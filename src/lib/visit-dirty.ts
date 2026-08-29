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
    // spell it differently. saveVisitResponses drops null/undefined, so a
    // field that was never answered has no saved row at all; typing into it
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
