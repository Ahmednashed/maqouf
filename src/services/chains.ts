import { createClient } from "@/lib/supabase/client";
import type { Chain } from "@/types";
import { getMyCompanyId } from "@/lib/supabase/helpers";

// ─── Payload types ────────────────────────────────────────────────────────────

export interface ChainInsert {
  name_ar:   string;
  name_en:   string;
  code:      string;
  color?:    string;
  is_active?: boolean;
}

export interface ChainUpdate {
  name_ar?:   string;
  name_en?:   string;
  code?:      string;
  color?:     string;
  is_active?: boolean;
}

// Extended type that includes the places count returned by the joined query.
export type ChainWithCount = Chain & {
  /** Number of branches (places) linked to this chain. */
  places_count: number;
};

// ─── Read ─────────────────────────────────────────────────────────────────────

/**
 * Fetch all chains for the current user's company.
 * RLS `chains_select` policy filters automatically — no company_id needed.
 * Also fetches a count of linked places via a PostgREST aggregate.
 */
export async function fetchChains(): Promise<ChainWithCount[]> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from("chains")
    .select("*, places:places(count)")
    .order("created_at", { ascending: false });

  if (error) throw error;

  // Normalise the PostgREST aggregate shape: places: [{count: N}] → places_count: N
  return (data ?? []).map((row: Chain & { places: { count: number }[] }) => ({
    ...row,
    places_count: row.places?.[0]?.count ?? 0,
  }));
}

// ─── Create ───────────────────────────────────────────────────────────────────

/**
 * Create a new chain.
 * company_id is resolved server-side via getMyCompanyId() so the caller
 * never has to pass it manually — preventing cross-company data leaks.
 */
export async function createChain(payload: ChainInsert): Promise<Chain> {
  const supabase  = createClient();
  const company_id = await getMyCompanyId();

  const { data, error } = await supabase
    .from("chains")
    .insert({
      ...payload,
      company_id,
      code: payload.code.toUpperCase(),
    })
    .select()
    .single();

  if (error) throw error;
  return data as Chain;
}

// ─── Update ───────────────────────────────────────────────────────────────────

/**
 * Update an existing chain by id.
 * RLS `chains_update` policy ensures only owner/admin can mutate,
 * and only within their own company.
 */
export async function updateChain(id: string, payload: ChainUpdate): Promise<Chain> {
  const supabase = createClient();

  const update: ChainUpdate = { ...payload };
  if (update.code) update.code = update.code.toUpperCase();

  const { data, error } = await supabase
    .from("chains")
    .update(update)
    .eq("id", id)
    .select()
    .single();

  if (error) throw error;
  return data as Chain;
}

// ─── Delete ───────────────────────────────────────────────────────────────────

/**
 * Delete a chain by id.
 * The DB schema has ON DELETE CASCADE on places → chain, so all linked
 * branches will be removed automatically.
 * RLS `chains_delete` policy restricts this to owner/admin only.
 */
export async function deleteChain(id: string): Promise<void> {
  const supabase = createClient();

  const { error } = await supabase
    .from("chains")
    .delete()
    .eq("id", id);

  if (error) throw error;
}
