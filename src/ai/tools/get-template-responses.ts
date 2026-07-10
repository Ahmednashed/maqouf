import { z } from "zod";
import type { ToolContext } from "../types";
import { makeSource } from "../sources";
import { MAX_TOOL_ROWS } from "../config";

export const templateResponsesArgs = z.object({
  visit_id: z.string().uuid(),
}).strict();

type Args = z.infer<typeof templateResponsesArgs>;

interface Row {
  value: unknown;
  field: { label_ar: string; label_en: string; type: string; sort_order: number } | null;
}

/** Compact, safe rendering of one response value. Photos → marker only. */
function renderValue(value: unknown, fieldType: string | undefined): string {
  if (value === null || value === undefined) return "—";
  if (fieldType === "photo" || (typeof value === "object" && value !== null && "path" in (value as object))) {
    return "[photo]";
  }
  if (Array.isArray(value)) return value.slice(0, 5).map(String).join(", ").slice(0, 100);
  if (typeof value === "object") return JSON.stringify(value).slice(0, 100);
  return String(value).slice(0, 100);
}

/** Template field answers captured on one visit. */
export async function getTemplateResponses(ctx: ToolContext, args: Args) {
  const { data, error } = await ctx.supabase
    .from("visit_template_responses")
    .select("value, field:template_fields (label_ar, label_en, type, sort_order)")
    .eq("visit_id", args.visit_id)
    .limit(MAX_TOOL_ROWS);

  if (error) {
    if (error.code === "42P01" || error.code === "PGRST205") {
      return { available: false, responses: [] };
    }
    throw error;
  }

  const rows = ((data ?? []) as unknown as Row[])
    .sort((a, b) => (a.field?.sort_order ?? 0) - (b.field?.sort_order ?? 0));
  const src = makeSource("visit", args.visit_id, `visit ${args.visit_id.slice(0, 8)}`);

  return {
    available: true,
    count: rows.length,
    responses: rows.map((r) => ({
      field: ctx.locale === "ar" ? r.field?.label_ar : r.field?.label_en,
      type:  r.field?.type,
      value: renderValue(r.value, r.field?.type),
    })),
    __sources: src ? [src] : [],
  };
}
