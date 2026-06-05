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
