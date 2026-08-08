"use client";

import { memo, useMemo } from "react";
import Link from "next/link";
import {
  Lightbulb, CalendarClock, BellRing, MapPinned, PackageSearch, FileDown,
  ArrowRight, CheckCircle2, type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import type { TranslationFn } from "@/hooks/use-translation";
import type { CommandCenterInsights } from "@/lib/insights";
import { DashboardSection, Card, EmptyState, Skeleton } from "./shared";

// ─── Component ────────────────────────────────────────────────────────────────

interface Recommendation {
  key:   string;
  label: string;
  icon:  LucideIcon;
  href:  string;
  color: string;
}

interface RecommendedActionsProps {
  insights: CommandCenterInsights;
  oosCount: number;
  loading:  boolean;
  t:        TranslationFn;
}

export const RecommendedActions = memo(function RecommendedActions({
  insights,
  oosCount,
  loading,
  t,
}: RecommendedActionsProps) {
  const recs = useMemo<Recommendation[]>(() => {
    const list: Recommendation[] = [];

    const hasOverdue = insights.priorities.some((p) => p.key === "overdue");
    const hasSync    = insights.priorities.some((p) => p.key === "sync");

    if (hasOverdue) {
      list.push({
        key: "reschedule", label: t("dashboard.rec.reschedule"),
        icon: CalendarClock, href: "/visits?tab=recurring", color: "bg-amber-50 text-amber-600",
      });
    }
    if (hasSync) {
      list.push({
        key: "remind", label: t("dashboard.rec.remindSync"),
        icon: BellRing, href: "/users", color: "bg-blue-50 text-blue-600",
      });
    }
    if (oosCount > 0) {
      list.push({
        key: "stock", label: t("dashboard.rec.reviewStock"),
        icon: PackageSearch, href: "/reports", color: "bg-rose-50 text-rose-500",
      });
    }

    // Always-available actions
    list.push({
      key: "assign", label: t("dashboard.rec.assignVisit"),
      icon: MapPinned, href: "/visits", color: "bg-emerald-50 text-emerald-600",
    });
    list.push({
      key: "export", label: t("dashboard.rec.exportToday"),
      icon: FileDown, href: "/reports", color: "bg-violet-50 text-violet-600",
    });

    return list.slice(0, 5);
  }, [insights.priorities, oosCount, t]);

  return (
    <DashboardSection title={t("dashboard.rec.title")} icon={Lightbulb} fill>
      {loading ? (
        <Skeleton className="h-[240px]" />
      ) : recs.length === 0 ? (
        <Card fill>
          <EmptyState icon={CheckCircle2} message={t("dashboard.rec.empty")} />
        </Card>
      ) : (
        <div className="bg-white rounded-2xl border border-ink-100 shadow-sm p-2 space-y-1 h-full">
          {recs.map(({ key, label, icon: Icon, href, color }) => (
            <Link
              key={key}
              href={href}
              className={cn(
                "flex items-center gap-3 rounded-xl px-3 py-2.5 group",
                "transition-colors hover:bg-ink-50",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-400"
              )}
            >
              <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center shrink-0", color)}>
                <Icon className="w-4 h-4" />
              </div>
              <span className="flex-1 min-w-0 text-[12.5px] font-semibold text-ink-700 truncate">
                {label}
              </span>
              <span className={cn(
                "inline-flex items-center gap-1 h-7 px-2.5 rounded-lg text-[11px] font-bold shrink-0",
                "bg-ink-50 text-ink-500 border border-ink-100",
                "transition-all group-hover:bg-brand-500 group-hover:text-white group-hover:border-brand-500"
              )}>
                {t("dashboard.rec.go")}
                <ArrowRight className="w-3 h-3 rtl:rotate-180" />
              </span>
            </Link>
          ))}
        </div>
      )}
    </DashboardSection>
  );
});
