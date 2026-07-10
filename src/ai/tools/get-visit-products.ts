import { z } from "zod";
import type { ToolContext } from "../types";
import { makeSource } from "../sources";
import { MAX_TOOL_ROWS } from "../config";

export const visitProductsArgs = z.object({
  visit_id: z.string().uuid(),
}).strict();

type Args = z.infer<typeof visitProductsArgs>;

interface Row {
  qty_found:   number | null;
  qty_missing: number | null;
  notes:       string | null;
  product: { name_ar: string; name_en: string; sku: string } | null;
}

/** Product audit results captured during one visit. */
export async function getVisitProducts(ctx: ToolContext, args: Args) {
  const { data, error } = await ctx.supabase
    .from("visit_products")
    .select("qty_found, qty_missing, notes, product:products (name_ar, name_en, sku)")
    .eq("visit_id", args.visit_id)
    .limit(MAX_TOOL_ROWS);

  if (error) throw error;

  const rows = (data ?? []) as unknown as Row[];
  const src = makeSource("visit", args.visit_id, `visit ${args.visit_id.slice(0, 8)}`);

  return {
    count: rows.length,
    with_missing_qty: rows.filter((r) => (r.qty_missing ?? 0) > 0).length,
    products: rows.map((r) => ({
      name: ctx.locale === "ar" ? r.product?.name_ar : r.product?.name_en,
      sku:  r.product?.sku,
      qty_found:   r.qty_found,
      qty_missing: r.qty_missing,
      note: r.notes?.slice(0, 100) ?? undefined,
    })),
    __sources: src ? [src] : [],
  };
}
