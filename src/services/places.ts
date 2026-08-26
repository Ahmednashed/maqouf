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
  /** Merchandiser who owns this branch. Nullable — a branch may be unassigned. */
  assigned_user_id?: string | null;
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
  assigned_user_id?: string | null;
  is_active?: boolean;
}

// ─── Operational stats ────────────────────────────────────────────────────────

/**
 * Derived operational context for one branch. None of this is stored on
 * `places` — it is rolled up from visits and place_products so the branch
 * register can answer the questions a supervisor actually asks: when was
 * anyone last here, and is this branch's assortment set up at all.
 */
export interface PlaceOps {
  /** scheduled_date of the most recent visit that is not still pending. */
  last_visit_date:   string | null;
  last_visit_status: string | null;
  /** merch_id on that visit — who was actually last on site. */
  last_visit_merch:  string | null;
  /** Rows in place_products for this branch. */
  product_count:     number;
  /** Of those, the ones flagged is_mandatory. */
  required_count:    number;
}

/**
 * Roll up per-branch operational stats in two queries rather than N+1.
 *
 * Both tables are read with the narrowest possible column set and reduced in
 * memory. Visits come back newest-first, so the first row seen for a branch is
 * its latest visit and every later row for that branch can be skipped.
 *
 * NOTE ON SCALE: this reads every visit row the caller can see. That is fine at
 * the current volume and keeps the change migration-free, but it is the first
 * thing to convert to a Postgres view or RPC if visit history grows large.
 */
export async function fetchPlaceOperations(): Promise<Record<string, PlaceOps>> {
  const supabase = createClient();

  const [visitsRes, productsRes] = await Promise.all([
    supabase
      .from("visits")
      .select("place_id, scheduled_date, status, merch_id")
      .order("scheduled_date", { ascending: false }),
    supabase
      .from("place_products")
      .select("place_id, is_mandatory"),
  ]);

  if (visitsRes.error)   throw visitsRes.error;
  if (productsRes.error) throw productsRes.error;

  const ops: Record<string, PlaceOps> = {};

  const blank = (): PlaceOps => ({
    last_visit_date:   null,
    last_visit_status: null,
    last_visit_merch:  null,
    product_count:     0,
    required_count:    0,
  });

  for (const v of visitsRes.data ?? []) {
    const row = (ops[v.place_id] ??= blank());
    // Newest-first ordering means the first row wins; skip the rest. A visit
    // that is still "pending" has not happened yet, so it is not a last visit.
    if (row.last_visit_date !== null) continue;
    if (v.status === "pending") continue;
    row.last_visit_date   = v.scheduled_date;
    row.last_visit_status = v.status;
    row.last_visit_merch  = v.merch_id;
  }

  for (const p of productsRes.data ?? []) {
    const row = (ops[p.place_id] ??= blank());
    row.product_count += 1;
    if (p.is_mandatory) row.required_count += 1;
  }

  return ops;
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
