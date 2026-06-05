"use client";

import { useEffect } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  X, CalendarDays, User, MapPin, Clock,
  RefreshCw, ChevronDown,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useTranslation } from "@/hooks/use-translation";
import { useCreateSchedule, useUpdateSchedule } from "@/hooks/use-schedules";
import { useMerchandisers } from "@/hooks/use-company-users";
import { usePlaces } from "@/hooks/use-places";
import type { ScheduleWithDetails } from "@/services/schedules";
import type { DayOfWeek, ScheduleFrequency } from "@/types";

// ─── Constants ────────────────────────────────────────────────────────────────

const DAYS: DayOfWeek[] = [0, 1, 2, 3, 4, 5, 6];

const FREQUENCIES: ScheduleFrequency[] = ["weekly", "biweekly", "monthly"];

const FREQ_KEY: Record<ScheduleFrequency, string> = {
  weekly:   "schedule.freqWeekly",
  biweekly: "schedule.freqBiweekly",
  monthly:  "schedule.freqMonthly",
};

// ─── Zod schema ───────────────────────────────────────────────────────────────

const scheduleSchema = z.object({
  merch_id:    z.string().min(1, "يجب اختيار المندوب"),
  place_id:    z.string().min(1, "يجب اختيار الفرع"),
  day_of_week: z.number().int().min(0).max(6),
  start_time:  z
    .string()
    .min(1, "وقت البداية مطلوب")
    .regex(/^\d{2}:\d{2}$/, "تنسيق HH:MM"),
  end_time: z
    .string()
    .optional()
    .refine((v) => !v || /^\d{2}:\d{2}$/.test(v), "تنسيق HH:MM"),
  frequency: z.enum(["weekly", "biweekly", "monthly"], {
    errorMap: () => ({ message: "يجب اختيار التكرار" }),
  }),
  is_active: z.boolean().default(true),
});

type ScheduleFormData = z.infer<typeof scheduleSchema>;

// ─── Props ────────────────────────────────────────────────────────────────────

interface ScheduleModalProps {
  schedule?: ScheduleWithDetails | null;
  onClose:   () => void;
}

// ─── Section header ───────────────────────────────────────────────────────────

function SectionHeader({ icon: Icon, label }: { icon: React.ElementType; label: string }) {
  return (
    <div className="flex items-center gap-2 pb-1 border-b border-ink-100 mb-3 mt-5 first:mt-0">
      <Icon className="w-3.5 h-3.5 text-brand-500" />
      <span className="text-[11.5px] font-bold text-ink-500 uppercase tracking-wider">
        {label}
      </span>
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ScheduleModal({ schedule, onClose }: ScheduleModalProps) {
  const { t, locale } = useTranslation();
  const isEdit        = Boolean(schedule);
  const create        = useCreateSchedule();
  const update        = useUpdateSchedule();
  const isPending     = create.isPending || update.isPending;

  const { data: merchs = [], isLoading: merchLoading } = useMerchandisers();
  const { data: places = [], isLoading: placesLoading } = usePlaces();
  const activePlaces = places.filter((p) => p.is_active);

  const {
    register, handleSubmit, control, setValue, watch, reset,
    formState: { errors },
  } = useForm<ScheduleFormData>({
    resolver: zodResolver(scheduleSchema),
    defaultValues: {
      merch_id:    schedule?.merch_id    ?? "",
      place_id:    schedule?.place_id    ?? "",
      day_of_week: schedule?.day_of_week ?? 0,
      start_time:  schedule?.start_time  ?? "",
      end_time:    schedule?.end_time    ?? "",
      frequency:   schedule?.frequency   ?? "weekly",
      is_active:   schedule?.is_active   ?? true,
    },
  });

  const isActive   = watch("is_active");
  const selectedDay = watch("day_of_week");

  useEffect(() => {
    reset({
      merch_id:    schedule?.merch_id    ?? "",
      place_id:    schedule?.place_id    ?? "",
      day_of_week: schedule?.day_of_week ?? 0,
      start_time:  schedule?.start_time  ?? "",
      end_time:    schedule?.end_time    ?? "",
      frequency:   schedule?.frequency   ?? "weekly",
      is_active:   schedule?.is_active   ?? true,
    });
  }, [schedule, reset]);

  // ── Submit ──────────────────────────────────────────────────────────────────
  async function onSubmit(data: ScheduleFormData) {
    const payload = {
      ...data,
      day_of_week: data.day_of_week as DayOfWeek,
      end_time: data.end_time?.trim() || undefined,
    };

    if (isEdit && schedule) {
      await update.mutateAsync({ id: schedule.id, payload });
    } else {
      await create.mutateAsync(payload);
    }
    onClose();
  }

  // ── Shared classes ──────────────────────────────────────────────────────────
  const selectCls = (hasError?: boolean) =>
    cn(
      "w-full h-10 ps-9 pe-8 rounded-xl border bg-white text-[13px] outline-none transition-all appearance-none cursor-pointer",
      "focus:border-brand-500 focus:ring-2 focus:ring-brand-50",
      hasError ? "border-rose-400 bg-rose-50/30" : "border-ink-200"
    );

  const inputCls = (hasError?: boolean) =>
    cn(
      "w-full h-10 ps-9 pe-3 rounded-xl border bg-white text-[13px] outline-none transition-all",
      "placeholder:text-ink-300 focus:border-brand-500 focus:ring-2 focus:ring-brand-50",
      hasError ? "border-rose-400 bg-rose-50/30" : "border-ink-200"
    );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-ink-900/40 backdrop-blur-sm animate-fade-in" />

      <div
        className="relative w-full max-w-lg bg-white rounded-2xl shadow-modal border border-ink-100 animate-slide-up flex flex-col max-h-[92vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Sticky header ──────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-ink-100 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-brand-50 flex items-center justify-center">
              <CalendarDays className="w-4 h-4 text-brand-500" />
            </div>
            <h2 className="text-[16px] font-bold text-ink-900">
              {isEdit ? t("schedule.edit") : t("schedule.add")}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-ink-400 hover:text-ink-700 hover:bg-ink-100 transition-all"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* ── Scrollable body ────────────────────────────────────────────── */}
        <form
          onSubmit={handleSubmit(onSubmit)}
          className="overflow-y-auto px-6 py-5 flex-1"
        >
          {/* ── SECTION 1: Assignment ────────────────────────────────────── */}
          <SectionHeader icon={User} label={t("schedule.sectionAssignment")} />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
            {/* Merchandiser */}
            <div>
              <label className="block text-[12px] font-semibold text-ink-700 mb-1">
                {t("schedule.merch")} <span className="text-brand-500">*</span>
              </label>
              <div className="relative">
                <User className="absolute start-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink-400 pointer-events-none z-10" />
                <ChevronDown className="absolute end-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink-400 pointer-events-none z-10" />
                <select
                  {...register("merch_id")}
                  disabled={merchLoading}
                  className={selectCls(!!errors.merch_id)}
                >
                  <option value="">
                    {merchLoading ? t("common.loading") : t("schedule.allMerchs")}
                  </option>
                  {merchs.length === 0 && !merchLoading && (
                    <option value="" disabled>{t("schedule.noMerchs")}</option>
                  )}
                  {merchs.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.user.full_name}
                    </option>
                  ))}
                </select>
              </div>
              {errors.merch_id && (
                <p className="mt-0.5 text-[11px] text-rose-500">{errors.merch_id.message}</p>
              )}
            </div>

            {/* Place */}
            <div>
              <label className="block text-[12px] font-semibold text-ink-700 mb-1">
                {t("schedule.place")} <span className="text-brand-500">*</span>
              </label>
              <div className="relative">
                <MapPin className="absolute start-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink-400 pointer-events-none z-10" />
                <ChevronDown className="absolute end-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink-400 pointer-events-none z-10" />
                <select
                  {...register("place_id")}
                  disabled={placesLoading}
                  className={selectCls(!!errors.place_id)}
                >
                  <option value="">
                    {placesLoading ? t("common.loading") : t("schedule.allPlaces")}
                  </option>
                  {activePlaces.length === 0 && !placesLoading && (
                    <option value="" disabled>{t("schedule.noPlaces")}</option>
                  )}
                  {activePlaces.map((p) => (
                    <option key={p.id} value={p.id}>
                      {locale === "ar" ? p.branch_ar : p.branch_en}
                      {p.chain ? ` — ${locale === "ar" ? p.chain.name_ar : p.chain.name_en}` : ""}
                    </option>
                  ))}
                </select>
              </div>
              {errors.place_id && (
                <p className="mt-0.5 text-[11px] text-rose-500">{errors.place_id.message}</p>
              )}
            </div>
          </div>

          {/* ── Day of week selector ─────────────────────────────────────── */}
          <div className="mb-3">
            <label className="block text-[12px] font-semibold text-ink-700 mb-2">
              {t("schedule.day")} <span className="text-brand-500">*</span>
            </label>
            <Controller
              control={control}
              name="day_of_week"
              render={({ field }) => (
                <div className="flex gap-1.5 flex-wrap">
                  {DAYS.map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => field.onChange(d)}
                      className={cn(
                        "flex-1 min-w-[40px] h-9 rounded-xl text-[11.5px] font-semibold transition-all border",
                        field.value === d
                          ? "bg-brand-500 text-white border-brand-500 shadow-pop"
                          : "bg-white text-ink-600 border-ink-200 hover:border-brand-300 hover:text-brand-600"
                      )}
                    >
                      {t(`schedule.day${d}Short` as Parameters<typeof t>[0])}
                    </button>
                  ))}
                </div>
              )}
            />
            {/* Show selected day name */}
            <p className="mt-1.5 text-[11px] text-ink-400">
              {t(`schedule.day${selectedDay}` as Parameters<typeof t>[0])}
            </p>
          </div>

          {/* ── SECTION 2: Timing ────────────────────────────────────────── */}
          <SectionHeader icon={Clock} label={t("schedule.sectionTiming")} />

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
            {/* Start Time */}
            <div>
              <label className="block text-[12px] font-semibold text-ink-700 mb-1">
                {t("schedule.startTime")} <span className="text-brand-500">*</span>
              </label>
              <div className="relative">
                <Clock className="absolute start-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink-400 pointer-events-none" />
                <input
                  {...register("start_time")}
                  type="time"
                  dir="ltr"
                  className={inputCls(!!errors.start_time)}
                />
              </div>
              {errors.start_time && (
                <p className="mt-0.5 text-[11px] text-rose-500">{errors.start_time.message}</p>
              )}
            </div>

            {/* End Time */}
            <div>
              <label className="block text-[12px] font-semibold text-ink-700 mb-1">
                {t("schedule.endTime")}
                <span className="ms-1 text-[10.5px] font-normal text-ink-400">
                  ({t("schedule.endTimeHint")})
                </span>
              </label>
              <div className="relative">
                <Clock className="absolute start-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink-400 pointer-events-none" />
                <input
                  {...register("end_time")}
                  type="time"
                  dir="ltr"
                  className={inputCls(!!errors.end_time)}
                />
              </div>
              {errors.end_time && (
                <p className="mt-0.5 text-[11px] text-rose-500">{errors.end_time.message}</p>
              )}
            </div>

            {/* Frequency */}
            <div>
              <label className="block text-[12px] font-semibold text-ink-700 mb-1">
                {t("schedule.frequency")} <span className="text-brand-500">*</span>
              </label>
              <div className="relative">
                <RefreshCw className="absolute start-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink-400 pointer-events-none z-10" />
                <ChevronDown className="absolute end-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink-400 pointer-events-none z-10" />
                <select
                  {...register("frequency")}
                  className={selectCls(!!errors.frequency)}
                >
                  {FREQUENCIES.map((f) => (
                    <option key={f} value={f}>
                      {t(FREQ_KEY[f] as Parameters<typeof t>[0])}
                    </option>
                  ))}
                </select>
              </div>
              {errors.frequency && (
                <p className="mt-0.5 text-[11px] text-rose-500">{errors.frequency.message}</p>
              )}
            </div>
          </div>

          {/* ── Status toggle ────────────────────────────────────────────── */}
          <div className="flex items-center justify-between py-2.5 px-3 rounded-xl bg-ink-50 border border-ink-100 mt-2">
            <span className="text-[13px] font-medium text-ink-700">{t("common.status")}</span>
            <button
              type="button"
              onClick={() => setValue("is_active", !isActive)}
              className={cn(
                "relative inline-flex h-6 w-11 items-center rounded-full transition-colors",
                isActive ? "bg-brand-500" : "bg-ink-200"
              )}
            >
              <span
                className={cn(
                  "inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform",
                  isActive ? "translate-x-6" : "translate-x-1"
                )}
              />
            </button>
          </div>
        </form>

        {/* ── Sticky footer ────────────────────────────────────────────────── */}
        <div className="flex gap-3 px-6 py-4 border-t border-ink-100 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 h-11 rounded-xl border border-ink-200 text-ink-700 text-[13.5px] font-semibold hover:bg-ink-50 transition-all"
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            disabled={isPending}
            onClick={handleSubmit(onSubmit)}
            className="flex-1 h-11 rounded-xl bg-brand-500 hover:bg-brand-600 disabled:opacity-60 text-white text-[13.5px] font-semibold shadow-pop transition-all"
          >
            {isPending ? t("common.loading") : t("common.save")}
          </button>
        </div>
      </div>
    </div>
  );
}
