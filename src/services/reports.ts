import { createClient } from "@/lib/supabase/client";

// ─── Shared types ─────────────────────────────────────────────────────────────

export interface DateRange {
  from: string;   // ISO date "YYYY-MM-DD"
  to:   string;
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
  merch: {
    user: { full_name: string } | null;
  } | null;
}

interface MerchReportQueryRow {
  status:           string;
  duration_minutes: number | null;
  merch_id:         string;
  merch: {
    id:   string;
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

// ─── Visits report ────────────────────────────────────────────────────────────

export interface VisitReportRow {
  id:               string;
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

export async function fetchVisitsReport(range: DateRange): Promise<VisitReportRow[]> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from("visits")
    .select(`
      id, scheduled_date, status, duration_minutes,
      place:places (branch_ar, branch_en, code, chain:chains (name_ar, name_en)),
      merch:company_users (user:users!company_users_user_id_fkey (full_name))
    `)
    .gte("scheduled_date", range.from)
    .lte("scheduled_date", range.to)
    .order("scheduled_date", { ascending: false });

  if (error) throw error;

  const rows = (data ?? []) as unknown as VisitReportQueryRow[];
  return rows.map((row) => ({
    id:               row.id,
    scheduled_date:   row.scheduled_date,
    status:           row.status,
    duration_minutes: row.duration_minutes ?? 0,
    branch_ar:        row.place?.branch_ar      ?? "—",
    branch_en:        row.place?.branch_en      ?? "—",
    branch_code:      row.place?.code           ?? "—",
    chain_ar:         row.place?.chain?.name_ar ?? "—",
    chain_en:         row.place?.chain?.name_en ?? "—",
    merch_name:       row.merch?.user?.full_name ?? "—",
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

export async function fetchMerchReport(range: DateRange): Promise<MerchReportRow[]> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from("visits")
    .select(`
      status, duration_minutes, merch_id,
      merch:company_users (
        id,
        user:users!company_users_user_id_fkey (full_name)
      )
    `)
    .gte("scheduled_date", range.from)
    .lte("scheduled_date", range.to);

  if (error) throw error;

  const rows = (data ?? []) as unknown as MerchReportQueryRow[];

  // Aggregate client-side
  const map = new Map<string, MerchReportRow>();

  for (const row of rows) {
    const id = row.merch_id;
    if (!map.has(id)) {
      map.set(id, {
        merch_id:        id,
        full_name:       row.merch?.user?.full_name ?? "—",
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
}

export async function fetchBranchReport(range: DateRange): Promise<BranchReportRow[]> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from("visits")
    .select(`
      status, duration_minutes, place_id,
      place:places (branch_ar, branch_en, code, chain:chains (name_ar, name_en))
    `)
    .gte("scheduled_date", range.from)
    .lte("scheduled_date", range.to);

  if (error) throw error;

  const rows = (data ?? []) as unknown as BranchReportQueryRow[];

  const map = new Map<string, BranchReportRow>();

  for (const row of rows) {
    const id = row.place_id;
    if (!map.has(id)) {
      map.set(id, {
        place_id:        id,
        branch_ar:       row.place?.branch_ar      ?? "—",
        branch_en:       row.place?.branch_en      ?? "—",
        branch_code:     row.place?.code           ?? "—",
        chain_ar:        row.place?.chain?.name_ar ?? "—",
        chain_en:        row.place?.chain?.name_en ?? "—",
        total_visits:    0,
        completed:       0,
        missed:          0,
        completion_rate: 0,
        avg_duration:    0,
      });
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

  const result = Array.from(map.values()).map((b) => {
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

export async function fetchProductReport(range: DateRange): Promise<ProductReportRow[]> {
  const supabase = createClient();

  // Step 1: get visit IDs in the date range
  const { data: visitIds, error: vidErr } = await supabase
    .from("visits")
    .select("id")
    .gte("scheduled_date", range.from)
    .lte("scheduled_date", range.to)
    .eq("status", "completed");

  if (vidErr) throw vidErr;
  if (!visitIds || visitIds.length === 0) return [];

  const ids = visitIds.map((v) => v.id);

  // Step 2: get visit_products for those visits
  const { data: vpRows, error: vpErr } = await supabase
    .from("visit_products")
    .select(`
      product_id, qty_found, qty_missing,
      product:products (id, name_ar, name_en, sku, unit)
    `)
    .in("visit_id", ids);

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

export async function fetchGpsReport(range: DateRange): Promise<GpsReportRow[]> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from("visits")
    .select(`
      merch_id, checkin_verified, checkin_distance_meters,
      merch:company_users (user:users!company_users_user_id_fkey (full_name))
    `)
    .gte("scheduled_date", range.from)
    .lte("scheduled_date", range.to)
    .not("started_at", "is", null);   // only started visits

  if (error) throw error;

  const rows = (data ?? []) as unknown as GpsQueryRow[];

  const map = new Map<string, { row: GpsReportRow; distances: number[] }>();

  for (const r of rows) {
    const id = r.merch_id;
    if (!map.has(id)) {
      map.set(id, {
        row: {
          merch_id:          id,
          full_name:         r.merch?.user?.full_name ?? "—",
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
