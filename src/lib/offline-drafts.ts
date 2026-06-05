/**
 * offline-drafts.ts
 *
 * Pure, React-free utilities for persisting visit audit drafts in localStorage.
 * No auth tokens or secrets are stored here — only form state (qty, notes, field
 * responses).  Photo binaries are explicitly excluded from this step.
 *
 * Key format: malgoof_visit_draft_{visit_id}
 *
 * Draft lifecycle
 * ───────────────
 *  user edits  →  writeDraft (dirty=true)
 *  server save →  writeDraft (dirty=false)   ← kept as backup
 *  visit done  →  clearDraft
 *
 * Future extension: swap localStorage for IndexedDB by replacing the three
 * functions (readDraft / writeDraft / clearDraft) without changing any callers.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

/** Mirrors the ProductEntry shape used in the visit detail page. */
export interface DraftProductEntry {
  qty_found: string;   // raw text-input value — may be ""
  notes:     string;
}

/** product_id → DraftProductEntry */
export type DraftProducts  = Record<string, DraftProductEntry>;

/**
 * field_id → raw field value (same unknown union as FieldResponses in the UI).
 * Excludes photo values — those are not stored in this draft.
 */
export type DraftResponses = Record<string, unknown>;

/** Full draft record stored under the localStorage key. */
export interface VisitDraft {
  visit_id:              string;
  products:              DraftProducts;
  responses:             DraftResponses;
  /**
   * ISO-8601 timestamp of the last local write.
   * Used in the restore-prompt to show the user when the draft was saved.
   */
  last_saved_locally_at: string;
  /**
   * true  → edits have not yet been synced to the server.
   * false → last server-save succeeded; draft is kept as a read-only backup
   *         and will be cleared when the visit is completed.
   */
  dirty: boolean;
}

// ─── Key ─────────────────────────────────────────────────────────────────────

const KEY_PREFIX = "malgoof_visit_draft_";

export function draftKey(visitId: string): string {
  return `${KEY_PREFIX}${visitId}`;
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

/**
 * Read a draft from localStorage.
 * Returns null if none exists, if JSON is malformed, or if localStorage is
 * unavailable (private-browsing mode, SSR, storage-quota exceeded).
 */
export function readDraft(visitId: string): VisitDraft | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(draftKey(visitId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as VisitDraft;
    // Basic shape guard — rejects stale drafts from a different schema version.
    if (
      typeof parsed !== "object"    ||
      parsed === null               ||
      typeof parsed.visit_id !== "string" ||
      typeof parsed.dirty    !== "boolean"
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Persist a draft to localStorage.
 * Fails silently when localStorage is full or unavailable — the caller's
 * in-memory state is still the source of truth while the page is open.
 */
export function writeDraft(draft: VisitDraft): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(draftKey(draft.visit_id), JSON.stringify(draft));
  } catch {
    console.warn("[offline-drafts] write failed — storage may be full", draft.visit_id);
  }
}

/**
 * Remove a visit's draft from localStorage.
 * Called when the visit is completed (data is now on the server).
 */
export function clearDraft(visitId: string): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.removeItem(draftKey(visitId));
  } catch {
    // ignore
  }
}
