import { createClient } from "@/lib/supabase/client";
import type { Product, ProductCategory, ProductUnit } from "@/types";
import { getMyCompanyId } from "@/lib/supabase/helpers";

// ─── Payload types ────────────────────────────────────────────────────────────

export interface ProductInsert {
  sku:        string;
  name_ar:    string;
  name_en:    string;
  category:   ProductCategory;
  unit:       ProductUnit;
  cost?:      number | null;
  price?:     number | null;
  stock?:     number;
  image_url?: string;
  is_active?: boolean;
}

export interface ProductUpdate {
  sku?:       string;
  name_ar?:   string;
  name_en?:   string;
  category?:  ProductCategory;
  unit?:      ProductUnit;
  cost?:      number | null;
  price?:     number | null;
  stock?:     number;
  image_url?: string;
  is_active?: boolean;
}

// ─── Assortment coverage ──────────────────────────────────────────────────────

/**
 * Where a product is actually tracked. A catalogue entry that no branch carries
 * is operationally dead — nobody will ever be asked to check it — and the
 * products screen had no way to tell those apart from the ones doing work.
 */
export interface ProductCoverage {
  /** Branches whose assortment includes this product (active rows only). */
  branch_count:   number;
  /** Of those, the branches that mark it required. */
  required_count: number;
}

/** One row per product, straight out of `public.v_product_coverage` (024). */
interface ProductCoverageRow {
  product_id:     string;
  branch_count:   number;
  required_count: number;
}

const PRODUCT_COVERAGE_COLUMNS = "product_id, branch_count, required_count";

/**
 * Roll up assortment coverage per product in one query.
 *
 * WHAT CHANGED, AND WHY
 * ─────────────────────
 * This used to fetch EVERY place_products row the caller could see and reduce
 * them in the browser — no filter, no limit and, worse, no ordering, so a
 * PostgREST db-max-rows ceiling would have truncated it silently and produced
 * coverage counts that were wrong with no error anywhere. See
 * docs/PERFORMANCE-RISKS.md §3. It was the last unbounded read feeding the
 * dashboard attention panel; migration 022 had already dealt with the others.
 *
 * The view does the same reduction in Postgres. It is `security_invoker = true`,
 * so `products_select` and `place_products_select` are still evaluated as the
 * querying user.
 *
 * The meaning of "covered" now lives in the view definition: only `is_active`
 * assortment rows count, because a product parked on a branch is not being
 * tracked there. Note this deliberately differs from
 * `v_branch_operations.product_count`, which counts all rows to match what the
 * branch register showed before 022. The two disagree on purpose.
 *
 * The view LEFT JOINs from `products`, so a product no branch carries returns
 * `branch_count: 0` where this function previously produced no map entry at
 * all. Both readers already go through `coverage[id]?.field ?? 0`:
 * `deriveAttention()` iterates products and looks each one up, and
 * `CoverageCell` treats 0 and undefined identically. Pinned by tests.
 *
 * There is deliberately NO fallback to the old scan. If the view is missing,
 * this must fail loudly rather than quietly reinstate the whole-table read it
 * exists to remove.
 */
export async function fetchProductCoverage(): Promise<Record<string, ProductCoverage>> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from("v_product_coverage")
    .select(PRODUCT_COVERAGE_COLUMNS);

  if (error) throw error;

  const out: Record<string, ProductCoverage> = {};

  for (const row of (data ?? []) as ProductCoverageRow[]) {
    out[row.product_id] = {
      branch_count:   row.branch_count,
      required_count: row.required_count,
    };
  }

  return out;
}

// ─── Read ─────────────────────────────────────────────────────────────────────

/**
 * Fetch all products for the current company.
 * RLS `products_select` filters automatically.
 */
export async function fetchProducts(): Promise<Product[]> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from("products")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data ?? []) as Product[];
}

// ─── Create ───────────────────────────────────────────────────────────────────

/**
 * Create a new product.
 * company_id is resolved automatically so callers never need to pass it.
 */
export async function createProduct(payload: ProductInsert): Promise<Product> {
  const supabase   = createClient();
  const company_id = await getMyCompanyId();

  const { data, error } = await supabase
    .from("products")
    .insert({
      ...payload,
      company_id,
      sku:   payload.sku.toUpperCase(),
      stock: payload.stock ?? 0,
    })
    .select()
    .single();

  if (error) throw error;
  return data as Product;
}

// ─── Update ───────────────────────────────────────────────────────────────────

/**
 * Update an existing product.
 * RLS restricts this to owner/admin within the same company.
 */
export async function updateProduct(id: string, payload: ProductUpdate): Promise<Product> {
  const supabase = createClient();

  const update: ProductUpdate = { ...payload };
  if (update.sku) update.sku = update.sku.toUpperCase();

  const { data, error } = await supabase
    .from("products")
    .update(update)
    .eq("id", id)
    .select()
    .single();

  if (error) throw error;
  return data as Product;
}

// ─── Delete ───────────────────────────────────────────────────────────────────

/**
 * Delete a product.
 * RLS `products_delete` restricts this to owner/admin only.
 * place_products and visit_products linked to this product are cascade-deleted.
 */
export async function deleteProduct(id: string): Promise<void> {
  const supabase = createClient();

  const { error } = await supabase
    .from("products")
    .delete()
    .eq("id", id);

  if (error) throw error;
}
