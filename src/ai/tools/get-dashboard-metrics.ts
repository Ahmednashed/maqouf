import { z } from "zod";
import type { ToolContext } from "../types";

export const dashboardMetricsArgs = z.object({}).strict();

/**
 * Company-wide snapshot for the operating date: visit status counts,
 * completion rate, and headline totals. Four cheap queries, counts only.
 */
export async function getDashboardMetrics(ctx: ToolContext) {
  const { supabase, date } = ctx;

  const [visitsRes, merchsRes, branchesRes, productsRes] = await Promise.all([
    supabase.from("visits").select("status").eq("scheduled_date", date),
    supabase.from("company_users").select("id", { count: "exact", head: true }).eq("status", "active"),
    supabase.from("places").select("id",   { count: "exact", head: true }).eq("is_active", true),
    supabase.from("products").select("id", { count: "exact", head: true }).eq("is_active", true),
  ]);

  if (visitsRes.error) throw visitsRes.error;

  const rows       = visitsRes.data ?? [];
  const byStatus   = (s: string) => rows.filter((r) => r.status === s).length;
  const completed  = byStatus("completed");
  const missed     = byStatus("missed");
  const finished   = completed + missed;

  return {
    date,
    visits_planned:    rows.length,
    visits_completed:  completed,
    visits_inprogress: byStatus("inprogress"),
    visits_pending:    byStatus("pending"),
    visits_missed:     missed,
    completion_rate_pct: finished > 0 ? Math.round((completed / finished) * 100) : 0,
    active_team_members: merchsRes.count   ?? 0,
    active_branches:     branchesRes.count ?? 0,
    active_products:     productsRes.count ?? 0,
  };
}
