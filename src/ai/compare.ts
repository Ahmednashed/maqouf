// ─────────────────────────────────────────────────────────────────────────────
// Period comparison — pure math (testable). Used by the compare_periods tool.
// ─────────────────────────────────────────────────────────────────────────────

export type ComparePeriodKey =
  | "today_vs_yesterday"
  | "week_vs_last_week"
  | "last7_vs_prev7"
  | "last30_vs_prev30";

export interface DateWindow {
  from: string;   // inclusive, YYYY-MM-DD
  to:   string;   // inclusive, YYYY-MM-DD
}

export interface PeriodWindows {
  current:  DateWindow;
  previous: DateWindow;
}

/** Pure: resolve the two date windows for a comparison key. `today` = YYYY-MM-DD. */
export function resolveWindows(key: ComparePeriodKey, today: string): PeriodWindows {
  const d       = new Date(today + "T00:00:00Z");
  const iso     = (x: Date) => x.toISOString().slice(0, 10);
  const shift   = (x: Date, days: number) => {
    const c = new Date(x);
    c.setUTCDate(c.getUTCDate() + days);
    return c;
  };

  switch (key) {
    case "today_vs_yesterday":
      return {
        current:  { from: today, to: today },
        previous: { from: iso(shift(d, -1)), to: iso(shift(d, -1)) },
      };
    case "week_vs_last_week": {
      // Monday-based week containing `today`
      const dow      = (d.getUTCDay() + 6) % 7;   // 0 = Monday
      const monday   = shift(d, -dow);
      const lastMon  = shift(monday, -7);
      const lastSun  = shift(monday, -1);
      return {
        current:  { from: iso(monday), to: today },
        previous: { from: iso(lastMon), to: iso(lastSun) },
      };
    }
    case "last7_vs_prev7":
      return {
        current:  { from: iso(shift(d, -6)),  to: today },
        previous: { from: iso(shift(d, -13)), to: iso(shift(d, -7)) },
      };
    case "last30_vs_prev30":
      return {
        current:  { from: iso(shift(d, -29)), to: today },
        previous: { from: iso(shift(d, -59)), to: iso(shift(d, -30)) },
      };
  }
}

// ─── Metric comparison ────────────────────────────────────────────────────────

export interface MetricComparison {
  metric:     string;
  current:    number | null;
  previous:   number | null;
  change:     number | null;
  change_pct: number | null;
  /** Whether the observed change is operationally good. */
  positive:   boolean | null;
}

/** Metrics where an INCREASE is operationally bad. */
const INVERTED = new Set([
  "missed_visits", "overdue_visits", "sync_issues", "stock_issues",
]);

/** Pure: compare one metric across two periods. */
export function compareMetric(
  metric:   string,
  current:  number | null,
  previous: number | null
): MetricComparison {
  if (current === null || previous === null) {
    return { metric, current, previous, change: null, change_pct: null, positive: null };
  }
  const change     = Math.round((current - previous) * 100) / 100;
  const change_pct = previous !== 0
    ? Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10
    : (current === 0 ? 0 : null);
  const positive = change === 0
    ? null
    : INVERTED.has(metric) ? change < 0 : change > 0;
  return { metric, current, previous, change, change_pct, positive };
}

// ─── Window aggregation (pure over fetched rows) ──────────────────────────────

export interface WindowVisitRow {
  status:           string;
  duration_minutes: number | null;
  started_at:       string | null;
  checkin_verified: boolean | null;
  merch_id:         string;
}

export interface WindowMetrics {
  planned:          number;
  completed:        number;
  completion_rate:  number;
  missed:           number;
  overdue:          number;   // still pending/inprogress as of "now"
  avg_duration:     number;
  active_users:     number;
  gps_verified_rate: number;
}

/** Pure: aggregate a window of visit rows into metrics. */
export function aggregateWindow(rows: WindowVisitRow[]): WindowMetrics {
  const completed = rows.filter((r) => r.status === "completed");
  const missed    = rows.filter((r) => r.status === "missed").length;
  const finished  = completed.length + missed;
  const started   = rows.filter((r) => r.started_at !== null);
  const gpsOk     = started.filter((r) => r.checkin_verified === true).length;
  const durations = completed.map((r) => r.duration_minutes ?? 0);

  return {
    planned:   rows.length,
    completed: completed.length,
    completion_rate: finished > 0 ? Math.round((completed.length / finished) * 100) : 0,
    missed,
    overdue:   rows.filter((r) => r.status === "pending" || r.status === "inprogress").length,
    avg_duration: durations.length > 0
      ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
      : 0,
    active_users: new Set(rows.map((r) => r.merch_id)).size,
    gps_verified_rate: started.length > 0
      ? Math.round((gpsOk / started.length) * 100)
      : 0,
  };
}
