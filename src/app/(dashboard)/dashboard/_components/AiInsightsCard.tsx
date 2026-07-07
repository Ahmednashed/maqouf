"use client";

import { memo } from "react";
import { Sparkles, TrendingDown, RefreshCw, Clock } from "lucide-react";
import type { TranslationFn } from "@/hooks/use-translation";
import { SectionHeader } from "./shared";

// ─── Design placeholder — static examples, logic wired later ─────────────────

export const AiInsightsCard = memo(function AiInsightsCard({ t }: { t: TranslationFn }) {
  const insights = [
    { icon: TrendingDown, color: "text-rose-500 bg-rose-50",   text: t("dashboard.ai.insight1") },
    { icon: RefreshCw,    color: "text-amber-500 bg-amber-50", text: t("dashboard.ai.insight2") },
    { icon: Clock,        color: "text-blue-500 bg-blue-50",   text: t("dashboard.ai.insight3") },
  ];

  return (
    <div>
      <SectionHeader
        title={t("dashboard.section.aiInsights")}
        icon={Sparkles}
        action={
          <span className="px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 text-[10px] font-bold uppercase tracking-wide">
            {t("dashboard.ai.badge")}
          </span>
        }
      />

      <div className="relative rounded-2xl border border-violet-100 shadow-sm overflow-hidden bg-gradient-to-br from-violet-50/80 via-white to-white">
        {/* Decorative glow */}
        <div className="absolute -top-8 -end-8 w-28 h-28 rounded-full bg-violet-200/30 blur-2xl pointer-events-none" />

        <div className="relative p-4 space-y-3">
          {insights.map(({ icon: Icon, color, text }, i) => (
            <div key={i} className="flex items-start gap-3">
              <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${color}`}>
                <Icon className="w-3.5 h-3.5" />
              </div>
              <p className="text-[12.5px] text-ink-700 leading-snug pt-1">{text}</p>
            </div>
          ))}

          <p className="text-[10.5px] text-ink-400 pt-1 border-t border-violet-100/60">
            {t("dashboard.ai.disclaimer")}
          </p>
        </div>
      </div>
    </div>
  );
});
