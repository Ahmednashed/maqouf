"use client";

import { memo, useRef, useState, useEffect } from "react";
import {
  ChevronLeft, ChevronRight, Plus, MoreHorizontal, Repeat, CalendarDays,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import type { TranslationFn } from "@/hooks/use-translation";
import type { CalendarView } from "@/lib/calendar-range";

// ─────────────────────────────────────────────────────────────────────────────
// Period navigation + view switch + the single primary action.
//
// RTL: the chevrons are `rtl:rotate-180`, so "previous" always points toward
// the past in reading order. Everything else uses logical spacing utilities,
// so no left/right is hardcoded.
// ─────────────────────────────────────────────────────────────────────────────

const VIEWS: CalendarView[] = ["day", "week", "month"];

interface CalendarToolbarProps {
  view:        CalendarView;
  periodLabel: string;
  isToday:     boolean;
  t:           TranslationFn;
  onViewChange: (v: CalendarView) => void;
  onPrev:      () => void;
  onNext:      () => void;
  onToday:     () => void;
  onAddVisit:  () => void;
  onManageRecurring: () => void;
}

export const CalendarToolbar = memo(function CalendarToolbar({
  view, periodLabel, isToday, t,
  onViewChange, onPrev, onNext, onToday, onAddVisit, onManageRecurring,
}: CalendarToolbarProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    if (menuOpen) document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [menuOpen]);

  const navBtn =
    "w-9 h-9 rounded-xl border border-ink-200 bg-white flex items-center justify-center " +
    "text-ink-500 hover:text-brand-600 hover:border-brand-300 transition-all " +
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400";

  return (
    <div className="flex flex-wrap items-center gap-2 mb-4">
      {/* Period navigation */}
      <div className="flex items-center gap-1.5">
        <button onClick={onPrev} aria-label={t("visits.calendar.prev")} className={navBtn}>
          <ChevronLeft className="w-4 h-4 rtl:rotate-180" />
        </button>
        <button onClick={onNext} aria-label={t("visits.calendar.next")} className={navBtn}>
          <ChevronRight className="w-4 h-4 rtl:rotate-180" />
        </button>
        <button
          onClick={onToday}
          disabled={isToday}
          className={cn(
            "h-9 px-3.5 rounded-xl border text-[12.5px] font-semibold transition-all",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400",
            isToday
              ? "border-ink-100 bg-ink-50 text-ink-300 cursor-default"
              : "border-ink-200 bg-white text-ink-600 hover:text-brand-600 hover:border-brand-300"
          )}
        >
          {t("visits.calendar.today")}
        </button>
      </div>

      {/* Current period */}
      <p className="text-[14px] font-bold text-ink-800 px-1 min-w-0 truncate" aria-live="polite">
        {periodLabel}
      </p>

      {/* View switcher */}
      <div
        role="tablist"
        aria-label={t("visits.calendar.viewSwitch")}
        className="flex items-center bg-ink-100 rounded-xl p-1 gap-0.5 ms-auto"
      >
        {VIEWS.map((v) => (
          <button
            key={v}
            role="tab"
            aria-selected={view === v}
            onClick={() => onViewChange(v)}
            className={cn(
              "h-8 px-3.5 rounded-lg text-[12px] font-semibold transition-all",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400",
              view === v ? "bg-white text-ink-900 shadow-sm" : "text-ink-500 hover:text-ink-700"
            )}
          >
            {t(`visits.calendar.${v}` as Parameters<typeof t>[0])}
          </button>
        ))}
      </div>

      {/* Primary action */}
      <button
        onClick={onAddVisit}
        className="inline-flex items-center gap-2 h-10 px-4 rounded-xl bg-brand-500 hover:bg-brand-600 text-white text-[13px] font-semibold shadow-pop transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2"
      >
        <Plus className="w-4 h-4" />
        {t("visits.add")}
      </button>

      {/* Secondary actions — recurring management lives here, demoted. */}
      <div ref={menuRef} className="relative">
        <button
          onClick={() => setMenuOpen((v) => !v)}
          aria-label={t("visits.calendar.more")}
          aria-expanded={menuOpen}
          className={navBtn}
        >
          <MoreHorizontal className="w-4 h-4" />
        </button>

        {menuOpen && (
          <div
            role="menu"
            className="absolute end-0 top-[calc(100%+6px)] w-60 bg-white rounded-2xl border border-ink-100 shadow-modal z-40 overflow-hidden animate-slide-up py-1.5"
          >
            <button
              role="menuitem"
              onClick={() => { setMenuOpen(false); onManageRecurring(); }}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-[13px] text-ink-700 hover:bg-ink-50 transition-colors text-start"
            >
              <Repeat className="w-4 h-4 text-ink-400 shrink-0" />
              {t("visits.tabRecurring")}
            </button>
            <div className="mx-3 my-1 border-t border-ink-100" />
            <p className="px-4 py-1.5 text-[11px] text-ink-400 flex items-start gap-2">
              <CalendarDays className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              {t("visits.calendar.recurringHint")}
            </p>
          </div>
        )}
      </div>
    </div>
  );
});
