"use client";

import { memo, useMemo } from "react";
import Link from "next/link";
import {
  Users,
  Wifi,
  CalendarDays,
  CheckCircle2,
  TrendingUp,
  Clock,
  RefreshCw,
  PackageX,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import type { TranslationFn } from "@/hooks/use-translation";
import type { DashboardData } from "@/services/dashboard";
import { presenceOf, type ExecutiveExtras } from "@/services/dashboard-extras";
import { Skeleton, TrendArrow } from "./shared";

// ─── Single card ──────────────────────────────────────────────────────────────

interface KpiDef {
  key:    string;
  label:  string;
  value:  number | string;
  unit?:  string;
  icon:   LucideIcon;
  accent: string;           // icon bubble classes
  href:   string;
  trend?: { today: number; yesterday: number; invert?: boolean };
  tooltip?: string;
  /** Highlight the whole card when the value signals a problem. */
  alert?: boolean;
}

const ExecKpiCard = memo(function ExecKpiCard({
  def,
  trendLabel,
}: {
  def:        KpiDef;
  trendLabel: string;
}) {
  const { label, value, unit, icon: Icon, accent, href, trend, tooltip, alert } = def;
  return (
    <Link
      href={href}
      title={tooltip}
      className={cn(
        "group bg-white rounded-2xl border p-4 shadow-sm flex items-start gap-3",
        "transition-all hover:shadow-md hover:-translate-y-0.5",
        alert ? "border-rose-200 bg-rose-50/40" : "border-ink-100"
      )}
    >
      <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center shrink-0", accent)}>
        <Icon className="w-5 h-5" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] text-ink-500 font-medium leading-tight truncate">{label}</p>
        <p className="text-[21px] font-bold text-ink-900 leading-tight mt-0.5">
          {value}
          {unit && <span className="text-[12px] font-normal text-ink-400 ms-1">{unit}</span>}
        </p>
        {trend && (
          <TrendArrow
            today={trend.today}
            yesterday={trend.yesterday}
            invert={trend.invert}
            label={trendLabel}
          />
        )}
      </div>
    </Link>
  );
});

// ─── Row ──────────────────────────────────────────────────────────────────────

interface ExecutiveKpiRowProps {
  data?:    DashboardData;
  extras?:  ExecutiveExtras;
  loading:  boolean;
  t:        TranslationFn;
}

export const ExecutiveKpiRow = memo(function ExecutiveKpiRow({
  data,
  extras,
  loading,
  t,
}: ExecutiveKpiRowProps) {
  const cards = useMemo<KpiDef[]>(() => {
    if (!data) return [];

    const team          = extras?.team ?? [];
    const activeToday   = team.filter((m) => presenceOf(m.last_activity_at) !== "offline").length;
    const onlineNow     = team.filter((m) => presenceOf(m.last_activity_at) === "online").length;
    const y             = extras?.yesterday;

    return [
      {
        key: "active", label: t("dashboard.exec.activeToday"), value: activeToday,
        icon: Users, accent: "bg-brand-50 text-brand-600", href: "/users",
        trend: y ? { today: activeToday, yesterday: y.activeUsers } : undefined,
      },
      {
        key: "online", label: t("dashboard.exec.onlineNow"), value: onlineNow,
        icon: Wifi, accent: "bg-emerald-50 text-emerald-600", href: "/users",
        tooltip: t("dashboard.exec.onlineTooltip"),
      },
      {
        key: "planned", label: t("dashboard.exec.plannedToday"), value: data.todayTotal,
        icon: CalendarDays, accent: "bg-blue-50 text-blue-600", href: "/visits",
        trend: y ? { today: data.todayTotal, yesterday: y.total } : undefined,
      },
      {
        key: "completed", label: t("dashboard.exec.completedToday"), value: data.todayCompleted,
        icon: CheckCircle2, accent: "bg-emerald-50 text-emerald-600", href: "/visits",
        trend: y ? { today: data.todayCompleted, yesterday: y.completed } : undefined,
      },
      {
        key: "rate", label: t("dashboard.exec.completionRate"), value: data.completionRate, unit: "%",
        icon: TrendingUp, accent: "bg-violet-50 text-violet-600", href: "/reports",
        trend: y ? { today: data.completionRate, yesterday: y.completionRate } : undefined,
      },
      {
        key: "overdue", label: t("dashboard.exec.overdue"), value: extras?.overdueCount ?? 0,
        icon: Clock, accent: "bg-amber-50 text-amber-600", href: "/visits",
        alert: (extras?.overdueCount ?? 0) > 0,
      },
      {
        key: "sync", label: t("dashboard.exec.syncIssues"), value: extras?.syncIssuesCount ?? 0,
        icon: RefreshCw, accent: "bg-rose-50 text-rose-500", href: "/users",
        alert: (extras?.syncIssuesCount ?? 0) > 0,
      },
      {
        key: "oos", label: t("dashboard.exec.oosReports"), value: data.alerts.length,
        icon: PackageX, accent: "bg-rose-50 text-rose-500", href: "/reports",
        alert: data.alerts.length > 0,
      },
    ];
  }, [data, extras, t]);

  if (loading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
        {[...Array(8)].map((_, i) => <Skeleton key={i} className="h-[92px]" />)}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
      {cards.map((c) => (
        <ExecKpiCard key={c.key} def={c} trendLabel={t("dashboard.exec.vsYesterday")} />
      ))}
    </div>
  );
});
