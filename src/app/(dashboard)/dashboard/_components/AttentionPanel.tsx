"use client";

import { memo } from "react";
import Link from "next/link";
import {
  ShieldAlert, MapPinOff, PackageX, FileWarning, Clock, UserX,
  ArrowRight, CheckCircle2, Sparkles, type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import type { TranslationFn } from "@/hooks/use-translation";
import type { TranslationKey } from "@/lib/i18n/translations";
import type { AttentionItem } from "@/lib/attention";
import { pluralKey } from "@/lib/i18n/plural";
import { DashboardSection, Card, Skeleton } from "./shared";

/**
 * Setup problems that quietly cost visits.
 *
 * Replaces a card that rendered invented statistics under a real issue count.
 * Every row here is a count of rows that exist, and every row links to the
 * screen where it can actually be fixed — an alert you cannot act on is just
 * decoration.
 */

const ICONS: Record<string, LucideIcon> = {
  neverVisited:   MapPinOff,
  noAssortment:   PackageX,
  emptyTemplate:  FileWarning,
  stale:          Clock,
  unassigned:     UserX,
  orphanProducts: PackageX,
};

interface Props {
  items:   AttentionItem[];
  loading: boolean;
  t:       TranslationFn;
  /** Needed to choose the plural form of each counted label. */
  locale:  string;
}

export const AttentionPanel = memo(function AttentionPanel({ items, loading, t, locale }: Props) {
  return (
    <DashboardSection title={t("dashboard.attn.title")} icon={ShieldAlert} fill>
      <Card className="h-full">
        {loading ? (
          <div className="p-4 space-y-2.5">
            {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-11 rounded-xl" />)}
          </div>
        ) : items.length === 0 ? (
          /* Not "no data" — a genuinely clean setup, which is worth saying. */
          <div className="p-6 flex flex-col items-center text-center gap-2">
            <CheckCircle2 className="w-8 h-8 text-emerald-500" />
            <p className="text-[13.5px] font-semibold text-ink-700">
              {t("dashboard.attn.allClear")}
            </p>
            <p className="text-[12px] text-ink-400 max-w-[280px]">
              {t("dashboard.attn.allClearHint")}
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-ink-50">
            {items.map((item) => {
              const Icon = ICONS[item.key] ?? ShieldAlert;
              const isRed = item.severity === "red";
              return (
                <li key={item.key}>
                  <Link
                    href={item.href}
                    className="flex items-center gap-3 px-4 py-3 hover:bg-ink-50/60 transition-colors group"
                  >
                    <span
                      className={cn(
                        "w-8 h-8 rounded-lg flex items-center justify-center shrink-0",
                        isRed ? "bg-rose-50 text-rose-600" : "bg-amber-50 text-amber-600"
                      )}
                    >
                      <Icon className="w-4 h-4" />
                    </span>

                    <span className="flex-1 min-w-0 text-[13px] text-ink-700">
                      {t(pluralKey(item.msgKey, item.count, locale) as TranslationKey)
                        .replace("{count}", String(item.count))}
                    </span>

                    <span className="hidden sm:inline text-[11.5px] font-semibold text-ink-400 group-hover:text-brand-600 transition-colors shrink-0">
                      {t(item.actionKey as TranslationKey)}
                    </span>
                    <ArrowRight className="w-3.5 h-3.5 text-ink-300 group-hover:text-brand-500 transition-colors shrink-0 rtl:rotate-180" />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
        <Link
          href="/ai"
          className="flex items-center gap-2 px-4 py-2.5 border-t border-ink-50 text-[12px] text-ink-500 hover:bg-ink-50/60 hover:text-brand-600 transition-colors group"
        >
          <Sparkles className="w-3.5 h-3.5 text-violet-400 shrink-0" />
          <span className="flex-1 min-w-0">{t("dashboard.attn.askAssistant")}</span>
          <ArrowRight className="w-3.5 h-3.5 text-ink-300 group-hover:text-brand-500 transition-colors shrink-0 rtl:rotate-180" />
        </Link>
      </Card>
    </DashboardSection>
  );
});
