/**
 * offline-photo-queue.ts
 *
 * IndexedDB-backed queue for photos captured while offline.
 * Blobs are stored as raw binary (not base64) — no size inflation.
 *
 * Database : malgoof_offline  (version 1)
 * Store    : photo_queue
 *
 * One logical entry per (visit_id, field_id) pair.
 * Enqueueing a photo for the same field replaces the previous entry.
 *
 * Lifecycle
 * ─────────
 *  user selects photo offline  →  putQueueItem  (status: pending)
 *  connection restored          →  updateQueueItemStatus → uploading → uploaded
 *  upload fails                 →  status: failed  (kept for retry)
 *  visit completed              →  items auto-removed after successful upload
 */

// ─── Constants ────────────────────────────────────────────────────────────────

const DB_NAME    = "malgoof_offline" as const;
const DB_VERSION = 1;
export const STORE_NAME = "photo_queue" as const;

// ─── Types ────────────────────────────────────────────────────────────────────

export type QueueItemStatus = "pending" | "uploading" | "uploaded" | "failed";

export interface PhotoQueueItem {
  /** IDB auto-increment primary key — omit when creating. */
  id?:         number;
  visit_id:    string;
  /** Needed when persisting the PhotoMeta back to visit_template_responses. */
  template_id: string;
  field_id:    string;
  /** Raw binary Blob — never base64-encoded. */
  blob:        Blob;
  file_name:   string;
  mime_type:   string;
  size:        number;
  created_at:  string;
  status:      QueueItemStatus;
}

export interface PhotoQueueItemStored extends PhotoQueueItem {
  id: number;
}

// ─── DB singleton ─────────────────────────────────────────────────────────────

let _db: IDBDatabase | null = null;

function openDb(): Promise<IDBDatabase> {
  if (_db) return Promise.resolve(_db);

  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("[offline-photo-queue] IndexedDB not available"));
      return;
    }

    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;

      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, {
          keyPath:       "id",
          autoIncrement: true,
        });

        // Compound index — used to find the single item for a field.
        store.createIndex("by_visit_field", ["visit_id", "field_id"], {
          unique: false,  // non-unique; we handle replacement manually
        });

        // Single-key index — used to list all items for a visit.
        store.createIndex("by_visit_id", "visit_id", { unique: false });

        // Status index — used to find pending items across visits.
        store.createIndex("by_status", "status", { unique: false });
      }
    };

    req.onsuccess = (e) => {
      _db = (e.target as IDBOpenDBRequest).result;
      // Reset cached handle if the DB is force-closed (e.g., schema bump).
      _db.onclose = () => { _db = null; };
      resolve(_db);
    };

    req.onerror = (e) => {
      reject((e.target as IDBOpenDBRequest).error);
    };
  });
}

// ─── Promise wrapper ──────────────────────────────────────────────────────────

function idbReq<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result as T);
    req.onerror   = () => reject(req.error);
  });
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

/**
 * Upsert a photo queue item for a (visit_id, field_id) pair.
 *
 * Any existing item for the same pair is deleted first so the user's latest
 * selection always wins.  Returns the new IDB record id.
 */
export async function putQueueItem(
  item: Omit<PhotoQueueItem, "id">,
): Promise<number> {
  const db  = await openDb();
  const tx  = db.transaction(STORE_NAME, "readwrite");
  const st  = tx.objectStore(STORE_NAME);
  const idx = st.index("by_visit_field");

  // Delete stale entry for the same field (if any).
  const existing = await idbReq<PhotoQueueItemStored | undefined>(
    idx.get([item.visit_id, item.field_id]),
  );
  if (existing?.id != null) {
    await idbReq(st.delete(existing.id));
  }

  const key = await idbReq<IDBValidKey>(st.add(item));
  return key as number;
}

/**
 * Fetch the queue item for a specific (visit_id, field_id) pair.
 * Returns null if none exists or if IndexedDB is unavailable.
 */
export async function getQueueItem(
  visitId: string,
  fieldId: string,
): Promise<PhotoQueueItemStored | null> {
  try {
    const db  = await openDb();
    const tx  = db.transaction(STORE_NAME, "readonly");
    const idx = tx.objectStore(STORE_NAME).index("by_visit_field");
    const result = await idbReq<PhotoQueueItemStored | undefined>(
      idx.get([visitId, fieldId]),
    );
    return result ?? null;
  } catch {
    return null;
  }
}

/**
 * Update the status of a queue item by its IDB id.
 * Silently no-ops if the item no longer exists.
 */
export async function updateQueueItemStatus(
  id:     number,
  status: QueueItemStatus,
): Promise<void> {
  try {
    const db   = await openDb();
    const tx   = db.transaction(STORE_NAME, "readwrite");
    const st   = tx.objectStore(STORE_NAME);
    const item = await idbReq<PhotoQueueItemStored | undefined>(st.get(id));
    if (!item) return;
    await idbReq(st.put({ ...item, status }));
  } catch {
    // Ignore — status update is best-effort.
  }
}

/**
 * Delete a queue item by IDB id.
 * Used after a successful upload or when the user cancels.
 */
export async function removeQueueItem(id: number): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_NAME, "readwrite");
    await idbReq(tx.objectStore(STORE_NAME).delete(id));
  } catch {
    // Ignore — item may have already been removed.
  }
}

/**
 * Fetch all pending or failed items for a visit.
 * Used when reconnecting to upload everything at once.
 */
export async function getPendingItems(
  visitId: string,
): Promise<PhotoQueueItemStored[]> {
  try {
    const db  = await openDb();
    const tx  = db.transaction(STORE_NAME, "readonly");
    const idx = tx.objectStore(STORE_NAME).index("by_visit_id");
    const all = await idbReq<PhotoQueueItemStored[]>(idx.getAll(visitId));
    return all.filter(
      (i) => i.status === "pending" || i.status === "failed",
    );
  } catch {
    return [];
  }
}
