import { z } from "zod";
import type { ToolContext } from "../types";
import { makeSource } from "../sources";

export const visitPhotosArgs = z.object({
  visit_id: z.string().uuid(),
}).strict();

type Args = z.infer<typeof visitPhotosArgs>;

interface Row {
  value:      unknown;
  created_at: string;
  field: { label_ar: string; label_en: string; type: string } | null;
}

/** Duck-type check for the PhotoMeta shape stored in response values. */
function isPhotoMeta(v: unknown): v is { file_name: string; size: number; uploaded_at?: string } {
  return (
    typeof v === "object" && v !== null &&
    typeof (v as Record<string, unknown>).path === "string" &&
    typeof (v as Record<string, unknown>).file_name === "string" &&
    typeof (v as Record<string, unknown>).mime_type === "string"
  );
}

/**
 * Photo evidence attached to a visit — METADATA ONLY (field, filename size,
 * upload time). Never returns storage paths or signed URLs to the model.
 */
export async function getVisitPhotos(ctx: ToolContext, args: Args) {
  const { data, error } = await ctx.supabase
    .from("visit_template_responses")
    .select("value, created_at, field:template_fields (label_ar, label_en, type)")
    .eq("visit_id", args.visit_id)
    .limit(50);

  if (error) {
    if (error.code === "42P01" || error.code === "PGRST205") {
      return { available: false, photo_count: 0, photos: [] };
    }
    throw error;
  }

  const rows   = (data ?? []) as unknown as Row[];
  const photos = rows.filter((r) => isPhotoMeta(r.value));
  const src    = makeSource("visit", args.visit_id, `visit ${args.visit_id.slice(0, 8)}`);

  return {
    available: true,
    photo_count: photos.length,
    photos: photos.slice(0, 10).map((r) => {
      const meta = r.value as { size: number; uploaded_at?: string };
      return {
        field: ctx.locale === "ar" ? r.field?.label_ar : r.field?.label_en,
        size_kb: Math.round((meta.size ?? 0) / 1024),
        uploaded_at: meta.uploaded_at ?? r.created_at,
      };
    }),
    __sources: src ? [src] : [],
  };
}
