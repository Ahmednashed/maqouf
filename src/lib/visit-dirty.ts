// ─────────────────────────────────────────────────────────────────────────────
// Whether the visit screen is holding edits the server has not got.
//
// Completing a visit does not save the audit — handleSave does — and the
// completion handler then clears the local draft. So a merchandiser who typed
// counts and pressed Complete without pressing Save lost the lot: the write
// never happened and the backup was deleted immediately after.
//
// syncStatus already tracks something close to this, but it flips to "unsaved"
// on any keystroke, including one that restores the original value. Comparing
// against what was actually loaded gives an answer with no false positives,
// which matters because this gates a button.
// ─────────────────────────────────────────────────────────────────────────────

/** A product row as loaded from the server. */
export interface SavedProduct {
  product_id: string;
  qty_found:  number | null;
  notes:      string | null;
}

/** The screen's local edit state for one product. */
export interface ProductEntry {
  qty_found: string;
  notes:     string;
}

export interface DirtyState {
  dirty:            boolean;
  changedProducts:  number;
  changedResponses: number;
}

const CLEAN: DirtyState = { dirty: false, changedProducts: 0, changedResponses: 0 };

/**
 * Structural equality for JSONB response values.
 *
 * Values come back from Postgres as parsed JSON, so they are plain data:
 * primitives, arrays and objects. Key order is not significant, which is why
 * this compares by key set rather than by JSON.stringify — two equal answers
 * serialised in different orders must not read as an edit.
 */
export function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  // null and undefined both mean "nothing recorded" here: a field that was
  // never answered and one explicitly cleared to null are the same state.
  if (a === null || a === undefined) return b === null || b === undefined;
  if (b === null || b === undefined) return false;

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => valuesEqual(v, b[i]));
  }
  if (typeof a === "object" && typeof b === "object") {
    const ka = Object.keys(a as object);
    const kb = Object.keys(b as object);
    if (ka.length !== kb.length) return false;
    return ka.every((k) =>
      Object.prototype.hasOwnProperty.call(b, k) &&
      valuesEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
    );
  }
  return false;
}

/**
 * "Nothing recorded" — the same set isAnswered() in visit-plan treats as
 * unanswered. Deliberately NOT used inside valuesEqual: nested empties are
 * real data, and "" inside an array is not the same as a missing element.
 */
function isBlank(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === "string") return v.trim() === "";
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

/** The screen seeds a missing product row as empty strings; mirror that here. */
function savedAsEntry(p: SavedProduct): ProductEntry {
  return {
    qty_found: p.qty_found !== null && p.qty_found !== undefined ? String(p.qty_found) : "",
    notes:     p.notes ?? "",
  };
}

export interface DiffInput {
  /**
   * False until the screen has copied server values into its edit state.
   * Before that the local state is empty and would diff against every saved
   * row, reporting a page that has just loaded as full of unsaved work.
   */
  ready:          boolean;
  savedProducts:  SavedProduct[];
  entries:        Record<string, ProductEntry>;
  /** Answerable field ids; sections are excluded by the caller. */
  fieldIds:       string[];
  savedResponses: Record<string, unknown>;
  responses:      Record<string, unknown>;
}

export function diffVisitEdits({
  ready, savedProducts, entries, fieldIds, savedResponses, responses,
}: DiffInput): DirtyState {
  if (!ready) return CLEAN;

  let changedProducts = 0;
  for (const p of savedProducts) {
    const saved = savedAsEntry(p);
    const local = entries[p.product_id] ?? { qty_found: "", notes: "" };
    if (local.qty_found !== saved.qty_found || local.notes !== saved.notes) changedProducts += 1;
  }

  let changedResponses = 0;
  for (const id of fieldIds) {
    const local = responses[id];
    const saved = savedResponses[id];
    // Both sides holding "nothing recorded" is not an edit, even when they
    // spell it differently. A field that was never answered has no saved row
    // at all (see responseSaveItems); typing into it
    // and clearing it again left local "" against saved undefined, which
    // compared unequal and pinned the visit as dirty with no way back except
    // saving. isAnswered() already treats all three as unanswered, so this
    // keeps dirtiness agreeing with the readiness summary.
    if (isBlank(local) && isBlank(saved)) continue;
    if (!valuesEqual(local, saved)) changedResponses += 1;
  }

  return {
    dirty: changedProducts > 0 || changedResponses > 0,
    changedProducts,
    changedResponses,
  };
}

const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

/**
 * The form answers a save sends.
 *
 * Every answer holding a value, and an explicit null for every answer this
 * screen has held and is now empty — a key in `responses` (loaded from the
 * server, typed, or restored from a draft). The null is what clears the saved
 * answer; leaving the field out, as saves used to, kept the old value on the
 * server while the screen showed it empty.
 *
 * An answer the screen has never held is left out, empty or not on the
 * server. If the server has a value the screen never saw, it arrived after
 * the screen loaded — a queued photo upload, another device — and is newer
 * than anything here, so a null must not overwrite it. Fields never answered
 * and never touched are left out too, so a save creates no empty rows.
 */
export function responseSaveItems(
  fieldIds:  string[],
  responses: Record<string, unknown>,
): Array<{ field_id: string; value: unknown }> {
  const items: Array<{ field_id: string; value: unknown }> = [];
  for (const id of fieldIds) {
    const value = responses[id];
    if (value !== null && value !== undefined) items.push({ field_id: id, value });
    else if (has(responses, id)) items.push({ field_id: id, value: null });
  }
  return items;
}

/** When a photo answer was uploaded, if it says (PhotoMeta.uploaded_at). */
function photoUploadedAt(v: unknown): number | null {
  if (typeof v !== "object" || v === null || typeof (v as { path?: unknown }).path !== "string") return null;
  const at = Date.parse(String((v as { uploaded_at?: unknown }).uploaded_at));
  return Number.isNaN(at) ? null : at;
}

/**
 * The answers to show when the user restores a local draft.
 *
 * Restoring used to replace the screen's answers with the draft's wholesale.
 * Two things in that were newer than the draft got lost:
 *
 *   • Answers the draft does not mention — they reached the screen or the
 *     server after the draft was written. They are kept.
 *   • A photo uploaded after the draft was written. Replacing a photo offline
 *     leaves null in the draft while the new photo waits in the upload queue;
 *     the queue uploads it later and writes its reference to the server
 *     directly. Restoring the draft's null over it, then saving, cleared that
 *     reference. Now a photo field keeps the newest photo uploaded after the
 *     draft was written, from the screen or the server, whatever the draft
 *     holds for it.
 *
 * Otherwise the draft wins, as before: it is the user's own unsaved work. A
 * photo the user removed after the newest upload stays removed, because the
 * draft holding that null was written after the upload.
 */
export function restoreDraftResponses(input: {
  draft:         Record<string, unknown>;
  /** The draft's last_saved_locally_at. */
  draftSavedAt:  string;
  current:       Record<string, unknown>;
  saved:         Record<string, unknown>;
  photoFieldIds: string[];
}): Record<string, unknown> {
  const restored: Record<string, unknown> = { ...input.saved, ...input.current, ...input.draft };
  const draftAt = Date.parse(input.draftSavedAt);
  for (const id of input.photoFieldIds) {
    let newest: unknown = undefined;
    let newestAt = Number.isNaN(draftAt) ? Infinity : draftAt;
    for (const candidate of [input.current[id], input.saved[id]]) {
      const at = photoUploadedAt(candidate);
      if (at !== null && at > newestAt) { newest = candidate; newestAt = at; }
    }
    if (newest !== undefined) restored[id] = newest;
  }
  return restored;
}
