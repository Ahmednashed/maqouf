"use client";

import { memo } from "react";
import { Check, AlertCircle, Play } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import type { TranslationFn } from "@/hooks/use-translation";
import type { DayBucket } from "@/lib/calendar-model";
import { isToday, isSameMonth } from "@/lib/calendar-range";

// ─────────────────────────────────────────────────────────────────────────────
// Month view — capacity overview. Counts and status tallies only; full visit
// cards would be unreadable at 42 cells. Clicking a day switches to Day view
// for that date (the simplest option consistent with the existing routing).
// ─────────────────────────────────────────────────────────────────────────────

interface MonthGridProps {
  buckets:   DayBucket[];
  anchor:    string;
  dayLabels: string[];
  t:         TranslationFn;
  onPickDay: (date: string) => void;
}

export const MonthGrid = memo(function MonthGrid({
  buckets, anchor, dayLabels, t, onPickDay,
}: MonthGridProps) {
  return (
    <div className="bg-white rounded-2xl border border-ink-100 shadow-sm overflow-hidden">
      {/* Weekday header */}
      <div className="grid grid-cols-7 bg-ink-50/60 border-b border-ink-100">
        {dayLabels.map((label) => (
          <div key={label} className="px-2 py-2 text-center">
            <span className="text-[10.5px] font-bold text-ink-400 uppercase tracking-wide">
              {label}
            </span>
          </div>
        ))}
      </div>

      {/* Day cells */}
      <div className="grid grid-cols-7">
        {buckets.map((b) => {
          const inMonth = isSameMonth(b.date, anchor);
          const today   = isToday(b.date);

          return (
            <button
              key={b.date}
              onClick={() => onPickDay(b.date)}
              aria-label={
                b.total === 0
                  ? `${b.date} — ${t("visits.calendar.noVisits")}`
                  : `${b.date} — ${t("visits.calendar.visitCount", { n: String(b.total) })}`
              }
              className={cn(
                "min-h-[92px] p-2 border-e border-b border-ink-50 text-start transition-colors",
                "hover:bg-brand-50/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-400",
                !inMonth && "bg-ink-50/40"
              )}
            >
              <span
                className={cn(
                  "inline-flex items-center justify-center w-6 h-6 rounded-lg text-[11.5px] font-bold tabular-nums",
                  today   ? "bg-brand-500 text-white" :
                  inMonth ? "text-ink-700" : "text-ink-300"
                )}
                dir="ltr"
              >
                {Number(b.date.slice(8))}
              </span>

              {b.total > 0 && (
                <>
                  <p className={cn(
                    "text-[11px] font-semibold mt-1.5",
                    inMonth ? "text-ink-600" : "text-ink-400"
                  )}>
                    {t("visits.calendar.visitCount", { n: String(b.total) })}
                  </p>

                  {/* Status tally — icon + number, never colour alone */}
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-1">
                    {b.completed > 0 && (
                      <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-emerald-600">
                        <Check className="w-2.5 h-2.5" aria-hidden="true" />
                        {b.completed}
                      </span>
                    )}
                    {b.inprogress > 0 && (
                      <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-blue-600">
                        <Play className="w-2.5 h-2.5" aria-hidden="true" />
                        {b.inprogress}
                      </span>
                    )}
                    {b.missed > 0 && (
                      <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-rose-500">
                        <AlertCircle className="w-2.5 h-2.5" aria-hidden="true" />
                        {b.missed}
                      </span>
                    )}
                  </div>
                </>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
});
