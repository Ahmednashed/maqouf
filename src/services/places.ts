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

/** When a branch was last actually visited. Shared by the branch register and
 *  the Branch Coverage report so both mean the same thing by "last visit". */
export interface BranchLastVisit {
  last_visit_date:   string | null;
  last_visit_status: string | null;
  last_visit_merch:  string | null;
}

// ─── Branch operations, from the database ────────────────────────────────────

/**
 * One row per branch, straight out of `public.v_branch_operations`
 * (migration 022).
 *
 * WHAT CHANGED, AND WHY
 * ─────────────────────
 * Both functions below used to fetch EVERY visit row the caller could see and
 * reduce them in the browser to answer one question per branch: when was it
 * last actually visited. That is one whole-table read on the three most-loaded
 * screens — see docs/PERFORMANCE-RISKS.md §1.
 *
 * The view does the same reduction in Postgres and returns one row per branch.
 * It is declared `security_invoker = true`, so base-table RLS is still
 * evaluated as the querying user: a merchandiser continues to see only visits
 * assigned to them, exactly as the client-side version did.
 *
 * The meaning of "visited" — completed or in progress, never pending or
 * missed — now lives in the view definition rather than here. It is stated in
 * migration 022 and must stay in step with `matchesLastVisitBucket()` and the
 * branch coverage report, which read these same fields.
 *
 * There is deliberately NO fallback to the old client-side scan. If the view
 * is missing, these calls must fail loudly rather than quietly degrade into
 * the whole-table read this change exists to remove.
 */
interface BranchOperationsRow {
  place_id:          string;
  last_visit_date:   string | null;
  last_visit_status: string | null;
  last_visit_merch:  string | null;
  product_count:     number;
  required_count:    number;
}

const BRANCH_OPS_COLUMNS =
  "place_id, last_visit_date, last_visit_status, last_visit_merch, product_count, required_count";

async function fetchBranchOperationRows(): Promise<BranchOperationsRow[]> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from("v_branch_operations")
    .select(BRANCH_OPS_COLUMNS);

  if (error) throw error;
  return (data ?? []) as BranchOperationsRow[];
}

/**
 * Most recent real visit per branch, across ALL history.
 *
 * Deliberately not scoped to any reporting window: "last visited 40 days ago"
 * is a fact about the branch, and measuring it inside a 30-day range would
 * make every stale branch look either fine or unvisited depending on where the
 * window happened to fall.
 *
 * The view returns a row for every visible branch, including ones that have
 * never been visited (all three fields null). The previous version simply had
 * no map entry for those. Both read identically at every call site, because
 * each one goes through `ops[id]?.field ?? null`.
 */
export async function fetchBranchLastVisits(): Promise<Record<string, BranchLastVisit>> {
  const rows = await fetchBranchOperationRows();

  const out: Record<string, BranchLastVisit> = {};
  for (const r of rows) {
    out[r.place_id] = {
      last_visit_date:   r.last_visit_date,
      last_visit_status: r.last_visit_status,
      last_visit_merch:  r.last_visit_merch,
    };
  }
  return out;
}

/**
 * Whole days from a "YYYY-MM-DD" date to the Riyadh business day, or null when
 * the branch has never been visited. UTC-anchored so it cannot drift.
 */
export function daysSinceIso(iso: string | null, todayIso: string): number | null {
  if (!iso) return null;
  const a = Date.parse(iso      + "T00:00:00Z");
  const b = Date.parse(todayIso + "T00:00:00Z");
  return Math.round((b - a) / 86_400_000);
}

/**
 * Per-branch operational stats — last real visit, and assortment counts.
 *
 * One query. This previously took two: every visit row the caller could see,
 * plus every place_products row, both reduced in the browser. The view now
 * answers both halves server-side and returns one row per branch.
 *
 * `product_count` counts ALL place_products rows for the branch, not only
 * active ones — that is what this function did before, so the view reproduces
 * it. Note it differs from initVisitProducts() and lib/visit-plan.ts, which do
 * filter on is_active. That inconsistency predates this change and is left
 * alone here rather than corrected silently, since fixing it would move
 * numbers on screen.
 */
export async function fetchPlaceOperations(): Promise<Record<string, PlaceOps>> {
  const rows = await fetchBranchOperationRows();

  const ops: Record<string, PlaceOps> = {};
  for (const r of rows) {
    ops[r.place_id] = {
      last_visit_date:   r.last_visit_date,
      last_visit_status: r.last_visit_status,
      last_visit_merch:  r.last_visit_merch,
      product_count:     r.product_count,
      required_count:    r.required_count,
    };
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
