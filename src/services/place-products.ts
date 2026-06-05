import { createClient } from "@/lib/supabase/client";
import type { PlaceProduct, Product } from "@/types";

// ─── Extended type ────────────────────────────────────────────────────────────

/** A place_products row with the joined product always present. */
export type PlaceProductWithProduct = Omit<PlaceProduct, "product"> & {
  product: Product;
};

// ─── Payload types ────────────────────────────────────────────────────────────

export interface PlaceProductAssign {
  place_id:          string;
  product_id:        string;
  is_mandatory?:     boolean;
  min_stock?:        number;
  display_priority?: number;
  is_active?:        boolean;
}

export interface PlaceProductUpdate {
  is_mandatory?:     boolean;
  min_stock?:        number;
  display_priority?: number;
  is_active?:        boolean;
}

// ─── Read ─────────────────────────────────────────────────────────────────────

/**
 * Fetch all products assigned to a given place.
 * RLS scopes results to the authenticated user's company automatically.
 * Ordered by display_priority ASC so the UI respects sort order.
 */
export async function fetchPlaceProducts(
  placeId: string
): Promise<PlaceProductWithProduct[]> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from("place_products")
    .select(`
      *,
      product:products (*)
    `)
    .eq("place_id", placeId)
    .order("display_priority", { ascending: true })
    .order("created_at",       { ascending: false });

  if (error) throw error;
  return (data ?? []) as PlaceProductWithProduct[];
}

// ─── Create (Assign) ──────────────────────────────────────────────────────────

/**
 * Assign a product to a place.
 * The DB unique constraint (place_id, product_id) prevents duplicates.
 */
export async function assignPlaceProduct(
  payload: PlaceProductAssign
): Promise<PlaceProduct> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from("place_products")
    .insert({
      is_mandatory:     false,
      min_stock:        0,
      display_priority: 0,
      is_active:        true,
      ...payload,
    })
    .select()
    .single();

  if (error) throw error;
  return data as PlaceProduct;
}

// ─── Update ───────────────────────────────────────────────────────────────────

/**
 * Update the settings for a specific place↔product assignment.
 * Uses the composite PK (place_id, product_id) to target the row.
 */
export async function updatePlaceProduct(
  placeId:   string,
  productId: string,
  payload:   PlaceProductUpdate
): Promise<PlaceProduct> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from("place_products")
    .update(payload)
    .eq("place_id",  placeId)
    .eq("product_id", productId)
    .select()
    .single();

  if (error) throw error;
  return data as PlaceProduct;
}

// ─── Delete (Remove) ──────────────────────────────────────────────────────────

/**
 * Remove a product from a place.
 * Cascade on visit_products is handled by the DB schema.
 */
export async function removePlaceProduct(
  placeId:   string,
  productId: string
): Promise<void> {
  const supabase = createClient();

  const { error } = await supabase
    .from("place_products")
    .delete()
    .eq("place_id",   placeId)
    .eq("product_id", productId);

  if (error) throw error;
}
