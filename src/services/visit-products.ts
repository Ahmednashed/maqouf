import { createClient } from "@/lib/supabase/client";

// ─── Raw Supabase join row shape (private to this module) ────────────────────
// Mirrors exactly what PostgREST returns for the visit_products + products join.

interface VisitProductQueryRow {
  visit_id:    string;
  product_id:  string;
  qty_found:   number | null;
  qty_missing: number | null;
  notes:       string | null;
  created_at:  string;
  product: {
    id:         string;
    name_ar:    string;
    name_en:    string;
    sku:        string;
    unit:       string;
    image_url?: string | null;
  } | null;
}

// ─── Extended type ────────────────────────────────────────────────────────────

/**
 * A visit_products row enriched with product details (from products table)
 * and shelf settings (merged from place_products for the visit's branch).
 */
export type VisitProductWithDetails = {
  visit_id:         string;
  product_id:       string;
  qty_found:        number | null;
  qty_missing:      number | null;
  notes:            string | null;
  created_at:       string;
  // joined from products
  product: {
    id:         string;
    name_ar:    string;
    name_en:    string;
    sku:        string;
    unit:       string;
    image_url?: string;
  };
  // merged from place_products (branch-specific settings)
  is_mandatory:     boolean;
  min_stock:        number;
  display_priority: number;
};

// ─── Save payload ─────────────────────────────────────────────────────────────

export interface VisitProductSave {
  product_id:  string;
  qty_found:   number | null;
  qty_missing: number | null;
  notes:       string | null;
}

// ─── Read ─────────────────────────────────────────────────────────────────────

/**
 * Fetch all visit_products for a visit, merging branch-level shelf settings
 * (is_mandatory, min_stock, display_priority) from place_products.
 * Results are sorted by display_priority ASC, then product name.
 */
export async function fetchVisitProducts(
  visitId: string,
  placeId: string
): Promise<VisitProductWithDetails[]> {
  const supabase = createClient();

  const [vpResult, ppResult] = await Promise.all([
    supabase
      .from("visit_products")
      .select("*, product:products(id, name_ar, name_en, sku, unit, image_url)")
      .eq("visit_id", visitId),
    supabase
      .from("place_products")
      .select("product_id, is_mandatory, min_stock, display_priority")
      .eq("place_id", placeId),
  ]);

  if (vpResult.error) throw vpResult.error;
  if (ppResult.error) throw ppResult.error;

  const ppMap = new Map(
    (ppResult.data ?? []).map((p) => [p.product_id, p])
  );

  const vpRows = (vpResult.data ?? []) as unknown as VisitProductQueryRow[];

  return vpRows
    .map((v) => ({
      ...v,
      is_mandatory:     ppMap.get(v.product_id)?.is_mandatory     ?? false,
      min_stock:        ppMap.get(v.product_id)?.min_stock         ?? 0,
      display_priority: ppMap.get(v.product_id)?.display_priority  ?? 999,
    }))
    .sort((a, b) => {
      if (a.display_priority !== b.display_priority)
        return a.display_priority - b.display_priority;
      // mandatory products float to top within the same priority band
      if (a.is_mandatory !== b.is_mandatory) return a.is_mandatory ? -1 : 1;
      return 0;
    }) as VisitProductWithDetails[];
}

// ─── Init from place_products (idempotent) ────────────────────────────────────

/**
 * Seed visit_products rows from the branch's active assortment.
 * Uses ignoreDuplicates so re-starting a visit never overwrites existing data.
 * Called internally by startVisit() in visits.ts.
 */
export async function initVisitProducts(
  visitId: string,
  placeId: string
): Promise<void> {
  const supabase = createClient();

  const { data: pp, error: ppErr } = await supabase
    .from("place_products")
    .select("product_id")
    .eq("place_id", placeId)
    .eq("is_active", true);

  if (ppErr) throw ppErr;
  if (!pp || pp.length === 0) return;

  const rows = pp.map((p) => ({
    visit_id:    visitId,
    product_id:  p.product_id,
    qty_found:   null,
    qty_missing: null,
    notes:       null,
  }));

  const { error } = await supabase
    .from("visit_products")
    .upsert(rows, { onConflict: "visit_id,product_id", ignoreDuplicates: true });

  if (error) throw error;
}

// ─── Save (upsert audit results) ──────────────────────────────────────────────

/**
 * Persist the merchandiser's audit data for all products in a visit.
 * Uses upsert so partial saves accumulate correctly over multiple taps.
 */
export async function saveVisitProducts(
  visitId: string,
  items:   VisitProductSave[]
): Promise<void> {
  if (items.length === 0) return;
  const supabase = createClient();

  const rows = items.map((item) => ({
    visit_id:    visitId,
    product_id:  item.product_id,
    qty_found:   item.qty_found,
    qty_missing: item.qty_missing,
    notes:       item.notes,
  }));

  const { error } = await supabase
    .from("visit_products")
    .upsert(rows, { onConflict: "visit_id,product_id" });

  if (error) throw error;
}
