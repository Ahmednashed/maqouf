"use client";

import { memo, useMemo } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  RadialBarChart, RadialBar, PolarAngleAxis, CartesianGrid,
} from "recharts";
import Link from "next/link";
import { BarChart3, PackageSearch, LineChart, ArrowRight } from "lucide-react";
import type { TranslationFn } from "@/hooks/use-translation";
import type { DashboardData, TrendPoint } from "@/services/dashboard";
import type { ExecutiveExtras } from "@/services/dashboard-extras";
import { VisitsTrendChart } from "../../_components/VisitsTrendChart";
import { SectionHeader } from "./shared";

// ─── Panel shell ──────────────────────────────────────────────────────────────

function ChartPanel({
  title,
  children,
  span2 = false,
}: {
  title:    string;
  children: React.ReactNode;
  span2?:   boolean;
}) {
  return (
    <div className={span2 ? "sm:col-span-2" : undefined}>
      <div className="bg-white rounded-2xl border border-ink-100 shadow-sm p-4 h-full">
        <p className="text-[12px] font-bold text-ink-600 mb-3">{title}</p>
        {children}
      </div>
    </div>
  );
}

function NoData({ t }: { t: TranslationFn }) {
  return (
    <div className="h-[160px] flex flex-col items-center justify-center gap-2">
      {/* Mini illustration: ghosted bars */}
      <div className="flex items-end gap-1.5 h-10" aria-hidden="true">
        {[16, 26, 12, 32, 20].map((h, i) => (
          <span
            key={i}
            className="w-2.5 rounded-t bg-ink-100"
            style={{ height: `${h}px` }}
          />
        ))}
        <LineChart className="w-4 h-4 text-ink-200 mb-1 ms-1" />
      </div>
      <p className="text-[12px] font-semibold text-ink-400">{t("dashboard.chart.noData")}</p>
      <Link
        href="/visits"
        className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-brand-500 hover:text-brand-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 rounded"
      >
        {t("dashboard.chart.emptyCta")}
        <ArrowRight className="w-3 h-3 rtl:rotate-180" />
      </Link>
    </div>
  );
}

const AXIS_TICK  = { fontSize: 10, fill: "#9ca3af" };
const BAR_RADIUS: [number, number, number, number] = [4, 4, 0, 0];

// ─── Grid ─────────────────────────────────────────────────────────────────────

interface ChartsGridProps {
  data?:   DashboardData;
  extras?: ExecutiveExtras;
  trend:   TrendPoint[];
  t:       TranslationFn;
  locale:  string;
}

function ChartsGridInner({ data, extras, trend, t, locale }: ChartsGridProps) {
  // Visits by hour — bucket started_at into 24 hours, trim to active window
  const hourly = useMemo(() => {
    const buckets = Array.from({ length: 24 }, (_, h) => ({ hour: `${h}`, visits: 0 }));
    for (const v of data?.todayVisits ?? []) {
      if (v.started_at) buckets[new Date(v.started_at).getHours()].visits++;
    }
    const active = buckets.filter((b) => b.visits > 0);
    if (active.length === 0) return [];
    const first = buckets.findIndex((b) => b.visits > 0);
    const last  = 23 - [...buckets].reverse().findIndex((b) => b.visits > 0);
    return buckets.slice(Math.max(0, first - 1), Math.min(24, last + 2));
  }, [data?.todayVisits]);

  // Top 5 chains — group today's visits by chain
  const chains = useMemo(() => {
    const map = new Map<string, { name: string; visits: number; color: string }>();
    for (const v of data?.todayVisits ?? []) {
      const c = v.place.chain;
      if (!c) continue;
      const name = locale === "ar" ? c.name_ar : c.name_en;
      if (!map.has(c.id)) map.set(c.id, { name, visits: 0, color: c.color ?? "#6366F1" });
      map.get(c.id)!.visits++;
    }
    return Array.from(map.values()).sort((a, b) => b.visits - a.visits).slice(0, 5);
  }, [data?.todayVisits, locale]);

  // Visits by user — top 8 from merchStats
  const byUser = useMemo(
    () =>
      (data?.merchStats ?? []).slice(0, 8).map((m) => ({
        name:      m.full_name.split(" ")[0],
        completed: m.completed,
        total:     m.total,
      })),
    [data?.merchStats]
  );

  const regions = useMemo(
    () => (extras?.regionStats ?? []).slice(0, 8),
    [extras?.regionStats]
  );

  const rate = data?.completionRate ?? 0;
  const rateColor = rate >= 80 ? "#10b981" : rate >= 50 ? "#f59e0b" : "#f43f5e";

  return (
    <div>
      <SectionHeader title={t("dashboard.section.charts")} icon={BarChart3} />

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3" dir="ltr">
        {/* 1. Visits by hour */}
        <ChartPanel title={t("dashboard.chart.byHour")}>
          {hourly.length === 0 ? <NoData t={t} /> : (
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={hourly}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
                <XAxis dataKey="hour" tick={AXIS_TICK} axisLine={false} tickLine={false} />
                <YAxis allowDecimals={false} tick={AXIS_TICK} axisLine={false} tickLine={false} width={24} />
                <Tooltip cursor={{ fill: "#f9fafb" }} contentStyle={{ fontSize: 11, borderRadius: 8 }} />
                <Bar dataKey="visits" fill="#6366F1" radius={BAR_RADIUS} maxBarSize={22} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartPanel>

        {/* 2. Completion % — radial gauge */}
        <ChartPanel title={t("dashboard.chart.completion")}>
          <div className="relative">
            <ResponsiveContainer width="100%" height={160}>
              <RadialBarChart
                innerRadius="70%" outerRadius="95%"
                data={[{ value: rate }]}
                startAngle={90} endAngle={-270}
              >
                <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
                <RadialBar dataKey="value" cornerRadius={8} fill={rateColor} background={{ fill: "#f3f4f6" }} />
              </RadialBarChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <span className="text-[26px] font-bold text-ink-900 leading-none">{rate}%</span>
              <span className="text-[10.5px] text-ink-400 mt-1">
                {data?.todayCompleted ?? 0}/{data?.todayTotal ?? 0}
              </span>
            </div>
          </div>
        </ChartPanel>

        {/* 3. Visits by region */}
        <ChartPanel title={t("dashboard.chart.byRegion")}>
          {regions.length === 0 ? <NoData t={t} /> : (
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={regions}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
                <XAxis dataKey="region" tick={AXIS_TICK} axisLine={false} tickLine={false} />
                <YAxis allowDecimals={false} tick={AXIS_TICK} axisLine={false} tickLine={false} width={24} />
                <Tooltip cursor={{ fill: "#f9fafb" }} contentStyle={{ fontSize: 11, borderRadius: 8 }} />
                <Bar dataKey="total"     fill="#c7d2fe" radius={BAR_RADIUS} maxBarSize={18} />
                <Bar dataKey="completed" fill="#6366F1" radius={BAR_RADIUS} maxBarSize={18} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartPanel>

        {/* 4. Visits by user — horizontal bars */}
        <ChartPanel title={t("dashboard.chart.byUser")}>
          {byUser.length === 0 ? <NoData t={t} /> : (
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={byUser} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f3f4f6" />
                <XAxis type="number" allowDecimals={false} tick={AXIS_TICK} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="name" tick={AXIS_TICK} axisLine={false} tickLine={false} width={64} />
                <Tooltip cursor={{ fill: "#f9fafb" }} contentStyle={{ fontSize: 11, borderRadius: 8 }} />
                <Bar dataKey="completed" fill="#10b981" radius={[0, 4, 4, 0]} maxBarSize={12} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartPanel>

        {/* 5. Products audited — big stat */}
        <ChartPanel title={t("dashboard.chart.productsAudited")}>
          <div className="h-[160px] flex flex-col items-center justify-center gap-2">
            <div className="w-12 h-12 rounded-2xl bg-brand-50 flex items-center justify-center">
              <PackageSearch className="w-6 h-6 text-brand-500" />
            </div>
            <span className="text-[32px] font-bold text-ink-900 leading-none">
              {extras?.productsAuditedToday ?? 0}
            </span>
            <span className="text-[11px] text-ink-400">{t("dashboard.chart.productsAudited")}</span>
          </div>
        </ChartPanel>

        {/* 6. Top 5 chains */}
        <ChartPanel title={t("dashboard.chart.topChains")}>
          {chains.length === 0 ? <NoData t={t} /> : (
            <div className="h-[160px] flex flex-col justify-center gap-2.5">
              {chains.map((c) => {
                const max = chains[0].visits || 1;
                return (
                  <div key={c.name} className="flex items-center gap-2">
                    <span className="text-[11px] text-ink-600 w-20 truncate shrink-0">{c.name}</span>
                    <div className="flex-1 h-2.5 rounded-full bg-ink-50 overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{ width: `${(c.visits / max) * 100}%`, backgroundColor: c.color }}
                      />
                    </div>
                    <span className="text-[11px] font-bold text-ink-700 w-5 text-end shrink-0">{c.visits}</span>
                  </div>
                );
              })}
            </div>
          )}
        </ChartPanel>

        {/* 7. 30-day trend — full width */}
        <ChartPanel title={t("dashboard.section.trend")} span2>
          <VisitsTrendChart data={trend} locale={locale} />
        </ChartPanel>
      </div>
    </div>
  );
}

export const ChartsGrid = memo(ChartsGridInner);
export default ChartsGrid;
