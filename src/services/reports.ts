import { createClient } from "@/lib/supabase/client";
import { tallyGps } from "@/lib/gps-status";
import { fetchBranchLastVisits, daysSinceIso } from "@/services/places";
import { riyadhToday } from "@/lib/utils/date";
import { assertReportComplete } from "@/lib/report-completeness";
import { loadAllReportPages } from "@/lib/report-pages";

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
}

/**
 * One row of public.report_summary (migration 026). Whole counts only: the
 * function deliberately returns duration_sum/duration_count rather than an
 * average, and no completion rate, so the rounding below stays in JavaScript.
 */
interface ReportSummaryRpcRow {
  total_visits:            number;
  completed:               number;
  missed:                  number;
  pending:                 number;
  inprogress:              number;
  active_merchandisers:    number;
  covered_branches:        number;
  scheduled_branches:      number;
  duration_sum:            number;
  duration_count:          number;
  audited_products:        number | null;
  products_with_shortfall: number | null;
}

const SUMMARY_COUNT_COLUMNS = [
  "total_visits", "completed", "missed", "pending", "inprogress",
  "active_merchandisers", "covered_branches", "scheduled_branches",
  "duration_sum", "duration_count",
] as const;

const SUMMARY_PRODUCT_COLUMNS = ["audited_products", "products_with_shortfall"] as const;

const isCount = (v: unknown): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0;

/**
 * Accept exactly the row the SQL returns, or throw. A missing or malformed row
 * must never render as a page of zeros — that reads as "nothing happened".
 */
function parseReportSummaryRow(data: unknown): ReportSummaryRpcRow {
  if (!Array.isArray(data) || data.length !== 1) {
    throw new Error(
      `report_summary returned ${Array.isArray(data) ? `${data.length} rows` : "no rows"}, expected exactly 1`,
    );
  }
  const row = data[0] as Record<string, unknown> | null;
  if (row === null || typeof row !== "object") {
    throw new Error("report_summary returned a malformed row");
  }
  for (const col of SUMMARY_COUNT_COLUMNS) {
    if (!isCount(row[col])) {
      throw new Error(`report_summary returned an invalid ${col}: ${JSON.stringify(row[col])}`);
    }
  }
  for (const col of SUMMARY_PRODUCT_COLUMNS) {
    if (row[col] !== null && !isCount(row[col])) {
      throw new Error(`report_summary returned an invalid ${col}: ${JSON.stringify(row[col])}`);
    }
  }
  // The SQL makes both NULL together (no audit rows) or neither.
  if ((row.audited_products === null) !== (row.products_with_shortfall === null)) {
    throw new Error("report_summary returned inconsistent product figures");
  }
  return row as unknown as ReportSummaryRpcRow;
}

/**
 * Counted inside PostgreSQL by public.report_summary, so the Data API's
 * 1,000-row cap cannot truncate the totals. Runs as the caller (SECURITY
 * INVOKER), so RLS scopes it exactly as the old table reads were scoped.
 *
 * Status narrows the visit counts only; the product figures always count
 * completed visits — the SQL keeps the old reads' behaviour. Errors are thrown,
 * never replaced by row-fetching fallbacks that the cap would silently cut.
 */
export async function fetchReportSummary(
  range: DateRange,
  filters?: ReportFilters,
): Promise<ReportSummary> {
  const supabase = createClient();

  const { data, error } = await supabase.rpc("report_summary", {
    p_from:     range.from,
    p_to:       range.to,
    // Absent filters are NULL, never "" — an empty string is not a uuid.
    p_merch_id: filters?.merchId || null,
    p_place_id: filters?.placeId || null,
    p_status:   filters?.status  || null,
  });

  if (error) throw error;

  const row = parseReportSummaryRow(data);
  const finished = row.completed + row.missed;

  return {
    total_visits:     row.total_visits,
    completed:        row.completed,
    missed:           row.missed,
    pending:          row.pending,
    inprogress:       row.inprogress,
    // Same formulas and rounding order as the old in-browser count: exact SQL
    // rounding would disagree (23 of 40 shows 57% here, 58% in SQL).
    completion_rate:  finished > 0 ? Math.round((row.completed / finished) * 100) : 0,
    active_merchandisers: row.active_merchandisers,
    covered_branches:     row.covered_branches,
    scheduled_branches:   row.scheduled_branches,
    avg_duration: row.duration_count > 0
      ? Math.round(row.duration_sum / row.duration_count)
      : 0,
    // No audit rows at all means "nobody checked", which is not the same as
    // "nothing was missing" — surface it as unknown, not as zero.
    audited_products:        row.audited_products,
    products_with_shortfall: row.products_with_shortfall,
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

/**
 * Read in pages, so a range may hold more visits than one API response does
 * (see report-pages.ts for how each page is checked, the hard maximum, and what
 * a multi-request read cannot promise). `signal` stops the load between pages
 * when the query it belongs to has been superseded.
 */
export async function fetchVisitsReport(
  range: DateRange,
  filters?: ReportFilters,
  signal?: AbortSignal,
): Promise<VisitReportRow[]> {
  const supabase = createClient();

  const rows = await loadAllReportPages<VisitReportQueryRow>({
    report: "visits",
    signal,
    keyOf:  (row) => row.id,
    fetchPage: async (after, limit) => {
      let query = supabase
        .from("visits")
        .select(`
          id, scheduled_date, status, duration_minutes, merch_id, place_id,
          place:places (branch_ar, branch_en, code, chain:chains (name_ar, name_en)),
          merch:company_users (display_name, user:users!company_users_user_id_fkey (full_name))
        `, { count: "exact" })
        .gte("scheduled_date", range.from)
        .lte("scheduled_date", range.to);

      if (filters?.merchId) query = query.eq("merch_id", filters.merchId);
      if (filters?.placeId) query = query.eq("place_id", filters.placeId);
      if (filters?.status) query = query.eq("status", filters.status);

      // Pages follow the primary key. With the cursor applied, the exact count
      // is of the rows from here on — what the loader checks each page against.
      if (after !== null) query = query.gt("id", after);
      let page = query.order("id", { ascending: true }).limit(limit);
      if (signal) page = page.abortSignal(signal);

      const { data, error, count } = await page;
      if (error) throw error;
      return { rows: (data ?? []) as unknown as VisitReportQueryRow[], count };
    },
  });

  // What the tab shows and exports is unchanged: newest first, with `id` as a
  // unique tie-breaker so the order within a day is the same on every load.
  // Both are compared as the API returns them (ISO dates, lowercase UUIDs),
  // which sorts them exactly as the database did.
  rows.sort((a, b) =>
    a.scheduled_date !== b.scheduled_date
      ? (a.scheduled_date < b.scheduled_date ? 1 : -1)
      : (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));

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
    `, { count: "exact" })
    .gte("scheduled_date", range.from)
    .lte("scheduled_date", range.to);

  if (filters?.merchId) query = query.eq("merch_id", filters.merchId);
  if (filters?.placeId) query = query.eq("place_id", filters.placeId);

  const { data, error, count } = await query.order("id", { ascending: true });

  if (error) throw error;

  const rows = (data ?? []) as unknown as MerchReportQueryRow[];
  // Aggregating a cut result would produce plausible, wrong totals.
  assertReportComplete("merch", rows, count);

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
    `, { count: "exact" })
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
    query.order("id", { ascending: true }),
    placeQuery,
    fetchBranchLastVisits(),
  ]);

  if (visitsRes.error) throw visitsRes.error;
  if (placesRes.error) throw placesRes.error;

  const rows = (visitsRes.data ?? []) as unknown as BranchReportQueryRow[];
  // A cut result would show covered branches as uncovered.
  assertReportComplete("branch", rows, visitsRes.count);
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
    `, { count: "exact" })
    .gte("visit.scheduled_date", range.from)
    .lte("visit.scheduled_date", range.to)
    .eq("visit.status", "completed");

  if (filters?.merchId) query = query.eq("visit.merch_id", filters.merchId);
  if (filters?.placeId) query = query.eq("visit.place_id", filters.placeId);

  // (visit_id, product_id) is this table's primary key: a unique, stable order.
  // The exact count is of visit_products rows AFTER the inner join's filters,
  // i.e. of exactly the rows this read returns when nothing is cut.
  const { data: vpRows, error: vpErr, count } = await query
    .order("visit_id", { ascending: true })
    .order("product_id", { ascending: true });

  if (vpErr) throw vpErr;

  const rows = (vpRows ?? []) as unknown as ProductReportQueryRow[];
  assertReportComplete("product", rows, count);

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
  checkin_lat:             number  | null;
  checkin_lng:             number  | null;
  checkin_distance_meters: number  | null;
  place: { lat: number | null; lng: number | null } | null;
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
  /** A position was captured that did not validate against the branch. */
  gps_outside:       number;
  /** No position captured. Missing data, NOT a failed check — see gps-status. */
  gps_not_recorded:  number;
  /** Started visits whose branch has no coordinates, so no check was possible. */
  no_branch_coords:  number;
  /** verified / measured, as %. null when nothing was measured. */
  verification_rate: number | null;
  /** Metres, verified check-ins only. null when there are none. */
  avg_distance:      number | null;
}

export async function fetchGpsReport(
  range: DateRange,
  filters?: ReportFilters,
): Promise<GpsReportRow[]> {
  const supabase = createClient();

  let query = supabase
    .from("visits")
    .select(`
      merch_id, checkin_verified, checkin_lat, checkin_lng, checkin_distance_meters,
      place:places (lat, lng),
      merch:company_users (display_name, user:users!company_users_user_id_fkey (full_name))
    `, { count: "exact" })
    .gte("scheduled_date", range.from)
    .lte("scheduled_date", range.to)
    .not("started_at", "is", null);   // only started visits

  if (filters?.merchId) query = query.eq("merch_id", filters.merchId);
  if (filters?.placeId) query = query.eq("place_id", filters.placeId);

  const { data, error, count } = await query.order("id", { ascending: true });

  if (error) throw error;

  const rows = (data ?? []) as unknown as GpsQueryRow[];
  assertReportComplete("gps", rows, count);

  // Group first, then let tallyGps() do the classifying, so this report and
  // the visit detail page cannot drift apart about what "verified" means.
  const byMerch = new Map<string, { name: string; rows: GpsQueryRow[] }>();
  for (const r of rows) {
    const entry = byMerch.get(r.merch_id)
      ?? { name: merchName(r.merch), rows: [] as GpsQueryRow[] };
    entry.rows.push(r);
    byMerch.set(r.merch_id, entry);
  }

  return Array.from(byMerch.entries())
    .map(([merch_id, { name, rows: merchRows }]) => {
      const tally = tallyGps(merchRows);
      return {
        merch_id,
        full_name:         name,
        total_started:     tally.started,
        gps_verified:      tally.verified,
        gps_outside:       tally.outside,
        gps_not_recorded:  tally.notRecorded,
        no_branch_coords:  tally.noBranchCoords,
        verification_rate: tally.rate,
        avg_distance:      tally.avgDistance,
      };
    })
    .sort((a, b) => b.total_started - a.total_started);
}
