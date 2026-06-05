import { createClient } from "@/lib/supabase/client";
import type {
  Template,
  TemplateFieldFull,
  TemplateWithFields,
  TemplateListItem,
} from "@/types";
import { getMyCompanyId } from "@/lib/supabase/helpers";

// ─── Payload types ────────────────────────────────────────────────────────────

export interface TemplateInsert {
  name_ar:      string;
  name_en:      string;
  description?: string;
  status?:      "active" | "draft";
}

export interface TemplateUpdate {
  name_ar?:     string;
  name_en?:     string;
  description?: string;
  status?:      "active" | "draft";
}

export interface FieldInsert {
  type:          TemplateFieldFull["type"];
  label_ar:      string;
  label_en:      string;
  required?:     boolean;
  options?:      string[] | null;
  help_text_ar?: string | null;
  help_text_en?: string | null;
  sort_order?:   number;
}

export interface FieldUpdate {
  type?:          TemplateFieldFull["type"];
  label_ar?:      string;
  label_en?:      string;
  required?:      boolean;
  options?:       string[] | null;
  help_text_ar?:  string | null;
  help_text_en?:  string | null;
  sort_order?:    number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Resolve the company_users.id for the currently authenticated user.
 *
 * `templates.created_by` is a FK → company_users(id), NOT auth.users(id).
 * We look up the company_users row whose user_id matches auth.uid().
 * Returns null if the row doesn't exist yet (e.g. super-admin without a
 * company_users record) — in that case created_by is left NULL.
 */
async function getMyCompanyUserId(): Promise<string | null> {
  const supabase = createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from("company_users")
    .select("id")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data?.id ?? null;
}

// ─── Templates — Read list ────────────────────────────────────────────────────

/**
 * Fetch all templates for the current company.
 * Pulls only field IDs (not full rows) so we can display a count cheaply.
 * RLS scopes to company_id automatically.
 */
export async function fetchTemplates(): Promise<TemplateListItem[]> {
  const supabase = createClient();

  // Use explicit FK hint so PostgREST never ambiguously resolves the
  // template_fields relationship (template_fields has two outgoing FKs:
  // template_id → templates and company_id → companies).
  const { data, error } = await supabase
    .from("templates")
    .select("*, _fields:template_fields!template_fields_template_id_fkey(id)")
    .order("created_at", { ascending: false });

  if (error) throw error;

  // Cast once at the Supabase boundary — `*` gives all Template columns,
  // `_fields` is the aliased template_fields join selecting only `id`.
  const rows = (data ?? []) as unknown as Array<Template & { _fields: { id: string }[] }>;

  return rows.map((row) => ({
    ...row,
    field_count: row._fields?.length ?? 0,
    _fields:     undefined,
  })) as TemplateListItem[];
}

// ─── Templates — Read single (with full fields) ───────────────────────────────

/**
 * Fetch one template with all its fields ordered by sort_order.
 * Used by the builder page.
 */
export async function fetchTemplate(id: string): Promise<TemplateWithFields> {
  const supabase = createClient();

  const [tmplRes, fieldsRes] = await Promise.all([
    supabase.from("templates").select("*").eq("id", id).single(),
    supabase
      .from("template_fields")
      .select("*")
      .eq("template_id", id)
      .order("sort_order", { ascending: true }),
  ]);

  if (tmplRes.error)   throw tmplRes.error;
  if (fieldsRes.error) throw fieldsRes.error;

  return {
    ...(tmplRes.data as Template),
    fields: (fieldsRes.data ?? []) as TemplateFieldFull[],
  };
}

// ─── Templates — Create ───────────────────────────────────────────────────────

export async function createTemplate(
  payload: TemplateInsert
): Promise<Template> {
  const supabase = createClient();

  // Run both lookups in parallel — company_id for RLS, company_user_id for the FK
  const [company_id, company_user_id] = await Promise.all([
    getMyCompanyId(),
    getMyCompanyUserId(),
  ]);

  const { data, error } = await supabase
    .from("templates")
    .insert({
      company_id,
      // created_by → company_users(id), nullable — safe to pass null if the
      // current session has no company_users row (e.g. a super-admin account)
      created_by:  company_user_id,
      name_ar:     payload.name_ar,
      name_en:     payload.name_en,
      description: payload.description ?? null,
      status:      payload.status ?? "draft",
      usage_count: 0,
      fields:      [],   // legacy JSONB column kept for schema compatibility
    })
    .select()
    .single();

  if (error) throw error;
  return data as Template;
}

// ─── Templates — Update ───────────────────────────────────────────────────────

export async function updateTemplate(
  id:      string,
  payload: TemplateUpdate
): Promise<Template> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from("templates")
    .update(payload)
    .eq("id", id)
    .select()
    .single();

  if (error) throw error;
  return data as Template;
}

// ─── Templates — Delete ───────────────────────────────────────────────────────

/**
 * Delete a template.
 * template_fields must CASCADE on template_id FK in the DB.
 */
export async function deleteTemplate(id: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from("templates").delete().eq("id", id);
  if (error) throw error;
}

// ─── Fields — Create ──────────────────────────────────────────────────────────

/**
 * Add a field to a template.
 * sort_order defaults to (max existing + 10) so new fields always go to bottom.
 */
export async function createField(
  templateId: string,
  payload:    FieldInsert
): Promise<TemplateFieldFull> {
  const supabase   = createClient();
  const company_id = await getMyCompanyId();

  // Determine next sort_order
  let sortOrder = payload.sort_order;
  if (sortOrder === undefined) {
    const { data: existing } = await supabase
      .from("template_fields")
      .select("sort_order")
      .eq("template_id", templateId)
      .order("sort_order", { ascending: false })
      .limit(1);
    sortOrder = ((existing?.[0]?.sort_order ?? 0) as number) + 10;
  }

  const { data, error } = await supabase
    .from("template_fields")
    .insert({
      template_id:  templateId,
      company_id,
      type:         payload.type,
      label_ar:     payload.label_ar,
      label_en:     payload.label_en,
      required:     payload.required ?? false,
      sort_order:   sortOrder,
      options:      payload.options   ?? null,
      help_text_ar: payload.help_text_ar ?? null,
      help_text_en: payload.help_text_en ?? null,
    })
    .select()
    .single();

  if (error) throw error;
  return data as TemplateFieldFull;
}

// ─── Fields — Update ──────────────────────────────────────────────────────────

export async function updateField(
  fieldId: string,
  payload: FieldUpdate
): Promise<TemplateFieldFull> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from("template_fields")
    .update(payload)
    .eq("id", fieldId)
    .select()
    .single();

  if (error) throw error;
  return data as TemplateFieldFull;
}

// ─── Fields — Delete ──────────────────────────────────────────────────────────

export async function deleteField(fieldId: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from("template_fields")
    .delete()
    .eq("id", fieldId);
  if (error) throw error;
}

// ─── Fields — Reorder ─────────────────────────────────────────────────────────

/**
 * Persist a new sort_order for every field in the template after a move.
 * Fires N parallel updates (N = field count, typically 5-15).
 */
export async function reorderFields(
  updates: Array<{ id: string; sort_order: number }>
): Promise<void> {
  const supabase = createClient();

  await Promise.all(
    updates.map(({ id, sort_order }) =>
      supabase
        .from("template_fields")
        .update({ sort_order })
        .eq("id", id)
    )
  );
}
