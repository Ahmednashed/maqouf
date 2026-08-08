"use client";

import { memo } from "react";
import { CalendarClock } from "lucide-react";
import type { TranslationFn } from "@/hooks/use-translation";
import type { MerchLane } from "@/lib/calendar-model";
import { VisitBlock } from "./VisitBlock";

// ─────────────────────────────────────────────────────────────────────────────
// Mobile day agenda — the primary phone experience.
//
// A Repsly-style timeline is unusable at 375px, so the same data is presented
// as a vertical list grouped by merchandiser. Timed visits come first in time
// order, then the untimed ones under their own subheading. Identical data,
// identical blocks, no tiny unreadable grid.
// ─────────────────────────────────────────────────────────────────────────────

interface DayAgendaProps {
  lanes: MerchLane[];
  t:     TranslationFn;
}

export const DayAgenda = memo(function DayAgenda({ lanes, t }: DayAgendaProps) {
  const active = lanes.filter((l) => l.total > 0);

  if (active.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-ink-100 shadow-sm flex items-center justify-center gap-2.5 px-4 py-8">
        <CalendarClock className="w-4 h-4 text-ink-300" aria-hidden="true" />
        <p className="text-[12.5px] text-ink-400">{t("visits.calendar.emptyDay")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {active.map((lane) => {
        const initials = lane.merchName
          .split(" ").filter(Boolean).map((w) => w[0]).slice(0, 2).join("").toUpperCase() || "?";

        return (
          <section key={lane.merchId} className="bg-white rounded-2xl border border-ink-100 shadow-sm overflow-hidden">
            <header className="flex items-center gap-2.5 px-3 py-2.5 border-b border-ink-50 bg-ink-50/50">
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-[11px] font-bold shrink-0"
                style={{ backgroundColor: lane.merchColor ?? "#6366F1" }}
                aria-hidden="true"
              >
                {initials}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-semibold text-ink-800 truncate">{lane.merchName}</p>
                <p className="text-[10.5px] text-ink-400">
                  {t("visits.calendar.laneSummary", {
                    done: String(lane.completed), total: String(lane.total),
                  })}
                </p>
              </div>
            </header>

            <div className="p-2.5 space-y-2">
              {lane.timed.map((item) => (
                <VisitBlock key={item.id} item={item} t={t} />
              ))}

              {lane.untimed.length > 0 && (
                <>
                  <p className="text-[10px] font-bold text-ink-400 uppercase tracking-wide pt-1">
                    {t("visits.calendar.unscheduled")}
                  </p>
                  {lane.untimed.map((item) => (
                    <VisitBlock key={item.id} item={item} t={t} />
                  ))}
                </>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
});
