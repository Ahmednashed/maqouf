import type { SupabaseClient } from "@supabase/supabase-js";

// ─────────────────────────────────────────────────────────────────────────────
// Compact upfront context: a handful of COUNTS injected into the system
// prompt so trivial questions ("how many visits today?") can be answered
// with zero tool rounds. Cost: ~4 cheap indexed queries, ~60 tokens.
// ─────────────────────────────────────────────────────────────────────────────

export interface OperationsContextResult {
  summary:  string;
  degraded: boolean;
}

export async function buildOperationsContext(
  supabase: SupabaseClient,
  date:     string
): Promise<OperationsContextResult> {
  const [visitsRes, teamRes, overdueRes] = await Promise.allSettled([
    supabase.from("visits").select("status").eq("scheduled_date", date),
    supabase
      .from("company_users")
      .select("last_mobile_sync, last_activity_at")
      .eq("status", "active"),
    supabase
      .from("visits")
      .select("id", { count: "exact", head: true })
      .in("status", ["pending", "inprogress"])
      .lt("scheduled_date", date),
  ]);

  let degraded = false;
  const lines: string[] = [];

  if (visitsRes.status === "fulfilled" && !visitsRes.value.error) {
    const rows = visitsRes.value.data ?? [];
    const c = (s: string) => rows.filter((r) => r.status === s).length;
    lines.push(
      `visits_today: total=${rows.length} completed=${c("completed")} inprogress=${c("inprogress")} pending=${c("pending")} missed=${c("missed")}`
    );
  } else degraded = true;

  if (teamRes.status === "fulfilled" && !teamRes.value.error) {
    const team  = teamRes.value.data ?? [];
    const now   = Date.now();
    const DAY   = 24 * 60 * 60 * 1000;
    const stale = team.filter((m) =>
      !m.last_mobile_sync || now - new Date(m.last_mobile_sync).getTime() > DAY
    ).length;
    lines.push(`team: active_members=${team.length} sync_issues=${stale}`);
  } else degraded = true;

  if (overdueRes.status === "fulfilled" && !overdueRes.value.error) {
    lines.push(`overdue_visits: ${overdueRes.value.count ?? 0}`);
  } else degraded = true;

  return { summary: lines.join("\n"), degraded };
}
