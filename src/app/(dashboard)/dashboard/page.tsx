"use client";

import { useState, useCallback } from "react";
import dynamic from "next/dynamic";
import { CalendarDays, RefreshCw, AlertTriangle } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "@/hooks/use-translation";
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

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { t, locale } = useTranslation();
  const qc            = useQueryClient();
  const [date, setDate] = useState(todayIso);

  const dashboard = useDashboard(date);
  const extras    = useExecutiveExtras(date);
  const trend     = useTrendData(30);

  const dir = locale === "ar" ? "rtl" : "ltr";

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

      {/* ── Header + date + refresh ─────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-bold text-ink-900">{t("dashboard.title")}</h1>
          <p className="text-ink-500 text-[13px] mt-0.5">{t("dashboard.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <CalendarDays className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-400 pointer-events-none" />
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="h-9 ps-9 pe-3 rounded-xl border border-ink-200 bg-white text-[13px] text-ink-800 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-50 transition-all"
            />
          </div>
          <button
            onClick={refresh}
            title="Refresh"
            className="w-9 h-9 rounded-xl border border-ink-200 bg-white flex items-center justify-center text-ink-500 hover:text-brand-600 hover:border-brand-300 transition-all"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
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
