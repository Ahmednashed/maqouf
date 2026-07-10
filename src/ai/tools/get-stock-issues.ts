import { z } from "zod";
import type { ToolContext } from "../types";
import { makeSource } from "../sources";
import { MAX_TOOL_ROWS } from "../config";

export const stockIssuesArgs = z.object({
  days: z.number().int().min(1).max(30).optional(),
}).strict();

type Args = z.infer<typeof stockIssuesArgs>;

interface MissingRow {
  qty_missing: number | null;
  product: { id: string; name_ar: string; name_en: string; sku: string } | null;
  visit:   { scheduled_date: string; place: { branch_ar: string; branch_en: string } | null } | null;
}

interface ExpiringRow {
  qty:         number;
  expiry_date: string;
  batch:       string;
  product: { id: string; name_ar: string; name_en: string } | null;
  place:   { branch_ar: string; branch_en: string } | null;
}

/** Missing-quantity reports (last N days) + products expiring within 30 days. */
export async function getStockIssues(ctx: ToolContext, args: Args) {
  const days = args.days ?? 7;
  const from = new Date(ctx.date + "T00:00:00Z");
  from.setUTCDate(from.getUTCDate() - days + 1);
  const fromDate = from.toISOString().slice(0, 10);

  const expiryLimit = new Date(ctx.date + "T00:00:00Z");
  expiryLimit.setUTCDate(expiryLimit.getUTCDate() + 30);

  const [missingRes, expiringRes] = await Promise.all([
    ctx.supabase
      .from("visit_products")
      .select(`
        qty_missing,
        product:products (id, name_ar, name_en, sku),
        visit:visits!inner (scheduled_date, place:places (branch_ar, branch_en))
      `)
      .gt("qty_missing", 0)
      .gte("visit.scheduled_date", fromDate)
      .lte("visit.scheduled_date", ctx.date)
      .limit(MAX_TOOL_ROWS),
    ctx.supabase
      .from("expiring_products")
      .select(`
        qty, expiry_date, batch,
        product:products (id, name_ar, name_en),
        place:places (branch_ar, branch_en)
      `)
      .lte("expiry_date", expiryLimit.toISOString().slice(0, 10))
      .gte("expiry_date", ctx.date)
      .order("expiry_date")
      .limit(MAX_TOOL_ROWS),
  ]);

  if (missingRes.error)  throw missingRes.error;
  // expiring_products may be unused in some deployments — degrade quietly
  const expiring = expiringRes.error ? [] : ((expiringRes.data ?? []) as unknown as ExpiringRow[]);
  const missing  = (missingRes.data ?? []) as unknown as MissingRow[];

  const pName  = (p: { name_ar: string; name_en: string } | null) =>
    ctx.locale === "ar" ? p?.name_ar : p?.name_en;
  const bName  = (b: { branch_ar: string; branch_en: string } | null) =>
    ctx.locale === "ar" ? b?.branch_ar : b?.branch_en;

  const sources = missing
    .slice(0, 3)
    .map((r) => (r.product ? makeSource("product", r.product.id, pName(r.product) ?? "") : null))
    .filter(Boolean);

  return {
    period_days: days,
    missing_count: missing.length,
    missing: missing.map((r) => ({
      product: pName(r.product),
      sku:     r.product?.sku,
      qty_missing: r.qty_missing,
      branch:  bName(r.visit?.place ?? null),
      date:    r.visit?.scheduled_date,
    })),
    expiring_count: expiring.length,
    expiring: expiring.slice(0, 10).map((r) => ({
      product: pName(r.product),
      qty: r.qty,
      expiry_date: r.expiry_date,
      branch: bName(r.place),
    })),
    __sources: sources,
  };
}
