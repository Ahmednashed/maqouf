import { createClient } from "@/lib/supabase/client";
import type { AttentionCounts } from "@/lib/attention";

/**
 * The six dashboard attention counts, from `public.company_attention` (025).
 *
 * WHAT THIS REPLACES
 * ──────────────────
 * The panel previously derived these in the browser from five queries: every
 * branch, every product, every template, plus both aggregate views. Five reads
 * and roughly 421 KB at 200 branches / 500 products, to render six integers.
 * See docs/PERFORMANCE-RISKS.md §6.
 *
 * WHY THE DAY IS A PARAMETER
 * ──────────────────────────
 * `stale` is measured against the RIYADH business day. The database server runs
 * on UTC, and between 21:00 and 24:00 UTC Riyadh is already on the next
 * calendar day — so a function reaching for `current_date` would count one day
 * fewer than the app for three hours out of every twenty-four, and a branch at
 * exactly fifteen days would silently stop being stale.
 *
 * Callers must pass `riyadhToday()`, the same value `deriveAttention()` used.
 * That is not a detail to tidy away: it is the reason this is a function rather
 * than a view.
 *
 * There is deliberately NO fallback to the client-side derivation. If the RPC
 * is missing this must fail loudly rather than quietly reinstate the five reads
 * it exists to remove.
 */

/** Row shape returned by the RPC. Snake_case because it is a database result. */
interface CompanyAttentionRow {
  never_visited:   number;
  stale:           number;
  no_assortment:   number;
  unassigned:      number;
  orphan_products: number;
  empty_templates: number;
}

export async function fetchCompanyAttention(today: string): Promise<AttentionCounts> {
  const supabase = createClient();

  const { data, error } = await supabase.rpc("company_attention", { p_today: today });

  if (error) throw error;

  // `returns table (...)` arrives as a single-element array over PostgREST.
  // An empty array means the function ran but produced nothing, which the SQL
  // cannot do — treat it as a failure rather than as six zeros, because zeros
  // would render "everything is set up" from data we do not have.
  const row = (data as CompanyAttentionRow[] | null)?.[0];
  if (!row) throw new Error("company_attention returned no row");

  return {
    neverVisited:   row.never_visited,
    stale:          row.stale,
    noAssortment:   row.no_assortment,
    unassigned:     row.unassigned,
    orphanProducts: row.orphan_products,
    emptyTemplate:  row.empty_templates,
  };
}
