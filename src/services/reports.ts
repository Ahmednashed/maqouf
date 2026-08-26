import { createClient } from "@/lib/supabase/client";
import { fetchBranchLastVisits, daysSinceIso } from "@/services/places";
import { riyadhToday } from "@/lib/utils/date";

// ─── Shared types ─────────────────────────────────────────────────────────────

export interface DateRange {
  from: string;   // ISO date "YYYY-MM-DD"
  to:   string;
}

/**
 * Optional narrowing applied to every report and to the summary, so what a
 * manager exports is exactly what they were looking at.
 *
 * `status` only narrows the Visits report — the other four aggregate *by*
 * status, so filtering to one value would empty their columns rather than
 * focus them, and is deliberately not applied there.
 */
/**
 * Branch recency buckets, measured from the last real visit across ALL history
 * to the Riyadh business day — never from inside the selected range, or a
 * branch's staleness would change with the window rather than with reality.
 *
 * "gt14"/"gt30" deliberately INCLUDE never-visited branches: a branch nobody
 * has ever been to has, self-evidently, not been visited in the last 30 days,
 * and a manager asking that question wants the worst offenders in the answer.
 * "never" remains separately selectable for the stricter question.
 */
export type LastVisitBucket = "never" | "le7" | "le14" | "gt14" | "gt30";

export function matchesLastVisitBucket(
  daysSince: number | null,
  bucket: LastVisitBucket,
): boolean {
  const never = daysSince === null;
  switch (bucket) {
    case "never": return never;
    case "le7":   return !never && daysSince <= 7;
    case "le14":  return !never && daysSince <= 14;
    case "gt14":  return never || daysSince > 14;
    case "gt30":  return never || daysSince > 30;
  }
}

export interface ReportFilters {
  merchId?: string;
  placeId?: string;
  status?:  string;
  /** Branch Coverage only — the other reports are not per-branch. */
  lastVisit?: LastVisitBucket;
}

/**
 * Merchandiser display name, matching the precedence the Users screen uses:
 * the admin-set display_name first, then the auth account's full_name.
 *
 * Reports previously read full_name alone, so a member whose auth user had
 * been removed — or who had an admin display-name override — showed as "—"
 * in every report while appearing correctly everywhere else in the app.
 */
function merchName(m: { display_name?: string | null; user?: { full_name: string } | null } | null): string {
  return m?.display_name?.trim() || m?.user?.full_name || "—";
}

// ─── Raw Supabase join row shapes (private to this module) ────────────────────
// Each interface mirrors exactly what PostgREST returns for the corresponding
// query's select() columns — the single boundary cast in each fetch function
// keeps all downstream field access fully typed.

interface VisitReportQueryRow {
  id:               string;
  scheduled_date:   string;
  status:           string;
  duration_minutes: number | null;
  place: {
    branch_ar: string;
    branch_en: string;
    code:      string;
    chain: { name_ar: string; name_en: string } | null;
  } | null;
  merch_id: string;
  place_id: string;
  merch: {
    display_name: string | null;
    user: { full_name: string } | null;
  } | null;
}

interface MerchReportQueryRow {
  status:           string;
  duration_minutes: number | null;
  merch_id:         string;
  merch: {
    id:           string;
    display_name: string | null;
    user: { full_name: string } | null;
  } | null;
}

interface BranchReportQueryRow {
  status:           string;
  duration_minutes: number | null;
  place_id:         string;
  place: {
    branch_ar: string;
    branch_en: string;
    code:      string;
    chain: { name_ar: string; name_en: string } | null;
  } | null;
}

interface ProductReportQueryRow {
  product_id:  string;
  qty_found:   number | null;
  qty_missing: number | null;
  product: {
    id:      string;
    name_ar: string;
    name_en: string;
    sku:     string;
    unit:    string;
  } | null;
}

// ─── Range summary ────────────────────────────────────────────────────────────

/**
 * Headline numbers for the whole window, independent of which tab is open.
 *
 * Everything here is counted from real rows. Where the underlying data does not
 * exist — no product audits recorded in the window — the field is null and the
 * card says so, rather than showing a confident zero that reads like "nothing
 * is missing" when it actually means "nobody checked".
 */
export interface ReportSummary {
  total_visits:     number;
  completed:        number;
  missed:           number;
  pending:          number;
  inprogress:       number;
  /** completed / (completed + missed) — visits still ahead do not count against it. */
  completion_rate:  number;
  /** Distinct merchandisers with at least one visit in the window. */
  active_merchandisers: number;
  /** Distinct branches with at least one COMPLETED visit. */
  covered_branches:     number;
  /** Distinct branches with at least one visit of any status. */
  scheduled_branches:   number;
  /** Mean duration over completed visits that recorded one. */
  avg_duration:     number;
  /** null = no product audit rows in this window at all. */
  audited_products:        number | null;
  /** null when audited_products is null. Distinct products short on shelf. */
  products_with_shortfall: number | null;
  /**
   * Active branches whose last real visit was over 14 days ago, or never.
   *
   * Measured across ALL history against the Riyadh business day, so it is
   * deliberately independent of the selected range — a branch is not "fresh"
   * just because you narrowed the report to last week. It respects the branch
   * filter but not the merchandiser filter: "nobody has been there" is the
   * operational question, not "this one person has not been there".
   */
  stale_branches:      number;
  /** Active branches considered, for the denominator. */
  total_branches:      number;
}

interface SummaryVisitRow {
  status:           string;
  duration_minutes: number | null;
  merch_id:         string;
  place_id:         string;
}

interface SummaryProductRow {
  product_id:  string;
  qty_missing: number | null;
}

export async function fetchReportSummary(
  range: DateRange,
  filters?: ReportFilters,
): Promise<ReportSummary> {
  const supabase = createClient();

  let visitQuery = supabase
    .from("visits")
    .select("status, duration_minutes, merch_id, place_id")
    .gte("scheduled_date", range.from)
    .lte("scheduled_date", range.to);

  if (filters?.merchId) visitQuery = visitQuery.eq("merch_id", filters.merchId);
  if (filters?.placeId) visitQuery = visitQuery.eq("place_id", filters.placeId);
  if (filters?.status)  visitQuery = visitQuery.eq("status",   filters.status);

  // Product shortfall rides the same inner-join filter the product report uses,
  // so it stays consistent with that tab and needs no visit-id round trip.
  let branchQuery = supabase
    .from("places")
    .select("id")
    .eq("is_active", true);

  if (filters?.placeId) branchQuery = branchQuery.eq("id", filters.placeId);

  let productQuery = supabase
    .from("visit_products")
    .select("product_id, qty_missing, visit:visits!inner (scheduled_date, status, merch_id, place_id)")
    .gte("visit.scheduled_date", range.from)
    .lte("visit.scheduled_date", range.to)
    .eq("visit.status", "completed");

  if (filters?.merchId) productQuery = productQuery.eq("visit.merch_id", filters.merchId);
  if (filters?.placeId) productQuery = productQuery.eq("visit.place_id", filters.placeId);

  const [visitsRes, productsRes, branchesRes, lastVisits] = await Promise.all([
    visitQuery,
    productQuery,
    branchQuery,
    fetchBranchLastVisits(),
  ]);

  if (visitsRes.error)   throw visitsRes.error;
  if (productsRes.error) throw productsRes.error;
  if (branchesRes.error) throw branchesRes.error;

  const visits = (visitsRes.data ?? []) as unknown as SummaryVisitRow[];

  const merchants        = new Set<string>();
  const branchesAny      = new Set<string>();
  const branchesCompleted = new Set<string>();
  const durations: number[] = [];

  let completed = 0, missed = 0, pending = 0, inprogress = 0;

  for (const v of visits) {
    merchants.add(v.merch_id);
    branchesAny.add(v.place_id);

    if (v.status === "completed") {
      completed++;
      branchesCompleted.add(v.place_id);
      if (v.duration_minutes != null && v.duration_minutes > 0) {
        durations.push(v.duration_minutes);
      }
    } else if (v.status === "missed")     missed++;
    else if (v.status === "pending")      pending++;
    else if (v.status === "inprogress")   inprogress++;
  }

  const finished = completed + missed;

  // Staleness uses the same rule and the same threshold as the "gt14" bucket
  // in the Branch Coverage filter, so the card and the filter agree.
  const today = riyadhToday();
  const activeBranches = (branchesRes.data ?? []) as unknown as { id: string }[];
  let staleBranches = 0;
  for (const b of activeBranches) {
    const since = daysSinceIso(lastVisits[b.id]?.last_visit_date ?? null, today);
    if (matchesLastVisitBucket(since, "gt14")) staleBranches++;
  }

  const products = (productsRes.data ?? []) as unknown as SummaryProductRow[];

  const shortfall = new Set<string>();
  for (const p of products) {
    if ((p.qty_missing ?? 0) > 0) shortfall.add(p.product_id);
  }
  const auditedProducts = new Set(products.map((p) => p.product_id));

  return {
    total_visits:     visits.length,
    completed,
    missed,
    pending,
    inprogress,
    completion_rate:  finished > 0 ? Math.round((completed / finished) * 100) : 0,
    active_merchandisers: merchants.size,
    covered_branches:     branchesCompleted.size,
    scheduled_branches:   branchesAny.size,
    avg_duration: durations.length > 0
      ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
      : 0,
    // No audit rows at all means "nobody checked", which is not the same as
    // "nothing was missing" — surface it as unknown, not as zero.
    audited_products:        products.length > 0 ? auditedProducts.size : null,
    products_with_shortfall: products.length > 0 ? shortfall.size       : null,
    stale_branches:          staleBranches,
    total_branches:          activeBranches.length,
  };
}

// ─── Visits report ────────────────────────────────────────────────────────────

export interface VisitReportRow {
  id:               string;
  /** Kept on the row so the page can filter and count distinct without re-querying. */
  merch_id:         string;
  place_id:         string;
  scheduled_date:   string;
  status:           string;
  duration_minutes: number;
  branch_ar:        string;
  branch_en:        string;
  branch_code:      string;
  chain_ar:         string;
  chain_en:         string;
  merch_name:       string;
}

export async function fetchVisitsReport(
  range: DateRange,
  filters?: ReportFilters,
): Promise<VisitReportRow[]> {
  const supabase = createClient();

  let query = supabase
    .from("visits")
    .select(`
      id, scheduled_date, status, duration_minutes, merch_id, place_id,
      place:places (branch_ar, branch_en, code, chain:chains (name_ar, name_en)),
      merch:company_users (display_name, user:users!company_users_user_id_fkey (full_name))
    `)
    .gte("scheduled_date", range.from)
    .lte("scheduled_date", range.to);

  if (filters?.merchId) query = query.eq("merch_id", filters.merchId);
  if (filters?.placeId) query = query.eq("place_id", filters.placeId);
  if (filters?.status) query = query.eq("status", filters.status);

  const { data, error } = await query.order("scheduled_date", { ascending: false });

  if (error) throw error;

  const rows = (data ?? []) as unknown as VisitReportQueryRow[];
  return rows.map((row) => ({
    id:               row.id,
    merch_id:         row.merch_id,
    place_id:         row.place_id,
    scheduled_date:   row.scheduled_date,
    status:           row.status,
    duration_minutes: row.duration_minutes ?? 0,
    branch_ar:        row.place?.branch_ar      ?? "—",
    branch_en:        row.place?.branch_en      ?? "—",
    branch_code:      row.place?.code           ?? "—",
    chain_ar:         row.place?.chain?.name_ar ?? "—",
    chain_en:         row.place?.chain?.name_en ?? "—",
    merch_name:       merchName(row.merch),
  }));
}

// ─── Merch performance report ─────────────────────────────────────────────────

export interface MerchReportRow {
  merch_id:        string;
  full_name:       string;
  total_visits:    number;
  completed:       number;
  missed:          number;
  pending:         number;
  inprogress:      number;
  completion_rate: number;   // %
  avg_duration:    number;   // minutes
}

export async function fetchMerchReport(
  range: DateRange,
  filters?: ReportFilters,
): Promise<MerchReportRow[]> {
  const supabase = createClient();

  let query = supabase
    .from("visits")
    .select(`
      status, duration_minutes, merch_id,
      merch:company_users (
        id, display_name,
        user:users!company_users_user_id_fkey (full_name)
      )
    `)
    .gte("scheduled_date", range.from)
    .lte("scheduled_date", range.to);

  if (filters?.merchId) query = query.eq("merch_id", filters.merchId);
  if (filters?.placeId) query = query.eq("place_id", filters.placeId);

  const { data, error } = await query;

  if (error) throw error;

  const rows = (data ?? []) as unknown as MerchReportQueryRow[];

  // Aggregate client-side
  const map = new Map<string, MerchReportRow>();

  for (const row of rows) {
    const id = row.merch_id;
    if (!map.has(id)) {
      map.set(id, {
        merch_id:        id,
        full_name:       merchName(row.merch),
        total_visits:    0,
        completed:       0,
        missed:          0,
        pending:         0,
        inprogress:      0,
        completion_rate: 0,
        avg_duration:    0,
      });
    }
    const m = map.get(id)!;
    m.total_visits++;
    const s = row.status;
    if (s === "completed")  m.completed++;
    if (s === "missed")     m.missed++;
    if (s === "pending")    m.pending++;
    if (s === "inprogress") m.inprogress++;
  }

  // Compute completion rate and avg duration
  const durMap = new Map<string, number[]>();
  for (const row of rows) {
    const id  = row.merch_id;
    const dur = row.duration_minutes;
    if (row.status === "completed" && dur !== null && dur > 0) {
      if (!durMap.has(id)) durMap.set(id, []);
      durMap.get(id)!.push(dur);
    }
  }

  const result = Array.from(map.values()).map((m) => {
    const finished  = m.completed + m.missed;
    const durations = durMap.get(m.merch_id) ?? [];
    return {
      ...m,
      completion_rate: finished > 0 ? Math.round((m.completed / finished) * 100) : 0,
      avg_duration:    durations.length > 0
        ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
        : 0,
    };
  });

  return result.sort((a, b) => b.completed - a.completed);
}

// ─── Branch coverage report ───────────────────────────────────────────────────

export interface BranchReportRow {
  place_id:        string;
  branch_ar:       string;
  branch_en:       string;
  branch_code:     string;
  chain_ar:        string;
  chain_en:        string;
  total_visits:    number;
  completed:       number;
  missed:          number;
  completion_rate: number;
  avg_duration:    number;
  /** Last real visit across all history — NOT limited to the report range. */
  last_visit_date: string | null;
  /** Whole days from that visit to the Riyadh business day; null = never. */
  days_since:      number | null;
}

/**
 * Branch coverage, including branches that were NOT covered.
 *
 * The report used to be built purely from visits in the range, so a branch
 * nobody went to simply had no row — a coverage report that silently omitted
 * the uncovered branches, which are the ones a manager is looking for. It now
 * starts from the active branch list and fills in whatever visits exist, so a
 * zero row is a real answer rather than an absence.
 */
export async function fetchBranchReport(
  range: DateRange,
  filters?: ReportFilters,
): Promise<BranchReportRow[]> {
  const supabase = createClient();

  let query = supabase
    .from("visits")
    .select(`
      status, duration_minutes, place_id,
      place:places (branch_ar, branch_en, code, chain:chains (name_ar, name_en))
    `)
    .gte("scheduled_date", range.from)
    .lte("scheduled_date", range.to);

  if (filters?.merchId) query = query.eq("merch_id", filters.merchId);
  if (filters?.placeId) query = query.eq("place_id", filters.placeId);

  let placeQuery = supabase
    .from("places")
    .select("id, branch_ar, branch_en, code, is_active, chain:chains (name_ar, name_en)")
    .eq("is_active", true);

  if (filters?.placeId) placeQuery = placeQuery.eq("id", filters.placeId);

  const [visitsRes, placesRes, lastVisits] = await Promise.all([
    query,
    placeQuery,
    fetchBranchLastVisits(),
  ]);

  if (visitsRes.error) throw visitsRes.error;
  if (placesRes.error) throw placesRes.error;

  const rows = (visitsRes.data ?? []) as unknown as BranchReportQueryRow[];
  const today = riyadhToday();

  const map = new Map<string, BranchReportRow>();

  const blankRow = (
    id: string,
    branch_ar: string, branch_en: string, code: string,
    chain_ar: string, chain_en: string,
  ): BranchReportRow => ({
    place_id:        id,
    branch_ar, branch_en,
    branch_code:     code,
    chain_ar, chain_en,
    total_visits:    0,
    completed:       0,
    missed:          0,
    completion_rate: 0,
    avg_duration:    0,
    last_visit_date: lastVisits[id]?.last_visit_date ?? null,
    days_since:      daysSinceIso(lastVisits[id]?.last_visit_date ?? null, today),
  });

  // Seed every active branch so uncovered ones still appear.
  const places = (placesRes.data ?? []) as unknown as {
    id: string; branch_ar: string; branch_en: string; code: string;
    chain: { name_ar: string; name_en: string } | null;
  }[];

  for (const p of places) {
    map.set(p.id, blankRow(
      p.id, p.branch_ar, p.branch_en, p.code,
      p.chain?.name_ar ?? "—", p.chain?.name_en ?? "—",
    ));
  }

  for (const row of rows) {
    const id = row.place_id;
    if (!map.has(id)) {
      // A visit against a branch that is inactive or otherwise not in the list
      // above — keep it rather than dropping real history on the floor.
      map.set(id, blankRow(
        id,
        row.place?.branch_ar ?? "—", row.place?.branch_en ?? "—",
        row.place?.code      ?? "—",
        row.place?.chain?.name_ar ?? "—", row.place?.chain?.name_en ?? "—",
      ));
    }
    const b = map.get(id)!;
    b.total_visits++;
    const s = row.status;
    if (s === "completed") b.completed++;
    if (s === "missed")    b.missed++;
  }

  const durMap = new Map<string, number[]>();
  for (const row of rows) {
    const id  = row.place_id;
    const dur = row.duration_minutes;
    if (row.status === "completed" && dur !== null && dur > 0) {
      if (!durMap.has(id)) durMap.set(id, []);
      durMap.get(id)!.push(dur);
    }
  }

  let result = Array.from(map.values()).map((b) => {
    const finished  = b.completed + b.missed;
    const durations = durMap.get(b.place_id) ?? [];
    return {
      ...b,
      completion_rate: finished > 0 ? Math.round((b.completed / finished) * 100) : 0,
      avg_duration:    durations.length > 0
        ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
        : 0,
    };
  });

  if (filters?.lastVisit) {
    const bucket = filters.lastVisit;
    result = result.filter((b) => matchesLastVisitBucket(b.days_since, bucket));
  }

  return result.sort((a, b) => b.total_visits - a.total_visits);
}

// ─── Product availability report ──────────────────────────────────────────────

export interface ProductReportRow {
  product_id:       string;
  name_ar:          string;
  name_en:          string;
  sku:              string;
  unit:             string;
  audited_count:    number;   // visits where this product was checked
  found_count:      number;   // rows where qty_found > 0
  missing_count:    number;   // rows where qty_missing > 0
  availability_pct: number;   // found_count / audited_count * 100
  total_missing:    number;   // sum of qty_missing
}

export async function fetchProductReport(
  range: DateRange,
  filters?: ReportFilters,
): Promise<ProductReportRow[]> {
  const supabase = createClient();

  // Filter through an inner join on the parent visit rather than fetching
  // visit ids first and passing them back as .in(...). That two-step version
  // put every completed visit id into the request URL, which silently breaks
  // once a window contains enough visits to exceed the URL length limit.
  let query = supabase
    .from("visit_products")
    .select(`
      product_id, qty_found, qty_missing,
      product:products (id, name_ar, name_en, sku, unit),
      visit:visits!inner (scheduled_date, status, merch_id, place_id)
    `)
    .gte("visit.scheduled_date", range.from)
    .lte("visit.scheduled_date", range.to)
    .eq("visit.status", "completed");

  if (filters?.merchId) query = query.eq("visit.merch_id", filters.merchId);
  if (filters?.placeId) query = query.eq("visit.place_id", filters.placeId);

  const { data: vpRows, error: vpErr } = await query;

  if (vpErr) throw vpErr;

  const rows = (vpRows ?? []) as unknown as ProductReportQueryRow[];

  // Aggregate
  const map = new Map<string, ProductReportRow>();

  for (const row of rows) {
    const pid = row.product_id;
    if (!map.has(pid)) {
      map.set(pid, {
        product_id:       pid,
        name_ar:          row.product?.name_ar ?? "—",
        name_en:          row.product?.name_en ?? "—",
        sku:              row.product?.sku     ?? "—",
        unit:             row.product?.unit    ?? "—",
        audited_count:    0,
        found_count:      0,
        missing_count:    0,
        availability_pct: 0,
        total_missing:    0,
      });
    }
    const p = map.get(pid)!;
    p.audited_count++;
    const qf = row.qty_found   ?? 0;
    const qm = row.qty_missing ?? 0;
    if (qf > 0) p.found_count++;
    if (qm > 0) {
      p.missing_count++;
      p.total_missing += qm;
    }
  }

  const result = Array.from(map.values()).map((p) => ({
    ...p,
    availability_pct: p.audited_count > 0
      ? Math.round((p.found_count / p.audited_count) * 100)
      : 0,
  }));

  return result.sort((a, b) => a.availability_pct - b.availability_pct);
}

// ─── GPS compliance report ────────────────────────────────────────────────────
//
// Per-merchandiser breakdown of GPS check-in compliance for all started visits.
// "started" = started_at IS NOT NULL (inprogress + completed + missed-after-start).
// The service recalculates verification_rate and avg_distance client-side;
// no raw distances are trusted from the client.

interface GpsQueryRow {
  merch_id:                string;
  checkin_verified:        boolean | null;
  checkin_distance_meters: number  | null;
  merch: {
    display_name: string | null;
    user: { full_name: string } | null;
  } | null;
}

export interface GpsReportRow {
  merch_id:          string;
  full_name:         string;
  total_started:     number;
  gps_verified:      number;
  gps_unverified:    number;
  verification_rate: number;   // %
  avg_distance:      number;   // metres, verified visits only
}

export async function fetchGpsReport(
  range: DateRange,
  filters?: ReportFilters,
): Promise<GpsReportRow[]> {
  const supabase = createClient();

  let query = supabase
    .from("visits")
    .select(`
      merch_id, checkin_verified, checkin_distance_meters,
      merch:company_users (display_name, user:users!company_users_user_id_fkey (full_name))
    `)
    .gte("scheduled_date", range.from)
    .lte("scheduled_date", range.to)
    .not("started_at", "is", null);   // only started visits

  if (filters?.merchId) query = query.eq("merch_id", filters.merchId);
  if (filters?.placeId) query = query.eq("place_id", filters.placeId);

  const { data, error } = await query;

  if (error) throw error;

  const rows = (data ?? []) as unknown as GpsQueryRow[];

  const map = new Map<string, { row: GpsReportRow; distances: number[] }>();

  for (const r of rows) {
    const id = r.merch_id;
    if (!map.has(id)) {
      map.set(id, {
        row: {
          merch_id:          id,
          full_name:         merchName(r.merch),
          total_started:     0,
          gps_verified:      0,
          gps_unverified:    0,
          verification_rate: 0,
          avg_distance:      0,
        },
        distances: [],
      });
    }
    const entry = map.get(id)!;
    entry.row.total_started++;
    if (r.checkin_verified === true) {
      entry.row.gps_verified++;
      if (r.checkin_distance_meters != null) {
        entry.distances.push(r.checkin_distance_meters);
      }
    } else {
      entry.row.gps_unverified++;
    }
  }

  return Array.from(map.values())
    .map(({ row, distances }) => ({
      ...row,
      verification_rate: row.total_started > 0
        ? Math.round((row.gps_verified / row.total_started) * 100)
        : 0,
      avg_distance: distances.length > 0
        ? Math.round(distances.reduce((a, b) => a + b, 0) / distances.length)
        : 0,
    }))
    .sort((a, b) => b.total_started - a.total_started);
}
