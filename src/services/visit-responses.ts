import { createClient } from "@/lib/supabase/client";

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
  value:    unknown;
}

/**
 * Upsert template-field responses for a visit.
 * Uses (visit_id, field_id) as the conflict target so re-saving is safe.
 * Skips rows where value is null/undefined to avoid cluttering the table.
 */
export async function saveVisitResponses(
  visitId:    string,
  templateId: string,
  items:      ResponseUpsertItem[]
): Promise<void> {
  if (!items.length) return;

  const supabase = createClient();

  const rows = items
    .filter((r) => r.value !== null && r.value !== undefined)
    .map((r) => ({
      visit_id:    visitId,
      template_id: templateId,
      field_id:    r.field_id,
      value:       r.value,
    }));

  if (!rows.length) return;

  const { error } = await supabase
    .from("visit_template_responses")
    .upsert(rows, { onConflict: "visit_id,field_id" });

  if (error) throw error;
}
