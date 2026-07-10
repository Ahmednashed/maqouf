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

export type ChangeDirection = "up" | "down" | "flat";
export type DataQuality     = "ok" | "no_baseline" | "no_data" | "no_history";

export interface MetricComparison {
  metric:     string;
  current:    number | null;
  previous:   number | null;
  change:     number | null;
  change_pct: number | null;
  direction:  ChangeDirection | null;
  /** Whether the observed change is operationally good. */
  positive:   boolean | null;
  /** Zero-denominator / missing-data handling. */
  data_quality: DataQuality;
  /** Machine-readable interpretation for the model to narrate. */
  interpretation:
    | "improved" | "worsened" | "unchanged"
    | "new_activity" | "activity_stopped" | "no_activity" | "insufficient_data";
}

/** Metrics where an INCREASE is operationally bad. */
const INVERTED = new Set([
  "missed_visits", "overdue_visits", "sync_issues", "stock_issues",
]);

/** Pure: compare one metric across two periods with explicit zero handling. */
export function compareMetric(
  metric:   string,
  current:  number | null,
  previous: number | null
): MetricComparison {
  // Missing sides → insufficient data (never invent)
  if (current === null || previous === null) {
    return {
      metric, current, previous,
      change: null, change_pct: null, direction: null, positive: null,
      data_quality: current === null ? "no_data" : "no_history",
      interpretation: "insufficient_data",
    };
  }

  // Both zero → genuinely no activity in either period
  if (previous === 0 && current === 0) {
    return {
      metric, current, previous,
      change: 0, change_pct: 0, direction: "flat", positive: null,
      data_quality: "ok",
      interpretation: "no_activity",
    };
  }

  const change    = Math.round((current - previous) * 100) / 100;
  const direction: ChangeDirection = change > 0 ? "up" : change < 0 ? "down" : "flat";
  const positive = change === 0
    ? null
    : INVERTED.has(metric) ? change < 0 : change > 0;

  // previous = 0, current > 0 → new activity; percentage undefined
  if (previous === 0) {
    return {
      metric, current, previous,
      change, change_pct: null, direction, positive,
      data_quality: "no_baseline",
      interpretation: "new_activity",
    };
  }

  const change_pct =
    Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10;

  return {
    metric, current, previous, change, change_pct, direction, positive,
    data_quality: "ok",
    interpretation:
      current === 0       ? "activity_stopped" :
      change === 0        ? "unchanged" :
      positive            ? "improved" : "worsened",
  };
}

// ─── Executive comparison summary (pure) ──────────────────────────────────────

export interface ComparisonSummary {
  improved:          string[];
  worsened:          string[];
  unchanged:         string[];
  insufficient_data: string[];
  /** Top ≤3 most significant observations, largest |%| change first. */
  top_observations: Array<{
    metric:         string;
    interpretation: MetricComparison["interpretation"];
    change_pct:     number | null;
  }>;
}

export function summarizeComparison(comparisons: MetricComparison[]): ComparisonSummary {
  const byInterp = (interps: MetricComparison["interpretation"][]) =>
    comparisons.filter((c) => interps.includes(c.interpretation)).map((c) => c.metric);

  const significant = comparisons
    .filter((c) =>
      c.interpretation === "improved" ||
      c.interpretation === "worsened" ||
      c.interpretation === "new_activity" ||
      c.interpretation === "activity_stopped"
    )
    .sort((a, b) => Math.abs(b.change_pct ?? 100) - Math.abs(a.change_pct ?? 100))
    .slice(0, 3);

  return {
    improved:          byInterp(["improved", "new_activity"]),
    worsened:          byInterp(["worsened", "activity_stopped"]),
    unchanged:         byInterp(["unchanged", "no_activity"]),
    insufficient_data: byInterp(["insufficient_data"]),
    top_observations: significant.map((c) => ({
      metric:         c.metric,
      interpretation: c.interpretation,
      change_pct:     c.change_pct,
    })),
  };
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
