/**
 * visit-completion.ts
 *
 * The rules for completing a visit that may hold unsaved audit work, and for
 * what to do with a local draft. Pure and React-free, so they can be tested
 * directly; the visit page and CompleteModal call them.
 *
 * WHY THIS EXISTS
 * ───────────────
 * Completing a visit closes it. Audit work is saved separately (handleSave on
 * the visit page), and a local draft in localStorage is the only copy of work
 * the server has not got. Three things went wrong around that boundary:
 *
 *   • Completing offline was allowed after an acknowledgement. TanStack Query
 *     pauses a mutation while it believes the device is offline and runs it
 *     when the connection returns — so the visit could be closed on reconnect
 *     before anyone saved the draft, leaving that draft with no way back in.
 *   • A draft for a visit that was already closed was never shown again: the
 *     restore prompt only appears on an open visit.
 *   • Nothing re-synced a draft on reconnect, though the offline toast said
 *     it would.
 *
 * THE RULES
 * ─────────
 *   • No completion offline. The completion request is not queued either
 *     (useCompleteVisit runs with networkMode "always"), so it can never fire
 *     later, behind the user's back.
 *   • Online with unsaved edits: save first; complete only if the save
 *     succeeded. A failed save leaves the visit open and the draft in place.
 *   • No automatic upload on reconnect. The user is shown "Sync now".
 *   • A dirty draft for a closed visit is shown read-only. It is never written
 *     to the closed visit and never deleted without the user asking.
 */

import type { VisitDraft } from "@/lib/offline-drafts";
import type { TranslationKey } from "@/lib/i18n/translations";

// ─── Completion ───────────────────────────────────────────────────────────────

/** Why the completion button is unavailable, or null when it can be pressed. */
export type CompletionBlock = "offline" | "ack" | null;

export function completionBlock(input: {
  isOnline: boolean;
  /** The dialog asks for an acknowledgement of outstanding work. */
  needsAck: boolean;
  acked:    boolean;
}): CompletionBlock {
  if (!input.isOnline) return "offline";
  if (input.needsAck && !input.acked) return "ack";
  return null;
}

/**
 * What the completion dialog shows and allows, as translation keys. Kept here
 * rather than in the component so it can be tested without rendering it.
 */
export interface CompletionDialogView {
  block:           CompletionBlock;
  confirmDisabled: boolean;
  confirmLabel:    TranslationKey;
  /** Tooltip on the confirm button explaining why it is unavailable. */
  confirmTitle:    TranslationKey | null;
  /** The line under "You have unsaved changes". */
  unsavedMessage:  TranslationKey | null;
  /** Offline with nothing unsaved: why completing is unavailable. */
  offlineNotice:   TranslationKey | null;
}

export function completionDialogView(input: {
  isOnline: boolean;
  dirty:    boolean;
  needsAck: boolean;
  acked:    boolean;
  /** A save or completion is in flight. */
  busy:     boolean;
}): CompletionDialogView {
  const block = completionBlock(input);
  return {
    block,
    confirmDisabled: input.busy || block !== null,
    confirmLabel:    input.dirty ? "visits.saveAndComplete" : "visits.complete",
    confirmTitle:    block === "offline" ? "offline.completeOfflineDisabled" : block === "ack" ? "visits.ready.ackRequired" : null,
    unsavedMessage:  input.dirty ? (input.isOnline ? "visits.unsaved.willSave" : "visits.unsaved.offlineBlocked") : null,
    offlineNotice:   !input.isOnline && !input.dirty ? "offline.completeOfflineDisabled" : null,
  };
}

export type CompletionOutcome =
  /**
   * The visit is closed. `savedFirst`: unsaved edits were saved before it.
   * `revision`: the edit revision that was saved (or found clean) — the local
   * draft may only be cleared if nothing has been edited since.
   */
  | { kind: "completed"; savedFirst: boolean; revision: number | null }
  /**
   * The edits changed while they were being saved, so what was saved is not
   * what is on screen. Nothing was completed and the draft is untouched.
   */
  | { kind: "changedDuringSave" }
  /** The edits could not be saved, so the visit was not completed. */
  | { kind: "saveFailed" }
  /** No connection, before or between the two steps. Nothing was completed. */
  | { kind: "offline" }
  /** The edits (if any) were saved, but completing itself failed. */
  | { kind: "completeFailed"; error: unknown };

/**
 * Save unsaved edits, then — and only then — complete.
 *
 * `save` resolves true when everything was saved (the page's handleSave).
 * `isOnline` is read again between the steps: a connection that drops during
 * the save must not lead to a completion request.
 */
export async function saveThenComplete(input: {
  dirty:    boolean;
  isOnline: () => boolean;
  save:     () => Promise<boolean>;
  complete: () => Promise<unknown>;
  /**
   * The current edit revision (bumped on every local edit). Read when the
   * operation starts and again just before the completion request: if it
   * moved, the visit is not completed.
   */
  revision?: () => number;
}): Promise<CompletionOutcome> {
  if (!input.isOnline()) return { kind: "offline" };
  const startRevision = input.revision ? input.revision() : null;

  let savedFirst = false;
  if (input.dirty) {
    let ok = false;
    try { ok = await input.save(); } catch { ok = false; }
    if (!ok) return { kind: "saveFailed" };
    savedFirst = true;
    if (!input.isOnline()) return { kind: "offline" };
  }

  if (input.revision && input.revision() !== startRevision) return { kind: "changedDuringSave" };

  try {
    await input.complete();
  } catch (error) {
    return { kind: "completeFailed", error };
  }
  return { kind: "completed", savedFirst, revision: startRevision };
}

/**
 * Whether nothing has been edited since `revision` — so a copy written or
 * cleared on the strength of that revision is still accurate. A null revision
 * (not tracked) never vouches for anything.
 */
export function noEditsSince(revision: number | null | undefined, current: number): boolean {
  return typeof revision === "number" && revision === current;
}

// ─── Closing the dialog while it works ────────────────────────────────────────

/** Every way the completion dialog can be asked to close. */
export type CompletionCloseSource = "backdrop" | "closeButton" | "cancel" | "escape";

/**
 * Holds the completion dialog open while "Save and complete" or "Complete"
 * runs. The check happens in the close handler itself, read at the moment of
 * the request — a disabled button is only the visible half of it. Closing
 * mid-operation used to leave the save and completion running behind a page
 * the user could edit again, whose newer edits the completion then dropped.
 */
export function createCompletionGuard() {
  let running = false;
  return {
    /** Start an operation. False if one is already running (a second press). */
    begin(): boolean {
      if (running) return false;
      running = true;
      return true;
    },
    end(): void { running = false; },
    isRunning(): boolean { return running; },
    /** Close only when nothing is running. Returns whether it closed. */
    requestClose(_source: CompletionCloseSource, close: () => void): boolean {
      if (running) return false;
      close();
      return true;
    },
  };
}

// ─── Local drafts ─────────────────────────────────────────────────────────────

/**
 *   none       — no draft, or only the clean backup a successful save leaves
 *   restorable — unsaved work for a visit that is still open: offer to restore
 *   stranded   — unsaved work for a visit that is already closed: show it
 *                read-only; never write it to the visit, never delete it unasked
 */
export type StoredDraftState = "none" | "restorable" | "stranded";

export function classifyStoredDraft(draft: VisitDraft | null, visitIsClosed: boolean): StoredDraftState {
  if (!draft || !draft.dirty) return "none";
  return visitIsClosed ? "stranded" : "restorable";
}

/**
 * Whether to ask the user to sync now, and why.
 *
 *   backOnline — the device was offline while holding unsaved edits and is
 *                back online; nothing has uploaded them
 *   failed     — the last save failed and the edits are still unsaved
 */
export type SyncPrompt = "backOnline" | "failed" | null;

export function syncPrompt(input: {
  isOnline:   boolean;
  /** Edits differ from what the server has. */
  dirty:      boolean;
  wasOffline: boolean;
  saveFailed: boolean;
}): SyncPrompt {
  if (!input.isOnline || !input.dirty) return null;
  if (input.saveFailed) return "failed";
  if (input.wasOffline) return "backOnline";
  return null;
}

// ─── What a stranded draft holds ──────────────────────────────────────────────

export interface StrandedProductRow {
  product_id: string;
  name_ar:    string;
  name_en:    string;
  qty_found:  string;
  notes:      string;
}

export interface StrandedResponseRow {
  field_id: string;
  label_ar: string;
  label_en: string;
  value:    string;
}

/**
 * The entries of a stranded draft that differ from what the visit has saved —
 * i.e. the work that would otherwise be lost — in a form that can be shown.
 * Products and fields the visit no longer knows are still listed, by id, so
 * nothing in the draft is hidden.
 */
export function describeStrandedDraft(
  draft: VisitDraft,
  saved: {
    products:  Array<{ product_id: string; qty_found: number | null; notes: string | null; name_ar?: string; name_en?: string }>;
    fields:    Array<{ id: string; label_ar: string; label_en: string }>;
    responses: Record<string, unknown>;
  },
): { products: StrandedProductRow[]; responses: StrandedResponseRow[] } {
  const savedById = new Map(saved.products.map((p) => [p.product_id, p]));
  const products: StrandedProductRow[] = [];
  for (const [productId, entry] of Object.entries(draft.products ?? {})) {
    const s = savedById.get(productId);
    const savedQty   = s?.qty_found != null ? String(s.qty_found) : "";
    const savedNotes = s?.notes ?? "";
    const qty   = entry?.qty_found ?? "";
    const notes = entry?.notes ?? "";
    if (s && qty === savedQty && notes === savedNotes) continue;
    products.push({ product_id: productId, name_ar: s?.name_ar ?? productId, name_en: s?.name_en ?? productId, qty_found: qty, notes });
  }

  const fieldsById = new Map(saved.fields.map((f) => [f.id, f]));
  const responses: StrandedResponseRow[] = [];
  for (const [fieldId, value] of Object.entries(draft.responses ?? {})) {
    if (JSON.stringify(value ?? null) === JSON.stringify(saved.responses[fieldId] ?? null)) continue;
    const f = fieldsById.get(fieldId);
    responses.push({ field_id: fieldId, label_ar: f?.label_ar ?? fieldId, label_en: f?.label_en ?? fieldId, value: displayValue(value) });
  }
  return { products, responses };
}

function displayValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (Array.isArray(value)) return value.map((v) => displayValue(v)).join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
