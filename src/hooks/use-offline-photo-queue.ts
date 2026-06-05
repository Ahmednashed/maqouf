"use client";

/**
 * use-offline-photo-queue
 *
 * Manages the offline photo queue for a single template photo field.
 * Scoped to one (visitId, fieldId) pair; used inside PhotoFieldInput.
 *
 * Responsibilities
 * ────────────────
 *  1. On mount    — load any existing pending/failed item from IndexedDB
 *                   and create a blob URL for local preview.
 *  2. On "online" — automatically process the pending item (upload to
 *                   Supabase Storage and persist the PhotoMeta response).
 *  3. enqueue()   — validate + save file to IDB + return local blob URL.
 *  4. retry()     — force an upload attempt (caller must be online).
 *  5. cancel()    — remove the queued item and revoke the blob URL.
 *  6. Cleanup     — revoke blob URLs on unmount to prevent memory leaks.
 *
 * Security
 * ────────
 *  - MIME type validated (must start with "image/").
 *  - Size validated (≤ 5 MB, matching MAX_PHOTO_SIZE_BYTES from storage.ts).
 *  - No auth tokens or secrets are stored in IndexedDB.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import {
  putQueueItem,
  getQueueItem,
  updateQueueItemStatus,
  removeQueueItem,
  type QueueItemStatus,
  type PhotoQueueItemStored,
} from "@/lib/offline-photo-queue";
import {
  uploadVisitPhoto,
  MAX_PHOTO_SIZE_BYTES,
  type PhotoMeta,
} from "@/services/storage";
import { saveVisitResponses } from "@/services/visit-responses";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface OfflinePhotoState {
  /**
   * "idle"      — no queued item for this field.
   * "pending"   — stored in IDB, awaiting upload.
   * "uploading" — network request in flight.
   * "uploaded"  — successfully synced; field now has real PhotoMeta.
   * "failed"    — upload failed; item still in IDB for retry.
   */
  status:   QueueItemStatus | "idle";
  /** Blob URL for local preview (non-null when pending/uploading/failed). */
  localUrl: string | null;
  /** IDB item id (null when idle or uploaded). */
  itemId:   number | null;
}

export interface UseOfflinePhotoQueueReturn {
  state:   OfflinePhotoState;
  /**
   * Validate and store a file in IndexedDB.
   * Returns a local blob URL for immediate preview, or null on validation
   * failure (invalid MIME type or file too large).
   */
  enqueue: (file: File) => Promise<string | null>;
  /**
   * Retry a failed upload.  Call only when navigator.onLine is true.
   * No-op if status is not "failed".
   */
  retry:   () => Promise<void>;
  /**
   * Cancel/remove the queued item.  Revokes the blob URL.
   * Intended for when the user changes their mind while offline.
   */
  cancel:  () => Promise<void>;
}

// ─── Hook ────────────────────────────────────────────────────────────────────

/**
 * @param visitId    Current visit being audited.
 * @param fieldId    Template field id (type === "photo").
 * @param templateId Needed to upsert the PhotoMeta response after upload.
 * @param onUploaded Called with (fieldId, PhotoMeta) after a successful sync
 *                   so the page can update its React state.
 */
export function useOfflinePhotoQueue(
  visitId:    string,
  fieldId:    string,
  templateId: string,
  onUploaded: (fieldId: string, meta: PhotoMeta) => void,
): UseOfflinePhotoQueueReturn {

  const [state, setState] = useState<OfflinePhotoState>({
    status:   "idle",
    localUrl: null,
    itemId:   null,
  });

  // Track the active blob URL so we can revoke it before creating a new one.
  const blobUrlRef    = useRef<string | null>(null);
  // Guard against concurrent upload attempts for the same field.
  const uploadingRef  = useRef(false);
  // Allow the mount-effect cleanup to cancel the async load.
  const mountedRef    = useRef(true);

  // ── Blob URL helpers ───────────────────────────────────────────────────────

  function makeBlobUrl(blob: Blob): string {
    if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
    const url         = URL.createObjectURL(blob);
    blobUrlRef.current = url;
    return url;
  }

  function revokeBlobUrl() {
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }
  }

  // ── Core upload logic ──────────────────────────────────────────────────────

  const uploadItem = useCallback(
    async (item: PhotoQueueItemStored) => {
      if (uploadingRef.current) return;
      uploadingRef.current = true;

      if (mountedRef.current) {
        setState((prev) => ({ ...prev, status: "uploading" }));
      }
      await updateQueueItemStatus(item.id, "uploading");

      try {
        // Reconstruct a File so uploadVisitPhoto receives the correct name/type.
        const file = new File([item.blob], item.file_name, {
          type: item.mime_type,
        });

        const meta = await uploadVisitPhoto(file, item.visit_id, item.field_id);

        // Persist the PhotoMeta as the field response on the server.
        await saveVisitResponses(item.visit_id, item.template_id, [
          { field_id: item.field_id, value: meta },
        ]);

        // Clean up: remove from IDB and revoke local blob URL.
        await removeQueueItem(item.id);
        revokeBlobUrl();

        if (mountedRef.current) {
          setState({ status: "uploaded", localUrl: null, itemId: null });
        }

        // Notify caller so the React field value is updated.
        onUploaded(item.field_id, meta);
      } catch {
        await updateQueueItemStatus(item.id, "failed");
        if (mountedRef.current) {
          setState((prev) => ({ ...prev, status: "failed" }));
        }
      } finally {
        uploadingRef.current = false;
      }
    },
    [onUploaded],
  );

  // ── Load existing item on mount ────────────────────────────────────────────

  useEffect(() => {
    mountedRef.current = true;

    async function loadFromIdb() {
      const item = await getQueueItem(visitId, fieldId);
      if (!item || !mountedRef.current) return;

      if (item.status === "uploading") {
        // Browser crashed mid-upload — reset to pending for next retry.
        await updateQueueItemStatus(item.id, "pending");
        item.status = "pending";
      }

      if (item.status === "pending" || item.status === "failed") {
        const url = makeBlobUrl(item.blob);
        setState({ status: item.status, localUrl: url, itemId: item.id });
      }
    }

    loadFromIdb().catch(console.error);

    return () => {
      mountedRef.current = false;
    };
    // visitId / fieldId are stable for the lifetime of this field instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visitId, fieldId]);

  // ── Auto-upload when connection returns ───────────────────────────────────

  useEffect(() => {
    async function handleOnline() {
      const item = await getQueueItem(visitId, fieldId);
      if (item && (item.status === "pending" || item.status === "failed")) {
        await uploadItem(item);
      }
    }

    window.addEventListener("online", handleOnline);
    return () => window.removeEventListener("online", handleOnline);
  }, [visitId, fieldId, uploadItem]);

  // ── Revoke blob URL on unmount ─────────────────────────────────────────────

  useEffect(() => {
    return () => revokeBlobUrl();
    // intentional: run only on unmount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Public API ─────────────────────────────────────────────────────────────

  const enqueue = useCallback(
    async (file: File): Promise<string | null> => {
      // Validate MIME type.
      if (!file.type.startsWith("image/")) return null;
      // Validate size (≤ 5 MB).
      if (file.size > MAX_PHOTO_SIZE_BYTES) return null;

      const id = await putQueueItem({
        visit_id:    visitId,
        template_id: templateId,
        field_id:    fieldId,
        blob:        file,
        file_name:   file.name,
        mime_type:   file.type,
        size:        file.size,
        created_at:  new Date().toISOString(),
        status:      "pending",
      });

      const localUrl = makeBlobUrl(file);
      setState({ status: "pending", localUrl, itemId: id });
      return localUrl;
    },
    [visitId, fieldId, templateId],
  );

  const retry = useCallback(async () => {
    if (state.status !== "failed" || state.itemId == null) return;
    const item = await getQueueItem(visitId, fieldId);
    if (item) await uploadItem(item);
  }, [state.status, state.itemId, visitId, fieldId, uploadItem]);

  const cancel = useCallback(async () => {
    if (state.itemId != null) await removeQueueItem(state.itemId);
    revokeBlobUrl();
    setState({ status: "idle", localUrl: null, itemId: null });
  }, [state.itemId]);

  return { state, enqueue, retry, cancel };
}
