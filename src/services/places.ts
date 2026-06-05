import { createClient } from "@/lib/supabase/client";
import type { Place, Chain } from "@/types";
import { getMyCompanyId } from "@/lib/supabase/helpers";

// ─── Extended types ───────────────────────────────────────────────────────────

/** Chain data joined on every place row for display in the table. */
export type PlaceChainInfo = Pick<Chain, "id" | "name_ar" | "name_en" | "code" | "color">;

/** Place row as returned by fetchPlaces — includes joined chain info. */
export type PlaceWithChain = Place & {
  chain?: PlaceChainInfo | null;
};

// ─── Payload types ────────────────────────────────────────────────────────────

export interface PlaceInsert {
  chain_id:   string;
  branch_ar:  string;
  branch_en:  string;
  code:       string;
  address_ar?: string;
  address_en?: string;
  city_ar?:   string;
  city_en?:   string;
  region?:    string;
  lat?:       number | null;
  lng?:       number | null;
  is_active?: boolean;
}

export interface PlaceUpdate {
  chain_id?:  string;
  branch_ar?: string;
  branch_en?: string;
  code?:      string;
  address_ar?: string;
  address_en?: string;
  city_ar?:   string;
  city_en?:   string;
  region?:    string;
  lat?:       number | null;
  lng?:       number | null;
  is_active?: boolean;
}

// ─── Read ─────────────────────────────────────────────────────────────────────

/**
 * Fetch all places for the current company.
 * RLS `places_select` filters automatically.
 * Joins chain info for display in the list.
 */
export async function fetchPlaces(): Promise<PlaceWithChain[]> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from("places")
    .select(`
      *,
      chain:chains (
        id, name_ar, name_en, code, color
      )
    `)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data ?? []) as PlaceWithChain[];
}

// ─── Create ───────────────────────────────────────────────────────────────────

/**
 * Create a new place.
 * company_id is resolved automatically so callers never need to pass it.
 */
export async function createPlace(payload: PlaceInsert): Promise<Place> {
  const supabase   = createClient();
  const company_id = await getMyCompanyId();

  const { data, error } = await supabase
    .from("places")
    .insert({
      ...payload,
      company_id,
      code: payload.code.toUpperCase(),
    })
    .select()
    .single();

  if (error) throw error;
  return data as Place;
}

// ─── Update ───────────────────────────────────────────────────────────────────

/**
 * Update an existing place.
 * RLS `places_update` restricts this to owner/admin within the same company.
 */
export async function updatePlace(id: string, payload: PlaceUpdate): Promise<Place> {
  const supabase = createClient();

  const update: PlaceUpdate = { ...payload };
  if (update.code) update.code = update.code.toUpperCase();

  const { data, error } = await supabase
    .from("places")
    .update(update)
    .eq("id", id)
    .select()
    .single();

  if (error) throw error;
  return data as Place;
}

// ─── Delete ───────────────────────────────────────────────────────────────────

/**
 * Delete a place.
 * RLS `places_delete` restricts this to owner/admin only.
 * Schedules, visits, and place_products linked to this place
 * are cascade-deleted by the DB schema.
 */
export async function deletePlace(id: string): Promise<void> {
  const supabase = createClient();

  const { error } = await supabase
    .from("places")
    .delete()
    .eq("id", id);

  if (error) throw error;
}
