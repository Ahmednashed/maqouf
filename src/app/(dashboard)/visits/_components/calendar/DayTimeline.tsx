"use client";

import { memo } from "react";
import { CalendarClock } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import type { TranslationFn } from "@/hooks/use-translation";
import {
  computeDayAxis,
  packIntoRows,
  type MerchLane,
  type CalendarVisitItem,
} from "@/lib/calendar-model";
import { VisitBlock } from "./VisitBlock";

// ─────────────────────────────────────────────────────────────────────────────
// Day view — merchandiser rows × time columns. The primary supervisor view.
//
// ── RTL ────────────────────────────────────────────────────────────────────
// Blocks are positioned with `insetInlineStart`, and hour headers use a CSS
// grid. Both follow the document's inline direction, so in Arabic the axis
// runs right→left (native RTL calendar behaviour) while remaining
// chronologically ordered — earliest at the reading start, latest at the
// reading end. No `left`/`right` anywhere.
//
// ── Time honesty ───────────────────────────────────────────────────────────
// Only visits with a resolved time are placed on the axis. Everything else
// goes to the "Unscheduled" column, never to a guessed hour.
// ─────────────────────────────────────────────────────────────────────────────

/** Pixels per hour. Fixed so the grid scrolls rather than crushing blocks. */
const HOUR_PX = 104;
/** Visual room one block claims, in axis minutes (no durations exist). */
const SLOT_MINUTES = 50;
const BLOCK_WIDTH_PX = Math.round((SLOT_MINUTES / 60) * HOUR_PX);

const LANE_ROW_PX = 34;

interface DayTimelineProps {
  lanes: MerchLane[];
  t:     TranslationFn;
}

function laneHeight(rows: number, untimed: number): number {
  const timedRows = Math.max(1, rows);
  return Math.max(56, timedRows * LANE_ROW_PX + 16, untimed > 0 ? 56 : 0);
}

const LaneRow = memo(function LaneRow({
  lane, axis, t,
}: {
  lane: MerchLane;
  axis: ReturnType<typeof computeDayAxis>;
  t:    TranslationFn;
}) {
  const rows   = packIntoRows(lane.timed, SLOT_MINUTES);
  const height = laneHeight(rows.length, lane.untimed.length);
  const initials = lane.merchName
    .split(" ").filter(Boolean).map((w) => w[0]).slice(0, 2).join("").toUpperCase() || "?";

  return (
    <div className="flex border-b border-ink-50 last:border-b-0">
      {/* Sticky summary column */}
      <div
        className="sticky start-0 z-20 bg-white border-e border-ink-100 shrink-0 w-[196px] px-3 py-2.5 flex items-center gap-2.5"
        style={{ minHeight: height }}
      >
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-[11px] font-bold shrink-0"
          style={{ backgroundColor: lane.merchColor ?? "#6366F1" }}
          aria-hidden="true"
        >
          {initials}
        </div>
        <div className="min-w-0">
          <p className="text-[12.5px] font-semibold text-ink-800 truncate">{lane.merchName}</p>
          <p className="text-[10.5px] text-ink-400">
            {lane.total === 0
              ? t("visits.calendar.noVisits")
              : t("visits.calendar.laneSummary", {
                  done:  String(lane.completed),
                  total: String(lane.total),
                })}
          </p>
        </div>
      </div>

      {/* Timed area */}
      <div className="relative flex-1" style={{ minHeight: height, minWidth: axis.hours.length * HOUR_PX }}>
        {/* Hour gridlines */}
        <div
          className="absolute inset-0 grid pointer-events-none"
          style={{ gridTemplateColumns: `repeat(${axis.hours.length}, ${HOUR_PX}px)` }}
          aria-hidden="true"
        >
          {axis.hours.map((h) => (
            <div key={h} className="border-e border-ink-50 last:border-e-0" />
          ))}
        </div>

        {rows.map((row, rowIdx) =>
          row.map((item: CalendarVisitItem) => (
            <VisitBlock
              key={item.id}
              item={item}
              t={t}
              className="absolute"
              style={{
                // Logical inset → correct in both LTR and RTL automatically.
                insetInlineStart:
                  `${((item.minutes! - axis.startHour * 60) / 60) * HOUR_PX}px`,
                top:   rowIdx * LANE_ROW_PX + 8,
                width: BLOCK_WIDTH_PX,
              }}
            />
          ))
        )}
      </div>

      {/* Unscheduled column — visits that genuinely have no time */}
      <div
        className="shrink-0 w-[168px] border-s border-ink-100 bg-ink-50/40 px-2 py-2 space-y-1.5"
        style={{ minHeight: height }}
      >
        {lane.untimed.map((item) => (
          <VisitBlock key={item.id} item={item} t={t} compact />
        ))}
      </div>
    </div>
  );
});

export const DayTimeline = memo(function DayTimeline({ lanes, t }: DayTimelineProps) {
  const all  = lanes.flatMap((l) => [...l.timed, ...l.untimed]);
  const axis = computeDayAxis(all);

  return (
    <div className="bg-white rounded-2xl border border-ink-100 shadow-sm overflow-hidden">
      <div className="overflow-x-auto">
        <div className="min-w-max">
          {/* Header: hour labels + column titles */}
          <div className="flex border-b border-ink-100 bg-ink-50/60 sticky top-0 z-30">
            <div className="sticky start-0 z-10 bg-ink-50 border-e border-ink-100 shrink-0 w-[196px] px-3 py-2">
              <span className="text-[10.5px] font-bold text-ink-400 uppercase tracking-wide">
                {t("visits.calendar.representative")}
              </span>
            </div>

            <div
              className="flex-1 grid"
              style={{ gridTemplateColumns: `repeat(${axis.hours.length}, ${HOUR_PX}px)` }}
            >
              {axis.hours.map((h) => (
                <div key={h} className="px-2 py-2 border-e border-ink-100 last:border-e-0">
                  <span className="text-[10.5px] font-semibold text-ink-400 tabular-nums" dir="ltr">
                    {String(h).padStart(2, "0")}:00
                  </span>
                </div>
              ))}
            </div>

            <div className="shrink-0 w-[168px] border-s border-ink-100 px-2 py-2">
              <span className="text-[10.5px] font-bold text-ink-400 uppercase tracking-wide">
                {t("visits.calendar.unscheduled")}
              </span>
            </div>
          </div>

          {/* Lanes */}
          {lanes.length === 0 ? (
            <div className="flex items-center justify-center gap-2.5 px-4 py-10">
              <CalendarClock className="w-4 h-4 text-ink-300" aria-hidden="true" />
              <p className="text-[12.5px] text-ink-400">{t("visits.calendar.emptyDay")}</p>
            </div>
          ) : (
            lanes.map((lane) => (
              <LaneRow key={lane.merchId} lane={lane} axis={axis} t={t} />
            ))
          )}
        </div>
      </div>
    </div>
  );
});
