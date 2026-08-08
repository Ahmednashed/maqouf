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
  /**
   * "primary"   — the five headline metrics: full treatment (sparkline + trend).
   * "exception" — problem counters: visually quiet at 0, loud above 0.
   */
  variant: "primary" | "exception";
}

const ExecKpiCard = memo(function ExecKpiCard({
  def,
  trendLabel,
}: {
  def:        KpiDef;
  trendLabel: string;
}) {
  const { label, value, unit, icon: Icon, accent, href, trend, tooltip, variant } = def;

  const isException = variant === "exception";
  // An exception card only earns attention when it actually has a problem.
  const raised      = isException && value > 0;
  const muted       = isException && value === 0;

  return (
    <Link
      href={href}
      title={tooltip}
      aria-label={`${label}: ${value}${unit ?? ""}`}
      className={cn(
        "group relative rounded-2xl border shadow-sm overflow-hidden p-3.5 h-full flex flex-col",
        "transition-all duration-200 hover:shadow-md hover:-translate-y-0.5",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2",
        raised  && "border-rose-200 bg-rose-50/50",
        muted   && "border-ink-100 bg-ink-50/40",
        !isException && cn("bg-white border-ink-100", accent.tint)
      )}
    >
      {/* Header: icon (+ sparkline on primary only) */}
      <div className="flex items-start justify-between gap-1">
        <div className={cn(
          "w-8 h-8 rounded-xl flex items-center justify-center shrink-0",
          "transition-transform duration-200 group-hover:scale-110",
          muted ? "bg-ink-100/70 text-ink-300" : accent.bubble
        )}>
          <Icon className="w-4 h-4" />
        </div>

        {!isException && <Sparkline className={cn("mt-0.5", accent.spark)} />}

        {raised && (
          <span className="relative flex w-2 h-2 mt-1.5 shrink-0" aria-hidden="true">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-60" />
            <span className="relative inline-flex rounded-full w-2 h-2 bg-rose-500" />
          </span>
        )}
      </div>

      {/* Value */}
      <p className={cn(
        "font-bold leading-none tracking-tight mt-2.5",
        isException ? "text-[21px]" : "text-[24px]",
        muted ? "text-ink-300" : "text-ink-900"
      )}>
        <AnimatedNumber value={value} />
        {unit && <span className="text-[12px] font-semibold text-ink-400 ms-0.5">{unit}</span>}
      </p>

      {/* Title */}
      <p className={cn(
        "text-[11px] font-medium mt-1 truncate",
        muted ? "text-ink-400" : "text-ink-500"
      )}>
        {label}
      </p>

      {/* Footer: trend (primary only — keeps exception cards short and quiet) */}
      {!isException && (
        <div className="mt-auto pt-2">
          {trend ? (
            <TrendArrow
              today={trend.today}
              yesterday={trend.yesterday}
              invert={trend.invert}
              label={trendLabel}
            />
          ) : (
            <span className="text-[10.5px] text-ink-300 font-medium line-clamp-1">
              {tooltip ?? "—"}
            </span>
          )}
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
      // ── Primary: the five headline numbers ────────────────────────────────
      {
        key: "active", label: t("dashboard.exec.activeToday"), value: activeToday,
        icon: Users, accent: ACCENTS.teal, href: "/users", variant: "primary",
        trend: y ? { today: activeToday, yesterday: y.activeUsers } : undefined,
      },
      {
        key: "online", label: t("dashboard.exec.onlineNow"), value: onlineNow,
        icon: Wifi, accent: ACCENTS.teal, href: "/users", variant: "primary",
        tooltip: t("dashboard.exec.onlineTooltip"),
      },
      {
        key: "planned", label: t("dashboard.exec.plannedToday"), value: data.todayTotal,
        icon: CalendarDays, accent: ACCENTS.blue, href: "/visits", variant: "primary",
        trend: y ? { today: data.todayTotal, yesterday: y.total } : undefined,
      },
      {
        key: "completed", label: t("dashboard.exec.completedToday"), value: data.todayCompleted,
        icon: CheckCircle2, accent: ACCENTS.green, href: "/visits", variant: "primary",
        trend: y ? { today: data.todayCompleted, yesterday: y.completed } : undefined,
      },
      {
        key: "rate", label: t("dashboard.exec.completionRate"), value: data.completionRate, unit: "%",
        icon: TrendingUp, accent: ACCENTS.violet, href: "/reports", variant: "primary",
        trend: y ? { today: data.completionRate, yesterday: y.completionRate } : undefined,
      },
      // ── Exceptions: quiet at 0, loud above 0 ──────────────────────────────
      {
        key: "overdue", label: t("dashboard.exec.overdue"), value: extras?.overdueCount ?? 0,
        icon: Clock, accent: ACCENTS.amber, href: "/visits", variant: "exception",
      },
      {
        key: "sync", label: t("dashboard.exec.syncIssues"), value: extras?.syncIssuesCount ?? 0,
        icon: RefreshCw, accent: ACCENTS.red, href: "/users", variant: "exception",
      },
      {
        key: "oos", label: t("dashboard.exec.oosReports"), value: data.alerts.length,
        icon: PackageX, accent: ACCENTS.red, href: "/reports", variant: "exception",
      },
    ];
  }, [data, extras, t]);

  // One responsive strip: 2 → 4 → 8 columns. Primary cards lead the strip,
  // exception cards close it, so the eye reads headline → problems.
  const GRID = "grid grid-cols-2 md:grid-cols-4 2xl:grid-cols-8 gap-3 items-stretch";

  if (loading) {
    return (
      <div className={GRID}>
        {[...Array(8)].map((_, i) => <Skeleton key={i} className="h-[112px]" />)}
      </div>
    );
  }

  return (
    <div className={GRID}>
      {cards.map((c) => (
        <ExecKpiCard key={c.key} def={c} trendLabel={t("dashboard.exec.vsYesterday")} />
      ))}
    </div>
  );
});
