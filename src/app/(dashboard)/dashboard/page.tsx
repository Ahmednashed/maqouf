"use client";

import { useState, useCallback, useMemo } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import {
  CalendarDays, RefreshCw, AlertTriangle, CloudSun,
  FileDown, SlidersHorizontal,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils/cn";
import { useTranslation } from "@/hooks/use-translation";
import { useCurrentMember, currentMemberLabel } from "@/hooks/use-current-member";
import { presenceOf } from "@/services/dashboard-extras";
import {
  useDashboard,
  useTrendData,
  useExecutiveExtras,
  DASHBOARD_KEY,
  TREND_KEY,
  ACTIVITY_KEY,
  EXTRAS_KEY,
} from "@/hooks/use-dashboard";
import { ACTIVITY_LOGS_KEY } from "@/hooks/use-activity-logs";
import { Skeleton } from "./_components/shared";
import { ExecutiveKpiRow }  from "./_components/ExecutiveKpiRow";
import { LiveActivityFeed } from "./_components/LiveActivityFeed";
import { AiInsightsCard }   from "./_components/AiInsightsCard";
import { LiveTeamMapCard }  from "./_components/LiveTeamMapCard";
import { FieldTeamTable }   from "./_components/FieldTeamTable";
import { TodayTimeline }    from "./_components/TodayTimeline";
import { QuickActions }     from "./_components/QuickActions";

// Recharts is the heaviest client dependency on this page — defer it so the
// KPI row and feed paint first.
const ChartsGrid = dynamic(
  () => import("./_components/ChartsGrid"),
  {
    ssr: false,
    loading: () => <Skeleton className="h-[420px]" />,
  }
);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function SummaryChip({
  value,
  label,
  className,
}: {
  value:     number;
  label:     string;
  className: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-semibold", className)}>
      <span className="font-bold">{value}</span>
      {label}
    </span>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { t, locale } = useTranslation();
  const qc            = useQueryClient();
  const [date, setDate] = useState(todayIso);

  const dashboard = useDashboard(date);
  const extras    = useExecutiveExtras(date);
  const trend     = useTrendData(30);
  const { data: me } = useCurrentMember();

  const dir = locale === "ar" ? "rtl" : "ltr";

  // Hero derivations
  const greetingKey = useMemo(() => {
    const h = new Date().getHours();
    if (h < 12) return "dashboard.hero.morning" as const;
    if (h < 17) return "dashboard.hero.afternoon" as const;
    return "dashboard.hero.evening" as const;
  }, []);

  const firstName = currentMemberLabel(me).split(" ")[0] || "";

  const prettyDate = useMemo(
    () =>
      new Date(date + "T00:00:00").toLocaleDateString(
        locale === "ar" ? "ar-SA-u-ca-gregory" : "en-GB",
        { weekday: "long", day: "numeric", month: "long", year: "numeric" }
      ),
    [date, locale]
  );

  const onlineNow = useMemo(
    () => (extras.data?.team ?? []).filter((m) => presenceOf(m.last_activity_at) === "online").length,
    [extras.data?.team]
  );

  const refresh = useCallback(() => {
    qc.invalidateQueries({ queryKey: DASHBOARD_KEY(date) });
    qc.invalidateQueries({ queryKey: EXTRAS_KEY(date) });
    qc.invalidateQueries({ queryKey: TREND_KEY(30) });
    qc.invalidateQueries({ queryKey: ACTIVITY_KEY });
    qc.invalidateQueries({ queryKey: ACTIVITY_LOGS_KEY() });
  }, [qc, date]);

  // ── Fatal error (KPI source failed) ─────────────────────────────────────
  if (dashboard.error) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-3" dir={dir}>
        <AlertTriangle className="w-10 h-10 text-rose-400" />
        <p className="text-ink-600 font-medium">{t("common.errorLoad")}</p>
        <button
          onClick={refresh}
          className="mt-2 px-4 h-9 rounded-xl bg-brand-500 text-white text-[13px] font-semibold hover:bg-brand-600 transition-all"
        >
          {t("reports.apply")}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-10" dir={dir}>

      {/* ── §1 Hero header ──────────────────────────────────────────────── */}
      <div className="relative bg-white rounded-2xl border border-ink-100 shadow-sm overflow-hidden">
        {/* Subtle brand wash */}
        <div className="absolute inset-0 bg-gradient-to-r from-brand-50/70 via-transparent to-transparent pointer-events-none" />

        <div className="relative px-5 py-5 sm:px-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            {/* Greeting */}
            <div className="min-w-0">
              <h1 className="text-[22px] sm:text-[24px] font-bold text-ink-900 leading-tight">
                {t(greetingKey)}{firstName ? ` ${firstName}` : ""} 👋
              </h1>
              <p className="text-ink-500 text-[13px] mt-1">{t("dashboard.hero.tagline")}</p>

              {/* Date + weather chip */}
              <div className="flex flex-wrap items-center gap-2 mt-2.5">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-ink-50 border border-ink-100 text-[11.5px] font-semibold text-ink-600">
                  <CalendarDays className="w-3.5 h-3.5 text-ink-400" />
                  {prettyDate}
                </span>
                {/* Weather placeholder */}
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-50 border border-amber-100 text-[11.5px] font-semibold text-amber-700">
                  <CloudSun className="w-3.5 h-3.5" />
                  —°
                </span>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2 shrink-0">
              <div className="relative">
                <CalendarDays className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-400 pointer-events-none" />
                <input
                  type="date"
                  value={date}
                  aria-label={t("dashboard.dateLabel")}
                  onChange={(e) => setDate(e.target.value)}
                  className="h-9 ps-9 pe-3 rounded-xl border border-ink-200 bg-white text-[13px] text-ink-800 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-50 transition-all"
                />
              </div>
              <button
                onClick={refresh}
                aria-label="Refresh"
                title="Refresh"
                className="w-9 h-9 rounded-xl border border-ink-200 bg-white flex items-center justify-center text-ink-500 hover:text-brand-600 hover:border-brand-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 transition-all"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
              <Link
                href="/reports"
                className="hidden sm:inline-flex items-center gap-1.5 h-9 px-3.5 rounded-xl border border-ink-200 bg-white text-[12.5px] font-semibold text-ink-600 hover:text-brand-600 hover:border-brand-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 transition-all"
              >
                <FileDown className="w-4 h-4" />
                {t("dashboard.hero.export")}
              </Link>
              <button
                type="button"
                disabled
                title={t("dashboard.hero.filters")}
                className="hidden sm:inline-flex items-center gap-1.5 h-9 px-3.5 rounded-xl border border-ink-200 bg-white text-[12.5px] font-semibold text-ink-300 cursor-not-allowed"
              >
                <SlidersHorizontal className="w-4 h-4" />
                {t("dashboard.hero.filters")}
              </button>
            </div>
          </div>

          {/* Summary line */}
          {dashboard.data && (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 mt-4 pt-4 border-t border-ink-100/70 text-[12.5px]">
              <span className="text-ink-500 font-medium">{t("dashboard.hero.summaryPrefix")}</span>
              <SummaryChip value={dashboard.data.todayTotal}     label={t("dashboard.hero.chipPlanned")}   className="bg-blue-50 text-blue-700" />
              <SummaryChip value={dashboard.data.todayCompleted} label={t("dashboard.hero.chipCompleted")} className="bg-emerald-50 text-emerald-700" />
              <SummaryChip value={extras.data?.overdueCount ?? 0} label={t("dashboard.hero.chipDelayed")}  className="bg-amber-50 text-amber-700" />
              <SummaryChip value={onlineNow}                     label={t("dashboard.hero.chipOnline")}    className="bg-teal-50 text-teal-700" />
            </div>
          )}
        </div>
      </div>

      {/* ── §1 Executive KPI cards ──────────────────────────────────────── */}
      <ExecutiveKpiRow
        data={dashboard.data}
        extras={extras.data}
        loading={dashboard.isLoading}
        t={t}
      />

      {/* ── Main grid: content (2/3) + live rail (1/3) ──────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 items-start">

        {/* Left / main column */}
        <div className="xl:col-span-2 space-y-6 min-w-0">
          {/* §4 Today's schedule */}
          <TodayTimeline
            visits={dashboard.data?.todayVisits}
            loading={dashboard.isLoading}
            t={t}
            locale={locale}
          />

          {/* §3 Field team status */}
          <FieldTeamTable
            team={extras.data?.team}
            loading={extras.isLoading}
            t={t}
            locale={locale}
          />

          {/* §6 Charts (lazy) */}
          <ChartsGrid
            data={dashboard.data}
            extras={extras.data}
            trend={trend.data ?? []}
            t={t}
            locale={locale}
          />
        </div>

        {/* Right rail */}
        <div className="space-y-6 min-w-0">
          {/* §2 Live activity feed */}
          <LiveActivityFeed />

          {/* §7 AI insights (design placeholder) */}
          <AiInsightsCard t={t} />

          {/* §5 Live team map (placeholder) */}
          <LiveTeamMapCard t={t} />
        </div>
      </div>

      {/* ── §8 Quick actions FAB ─────────────────────────────────────────── */}
      <QuickActions t={t} />
    </div>
  );
}
