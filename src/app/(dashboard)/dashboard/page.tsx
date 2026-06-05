"use client";

import { useState } from "react";
import {
  CalendarDays, CheckCircle2, Clock, AlertTriangle,
  Users, MapPin, Package, TrendingUp, ShieldCheck,
  RefreshCw, Activity, Zap, Building2,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useTranslation, type TranslationFn } from "@/hooks/use-translation";
import {
  useDashboard,
  useTrendData,
  useActivityFeed,
  DASHBOARD_KEY,
  TREND_KEY,
  ACTIVITY_KEY,
} from "@/hooks/use-dashboard";
import { useQueryClient } from "@tanstack/react-query";
import type { VisitStatus } from "@/types";
import { VisitsTrendChart } from "../_components/VisitsTrendChart";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function statusColor(status: string) {
  switch (status) {
    case "completed":  return "bg-emerald-100 text-emerald-700";
    case "inprogress": return "bg-blue-100 text-blue-700";
    case "pending":    return "bg-amber-100 text-amber-700";
    case "missed":     return "bg-rose-100 text-rose-700";
    default:           return "bg-ink-100 text-ink-600";
  }
}

function statusBar(status: string) {
  switch (status) {
    case "completed":  return "bg-emerald-500";
    case "inprogress": return "bg-blue-500";
    case "pending":    return "bg-amber-400";
    case "missed":     return "bg-rose-500";
    default:           return "bg-ink-300";
  }
}

function relativeTime(iso: string | null, locale: string): string {
  if (!iso) return "—";
  const diff = Math.max(0, Date.now() - new Date(iso).getTime());
  const mins = Math.floor(diff / 60_000);
  const hrs  = Math.floor(mins / 60);
  const days = Math.floor(hrs / 24);
  if (locale === "ar") {
    if (mins < 1)  return "الآن";
    if (mins < 60) return `منذ ${mins}د`;
    if (hrs  < 24) return `منذ ${hrs}س`;
    return `منذ ${days}ي`;
  }
  if (mins < 1)  return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (hrs  < 24) return `${hrs}h ago`;
  return `${days}d ago`;
}

// ─── Atoms ────────────────────────────────────────────────────────────────────

function KpiCard({
  label, value, unit, icon: Icon, accent, sub,
}: {
  label:   string;
  value:   string | number;
  unit?:   string;
  icon:    React.ElementType;
  accent:  string;
  sub?:    string;
}) {
  return (
    <div className="bg-white rounded-2xl border border-ink-100 p-4 shadow-sm flex items-start gap-3">
      <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center shrink-0", accent)}>
        <Icon className="w-5 h-5" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] text-ink-500 font-medium leading-tight truncate">{label}</p>
        <p className="text-[21px] font-bold text-ink-900 leading-tight mt-0.5">
          {value}
          {unit && <span className="text-[12px] font-normal text-ink-400 ms-1">{unit}</span>}
        </p>
        {sub && <p className="text-[10.5px] text-ink-400 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

function SectionHeader({ title, icon: Icon }: { title: string; icon?: React.ElementType }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <div className="w-1 h-5 rounded-full bg-brand-500" />
      {Icon && <Icon className="w-3.5 h-3.5 text-brand-400" />}
      <h2 className="text-[13px] font-bold text-ink-700">{title}</h2>
    </div>
  );
}

function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-xl bg-ink-100", className)} />;
}

function RateBadge({ rate }: { rate: number }) {
  const cls =
    rate >= 80 ? "bg-emerald-100 text-emerald-700" :
    rate >= 50 ? "bg-amber-100 text-amber-700"   :
                 "bg-rose-100 text-rose-700";
  return (
    <span className={cn("px-2 py-0.5 rounded-full text-[11px] font-bold", cls)}>
      {rate}%
    </span>
  );
}

// ─── Sub-sections ─────────────────────────────────────────────────────────────

function TrendSection({ locale, t }: { locale: string; t: TranslationFn }) {
  const { data = [], isLoading } = useTrendData(30);

  return (
    <div>
      <SectionHeader title={t("dashboard.section.trend")} icon={TrendingUp} />
      <div className="bg-white rounded-2xl border border-ink-100 shadow-sm p-4">
        {isLoading ? (
          <Skeleton className="h-[200px]" />
        ) : (
          <VisitsTrendChart data={data} locale={locale} />
        )}
      </div>
    </div>
  );
}

function ActivitySection({ locale, t }: { locale: string; t: TranslationFn }) {
  const { data = [], isLoading } = useActivityFeed();

  return (
    <div>
      <SectionHeader title={t("dashboard.section.activity")} icon={Activity} />
      {isLoading ? (
        <div className="space-y-2">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-14" />)}
        </div>
      ) : data.length === 0 ? (
        <div className="bg-white rounded-2xl border border-ink-100 p-8 text-center shadow-sm">
          <Activity className="w-8 h-8 text-ink-300 mx-auto mb-2" />
          <p className="text-[13px] text-ink-400">{t("dashboard.noActivity")}</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-ink-100 shadow-sm overflow-hidden">
          {data.map((v, i) => (
            <div
              key={v.id}
              className={cn(
                "flex items-center gap-3 px-4 py-3",
                i > 0 && "border-t border-ink-50"
              )}
            >
              {/* Avatar */}
              <div
                className="w-8 h-8 rounded-xl flex items-center justify-center text-white text-[11px] font-bold shrink-0"
                style={{ backgroundColor: v.merch_color ?? "#6366f1" }}
              >
                {v.merch_name.charAt(0).toUpperCase()}
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-semibold text-ink-800 truncate">
                  {locale === "ar" ? v.branch_ar : v.branch_en}
                </p>
                <p className="text-[11px] text-ink-400 truncate">
                  {v.merch_name}
                  {(locale === "ar" ? v.chain_ar : v.chain_en) !== "—"
                    ? ` · ${locale === "ar" ? v.chain_ar : v.chain_en}`
                    : ""}
                </p>
              </div>

              {/* Duration + time */}
              <div className="text-end shrink-0">
                {v.duration_minutes > 0 && (
                  <p className="text-[12px] font-semibold text-emerald-600">
                    {v.duration_minutes}{t("dashboard.kpi.minutes")}
                  </p>
                )}
                <p className="text-[10.5px] text-ink-400">
                  {relativeTime(v.completed_at, locale)}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { t, locale } = useTranslation();
  const qc            = useQueryClient();
  const [date, setDate] = useState(todayIso);

  const { data, isLoading, error } = useDashboard(date);

  const dir  = locale === "ar" ? "rtl" : "ltr";
  const isAr = locale === "ar";

  function refresh() {
    qc.invalidateQueries({ queryKey: DASHBOARD_KEY(date) });
    qc.invalidateQueries({ queryKey: TREND_KEY(30) });
    qc.invalidateQueries({ queryKey: ACTIVITY_KEY });
  }

  function tStatus(s: VisitStatus) {
    return t(`status.${s}`);
  }

  // ── Loading skeleton ──────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="space-y-6 pb-10" dir={dir}>
        <div className="flex items-center justify-between">
          <div>
            <Skeleton className="h-7 w-40 mb-2" />
            <Skeleton className="h-4 w-56" />
          </div>
          <Skeleton className="h-10 w-36" />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-20" />)}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-20" />)}
        </div>
        <Skeleton className="h-48" />
        <Skeleton className="h-64" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (error) {
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

  if (!data) return null;

  const {
    todayTotal, todayCompleted, todayInProgress, todayPending, todayMissed,
    completionRate, avgDuration, gpsVerifiedRate, gpsVerifiedCount,
    activeMerchs, activeBranches, activeProducts,
    todayVisits, branchStats, merchStats, alerts,
  } = data;

  // Status distribution bar segments
  const segmentData: { key: VisitStatus; count: number; bar: string }[] = [
    { key: "completed",  count: todayCompleted,  bar: "bg-emerald-500" },
    { key: "inprogress", count: todayInProgress, bar: "bg-blue-500"    },
    { key: "pending",    count: todayPending,    bar: "bg-amber-400"   },
    { key: "missed",     count: todayMissed,     bar: "bg-rose-500"    },
  ];
  const segments = segmentData.filter((s) => s.count > 0);

  const gpsSubtext = gpsVerifiedCount > 0
    ? `${gpsVerifiedCount} ${isAr ? "زيارة" : "visits"}`
    : undefined;

  return (
    <div className="space-y-6 pb-10" dir={dir}>

      {/* ── Page header ─────────────────────────────────────────────────── */}
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

      {/* ── KPI Row 1: Today's visit counts ─────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard
          label={t("dashboard.kpi.todayVisits")}
          value={todayTotal}
          icon={CalendarDays}
          accent="bg-brand-50 text-brand-600"
        />
        <KpiCard
          label={t("dashboard.kpi.completed")}
          value={todayCompleted}
          icon={CheckCircle2}
          accent="bg-emerald-50 text-emerald-600"
        />
        <KpiCard
          label={t("dashboard.kpi.inprogress")}
          value={todayInProgress}
          icon={Clock}
          accent="bg-blue-50 text-blue-600"
        />
        <KpiCard
          label={t("dashboard.kpi.missed")}
          value={todayMissed}
          icon={AlertTriangle}
          accent="bg-rose-50 text-rose-500"
        />
      </div>

      {/* ── KPI Row 2: Rates + GPS + Merchs ─────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard
          label={t("dashboard.kpi.completionRate")}
          value={`${completionRate}%`}
          icon={TrendingUp}
          accent="bg-violet-50 text-violet-600"
        />
        <KpiCard
          label={t("dashboard.kpi.avgDuration")}
          value={avgDuration || "—"}
          unit={avgDuration ? t("dashboard.kpi.minutes") : undefined}
          icon={Clock}
          accent="bg-sky-50 text-sky-600"
        />
        <KpiCard
          label={t("dashboard.kpi.gpsVerified")}
          value={`${gpsVerifiedRate}%`}
          sub={gpsSubtext}
          icon={ShieldCheck}
          accent={
            gpsVerifiedRate >= 80
              ? "bg-emerald-50 text-emerald-600"
              : gpsVerifiedRate >= 50
                ? "bg-amber-50 text-amber-600"
                : "bg-rose-50 text-rose-500"
          }
        />
        <KpiCard
          label={t("dashboard.kpi.activeMerchs")}
          value={activeMerchs}
          icon={Users}
          accent="bg-amber-50 text-amber-600"
        />
      </div>

      {/* ── KPI Row 3: Company totals ────────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-3">
        <KpiCard
          label={t("dashboard.kpi.activeBranches")}
          value={activeBranches}
          icon={Building2}
          accent="bg-teal-50 text-teal-600"
        />
        <KpiCard
          label={t("dashboard.kpi.activeProducts")}
          value={activeProducts}
          icon={Package}
          accent="bg-indigo-50 text-indigo-600"
        />
        <KpiCard
          label={t("dashboard.kpi.pending")}
          value={todayPending}
          icon={Zap}
          accent="bg-orange-50 text-orange-500"
        />
      </div>

      {/* ── Status distribution bar ──────────────────────────────────────── */}
      {todayTotal > 0 && (
        <div className="bg-white rounded-2xl border border-ink-100 p-4 shadow-sm">
          <SectionHeader title={t("dashboard.section.statusDist")} />
          <div className="flex h-2.5 rounded-full overflow-hidden gap-px">
            {segments.map(({ key, count, bar }) => (
              <div
                key={key}
                className={cn("h-full transition-all", bar)}
                style={{ width: `${(count / todayTotal) * 100}%` }}
              />
            ))}
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-1.5 mt-3">
            {segments.map(({ key, count, bar }) => (
              <div key={key} className="flex items-center gap-1.5 text-[12px] text-ink-600">
                <span className={cn("w-2.5 h-2.5 rounded-sm shrink-0", bar)} />
                <span>{tStatus(key)}</span>
                <span className="font-bold text-ink-800">{count}</span>
                <span className="text-ink-400 text-[11px]">
                  ({Math.round((count / todayTotal) * 100)}%)
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── 30-day trend chart ───────────────────────────────────────────── */}
      <TrendSection locale={locale} t={t} />

      {/* ── Today's visits list ──────────────────────────────────────────── */}
      <div>
        <SectionHeader title={t("dashboard.section.todayVisits")} icon={CalendarDays} />
        {todayVisits.length === 0 ? (
          <div className="bg-white rounded-2xl border border-ink-100 p-8 text-center shadow-sm">
            <CalendarDays className="w-8 h-8 text-ink-300 mx-auto mb-2" />
            <p className="text-[13px] text-ink-400">{t("dashboard.noVisitsToday")}</p>
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-ink-100 shadow-sm overflow-hidden">
            {todayVisits.map((v, i) => (
              <div
                key={v.id}
                className={cn(
                  "flex items-center gap-3 px-4 py-3",
                  i > 0 && "border-t border-ink-50"
                )}
              >
                <span className={cn("w-2 h-2 rounded-full shrink-0", statusBar(v.status))} />
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-semibold text-ink-800 truncate">
                    {isAr ? v.place?.branch_ar : v.place?.branch_en}
                  </p>
                  <p className="text-[11.5px] text-ink-400 truncate">
                    {v.merch?.user?.full_name}
                    {v.place?.chain && ` · ${isAr ? v.place.chain.name_ar : v.place.chain.name_en}`}
                  </p>
                </div>
                {v.checkin_verified && (
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                )}
                <span className={cn(
                  "shrink-0 px-2.5 py-0.5 rounded-full text-[11px] font-semibold",
                  statusColor(v.status)
                )}>
                  {tStatus(v.status)}
                </span>
                {v.status === "completed" && v.duration_minutes > 0 && (
                  <span className="text-[11.5px] text-ink-400 shrink-0">
                    {v.duration_minutes}{t("dashboard.kpi.minutes")}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Branch compliance table ──────────────────────────────────────── */}
      {branchStats.length > 0 && (
        <div>
          <SectionHeader title={t("dashboard.section.topBranches")} icon={MapPin} />
          <div className="bg-white rounded-2xl border border-ink-100 shadow-sm overflow-hidden">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="border-b border-ink-100 bg-ink-50/50">
                  <th className="text-start ps-4 py-2.5 font-semibold text-ink-500">{t("dashboard.col.branch")}</th>
                  <th className="text-center px-3 py-2.5 font-semibold text-ink-500">{t("dashboard.col.total")}</th>
                  <th className="text-center px-3 py-2.5 font-semibold text-ink-500">{t("dashboard.col.completed")}</th>
                  <th className="text-center px-3 py-2.5 font-semibold text-ink-500">{t("dashboard.col.missed")}</th>
                  <th className="text-center pe-4 py-2.5 font-semibold text-ink-500">{t("dashboard.col.rate")}</th>
                </tr>
              </thead>
              <tbody>
                {branchStats.map((b, i) => {
                  const finished = b.completed + b.missed;
                  const rate = finished > 0 ? Math.round((b.completed / finished) * 100) : null;
                  return (
                    <tr key={b.place_id} className={cn(i > 0 && "border-t border-ink-50")}>
                      <td className="ps-4 py-2.5">
                        <p className="font-semibold text-ink-800">{isAr ? b.branch_ar : b.branch_en}</p>
                        <p className="text-[11px] text-ink-400">{isAr ? b.chain_ar : b.chain_en} · {b.code}</p>
                      </td>
                      <td className="text-center px-3 py-2.5 font-bold text-ink-700">{b.total}</td>
                      <td className="text-center px-3 py-2.5 text-emerald-600 font-semibold">{b.completed}</td>
                      <td className="text-center px-3 py-2.5 text-rose-500 font-semibold">{b.missed}</td>
                      <td className="text-center pe-4 py-2.5">
                        {rate !== null ? <RateBadge rate={rate} /> : <span className="text-ink-300">—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Merch performance table ──────────────────────────────────────── */}
      {merchStats.length > 0 && (
        <div>
          <SectionHeader title={t("dashboard.section.merch")} icon={Users} />
          <div className="bg-white rounded-2xl border border-ink-100 shadow-sm overflow-hidden">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="border-b border-ink-100 bg-ink-50/50">
                  <th className="text-start ps-4 py-2.5 font-semibold text-ink-500">{t("dashboard.col.merch")}</th>
                  <th className="text-center px-3 py-2.5 font-semibold text-ink-500">{t("dashboard.col.total")}</th>
                  <th className="text-center px-3 py-2.5 font-semibold text-ink-500">{t("dashboard.col.completed")}</th>
                  <th className="text-center px-3 py-2.5 font-semibold text-ink-500">{t("dashboard.col.missed")}</th>
                  <th className="text-center pe-4 py-2.5 font-semibold text-ink-500">{t("dashboard.col.avgMin")}</th>
                </tr>
              </thead>
              <tbody>
                {merchStats.map((m, i) => (
                  <tr key={m.merch_id} className={cn(i > 0 && "border-t border-ink-50")}>
                    <td className="ps-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <div
                          className="w-7 h-7 rounded-full flex items-center justify-center text-white text-[11px] font-bold shrink-0"
                          style={{ backgroundColor: m.color ?? "#6366f1" }}
                        >
                          {m.full_name.charAt(0).toUpperCase()}
                        </div>
                        <span className="font-semibold text-ink-800 truncate">{m.full_name}</span>
                      </div>
                    </td>
                    <td className="text-center px-3 py-2.5 font-bold text-ink-700">{m.total}</td>
                    <td className="text-center px-3 py-2.5 text-emerald-600 font-semibold">{m.completed}</td>
                    <td className="text-center px-3 py-2.5 text-rose-500 font-semibold">{m.missed}</td>
                    <td className="text-center pe-4 py-2.5 text-ink-600">
                      {m.avg_minutes > 0 ? `${m.avg_minutes}${t("dashboard.kpi.minutes")}` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Activity feed ────────────────────────────────────────────────── */}
      <ActivitySection locale={locale} t={t} />

      {/* ── Stock alerts ─────────────────────────────────────────────────── */}
      <div>
        <SectionHeader title={t("dashboard.section.alerts")} icon={AlertTriangle} />
        {alerts.length === 0 ? (
          <div className="bg-white rounded-2xl border border-ink-100 p-6 text-center shadow-sm">
            <CheckCircle2 className="w-7 h-7 text-emerald-400 mx-auto mb-2" />
            <p className="text-[13px] text-ink-400">{t("dashboard.noAlerts")}</p>
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-ink-100 shadow-sm overflow-hidden">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="border-b border-ink-100 bg-rose-50/40">
                  <th className="text-start ps-4 py-2.5 font-semibold text-ink-500">{t("dashboard.col.branch")}</th>
                  <th className="text-start px-3 py-2.5 font-semibold text-ink-500">{t("dashboard.col.product")}</th>
                  <th className="text-center pe-4 py-2.5 font-semibold text-ink-500">{t("dashboard.col.missingQty")}</th>
                </tr>
              </thead>
              <tbody>
                {alerts.map((a, i) => (
                  <tr key={`${a.visit_id}-${a.product_id}`} className={cn(i > 0 && "border-t border-ink-50")}>
                    <td className="ps-4 py-2.5">
                      <p className="font-semibold text-ink-800">{isAr ? a.place.branch_ar : a.place.branch_en}</p>
                      <p className="text-[11px] text-ink-400">{a.place.code}</p>
                    </td>
                    <td className="px-3 py-2.5">
                      <p className="text-ink-800">{isAr ? a.product.name_ar : a.product.name_en}</p>
                      <p className="text-[11px] text-ink-400 font-mono">{a.product.sku}</p>
                    </td>
                    <td className="text-center pe-4 py-2.5">
                      <span className="px-2.5 py-0.5 rounded-full bg-rose-100 text-rose-700 font-bold text-[11.5px]">
                        {a.qty_missing}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

    </div>
  );
}
