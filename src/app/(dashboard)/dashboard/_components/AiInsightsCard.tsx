"use client";

import { memo } from "react";
import { Sparkles, TrendingDown, RefreshCw, UserRound, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import type { TranslationFn } from "@/hooks/use-translation";

// ─── Design placeholder — static examples, logic wired later ─────────────────

export const AiInsightsCard = memo(function AiInsightsCard({ t }: { t: TranslationFn }) {
  const insights = [
    { icon: TrendingDown, text: t("dashboard.ai.insight1") },
    { icon: UserRound,    text: t("dashboard.ai.insightUserLow") },
    { icon: RefreshCw,    text: t("dashboard.ai.insight2") },
  ];

  return (
    <div
      className={cn(
        "relative rounded-2xl overflow-hidden shadow-lg",
        "bg-gradient-to-br from-violet-600 via-violet-700 to-indigo-800"
      )}
    >
      {/* Decorative glows */}
      <div className="absolute -top-10 -end-10 w-40 h-40 rounded-full bg-fuchsia-400/20 blur-3xl pointer-events-none" />
      <div className="absolute -bottom-12 -start-8 w-36 h-36 rounded-full bg-indigo-400/20 blur-3xl pointer-events-none" />

      <div className="relative p-5">
        {/* Header */}
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-white/15 backdrop-blur flex items-center justify-center ring-1 ring-white/20">
              <Sparkles className="w-5.5 h-5.5 w-[22px] h-[22px] text-white" />
            </div>
            <div>
              <h3 className="text-[15px] font-bold text-white leading-tight">
                {t("dashboard.ai.assistant")}
              </h3>
              <p className="text-[11.5px] text-violet-200 leading-tight mt-0.5">
                {t("dashboard.ai.found")}
              </p>
            </div>
          </div>
          <span className="px-2 py-0.5 rounded-full bg-white/15 ring-1 ring-white/25 text-white text-[10px] font-bold uppercase tracking-wide backdrop-blur">
            {t("dashboard.ai.badge")}
          </span>
        </div>

        {/* Insights */}
        <div className="space-y-2 mb-4">
          {insights.map(({ icon: Icon, text }, i) => (
            <div
              key={i}
              className="flex items-start gap-2.5 rounded-xl bg-white/10 ring-1 ring-white/10 px-3 py-2.5 backdrop-blur-sm"
            >
              <Icon className="w-3.5 h-3.5 text-violet-200 shrink-0 mt-0.5" />
              <p className="text-[12.5px] text-white/90 leading-snug">{text}</p>
            </div>
          ))}
        </div>

        {/* CTA — design only, logic later */}
        <button
          type="button"
          aria-label={t("dashboard.ai.cta")}
          className={cn(
            "w-full h-11 rounded-xl bg-white text-violet-700 text-[13.5px] font-bold",
            "flex items-center justify-center gap-2 shadow-md",
            "transition-all hover:bg-violet-50 hover:shadow-lg active:scale-[0.99]",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
          )}
        >
          {t("dashboard.ai.cta")}
          <ArrowRight className="w-4 h-4 rtl:rotate-180" />
        </button>

        <p className="text-[10px] text-violet-300 text-center mt-2.5">
          {t("dashboard.ai.disclaimer")}
        </p>
      </div>
    </div>
  );
});
