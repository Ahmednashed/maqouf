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
}

export const PriorityPanel = memo(function PriorityPanel({
  priorities,
  loading,
  t,
}: PriorityPanelProps) {
  return (
    <div>
      <SectionHeader title={t("dashboard.prio.title")} icon={ListTodo} />

      {loading ? (
        <Skeleton className="h-[120px]" />
      ) : (
        <div className="bg-white rounded-2xl border border-ink-100 shadow-sm p-3 space-y-2">
          {priorities.map((p) => {
            const sev  = SEVERITY[p.severity];
            const Icon = ICONS[p.key] ?? AlertCircle;
            return (
              <div
                key={p.key}
                className={cn(
                  "flex items-center gap-3 rounded-xl border px-3.5 py-2.5 transition-all hover:shadow-sm",
                  sev.row
                )}
              >
                <span className={cn("w-2 h-2 rounded-full shrink-0", sev.dot)} />
                <Icon className={cn("w-4 h-4 shrink-0", sev.icon)} />
                <p className="flex-1 min-w-0 text-[13px] font-semibold text-ink-800 truncate">
                  {t(p.msgKey as TranslationKey, p.msgVars)}
                </p>
                <Link
                  href={p.href}
                  className={cn(
                    "inline-flex items-center gap-1 h-7 px-3 rounded-lg text-[11.5px] font-bold shrink-0",
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
      )}
    </div>
  );
});
