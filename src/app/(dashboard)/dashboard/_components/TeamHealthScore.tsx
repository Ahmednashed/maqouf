"use client";

import { memo } from "react";
import { HeartPulse } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import type { TranslationFn } from "@/hooks/use-translation";
import type { TranslationKey } from "@/lib/i18n/translations";
import { healthLabelKey, healthColor } from "@/lib/insights";
import { SectionHeader, Skeleton, AnimatedNumber } from "./shared";

// ─── SVG ring (no recharts — keeps the main bundle lean) ─────────────────────

function ScoreRing({ score, color }: { score: number; color: string }) {
  const R    = 52;
  const C    = 2 * Math.PI * R;
  const fill = (score / 100) * C;

  return (
    <div className="relative w-[132px] h-[132px]" role="img" aria-label={`${score} / 100`}>
      <svg viewBox="0 0 120 120" className="w-full h-full -rotate-90">
        <circle cx="60" cy="60" r={R} fill="none" stroke="#f3f4f6" strokeWidth="10" />
        <circle
          cx="60" cy="60" r={R} fill="none"
          stroke={color} strokeWidth="10" strokeLinecap="round"
          strokeDasharray={`${fill} ${C - fill}`}
          className="transition-all duration-700 ease-out"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[30px] font-bold text-ink-900 leading-none">
          <AnimatedNumber value={score} />
        </span>
        <span className="text-[10.5px] text-ink-400 font-semibold mt-0.5">/ 100</span>
      </div>
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

interface TeamHealthScoreProps {
  score:   number;
  parts:   { completion: number; sync: number; gps: number; attendance: number };
  loading: boolean;
  t:       TranslationFn;
}

export const TeamHealthScore = memo(function TeamHealthScore({
  score,
  parts,
  loading,
  t,
}: TeamHealthScoreProps) {
  const color = healthColor(score);
  const label = t(healthLabelKey(score) as TranslationKey);

  const breakdown = [
    { key: "completion", label: t("dashboard.health.completion"), value: parts.completion },
    { key: "sync",       label: t("dashboard.health.sync"),       value: parts.sync },
    { key: "gps",        label: t("dashboard.health.gps"),        value: parts.gps },
    { key: "attendance", label: t("dashboard.health.attendance"), value: parts.attendance },
  ];

  return (
    <div>
      <SectionHeader title={t("dashboard.health.title")} icon={HeartPulse} />

      {loading ? (
        <Skeleton className="h-[220px]" />
      ) : (
        <div className="bg-white rounded-2xl border border-ink-100 shadow-sm p-4 flex flex-col items-center">
          <ScoreRing score={score} color={color} />

          <span
            className="mt-2 px-3 py-1 rounded-full text-[11.5px] font-bold"
            style={{ backgroundColor: `${color}18`, color }}
          >
            {label}
          </span>

          {/* Breakdown */}
          <div className="w-full grid grid-cols-2 gap-x-4 gap-y-2 mt-4 pt-3 border-t border-ink-50">
            {breakdown.map((b) => (
              <div key={b.key} className="flex items-center justify-between gap-2">
                <span className="text-[11px] text-ink-500 font-medium truncate">{b.label}</span>
                <span className={cn(
                  "text-[11.5px] font-bold",
                  b.value >= 70 ? "text-ink-800" : "text-rose-500"
                )}>
                  {b.value}%
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
});
