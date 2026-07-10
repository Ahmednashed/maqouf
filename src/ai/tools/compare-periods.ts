import { z } from "zod";
import type { ToolContext } from "../types";
import {
  resolveWindows,
  aggregateWindow,
  compareMetric,
  type ComparePeriodKey,
  type DateWindow,
  type WindowVisitRow,
  type MetricComparison,
} from "../compare";

export const comparePeriodsArgs = z.object({
  period: z.enum([
    "today_vs_yesterday",
    "week_vs_last_week",
    "last7_vs_prev7",
    "last30_vs_prev30",
  ]),
}).strict();

type Args = z.infer<typeof comparePeriodsArgs>;

async function fetchWindow(ctx: ToolContext, w: DateWindow) {
  const [visitsRes, auditedRes, stockRes] = await Promise.all([
    ctx.supabase
      .from("visits")
      .select("status, duration_minutes, started_at, checkin_verified, merch_id")
      .gte("scheduled_date", w.from)
      .lte("scheduled_date", w.to),
    ctx.supabase
      .from("visit_products")
      .select("visit_id, visits!inner(scheduled_date)", { count: "exact", head: true })
      .gte("visits.scheduled_date", w.from)
      .lte("visits.scheduled_date", w.to),
    ctx.supabase
      .from("visit_products")
      .select("visit_id, visits!inner(scheduled_date)", { count: "exact", head: true })
      .gt("qty_missing", 0)
      .gte("visits.scheduled_date", w.from)
      .lte("visits.scheduled_date", w.to),
  ]);

  if (visitsRes.error) throw visitsRes.error;

  return {
    metrics:  aggregateWindow((visitsRes.data ?? []) as WindowVisitRow[]),
    audited:  auditedRes.error ? null : (auditedRes.count ?? 0),
    stock:    stockRes.error   ? null : (stockRes.count ?? 0),
  };
}

/**
 * Compare operational metrics across two periods. Sync issues have no
 * historical snapshot, so they're reported for the CURRENT state only
 * (previous = null) — the model is told never to invent the missing side.
 */
export async function comparePeriods(ctx: ToolContext, args: Args) {
  const windows = resolveWindows(args.period as ComparePeriodKey, ctx.date);

  const [cur, prev, teamRes] = await Promise.all([
    fetchWindow(ctx, windows.current),
    fetchWindow(ctx, windows.previous),
    ctx.supabase
      .from("company_users")
      .select("last_mobile_sync")
      .eq("status", "active"),
  ]);

  // Current-only sync issues (no history exists)
  let syncNow: number | null = null;
  if (!teamRes.error) {
    const DAY = 24 * 60 * 60 * 1000;
    syncNow = (teamRes.data ?? []).filter((m) =>
      !m.last_mobile_sync || Date.now() - new Date(m.last_mobile_sync).getTime() > DAY
    ).length;
  }

  const m = cur.metrics;
  const p = prev.metrics;

  const comparisons: MetricComparison[] = [
    compareMetric("planned_visits",    m.planned,          p.planned),
    compareMetric("completed_visits",  m.completed,        p.completed),
    compareMetric("completion_rate",   m.completion_rate,  p.completion_rate),
    compareMetric("missed_visits",     m.missed,           p.missed),
    compareMetric("overdue_visits",    m.overdue,          p.overdue),
    compareMetric("avg_duration_min",  m.avg_duration,     p.avg_duration),
    compareMetric("active_users",      m.active_users,     p.active_users),
    compareMetric("gps_verified_rate", m.gps_verified_rate, p.gps_verified_rate),
    compareMetric("products_audited",  cur.audited,        prev.audited),
    compareMetric("stock_issues",      cur.stock,          prev.stock),
    compareMetric("sync_issues",       syncNow,            null),   // current-only
  ];

  return {
    period: args.period,
    current_window:  windows.current,
    previous_window: windows.previous,
    comparisons,
    note: "sync_issues has no historical data; previous value is null by design.",
  };
}
