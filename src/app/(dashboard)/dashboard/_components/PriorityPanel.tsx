"use client";

import { memo } from "react";
import Link from "next/link";
import {
  ListTodo, AlertCircle, RefreshCw, TrendingDown, PackageX, CheckCircle2,
  ArrowRight, type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import type { TranslationFn } from "@/hooks/use-translation";
import type { TranslationKey } from "@/lib/i18n/translations";
import type { PriorityItem, Severity } from "@/lib/insights";
import { pluralKey } from "@/lib/i18n/plural";
import { SectionHeader, Skeleton } from "./shared";

// ─── Severity presentation ────────────────────────────────────────────────────

const SEVERITY: Record<Severity, { dot: string; row: string; icon: string }> = {
  red:   { dot: "bg-rose-500",    row: "border-rose-100 bg-rose-50/50",     icon: "text-rose-500" },
  amber: { dot: "bg-amber-400",   row: "border-amber-100 bg-amber-50/50",   icon: "text-amber-500" },
  green: { dot: "bg-emerald-500", row: "border-emerald-100 bg-emerald-50/50", icon: "text-emerald-500" },
};

const ICONS: Record<string, LucideIcon> = {
  overdue: AlertCircle,
  sync:    RefreshCw,
  rate:    TrendingDown,
  oos:     PackageX,
  allgood: CheckCircle2,
};

// ─── Component ────────────────────────────────────────────────────────────────

interface PriorityPanelProps {
  priorities: PriorityItem[];
  loading:    boolean;
  t:          TranslationFn;
  /** Needed to choose the plural form of counted labels. */
  locale:     string;
}

export const PriorityPanel = memo(function PriorityPanel({
  priorities,
  loading,
  t,
  locale,
}: PriorityPanelProps) {
  if (loading) {
    return (
      <div>
        <SectionHeader title={t("dashboard.prio.title")} icon={ListTodo} />
        <Skeleton className="h-[76px]" />
      </div>
    );
  }

  // Only items that genuinely need attention drive the full panel.
  const actionable = priorities.filter((p) => p.severity !== "green");

  // ── Nothing to act on → collapse to a single slim banner (no section
  //    header, no large empty container). ──────────────────────────────────
  if (actionable.length === 0) {
    return (
      <div className="flex items-center gap-2.5 rounded-xl border border-emerald-100 bg-emerald-50/60 px-3.5 py-2.5">
        <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
        <p className="text-[12.5px] font-semibold text-emerald-800">
          {t("dashboard.prio.allGood")}
        </p>
      </div>
    );
  }

  // ── Compact attention list ────────────────────────────────────────────────
  return (
    <div>
      <SectionHeader
        title={t("dashboard.prio.title")}
        icon={ListTodo}
        action={
          <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-rose-50 border border-rose-100 text-[10.5px] font-bold text-rose-600">
            {actionable.length}
          </span>
        }
      />

      <div className="bg-white rounded-2xl border border-ink-100 shadow-sm p-2 space-y-1.5">
        {actionable.map((p) => {
          const sev  = SEVERITY[p.severity];
          const Icon = ICONS[p.key] ?? AlertCircle;
          return (
            <div
              key={p.key}
              className={cn(
                "flex items-center gap-2.5 rounded-xl border px-3 py-2 transition-all hover:shadow-sm",
                sev.row
              )}
            >
              <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", sev.dot)} />
              <Icon className={cn("w-3.5 h-3.5 shrink-0", sev.icon)} />
              <p className="flex-1 min-w-0 text-[12.5px] font-semibold text-ink-800 truncate">
                {t(
                  (p.pluralCount === undefined
                    ? p.msgKey
                    : pluralKey(p.msgKey, p.pluralCount, locale)) as TranslationKey,
                  p.msgVars,
                )}
              </p>
              <Link
                href={p.href}
                className={cn(
                  "inline-flex items-center gap-1 h-7 px-2.5 rounded-lg text-[11px] font-bold shrink-0",
                  "bg-white border border-ink-200 text-ink-600",
                  "transition-all hover:border-brand-300 hover:text-brand-600",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
                )}
              >
                {t(p.actionKey as TranslationKey)}
                <ArrowRight className="w-3 h-3 rtl:rotate-180" />
              </Link>
            </div>
          );
        })}
      </div>
    </div>
  );
});
