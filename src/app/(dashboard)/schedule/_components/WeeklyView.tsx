"use client";

import { Pencil, Trash2, Clock, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useTranslation, type TranslationFn } from "@/hooks/use-translation";
import type { ScheduleWithDetails } from "@/services/schedules";
import type { DayOfWeek, ScheduleFrequency } from "@/types";

// ─── Constants ────────────────────────────────────────────────────────────────

const DAYS: DayOfWeek[] = [0, 1, 2, 3, 4, 5, 6];

const FREQ_COLORS: Record<ScheduleFrequency, string> = {
  weekly:   "bg-brand-50   text-brand-700",
  biweekly: "bg-purple-50  text-purple-700",
  monthly:  "bg-amber-50   text-amber-700",
};

// ─── Props ────────────────────────────────────────────────────────────────────

interface WeeklyViewProps {
  schedules: ScheduleWithDetails[];
  onEdit:    (s: ScheduleWithDetails) => void;
  onDelete:  (s: ScheduleWithDetails) => void;
}

// ─── Schedule card ────────────────────────────────────────────────────────────

interface ScheduleCardProps {
  schedule: ScheduleWithDetails;
  locale:   string;
  t:        TranslationFn;
  onEdit:   () => void;
  onDelete: () => void;
}

function ScheduleCard({ schedule, locale, t, onEdit, onDelete }: ScheduleCardProps) {
  const merchName  = schedule.merch?.user?.full_name ?? "—";
  const branchName = locale === "ar"
    ? schedule.place?.branch_ar
    : schedule.place?.branch_en;
  const chainColor = (schedule.place as { chain?: { color?: string } })?.chain?.color ?? "#111827";
  const freqKey    = `schedule.freq${schedule.frequency.charAt(0).toUpperCase()}${schedule.frequency.slice(1)}` as Parameters<typeof t>[0];
  const initials   = merchName
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();

  return (
    <div
      className={cn(
        "group relative rounded-xl border p-2.5 transition-all hover:shadow-md",
        schedule.is_active
          ? "bg-white border-ink-100"
          : "bg-ink-50 border-ink-100 opacity-60"
      )}
    >
      {/* Chain colour accent bar */}
      <div
        className="absolute start-0 top-2 bottom-2 w-0.5 rounded-full"
        style={{ backgroundColor: chainColor }}
      />

      <div className="ps-2">
        {/* Merchandiser row */}
        <div className="flex items-center gap-1.5 mb-1.5">
          <div
            className="w-5 h-5 rounded-full flex items-center justify-center text-white text-[9px] font-bold shrink-0"
            style={{ backgroundColor: chainColor }}
          >
            {initials}
          </div>
          <span className="text-[12px] font-semibold text-ink-800 leading-tight truncate">
            {merchName}
          </span>
        </div>

        {/* Branch */}
        <p className="text-[11px] text-ink-500 leading-tight truncate mb-1.5">
          {branchName}
        </p>

        {/* Time + frequency */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="inline-flex items-center gap-1 text-[10.5px] text-ink-500">
            <Clock className="w-2.5 h-2.5" />
            {schedule.start_time}
            {schedule.end_time && `–${schedule.end_time}`}
          </span>
          <span
            className={cn(
              "inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9.5px] font-semibold",
              FREQ_COLORS[schedule.frequency]
            )}
          >
            <RefreshCw className="w-2 h-2" />
            {t(freqKey)}
          </span>
        </div>
      </div>

      {/* Hover actions */}
      <div className="absolute top-1.5 end-1.5 flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={onEdit}
          className="w-6 h-6 rounded-md flex items-center justify-center text-ink-400 hover:text-brand-500 hover:bg-brand-50 transition-all"
        >
          <Pencil className="w-2.5 h-2.5" />
        </button>
        <button
          onClick={onDelete}
          className="w-6 h-6 rounded-md flex items-center justify-center text-ink-400 hover:text-rose-500 hover:bg-rose-50 transition-all"
        >
          <Trash2 className="w-2.5 h-2.5" />
        </button>
      </div>
    </div>
  );
}

// ─── Weekly view grid ─────────────────────────────────────────────────────────

export function WeeklyView({ schedules, onEdit, onDelete }: WeeklyViewProps) {
  const { t, locale } = useTranslation();

  // Group schedules by day_of_week
  const byDay: Partial<Record<DayOfWeek, ScheduleWithDetails[]>> = {};
  for (const s of schedules) {
    (byDay[s.day_of_week] ??= []).push(s);
  }

  return (
    <div className="overflow-x-auto pb-2">
      <div className="grid grid-cols-7 gap-2 min-w-[700px]">
        {DAYS.map((day) => {
          const daySchedules = byDay[day] ?? [];
          const isWeekend    = day === 5 || day === 6; // Fri / Sat

          return (
            <div key={day} className="flex flex-col min-w-0">
              {/* Day header */}
              <div
                className={cn(
                  "flex items-center justify-between px-2.5 py-2 rounded-t-xl mb-1.5 border-b-2",
                  isWeekend
                    ? "bg-ink-50 border-ink-200"
                    : "bg-brand-50 border-brand-200"
                )}
              >
                <span
                  className={cn(
                    "text-[11.5px] font-bold",
                    isWeekend ? "text-ink-500" : "text-brand-700"
                  )}
                >
                  {t(`schedule.day${day}Short` as Parameters<typeof t>[0])}
                </span>
                {daySchedules.length > 0 && (
                  <span
                    className={cn(
                      "w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold text-white",
                      isWeekend ? "bg-ink-400" : "bg-brand-500"
                    )}
                  >
                    {daySchedules.length}
                  </span>
                )}
              </div>

              {/* Cards */}
              <div className="flex flex-col gap-1.5">
                {daySchedules.length === 0 ? (
                  <div className="h-16 rounded-xl border border-dashed border-ink-150 flex items-center justify-center">
                    <span className="text-[10px] text-ink-300">—</span>
                  </div>
                ) : (
                  daySchedules.map((s) => (
                    <ScheduleCard
                      key={s.id}
                      schedule={s}
                      locale={locale}
                      t={t}
                      onEdit={() => onEdit(s)}
                      onDelete={() => onDelete(s)}
                    />
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
