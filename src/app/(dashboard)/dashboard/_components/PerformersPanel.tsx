"use client";

import { memo, useMemo } from "react";
import {
  Trophy, LifeBuoy, TrendingUp, TrendingDown, Minus, Timer,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import type { TranslationFn } from "@/hooks/use-translation";
import type { MerchStat } from "@/services/dashboard";
import { hasSyncIssue, type TeamMemberStatus } from "@/services/dashboard-extras";
import { formatRelativeTime } from "@/lib/utils/format";
import type { Locale } from "@/types";
import { SectionHeader, Skeleton } from "./shared";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function rateOf(m: MerchStat): number {
  const finished = m.completed + m.missed;
  return finished > 0 ? Math.round((m.completed / finished) * 100) : 0;
}

function initialsOf(name: string): string {
  return name.split(" ").filter(Boolean).map((w) => w[0]).slice(0, 2).join("").toUpperCase() || "?";
}

function RateTrend({ rate }: { rate: number }) {
  if (rate >= 80) return <TrendingUp   className="w-3.5 h-3.5 text-emerald-500" />;
  if (rate >= 50) return <Minus        className="w-3.5 h-3.5 text-amber-500" />;
  return               <TrendingDown className="w-3.5 h-3.5 text-rose-500" />;
}

// ─── Rows ─────────────────────────────────────────────────────────────────────

const TopRow = memo(function TopRow({
  m, rank, t,
}: { m: MerchStat; rank: number; t: TranslationFn }) {
  const rate = rateOf(m);
  return (
    <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-ink-50/70 transition-colors">
      <span className={cn(
        "w-5 text-[12px] font-bold text-center shrink-0",
        rank === 1 ? "text-amber-500" : "text-ink-300"
      )}>
        {rank}
      </span>
      <div
        className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-[11px] font-bold shrink-0"
        style={{ backgroundColor: m.color ?? "#6366F1" }}
      >
        {initialsOf(m.full_name)}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[12.5px] font-semibold text-ink-800 truncate">{m.full_name}</p>
        <p className="text-[10.5px] text-ink-400">
          {m.completed}/{m.total} {t("dashboard.perf.visits")}
          {m.avg_minutes > 0 && (
            <span className="inline-flex items-center gap-0.5 ms-1.5">
              <Timer className="w-2.5 h-2.5" />
              {m.avg_minutes} {t("dashboard.perf.avgMin")}
            </span>
          )}
        </p>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <RateTrend rate={rate} />
        <span className={cn(
          "text-[12px] font-bold",
          rate >= 80 ? "text-emerald-600" : rate >= 50 ? "text-amber-600" : "text-rose-500"
        )}>
          {rate}%
        </span>
      </div>
    </div>
  );
});

interface LowEntry {
  m:      MerchStat;
  reason: string;
  sync:   string | null;
}

const LowRow = memo(function LowRow({
  entry, locale, t,
}: { entry: LowEntry; locale: string; t: TranslationFn }) {
  const { m, reason, sync } = entry;
  return (
    <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-ink-50/70 transition-colors">
      <div
        className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-[11px] font-bold shrink-0 grayscale-[25%]"
        style={{ backgroundColor: m.color ?? "#6366F1" }}
      >
        {initialsOf(m.full_name)}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[12.5px] font-semibold text-ink-800 truncate">{m.full_name}</p>
        <p className="text-[10.5px] text-rose-500 font-medium truncate">{reason}</p>
      </div>
      <div className="text-end shrink-0">
        {m.missed > 0 && (
          <p className="text-[11px] font-bold text-rose-500">
            {m.missed} {t("dashboard.perf.missed")}
          </p>
        )}
        <p className="text-[10px] text-ink-400">
          {sync ? formatRelativeTime(sync, locale as Locale) : t("users.neverSynced")}
        </p>
      </div>
    </div>
  );
});

// ─── Panel ────────────────────────────────────────────────────────────────────

interface PerformersPanelProps {
  merchStats?: MerchStat[];
  team?:       TeamMemberStatus[];
  loading:     boolean;
  t:           TranslationFn;
  locale:      string;
}

export const PerformersPanel = memo(function PerformersPanel({
  merchStats = [],
  team = [],
  loading,
  t,
  locale,
}: PerformersPanelProps) {
  const top = useMemo(
    () =>
      [...merchStats]
        .filter((m) => m.total > 0)
        .sort((a, b) => rateOf(b) - rateOf(a) || b.completed - a.completed)
        .slice(0, 5),
    [merchStats]
  );

  const low = useMemo<LowEntry[]>(() => {
    const teamById = new Map(team.map((m) => [m.id, m]));
    return [...merchStats]
      .filter((m) => m.total > 0)
      .sort((a, b) => rateOf(a) - rateOf(b) || b.missed - a.missed)
      .slice(0, 3)
      .filter((m) => rateOf(m) < 70 || m.missed > 0)
      .map((m) => {
        const tm     = teamById.get(m.merch_id);
        const nosync = tm ? hasSyncIssue(tm.last_mobile_sync) : false;
        const reason = m.missed > 0
          ? t("dashboard.perf.reasonMissed")
          : nosync
            ? t("dashboard.perf.reasonSync")
            : t("dashboard.perf.reasonLow");
        return { m, reason, sync: tm?.last_mobile_sync ?? null };
      });
  }, [merchStats, team, t]);

  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div><Skeleton className="h-[240px]" /></div>
        <div><Skeleton className="h-[240px]" /></div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      {/* Top performers */}
      <div>
        <SectionHeader title={t("dashboard.perf.topTitle")} icon={Trophy} />
        <div className="bg-white rounded-2xl border border-ink-100 shadow-sm p-2">
          {top.length === 0 ? (
            <p className="text-[12px] text-ink-400 text-center py-8">{t("dashboard.perf.empty")}</p>
          ) : (
            top.map((m, i) => <TopRow key={m.merch_id} m={m} rank={i + 1} t={t} />)
          )}
        </div>
      </div>

      {/* Needs support */}
      <div>
        <SectionHeader title={t("dashboard.perf.lowTitle")} icon={LifeBuoy} />
        <div className="bg-white rounded-2xl border border-ink-100 shadow-sm p-2">
          {low.length === 0 ? (
            <p className="text-[12px] text-ink-400 text-center py-8">{t("dashboard.perf.empty")}</p>
          ) : (
            low.map((entry) => (
              <LowRow key={entry.m.merch_id} entry={entry} locale={locale} t={t} />
            ))
          )}
        </div>
      </div>
    </div>
  );
});
