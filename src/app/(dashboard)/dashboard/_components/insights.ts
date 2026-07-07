import type { DashboardData } from "@/services/dashboard";
import {
  presenceOf,
  hasSyncIssue,
  type ExecutiveExtras,
} from "@/services/dashboard-extras";

// ─────────────────────────────────────────────────────────────────────────────
// Presentation-level issue derivation for the Command Center.
// Pure functions over data the existing hooks already fetch — no new queries,
// no business logic. Severity ranking: red (act now) > amber (watch) > green.
// ─────────────────────────────────────────────────────────────────────────────

export type Severity = "red" | "amber" | "green";

export interface PriorityItem {
  key:      string;
  severity: Severity;
  /** Translation key + vars, resolved by the component. */
  msgKey:   string;
  msgVars?: Record<string, string | number>;
  href:     string;
  actionKey: string;   // translation key for the CTA label
}

export interface CommandCenterInsights {
  priorities:   PriorityItem[];
  issueCount:   number;      // red + amber
  offlineCount: number;
  gpsProblems:  number;      // started today but not GPS-verified
  healthScore:  number;      // 0–100
  healthParts:  { completion: number; sync: number; gps: number; attendance: number };
}

export function deriveInsights(
  data?:   DashboardData,
  extras?: ExecutiveExtras
): CommandCenterInsights {
  const team = extras?.team ?? [];

  // ── Building blocks ────────────────────────────────────────────────────────
  const offlineCount = team.filter((m) => presenceOf(m.last_activity_at) === "offline").length;
  const syncOffenders = team.filter((m) => hasSyncIssue(m.last_mobile_sync));

  const startedToday = (data?.todayVisits ?? []).filter((v) => v.started_at !== null);
  const gpsProblems  = startedToday.filter((v) => v.checkin_verified !== true).length;

  const overdue = extras?.overdueCount ?? 0;
  const oos     = data?.alerts.length ?? 0;

  const rateToday     = data?.completionRate ?? 0;
  const rateYesterday = extras?.yesterday.completionRate ?? 0;
  const rateDropped   = rateYesterday > 0 && rateToday < rateYesterday - 5;   // >5 pts drop

  // ── Priorities (ranked) ───────────────────────────────────────────────────
  const priorities: PriorityItem[] = [];

  if (overdue > 0) {
    priorities.push({
      key: "overdue", severity: "red",
      msgKey: "dashboard.prio.overdue", msgVars: { n: overdue },
      href: "/visits", actionKey: "dashboard.prio.actReview",
    });
  }

  if (syncOffenders.length === 1) {
    priorities.push({
      key: "sync", severity: "amber",
      msgKey: "dashboard.prio.syncUser", msgVars: { name: syncOffenders[0].name },
      href: "/users", actionKey: "dashboard.prio.actRemind",
    });
  } else if (syncOffenders.length > 1) {
    priorities.push({
      key: "sync", severity: "amber",
      msgKey: "dashboard.prio.syncMany", msgVars: { n: syncOffenders.length },
      href: "/users", actionKey: "dashboard.prio.actRemind",
    });
  }

  if (rateDropped) {
    priorities.push({
      key: "rate", severity: "amber",
      msgKey: "dashboard.prio.rateDrop",
      msgVars: { today: rateToday, yesterday: rateYesterday },
      href: "/reports", actionKey: "dashboard.prio.actOpen",
    });
  }

  if (oos > 0) {
    priorities.push({
      key: "oos", severity: "amber",
      msgKey: "dashboard.prio.oos", msgVars: { n: oos },
      href: "/reports", actionKey: "dashboard.prio.actReview",
    });
  }

  if (priorities.length === 0) {
    priorities.push({
      key: "allgood", severity: "green",
      msgKey: "dashboard.prio.allGood",
      href: "/visits", actionKey: "dashboard.prio.actOpen",
    });
  }

  const issueCount = priorities.filter((p) => p.severity !== "green").length;

  // ── Health score (equal-weight average of 4 sub-scores) ──────────────────
  const syncScore = team.length > 0
    ? Math.round(((team.length - syncOffenders.length) / team.length) * 100)
    : 100;
  const attendanceScore = team.length > 0
    ? Math.round((team.filter((m) => presenceOf(m.last_activity_at) !== "offline").length / team.length) * 100)
    : 100;
  const gpsScore        = data?.gpsVerifiedRate ?? 100;
  const completionScore = rateToday;

  const healthParts = {
    completion: completionScore,
    sync:       syncScore,
    gps:        gpsScore,
    attendance: attendanceScore,
  };
  const healthScore = Math.round(
    (completionScore + syncScore + gpsScore + attendanceScore) / 4
  );

  return { priorities, issueCount, offlineCount, gpsProblems, healthScore, healthParts };
}

// ─── Health label thresholds ──────────────────────────────────────────────────

export function healthLabelKey(score: number): string {
  if (score >= 85) return "dashboard.health.excellent";
  if (score >= 70) return "dashboard.health.good";
  if (score >= 50) return "dashboard.health.attention";
  return "dashboard.health.critical";
}

export function healthColor(score: number): string {
  if (score >= 85) return "#10b981";   // emerald
  if (score >= 70) return "#3b82f6";   // blue
  if (score >= 50) return "#f59e0b";   // amber
  return "#f43f5e";                    // rose
}
