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
import { Skeleton, TrendArrow, AnimatedNumber, Sparkline } from "./shared";

// ─── Accent system (section 3: color = meaning, used sparingly) ───────────────

interface Accent {
  bubble: string;   // icon bubble
  tint:   string;   // card surface tint
  spark:  string;   // sparkline stroke color
}

const ACCENTS: Record<string, Accent> = {
  teal:    { bubble: "bg-teal-50 text-teal-600",       tint: "hover:border-teal-200",    spark: "text-teal-400" },
  green:   { bubble: "bg-emerald-50 text-emerald-600", tint: "hover:border-emerald-200", spark: "text-emerald-400" },
  blue:    { bubble: "bg-blue-50 text-blue-600",       tint: "hover:border-blue-200",    spark: "text-blue-400" },
  violet:  { bubble: "bg-violet-50 text-violet-600",   tint: "hover:border-violet-200",  spark: "text-violet-400" },
  amber:   { bubble: "bg-amber-50 text-amber-600",     tint: "hover:border-amber-200",   spark: "text-amber-400" },
  red:     { bubble: "bg-rose-50 text-rose-500",       tint: "hover:border-rose-200",    spark: "text-rose-400" },
};

// ─── Card definition ──────────────────────────────────────────────────────────

interface KpiDef {
  key:    string;
  label:  string;
  value:  number;
  unit?:  string;
  icon:   LucideIcon;
  accent: Accent;
  href:   string;
  trend?: { today: number; yesterday: number; invert?: boolean };
  tooltip?: string;
  alert?:  boolean;
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
      aria-label={`${label}: ${value}${unit ?? ""}`}
      className={cn(
        "group relative bg-white rounded-2xl border p-4 shadow-sm overflow-hidden",
        "transition-all duration-200 hover:shadow-lg hover:-translate-y-1",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2",
        alert ? "border-rose-200 bg-rose-50/40" : cn("border-ink-100", accent.tint)
      )}
    >
      {/* Header: icon + sparkline */}
      <div className="flex items-start justify-between mb-2">
        <div className={cn(
          "w-9 h-9 rounded-xl flex items-center justify-center shrink-0",
          "transition-transform duration-200 group-hover:scale-110",
          accent.bubble
        )}>
          <Icon className="w-[18px] h-[18px]" />
        </div>
        <Sparkline className={cn("mt-1", accent.spark)} />
      </div>

      {/* Value */}
      <p className="text-[26px] font-bold text-ink-900 leading-none tracking-tight">
        <AnimatedNumber value={value} />
        {unit && <span className="text-[13px] font-semibold text-ink-400 ms-0.5">{unit}</span>}
      </p>

      {/* Title */}
      <p className="text-[11px] text-ink-500 font-medium mt-1 truncate">{label}</p>

      {/* Footer: trend */}
      {trend ? (
        <div className="mt-2 pt-2 border-t border-ink-50">
          <TrendArrow
            today={trend.today}
            yesterday={trend.yesterday}
            invert={trend.invert}
            label={trendLabel}
          />
        </div>
      ) : (
        <div className="mt-2 pt-2 border-t border-ink-50">
          <span className="text-[10.5px] text-ink-300 font-medium">{tooltip ?? "—"}</span>
        </div>
      )}
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

    const team        = extras?.team ?? [];
    const activeToday = team.filter((m) => presenceOf(m.last_activity_at) !== "offline").length;
    const onlineNow   = team.filter((m) => presenceOf(m.last_activity_at) === "online").length;
    const y           = extras?.yesterday;

    return [
      {
        key: "active", label: t("dashboard.exec.activeToday"), value: activeToday,
        icon: Users, accent: ACCENTS.teal, href: "/users",
        trend: y ? { today: activeToday, yesterday: y.activeUsers } : undefined,
      },
      {
        key: "online", label: t("dashboard.exec.onlineNow"), value: onlineNow,
        icon: Wifi, accent: ACCENTS.teal, href: "/users",
        tooltip: t("dashboard.exec.onlineTooltip"),
      },
      {
        key: "planned", label: t("dashboard.exec.plannedToday"), value: data.todayTotal,
        icon: CalendarDays, accent: ACCENTS.blue, href: "/visits",
        trend: y ? { today: data.todayTotal, yesterday: y.total } : undefined,
      },
      {
        key: "completed", label: t("dashboard.exec.completedToday"), value: data.todayCompleted,
        icon: CheckCircle2, accent: ACCENTS.green, href: "/visits",
        trend: y ? { today: data.todayCompleted, yesterday: y.completed } : undefined,
      },
      {
        key: "rate", label: t("dashboard.exec.completionRate"), value: data.completionRate, unit: "%",
        icon: TrendingUp, accent: ACCENTS.violet, href: "/reports",
        trend: y ? { today: data.completionRate, yesterday: y.completionRate } : undefined,
      },
      {
        key: "overdue", label: t("dashboard.exec.overdue"), value: extras?.overdueCount ?? 0,
        icon: Clock, accent: ACCENTS.amber, href: "/visits",
        alert: (extras?.overdueCount ?? 0) > 0,
      },
      {
        key: "sync", label: t("dashboard.exec.syncIssues"), value: extras?.syncIssuesCount ?? 0,
        icon: RefreshCw, accent: ACCENTS.red, href: "/users",
        alert: (extras?.syncIssuesCount ?? 0) > 0,
      },
      {
        key: "oos", label: t("dashboard.exec.oosReports"), value: data.alerts.length,
        icon: PackageX, accent: ACCENTS.red, href: "/reports",
        alert: data.alerts.length > 0,
      },
    ];
  }, [data, extras, t]);

  if (loading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
        {[...Array(8)].map((_, i) => <Skeleton key={i} className="h-[130px]" />)}
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
