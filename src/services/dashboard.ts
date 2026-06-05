import { createClient } from "@/lib/supabase/client";

// ─── Raw Supabase join row shapes (private to this module) ────────────────────
// Each interface mirrors exactly what PostgREST returns for its query's
// select() columns — used to type the boundary cast and eliminate all
// parameter/return-site `any` annotations.

interface DashboardVisitQueryRow {
  id:                      string;
  status:                  "pending" | "inprogress" | "completed" | "missed";
  scheduled_date:          string;
  started_at:              string | null;
  completed_at:            string | null;
  duration_minutes:        number | null;
  place_id:                string;
  merch_id:                string;
  checkin_verified:        boolean | null;
  checkin_distance_meters: number | null;
  place: {
    id:        string;
    branch_ar: string;
    branch_en: string;
    code:      string;
    chain: {
      id:      string;
      name_ar: string;
      name_en: string;
      color:   string | null;
    } | null;
  } | null;
  merch: {
    id:    string;
    color: string | null;
    user: {
      id:         string;
      full_name:  string;
      avatar_url: string | null;
    } | null;
  } | null;
}

interface AlertQueryRow {
  visit_id:    string;
  product_id:  string;
  qty_missing: number;
  product: {
    name_ar: string;
    name_en: string;
    sku:     string;
  } | null;
}

interface ActivityQueryRow {
  id:               string;
  status:           string;
  completed_at:     string | null;
  duration_minutes: number | null;
  place: {
    branch_ar: string;
    branch_en: string;
    code:      string;
    chain: { name_ar: string; name_en: string; color: string | null } | null;
  } | null;
  merch: {
    color: string | null;
    user:  { full_name: string } | null;
  } | null;
}

// ─── Output types ─────────────────────────────────────────────────────────────

export interface DashboardVisit {
  id:                      string;
  status:                  "pending" | "inprogress" | "completed" | "missed";
  scheduled_date:          string;
  started_at:              string | null;
  completed_at:            string | null;
  duration_minutes:        number;
  place_id:                string;
  merch_id:                string;
  checkin_verified:        boolean | null;
  checkin_distance_meters: number | null;
  place: {
    id:        string;
    branch_ar: string;
    branch_en: string;
    code:      string;
    chain: {
      id:      string;
      name_ar: string;
      name_en: string;
      color?:  string;
    } | null;
  };
  merch: {
    id:    string;
    color: string | null;
    user: {
      id:        string;
      full_name: string;
      avatar_url?: string;
    };
  };
}

export interface AlertItem {
  visit_id:    string;
  product_id:  string;
  qty_missing: number;
  place:       { branch_ar: string; branch_en: string; code: string };
  product:     { name_ar: string; name_en: string; sku: string };
}

export interface BranchStat {
  place_id:   string;
  branch_ar:  string;
  branch_en:  string;
  code:       string;
  chain_ar:   string;
  chain_en:   string;
  total:      number;
  completed:  number;
  missed:     number;
}

export interface MerchStat {
  merch_id:    string;
  full_name:   string;
  avatar_url?: string;
  color:       string | null;
  total:       number;
  completed:   number;
  missed:      number;
  avg_minutes: number;
}

// ─── Trend data ───────────────────────────────────────────────────────────────

/** One calendar-day bucket for the 30-day trend chart. */
export interface TrendPoint {
  date:       string;   // "YYYY-MM-DD"
  total:      number;
  completed:  number;
  missed:     number;
  inprogress: number;
  pending:    number;
}

// ─── Activity feed ────────────────────────────────────────────────────────────

/** Flattened completed-visit row for the live activity feed. */
export interface ActivityVisit {
  id:               string;
  completed_at:     string | null;
  duration_minutes: number;
  branch_ar:        string;
  branch_en:        string;
  branch_code:      string;
  chain_ar:         string;
  chain_en:         string;
  chain_color:      string | null;
  merch_name:       string;
  merch_color:      string | null;
}

// ─── Dashboard KPIs ───────────────────────────────────────────────────────────

export interface DashboardData {
  // KPI counters — today
  todayTotal:       number;
  todayCompleted:   number;
  todayInProgress:  number;
  todayPending:     number;
  todayMissed:      number;
  completionRate:   number;   // 0–100 (%)
  avgDuration:      number;   // minutes, completed visits only
  gpsVerifiedCount: number;   // started visits with checkin_verified = true
  gpsVerifiedRate:  number;   // gpsVerifiedCount / started * 100
  // Company-wide totals (static counts)
  activeMerchs:     number;
  activeBranches:   number;
  activeProducts:   number;
  // Detail lists
  todayVisits:   DashboardVisit[];
  branchStats:   BranchStat[];   // top 5 by total
  merchStats:    MerchStat[];    // all active merchs
  alerts:        AlertItem[];    // qty_missing > 0
}

// ─── Main fetch ───────────────────────────────────────────────────────────────

export async function fetchDashboard(date: string): Promise<DashboardData> {
  const supabase = createClient();

  // ── Phase 1: parallel fetches ─────────────────────────────────────────────
  const [visitsRes, merchsRes, branchesRes, productsRes] = await Promise.all([
    // Today's visits (full join for display + GPS fields)
    supabase
      .from("visits")
      .select(`
        id, status, scheduled_date, started_at, completed_at, duration_minutes,
        place_id, merch_id, checkin_verified, checkin_distance_meters,
        place:places (
          id, branch_ar, branch_en, code,
          chain:chains (id, name_ar, name_en, color)
        ),
        merch:company_users (
          id, color,
          user:users!company_users_user_id_fkey (id, full_name, avatar_url)
        )
      `)
      .eq("scheduled_date", date)
      .order("status", { ascending: true })
      .order("created_at", { ascending: false }),

    // Count active merchandisers (company-scoped via RLS)
    supabase
      .from("company_users")
      .select("id", { count: "exact", head: true })
      .eq("status", "active"),

    // Count active branches
    supabase
      .from("places")
      .select("id", { count: "exact", head: true })
      .eq("is_active", true),

    // Count active products
    supabase
      .from("products")
      .select("id", { count: "exact", head: true })
      .eq("is_active", true),
  ]);

  if (visitsRes.error)   throw visitsRes.error;
  if (merchsRes.error)   throw merchsRes.error;
  if (branchesRes.error) throw branchesRes.error;
  if (productsRes.error) throw productsRes.error;

  const queryRows   = (visitsRes.data ?? []) as unknown as DashboardVisitQueryRow[];
  const todayVisits: DashboardVisit[] = queryRows.map((row) => ({
    id:                      row.id,
    status:                  row.status,
    scheduled_date:          row.scheduled_date,
    started_at:              row.started_at,
    completed_at:            row.completed_at,
    duration_minutes:        row.duration_minutes ?? 0,
    place_id:                row.place_id,
    merch_id:                row.merch_id,
    checkin_verified:        row.checkin_verified,
    checkin_distance_meters: row.checkin_distance_meters,
    place: {
      id:        row.place?.id        ?? "",
      branch_ar: row.place?.branch_ar ?? "—",
      branch_en: row.place?.branch_en ?? "—",
      code:      row.place?.code      ?? "—",
      chain:     row.place?.chain
        ? {
            id:      row.place.chain.id,
            name_ar: row.place.chain.name_ar,
            name_en: row.place.chain.name_en,
            color:   row.place.chain.color ?? undefined,
          }
        : null,
    },
    merch: {
      id:    row.merch?.id    ?? "",
      color: row.merch?.color ?? null,
      user: {
        id:         row.merch?.user?.id         ?? "",
        full_name:  row.merch?.user?.full_name  ?? "—",
        avatar_url: row.merch?.user?.avatar_url ?? undefined,
      },
    },
  }));

  const visitIds = todayVisits.map((v) => v.id);

  // ── Phase 2: alerts (only if there are visits today) ─────────────────────
  let alerts: AlertItem[] = [];
  if (visitIds.length > 0) {
    const { data: alertRows, error: alertErr } = await supabase
      .from("visit_products")
      .select(`
        visit_id, product_id, qty_missing,
        product:products (name_ar, name_en, sku)
      `)
      .in("visit_id", visitIds)
      .gt("qty_missing", 0);

    if (alertErr) throw alertErr;

    const placeMap = new Map(todayVisits.map((v) => [v.id, v.place]));
    const alertQueryRows = (alertRows ?? []) as unknown as AlertQueryRow[];
    alerts = alertQueryRows.map((row) => ({
      visit_id:    row.visit_id,
      product_id:  row.product_id,
      qty_missing: row.qty_missing,
      place:       placeMap.get(row.visit_id) ?? { branch_ar: "—", branch_en: "—", code: "—" },
      product:     row.product ?? { name_ar: "—", name_en: "—", sku: "—" },
    }));
  }

  // ── Client-side aggregations ──────────────────────────────────────────────

  const completed  = todayVisits.filter((v) => v.status === "completed");
  const missed     = todayVisits.filter((v) => v.status === "missed");
  const inProgress = todayVisits.filter((v) => v.status === "inprogress");
  const pending    = todayVisits.filter((v) => v.status === "pending");

  // Completion rate: completed / (completed + missed)
  // Excludes still-pending/inprogress visits from the denominator.
  const finishedCount  = completed.length + missed.length;
  const completionRate = finishedCount > 0
    ? Math.round((completed.length / finishedCount) * 100)
    : 0;

  // Average duration across completed visits
  const durationsSum = completed.reduce((acc, v) => acc + (v.duration_minutes ?? 0), 0);
  const avgDuration  = completed.length > 0
    ? Math.round(durationsSum / completed.length)
    : 0;

  // GPS verified rate: GPS-verified / started
  // "started" = any visit that has begun (inprogress + completed + missed with started_at)
  const started         = todayVisits.filter((v) => v.started_at !== null);
  const gpsVerifiedCount = started.filter((v) => v.checkin_verified === true).length;
  const gpsVerifiedRate  = started.length > 0
    ? Math.round((gpsVerifiedCount / started.length) * 100)
    : 0;

  // Branch stats — grouped by place_id, top 5 by total
  const branchMap = new Map<string, BranchStat>();
  for (const v of todayVisits) {
    if (!branchMap.has(v.place_id)) {
      branchMap.set(v.place_id, {
        place_id:  v.place_id,
        branch_ar: v.place?.branch_ar ?? "—",
        branch_en: v.place?.branch_en ?? "—",
        code:      v.place?.code ?? "—",
        chain_ar:  v.place?.chain?.name_ar ?? "—",
        chain_en:  v.place?.chain?.name_en ?? "—",
        total:     0,
        completed: 0,
        missed:    0,
      });
    }
    const s = branchMap.get(v.place_id)!;
    s.total++;
    if (v.status === "completed") s.completed++;
    if (v.status === "missed")    s.missed++;
  }
  const branchStats = Array.from(branchMap.values())
    .sort((a, b) => b.total - a.total)
    .slice(0, 5);

  // Merch stats
  const merchMap = new Map<string, MerchStat>();
  for (const v of todayVisits) {
    if (!merchMap.has(v.merch_id)) {
      merchMap.set(v.merch_id, {
        merch_id:    v.merch_id,
        full_name:   v.merch?.user?.full_name ?? "—",
        avatar_url:  v.merch?.user?.avatar_url,
        color:       v.merch?.color ?? null,
        total:       0,
        completed:   0,
        missed:      0,
        avg_minutes: 0,
      });
    }
    const m = merchMap.get(v.merch_id)!;
    m.total++;
    if (v.status === "completed") m.completed++;
    if (v.status === "missed")    m.missed++;
  }
  const durationsByMerch = new Map<string, number[]>();
  for (const v of completed) {
    if (!durationsByMerch.has(v.merch_id)) durationsByMerch.set(v.merch_id, []);
    durationsByMerch.get(v.merch_id)!.push(v.duration_minutes ?? 0);
  }
  durationsByMerch.forEach((durations, mid) => {
    const m = merchMap.get(mid);
    if (m) {
      m.avg_minutes = Math.round(
        durations.reduce((a: number, b: number) => a + b, 0) / durations.length
      );
    }
  });
  const merchStats = Array.from(merchMap.values())
    .sort((a, b) => b.completed - a.completed);

  return {
    todayTotal:       todayVisits.length,
    todayCompleted:   completed.length,
    todayInProgress:  inProgress.length,
    todayPending:     pending.length,
    todayMissed:      missed.length,
    completionRate,
    avgDuration,
    gpsVerifiedCount,
    gpsVerifiedRate,
    activeMerchs:     merchsRes.count  ?? 0,
    activeBranches:   branchesRes.count ?? 0,
    activeProducts:   productsRes.count ?? 0,
    todayVisits,
    branchStats,
    merchStats,
    alerts,
  };
}

// ─── 30-day trend ─────────────────────────────────────────────────────────────
//
// Strategy: fetch only (scheduled_date, status) for the date window — two
// lightweight indexed columns. Build a date-keyed map to guarantee every day
// in the range appears in the output (zero-filled if no visits that day).
// Suitable for a 30-day or 90-day window without pagination.

export async function fetchTrendData(days: number = 30): Promise<TrendPoint[]> {
  const supabase = createClient();

  const now  = new Date();
  const from = new Date(now);
  from.setDate(from.getDate() - days + 1);

  const fromDate = from.toISOString().slice(0, 10);
  const toDate   = now.toISOString().slice(0, 10);

  const { data, error } = await supabase
    .from("visits")
    .select("scheduled_date, status")
    .gte("scheduled_date", fromDate)
    .lte("scheduled_date", toDate);

  if (error) throw error;

  // Initialise every date in the window (zero-filled)
  const map = new Map<string, TrendPoint>();
  const cur = new Date(from);
  while (cur <= now) {
    const d = cur.toISOString().slice(0, 10);
    map.set(d, { date: d, total: 0, completed: 0, missed: 0, inprogress: 0, pending: 0 });
    cur.setDate(cur.getDate() + 1);
  }

  for (const row of (data ?? [])) {
    const p = map.get(row.scheduled_date);
    if (!p) continue;
    p.total++;
    if      (row.status === "completed")  p.completed++;
    else if (row.status === "missed")     p.missed++;
    else if (row.status === "inprogress") p.inprogress++;
    else if (row.status === "pending")    p.pending++;
  }

  return Array.from(map.values());
}

// ─── Activity feed ────────────────────────────────────────────────────────────
//
// Last 15 completed visits across all time — no date filter so the feed always
// has content even when the selected dashboard date has no completed visits.

export async function fetchActivityFeed(): Promise<ActivityVisit[]> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from("visits")
    .select(`
      id, status, completed_at, duration_minutes,
      place:places (
        branch_ar, branch_en, code,
        chain:chains (name_ar, name_en, color)
      ),
      merch:company_users (
        color,
        user:users!company_users_user_id_fkey (full_name)
      )
    `)
    .eq("status", "completed")
    .order("completed_at", { ascending: false })
    .limit(15);

  if (error) throw error;

  const rows = (data ?? []) as unknown as ActivityQueryRow[];
  return rows.map((r) => ({
    id:               r.id,
    completed_at:     r.completed_at,
    duration_minutes: r.duration_minutes ?? 0,
    branch_ar:        r.place?.branch_ar      ?? "—",
    branch_en:        r.place?.branch_en      ?? "—",
    branch_code:      r.place?.code           ?? "—",
    chain_ar:         r.place?.chain?.name_ar ?? "—",
    chain_en:         r.place?.chain?.name_en ?? "—",
    chain_color:      r.place?.chain?.color   ?? null,
    merch_name:       r.merch?.user?.full_name ?? "—",
    merch_color:      r.merch?.color           ?? null,
  }));
}
