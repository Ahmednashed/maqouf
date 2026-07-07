import { createClient } from "@/lib/supabase/client";

// ─────────────────────────────────────────────────────────────────────────────
// Executive Dashboard 2.0 — supplemental data
//
// Everything the classic fetchDashboard() doesn't provide:
//   • yesterday's counts (KPI trend arrows)
//   • overdue visits (pending/inprogress scheduled before today)
//   • field-team status rows (last activity, last sync, current visit)
//   • sync-issue count (no mobile sync in 24 h)
//   • visits-by-region aggregation (places.region isn't in DashboardVisit)
//   • products-audited-today count
//
// dashboard.ts stays untouched — this module is additive only.
// ─────────────────────────────────────────────────────────────────────────────

// ─── Output types ─────────────────────────────────────────────────────────────

export interface YesterdayStats {
  total:     number;
  completed: number;
  /** completed / (completed + missed) × 100 */
  completionRate: number;
  activeUsers: number;   // distinct merch_ids with any visit activity yesterday
}

export interface TeamMemberStatus {
  id:               string;   // company_users.id
  name:             string;
  email:            string | null;
  region:           string | null;
  color:            string | null;
  avatar_url:       string | null;
  role:             string;
  last_activity_at: string | null;
  last_mobile_sync: string | null;
  /** Set when the member has an in-progress visit right now. */
  current_visit: {
    id:               string;
    branch_ar:        string;
    branch_en:        string;
    checkin_verified: boolean | null;
  } | null;
}

export interface RegionStat {
  region:    string;
  total:     number;
  completed: number;
}

export interface ExecutiveExtras {
  yesterday:        YesterdayStats;
  overdueCount:     number;
  team:             TeamMemberStatus[];
  syncIssuesCount:  number;
  regionStats:      RegionStat[];
  productsAuditedToday: number;
}

// ─── Presence helpers (shared with the UI) ────────────────────────────────────

export const ONLINE_WINDOW_MS = 15 * 60 * 1000;        // 15 minutes
export const SYNC_STALE_MS    = 24 * 60 * 60 * 1000;   // 24 hours

export type PresenceState = "online" | "idle" | "offline";

/** online = active in the last 15 min; idle = active today; else offline. */
export function presenceOf(lastActivityAt: string | null): PresenceState {
  if (!lastActivityAt) return "offline";
  const ts = new Date(lastActivityAt).getTime();
  if (Date.now() - ts <= ONLINE_WINDOW_MS) return "online";
  const d = new Date(lastActivityAt);
  const n = new Date();
  const sameDay =
    d.getFullYear() === n.getFullYear() &&
    d.getMonth()    === n.getMonth()    &&
    d.getDate()     === n.getDate();
  return sameDay ? "idle" : "offline";
}

export function hasSyncIssue(lastMobileSync: string | null): boolean {
  if (!lastMobileSync) return true;
  return Date.now() - new Date(lastMobileSync).getTime() > SYNC_STALE_MS;
}

// ─── Raw query row shapes ─────────────────────────────────────────────────────

interface TeamQueryRow {
  id:               string;
  region:           string | null;
  color:            string | null;
  role:             string;
  display_name:     string | null;
  display_email:    string | null;
  avatar_url:       string | null;
  last_activity_at: string | null;
  last_mobile_sync: string | null;
  user: {
    full_name:  string;
    email:      string;
    avatar_url: string | null;
  } | null;
}

interface CurrentVisitRow {
  id:               string;
  merch_id:         string;
  checkin_verified: boolean | null;
  place: { branch_ar: string; branch_en: string } | null;
}

interface RegionVisitRow {
  status: string;
  place:  { region: string | null } | null;
}

// ─── Main fetch ───────────────────────────────────────────────────────────────

export async function fetchExecutiveExtras(date: string): Promise<ExecutiveExtras> {
  const supabase = createClient();

  const yesterdayDate = (() => {
    const d = new Date(date + "T00:00:00");
    d.setDate(d.getDate() - 1);
    return d.toISOString().slice(0, 10);
  })();

  const [yesterdayRes, overdueRes, teamRes, currentVisitsRes, regionRes, auditedRes] =
    await Promise.all([
      // 1. Yesterday's visits — status + merch only (trend arrows)
      supabase
        .from("visits")
        .select("status, merch_id")
        .eq("scheduled_date", yesterdayDate),

      // 2. Overdue: unfinished visits scheduled before today
      supabase
        .from("visits")
        .select("id", { count: "exact", head: true })
        .in("status", ["pending", "inprogress"])
        .lt("scheduled_date", date),

      // 3. Field team — all active members (RLS scopes to company)
      supabase
        .from("company_users")
        .select(`
          id, region, color, role, display_name, display_email, avatar_url,
          last_activity_at, last_mobile_sync,
          user:users!company_users_user_id_fkey (full_name, email, avatar_url)
        `)
        .eq("status", "active")
        .order("last_activity_at", { ascending: false, nullsFirst: false }),

      // 4. In-progress visits today → "current visit" per member
      supabase
        .from("visits")
        .select("id, merch_id, checkin_verified, place:places (branch_ar, branch_en)")
        .eq("scheduled_date", date)
        .eq("status", "inprogress"),

      // 5. Today's visits with place region (region aggregation)
      supabase
        .from("visits")
        .select("status, place:places (region)")
        .eq("scheduled_date", date),

      // 6. Products audited today (visit_products joined to today's visits)
      supabase
        .from("visit_products")
        .select("visit_id, visits!inner(scheduled_date)", { count: "exact", head: true })
        .eq("visits.scheduled_date", date),
    ]);

  if (yesterdayRes.error)     throw yesterdayRes.error;
  if (overdueRes.error)       throw overdueRes.error;
  if (teamRes.error)          throw teamRes.error;
  if (currentVisitsRes.error) throw currentVisitsRes.error;
  if (regionRes.error)        throw regionRes.error;
  if (auditedRes.error)       throw auditedRes.error;

  // ── Yesterday aggregation ─────────────────────────────────────────────────
  const yRows      = yesterdayRes.data ?? [];
  const yCompleted = yRows.filter((r) => r.status === "completed").length;
  const yMissed    = yRows.filter((r) => r.status === "missed").length;
  const yFinished  = yCompleted + yMissed;
  const yesterday: YesterdayStats = {
    total:          yRows.length,
    completed:      yCompleted,
    completionRate: yFinished > 0 ? Math.round((yCompleted / yFinished) * 100) : 0,
    activeUsers:    new Set(yRows.map((r) => r.merch_id)).size,
  };

  // ── Team status ───────────────────────────────────────────────────────────
  const currentByMerch = new Map<string, CurrentVisitRow>();
  for (const row of (currentVisitsRes.data ?? []) as unknown as CurrentVisitRow[]) {
    currentByMerch.set(row.merch_id, row);
  }

  const team: TeamMemberStatus[] = ((teamRes.data ?? []) as unknown as TeamQueryRow[]).map(
    (r) => {
      const cv = currentByMerch.get(r.id);
      return {
        id:               r.id,
        name:             r.display_name?.trim() || r.user?.full_name?.trim() || "—",
        email:            r.user?.email ?? r.display_email ?? null,
        region:           r.region,
        color:            r.color,
        avatar_url:       r.avatar_url ?? r.user?.avatar_url ?? null,
        role:             r.role,
        last_activity_at: r.last_activity_at,
        last_mobile_sync: r.last_mobile_sync,
        current_visit: cv
          ? {
              id:               cv.id,
              branch_ar:        cv.place?.branch_ar ?? "—",
              branch_en:        cv.place?.branch_en ?? "—",
              checkin_verified: cv.checkin_verified,
            }
          : null,
      };
    }
  );

  const syncIssuesCount = team.filter((m) => hasSyncIssue(m.last_mobile_sync)).length;

  // ── Region aggregation ────────────────────────────────────────────────────
  const regionMap = new Map<string, RegionStat>();
  for (const row of (regionRes.data ?? []) as unknown as RegionVisitRow[]) {
    const region = row.place?.region?.trim() || "—";
    if (!regionMap.has(region)) {
      regionMap.set(region, { region, total: 0, completed: 0 });
    }
    const s = regionMap.get(region)!;
    s.total++;
    if (row.status === "completed") s.completed++;
  }
  const regionStats = Array.from(regionMap.values()).sort((a, b) => b.total - a.total);

  return {
    yesterday,
    overdueCount:         overdueRes.count ?? 0,
    team,
    syncIssuesCount,
    regionStats,
    productsAuditedToday: auditedRes.count ?? 0,
  };
}
