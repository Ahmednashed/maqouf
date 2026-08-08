"use client";

import { memo, useState } from "react";
import { cn } from "@/lib/utils/cn";
import type { TranslationFn } from "@/hooks/use-translation";
import type { MerchLane, CalendarVisitItem } from "@/lib/calendar-model";
import { isToday } from "@/lib/calendar-range";
import { VisitBlock } from "./VisitBlock";

// ─────────────────────────────────────────────────────────────────────────────
// Week view — merchandiser rows × day columns. The planning view.
//
// A crowded cell shows the first few visits and a "+N more" control that
// expands in place, so nothing is hidden behind a modal.
// The grid flows in the document's inline direction: Sun→Sat left-to-right in
// English, right-to-left in Arabic, which is the native expectation for both.
// ─────────────────────────────────────────────────────────────────────────────

const VISIBLE_PER_CELL = 2;

interface WeekGridProps {
  lanes:     MerchLane[];
  dates:     string[];
  dayLabels: string[];
  t:         TranslationFn;
}

const WeekCell = memo(function WeekCell({
  items, t,
}: {
  items: CalendarVisitItem[];
  t:     TranslationFn;
}) {
  const [expanded, setExpanded] = useState(false);
  const hidden  = items.length - VISIBLE_PER_CELL;
  const visible = expanded ? items : items.slice(0, VISIBLE_PER_CELL);

  return (
    <div className="p-1.5 space-y-1 min-h-[72px] border-e border-b border-ink-50 last:border-e-0">
      {visible.map((item) => (
        <VisitBlock key={item.id} item={item} t={t} compact />
      ))}

      {hidden > 0 && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="w-full text-[10.5px] font-semibold text-brand-500 hover:text-brand-600 hover:underline rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 py-0.5"
        >
          {expanded
            ? t("visits.calendar.showLess")
            : t("visits.calendar.moreCount", { n: String(hidden) })}
        </button>
      )}
    </div>
  );
});

export const WeekGrid = memo(function WeekGrid({
  lanes, dates, dayLabels, t,
}: WeekGridProps) {
  const cols = `196px repeat(${dates.length}, minmax(120px, 1fr))`;

  return (
    <div className="bg-white rounded-2xl border border-ink-100 shadow-sm overflow-hidden">
      <div className="overflow-x-auto">
        <div className="min-w-max">
          {/* Day header */}
          <div className="grid bg-ink-50/60 border-b border-ink-100" style={{ gridTemplateColumns: cols }}>
            <div className="px-3 py-2 border-e border-ink-100">
              <span className="text-[10.5px] font-bold text-ink-400 uppercase tracking-wide">
                {t("visits.calendar.representative")}
              </span>
            </div>
            {dates.map((d, i) => (
              <div
                key={d}
                className={cn(
                  "px-2 py-2 border-e border-ink-100 last:border-e-0",
                  isToday(d) && "bg-brand-50"
                )}
              >
                <p className="text-[11px] font-bold text-ink-600">{dayLabels[i]}</p>
                <p className={cn(
                  "text-[10.5px] tabular-nums",
                  isToday(d) ? "text-brand-600 font-bold" : "text-ink-400"
                )} dir="ltr">
                  {d.slice(8)}
                </p>
              </div>
            ))}
          </div>

          {/* Rows */}
          {lanes.map((lane) => {
            const byDate = new Map<string, CalendarVisitItem[]>();
            for (const item of [...lane.timed, ...lane.untimed]) {
              const list = byDate.get(item.scheduledDate) ?? [];
              list.push(item);
              byDate.set(item.scheduledDate, list);
            }

            const initials = lane.merchName
              .split(" ").filter(Boolean).map((w) => w[0]).slice(0, 2).join("").toUpperCase() || "?";

            return (
              <div key={lane.merchId} className="grid" style={{ gridTemplateColumns: cols }}>
                <div className="px-3 py-2 border-e border-b border-ink-100 flex items-center gap-2.5 bg-white">
                  <div
                    className="w-7 h-7 rounded-lg flex items-center justify-center text-white text-[10.5px] font-bold shrink-0"
                    style={{ backgroundColor: lane.merchColor ?? "#6366F1" }}
                    aria-hidden="true"
                  >
                    {initials}
                  </div>
                  <div className="min-w-0">
                    <p className="text-[12px] font-semibold text-ink-800 truncate">{lane.merchName}</p>
                    <p className="text-[10px] text-ink-400">
                      {t("visits.calendar.laneSummary", {
                        done: String(lane.completed), total: String(lane.total),
                      })}
                    </p>
                  </div>
                </div>

                {dates.map((d) => (
                  <WeekCell key={d} items={byDate.get(d) ?? []} t={t} />
                ))}
              </div>
            );
          })}

          {lanes.length === 0 && (
            <p className="text-center text-[12.5px] text-ink-400 py-10">
              {t("visits.calendar.emptyWeek")}
            </p>
          )}
        </div>
      </div>
    </div>
  );
});
