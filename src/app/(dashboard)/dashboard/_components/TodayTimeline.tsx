"use client";

import { memo, useMemo } from "react";
import Link from "next/link";
import { CalendarClock, Sunrise, Sun, CalendarPlus } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import type { TranslationFn } from "@/hooks/use-translation";
import type { DashboardVisit } from "@/services/dashboard";
import { SectionHeader, Skeleton } from "./shared";

// ─── Status → timeline dot/badge styling ──────────────────────────────────────

function dotColor(v: DashboardVisit): string {
  switch (v.status) {
    case "completed":  return "bg-emerald-500";
    case "inprogress": return "bg-blue-500 animate-pulse";
    case "missed":     return "bg-rose-500";
    default:           return "bg-amber-400";
  }
}

function timeOf(iso: string | null, locale: string): string {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString(locale === "ar" ? "ar-SA" : "en-GB", {
    hour: "2-digit", minute: "2-digit",
  });
}

// ─── One timeline entry ───────────────────────────────────────────────────────

const TimelineItem = memo(function TimelineItem({
  visit,
  locale,
  t,
  isLast,
}: {
  visit:  DashboardVisit;
  locale: string;
  t:      TranslationFn;
  isLast: boolean;
}) {
  const branch = locale === "ar" ? visit.place.branch_ar : visit.place.branch_en;
  const chain  = visit.place.chain
    ? (locale === "ar" ? visit.place.chain.name_ar : visit.place.chain.name_en)
    : null;

  return (
    <Link href={`/visits/${visit.id}`} className="flex gap-3 group">
      {/* Dot + connector */}
      <div className="flex flex-col items-center pt-1.5">
        <span className={cn("w-2.5 h-2.5 rounded-full shrink-0", dotColor(visit))} />
        {!isLast && <span className="w-px flex-1 bg-ink-100 mt-1" />}
      </div>

      {/* Content */}
      <div className="pb-4 min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="text-[13px] font-semibold text-ink-800 truncate group-hover:text-brand-600 transition-colors">
            {branch}
          </p>
          {visit.started_at && (
            <span className="text-[10.5px] text-ink-400 shrink-0" dir="ltr">
              {timeOf(visit.started_at, locale)}
            </span>
          )}
        </div>
        <p className="text-[11.5px] text-ink-400 truncate">
          {visit.merch.user.full_name}
          {chain ? ` · ${chain}` : ""}
          {" · "}
          <span className={cn(
            visit.status === "completed"  && "text-emerald-600",
            visit.status === "inprogress" && "text-blue-600",
            visit.status === "missed"     && "text-rose-500",
            visit.status === "pending"    && "text-amber-600",
          )}>
            {t(`status.${visit.status}`)}
          </span>
        </p>
      </div>
    </Link>
  );
});

// ─── Timeline ─────────────────────────────────────────────────────────────────

interface TodayTimelineProps {
  visits?:  DashboardVisit[];
  loading:  boolean;
  t:        TranslationFn;
  locale:   string;
}

interface TimelineGroup {
  key:   string;
  label: string;
  icon:  React.ElementType;
  items: DashboardVisit[];
}

export const TodayTimeline = memo(function TodayTimeline({
  visits = [],
  loading,
  t,
  locale,
}: TodayTimelineProps) {
  const groups = useMemo<TimelineGroup[]>(() => {
    const morning:   DashboardVisit[] = [];
    const afternoon: DashboardVisit[] = [];
    const upcoming:  DashboardVisit[] = [];

    for (const v of visits) {
      if (!v.started_at) {
        upcoming.push(v);
      } else if (new Date(v.started_at).getHours() < 12) {
        morning.push(v);
      } else {
        afternoon.push(v);
      }
    }

    const byStart = (a: DashboardVisit, b: DashboardVisit) =>
      (a.started_at ?? "").localeCompare(b.started_at ?? "");
    morning.sort(byStart);
    afternoon.sort(byStart);

    return [
      { key: "morning",   label: t("dashboard.timeline.morning"),   icon: Sunrise,      items: morning },
      { key: "afternoon", label: t("dashboard.timeline.afternoon"), icon: Sun,          items: afternoon },
      { key: "upcoming",  label: t("dashboard.timeline.upcoming"),  icon: CalendarPlus, items: upcoming },
    ].filter((g) => g.items.length > 0);
  }, [visits, t]);

  return (
    <div>
      <SectionHeader title={t("dashboard.section.timeline")} icon={CalendarClock} />

      {loading ? (
        <Skeleton className="h-[220px]" />
      ) : groups.length === 0 ? (
        <div className="bg-white rounded-2xl border border-ink-100 p-8 text-center shadow-sm">
          <CalendarClock className="w-8 h-8 text-ink-300 mx-auto mb-2" />
          <p className="text-[13px] text-ink-400">{t("dashboard.timeline.empty")}</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-ink-100 shadow-sm p-4 space-y-4">
          {groups.map(({ key, label, icon: Icon, items }) => (
            <div key={key}>
              <p className="flex items-center gap-1.5 text-[11px] font-bold text-ink-400 uppercase tracking-widest mb-2.5">
                <Icon className="w-3.5 h-3.5" />
                {label}
                <span className="text-ink-300 font-semibold">({items.length})</span>
              </p>
              <div>
                {items.map((v, i) => (
                  <TimelineItem
                    key={v.id}
                    visit={v}
                    locale={locale}
                    t={t}
                    isLast={i === items.length - 1}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
});
