import { createClient } from "@/lib/supabase/client";
import { valuesEqual } from "@/lib/visit-dirty";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface VisitTemplateResponse {
  id:          string;
  visit_id:    string;
  template_id: string;
  field_id:    string;
  value:       unknown;    // JSONB — typed per field.type at the call site
  created_at:  string;
  updated_at:  string;
}

/** field_id → raw JSONB value, built from fetched rows */
export type ResponseMap = Record<string, unknown>;

// ─── Read ─────────────────────────────────────────────────────────────────────

/**
 * Fetch all template-field responses for a single visit.
 * Returns an empty array (not an error) when the visit has no template or no
 * responses have been saved yet.
 */
export async function fetchVisitResponses(
  visitId: string
): Promise<VisitTemplateResponse[]> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from("visit_template_responses")
    .select("*")
    .eq("visit_id", visitId)
    .order("created_at", { ascending: true });

  if (error) throw error;
  return (data ?? []) as VisitTemplateResponse[];
}

// ─── Upsert (save / update) ───────────────────────────────────────────────────

export interface ResponseUpsertItem {
  field_id: string;
  /** null clears a saved answer (the row stays, with no value). */
  value:    unknown;
}

/**
 * The save went through, but the rows the database returned do not hold what
 * was sent — so the server may still have an older answer. The visit must not
 * be completed on the strength of this save.
 */
export class ResponsesNotStoredError extends Error {
  fieldIds: string[];
  constructor(fieldIds: string[]) {
    super(`${fieldIds.length} answer(s) were not stored as sent`);
    this.name     = "ResponsesNotStoredError";
    this.fieldIds = fieldIds;
  }
}

/**
 * Upsert template-field responses for a visit.
 * Uses (visit_id, field_id) as the conflict target so re-saving is safe.
 *
 * A null value is written as null, which is how a cleared answer reaches the
 * server: the row is updated rather than deleted, because merchandisers may
 * update their visit's answers but not delete them (RLS). Which empty fields
 * to send is the caller's choice — see responseSaveItems.
 *
 * The written rows are read back from the same request and compared with what
 * was sent; any difference throws ResponsesNotStoredError. "What was sent" is
 * each value after JSON conversion, the form it travels in: an object key set
 * to undefined is dropped and a non-finite number becomes null on the way, so
 * comparing against the in-memory value would report those as not stored on
 * every save. The rows sent are those same converted values.
 */
export async function saveVisitResponses(
  visitId:    string,
  templateId: string,
  items:      ResponseUpsertItem[]
): Promise<void> {
  if (!items.length) return;

  const supabase = createClient();

  const rows = items.map((r) => ({
    visit_id:    visitId,
    template_id: templateId,
    field_id:    r.field_id,
    value:       asSent(r.value),
  }));

  const { data, error } = await supabase
    .from("visit_template_responses")
    .upsert(rows, { onConflict: "visit_id,field_id" })
    .select("field_id, value");

  if (error) throw error;

  const stored = new Map(
    ((data ?? []) as Array<{ field_id: string; value: unknown }>).map((r) => [r.field_id, r.value]),
  );
  const notStored = rows
    .filter((r) => !stored.has(r.field_id) || !valuesEqual(stored.get(r.field_id), r.value))
    .map((r) => r.field_id);
  if (notStored.length) throw new ResponsesNotStoredError(notStored);
}

/** A value as JSON carries it; undefined (nothing recorded) is null. */
function asSent(value: unknown): unknown {
  const json = value === undefined ? undefined : JSON.stringify(value);
  return json === undefined ? null : (JSON.parse(json) as unknown);
}
