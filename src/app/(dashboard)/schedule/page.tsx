"use client";

import { useState, useMemo } from "react";
import {
  CalendarDays, Plus, Search, Pencil, Trash2,
  ToggleLeft, ToggleRight, AlertCircle,
  ChevronDown, LayoutGrid, List, Clock, RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useTranslation, type TranslationFn } from "@/hooks/use-translation";
import { useSchedules } from "@/hooks/use-schedules";
import { useMerchandisers } from "@/hooks/use-company-users";
import { usePlaces } from "@/hooks/use-places";
import type { ScheduleWithDetails } from "@/services/schedules";
import type { DayOfWeek, ScheduleFrequency } from "@/types";
import { ScheduleModal } from "./_components/ScheduleModal";
import { DeleteModal }   from "./_components/DeleteModal";
import { WeeklyView }    from "./_components/WeeklyView";

// ─── Constants ────────────────────────────────────────────────────────────────

const DAYS: DayOfWeek[] = [0, 1, 2, 3, 4, 5, 6];

const FREQ_COLORS: Record<ScheduleFrequency, string> = {
  weekly:   "bg-brand-50  text-brand-700",
  biweekly: "bg-purple-50 text-purple-700",
  monthly:  "bg-amber-50  text-amber-700",
};

// ─── Skeleton row ─────────────────────────────────────────────────────────────
function SkeletonRow() {
  return (
    <tr className="border-b border-ink-100">
      {[...Array(7)].map((_, i) => (
        <td key={i} className="px-4 py-3.5">
          <div className="h-4 rounded-md bg-ink-100 animate-pulse w-full max-w-[110px]" />
        </td>
      ))}
    </tr>
  );
}

// ─── Skeleton weekly ──────────────────────────────────────────────────────────
function SkeletonWeekly() {
  return (
    <div className="grid grid-cols-7 gap-2 min-w-[700px]">
      {[...Array(7)].map((_, d) => (
        <div key={d} className="space-y-1.5">
          <div className="h-8 rounded-xl bg-ink-100 animate-pulse" />
          {[...Array(d % 3 === 0 ? 2 : d % 2 === 0 ? 1 : 0)].map((__, i) => (
            <div key={i} className="h-20 rounded-xl bg-ink-100 animate-pulse" />
          ))}
          <div className="h-16 rounded-xl border border-dashed border-ink-150" />
        </div>
      ))}
    </div>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────
function EmptyState({ onAdd, t }: { onAdd: () => void; t: TranslationFn }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="w-16 h-16 rounded-2xl bg-ink-100 flex items-center justify-center mb-4">
        <CalendarDays className="w-8 h-8 text-ink-300" />
      </div>
      <h3 className="text-[15px] font-semibold text-ink-700 mb-1">
        {t("schedule.emptyTitle")}
      </h3>
      <p className="text-[13px] text-ink-400 mb-6 max-w-xs">
        {t("schedule.emptyDesc")}
      </p>
      <button
        onClick={onAdd}
        className="inline-flex items-center gap-2 h-10 px-5 rounded-xl bg-brand-500 hover:bg-brand-600 text-white text-[13px] font-semibold shadow-pop transition-all"
      >
        <Plus className="w-4 h-4" />
        {t("schedule.add")}
      </button>
    </div>
  );
}

// ─── Error state ──────────────────────────────────────────────────────────────
function ErrorState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="w-14 h-14 rounded-2xl bg-rose-50 flex items-center justify-center mb-4">
        <AlertCircle className="w-7 h-7 text-rose-400" />
      </div>
      <p className="text-[13px] text-rose-500">{message}</p>
    </div>
  );
}

// ─── Status badge ─────────────────────────────────────────────────────────────
function StatusBadge({ active, t }: { active: boolean; t: TranslationFn }) {
  return (
    <span className={cn(
      "inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11.5px] font-semibold",
      active ? "bg-emerald-50 text-emerald-700" : "bg-ink-100 text-ink-500"
    )}>
      {active ? <ToggleRight className="w-3.5 h-3.5" /> : <ToggleLeft className="w-3.5 h-3.5" />}
      {active ? t("common.active") : t("common.inactive")}
    </span>
  );
}

// ─── Frequency badge ──────────────────────────────────────────────────────────
function FreqBadge({ freq, t }: { freq: ScheduleFrequency; t: TranslationFn }) {
  const labelKey = `schedule.freq${freq.charAt(0).toUpperCase()}${freq.slice(1)}` as Parameters<typeof t>[0];
  return (
    <span className={cn(
      "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold",
      FREQ_COLORS[freq]
    )}>
      <RefreshCw className="w-2.5 h-2.5" />
      {t(labelKey)}
    </span>
  );
}

// ─── Table head ───────────────────────────────────────────────────────────────
function TableHead({ t }: { t: TranslationFn }) {
  return (
    <tr className="border-b border-ink-100 bg-ink-50/60">
      <th className="px-4 py-3 text-start text-[11.5px] font-semibold text-ink-400 uppercase tracking-wide">
        {t("schedule.merch")}
      </th>
      <th className="px-4 py-3 text-start text-[11.5px] font-semibold text-ink-400 uppercase tracking-wide">
        {t("schedule.place")}
      </th>
      <th className="px-4 py-3 text-start text-[11.5px] font-semibold text-ink-400 uppercase tracking-wide">
        {t("schedule.day")}
      </th>
      <th className="px-4 py-3 text-start text-[11.5px] font-semibold text-ink-400 uppercase tracking-wide">
        {t("schedule.startTime")}
      </th>
      <th className="px-4 py-3 text-start text-[11.5px] font-semibold text-ink-400 uppercase tracking-wide">
        {t("schedule.frequency")}
      </th>
      <th className="px-4 py-3 text-start text-[11.5px] font-semibold text-ink-400 uppercase tracking-wide">
        {t("common.status")}
      </th>
      <th className="px-4 py-3 text-end text-[11.5px] font-semibold text-ink-400 uppercase tracking-wide">
        {t("common.actions")}
      </th>
    </tr>
  );
}

// ─── Table row ────────────────────────────────────────────────────────────────
interface RowProps {
  schedule: ScheduleWithDetails;
  locale:   string;
  t:        TranslationFn;
  onEdit:   () => void;
  onDelete: () => void;
}

function ScheduleRow({ schedule, locale, t, onEdit, onDelete }: RowProps) {
  const merchName  = schedule.merch?.user?.full_name ?? "—";
  const branchName = locale === "ar" ? schedule.place?.branch_ar : schedule.place?.branch_en;
  const chainColor = (schedule.place as { chain?: { color?: string } })?.chain?.color ?? "#111827";
  const dayLabel   = t(`schedule.day${schedule.day_of_week}` as Parameters<typeof t>[0]);
  const initials   = merchName.split(" ").slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  const isOptimistic = schedule.id === "__optimistic__";

  return (
    <tr className={cn(
      "border-b border-ink-100 hover:bg-ink-50/50 transition-colors group",
      isOptimistic && "opacity-60 pointer-events-none"
    )}>
      {/* Merchandiser */}
      <td className="px-4 py-3.5">
        <div className="flex items-center gap-2.5">
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center text-white text-[11px] font-bold shrink-0"
            style={{ backgroundColor: chainColor }}
          >
            {initials}
          </div>
          <span className="font-semibold text-ink-800 text-[13px]">{merchName}</span>
        </div>
      </td>

      {/* Branch */}
      <td className="px-4 py-3.5">
        <div className="flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: chainColor }} />
          <span className="text-ink-700">{branchName}</span>
        </div>
      </td>

      {/* Day */}
      <td className="px-4 py-3.5">
        <span className="px-2 py-0.5 rounded-md bg-ink-100 text-ink-600 text-[12px] font-medium">
          {dayLabel}
        </span>
      </td>

      {/* Time */}
      <td className="px-4 py-3.5">
        <span className="inline-flex items-center gap-1 text-ink-700 text-[12.5px] font-medium">
          <Clock className="w-3 h-3 text-ink-400" />
          {schedule.start_time}
          {schedule.end_time && (
            <span className="text-ink-400"> – {schedule.end_time}</span>
          )}
        </span>
      </td>

      {/* Frequency */}
      <td className="px-4 py-3.5">
        <FreqBadge freq={schedule.frequency} t={t} />
      </td>

      {/* Status */}
      <td className="px-4 py-3.5">
        <StatusBadge active={schedule.is_active} t={t} />
      </td>

      {/* Actions */}
      <td className="px-4 py-3.5">
        <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={onEdit}
            title={t("common.edit")}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-ink-400 hover:text-brand-500 hover:bg-brand-50 transition-all"
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onDelete}
            title={t("common.delete")}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-ink-400 hover:text-rose-500 hover:bg-rose-50 transition-all"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </td>
    </tr>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function SchedulePage() {
  const { t, locale } = useTranslation();
  const { data: schedules = [], isLoading, isError, error } = useSchedules();
  const { data: merchs  = [] } = useMerchandisers();
  const { data: places  = [] } = usePlaces();

  // ── Modal state ─────────────────────────────────────────────────────────────
  const [showCreate,   setShowCreate]   = useState(false);
  const [editTarget,   setEditTarget]   = useState<ScheduleWithDetails | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ScheduleWithDetails | null>(null);

  // ── View mode ───────────────────────────────────────────────────────────────
  const [view, setView] = useState<"week" | "list">("week");

  // ── Filters ─────────────────────────────────────────────────────────────────
  const [search,        setSearch]        = useState("");
  const [filterDay,     setFilterDay]     = useState<string>("");
  const [filterMerchId, setFilterMerchId] = useState<string>("");
  const [filterPlaceId, setFilterPlaceId] = useState<string>("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return schedules.filter((s) => {
      if (filterDay     && String(s.day_of_week) !== filterDay) return false;
      if (filterMerchId && s.merch_id            !== filterMerchId) return false;
      if (filterPlaceId && s.place_id            !== filterPlaceId) return false;
      if (!q) return true;
      const merch  = s.merch?.user?.full_name ?? "";
      const branchAr = s.place?.branch_ar ?? "";
      const branchEn = s.place?.branch_en ?? "";
      return (
        merch.toLowerCase().includes(q) ||
        branchAr.toLowerCase().includes(q) ||
        branchEn.toLowerCase().includes(q)
      );
    });
  }, [schedules, search, filterDay, filterMerchId, filterPlaceId]);

  // ── Stats ───────────────────────────────────────────────────────────────────
  const totalCount  = schedules.length;
  const activeCount = schedules.filter((s) => s.is_active).length;

  const hasFilters = !!(search || filterDay || filterMerchId || filterPlaceId);

  function clearFilters() {
    setSearch(""); setFilterDay(""); setFilterMerchId(""); setFilterPlaceId("");
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <>
      {/* ── Page header ─────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-[24px] font-bold text-ink-900 flex items-center gap-2.5">
            <CalendarDays className="w-6 h-6 text-brand-500" />
            {t("schedule.pageTitle")}
          </h1>
          <p className="text-[13px] text-ink-400 mt-0.5">
            {t("schedule.pageSubtitle")}
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* View toggle */}
          <div className="flex items-center bg-ink-100 rounded-xl p-1 gap-0.5">
            <button
              onClick={() => setView("week")}
              className={cn(
                "flex items-center gap-1.5 h-8 px-3 rounded-lg text-[12px] font-semibold transition-all",
                view === "week"
                  ? "bg-white text-ink-900 shadow-sm"
                  : "text-ink-500 hover:text-ink-700"
              )}
            >
              <LayoutGrid className="w-3.5 h-3.5" />
              {t("schedule.viewWeekly")}
            </button>
            <button
              onClick={() => setView("list")}
              className={cn(
                "flex items-center gap-1.5 h-8 px-3 rounded-lg text-[12px] font-semibold transition-all",
                view === "list"
                  ? "bg-white text-ink-900 shadow-sm"
                  : "text-ink-500 hover:text-ink-700"
              )}
            >
              <List className="w-3.5 h-3.5" />
              {t("schedule.viewList")}
            </button>
          </div>

          <button
            onClick={() => setShowCreate(true)}
            className="inline-flex items-center gap-2 h-10 px-5 rounded-xl bg-brand-500 hover:bg-brand-600 text-white text-[13.5px] font-semibold shadow-pop transition-all"
          >
            <Plus className="w-4 h-4" />
            {t("schedule.add")}
          </button>
        </div>
      </div>

      {/* ── Stats pills ─────────────────────────────────────────────────── */}
      {!isLoading && !isError && totalCount > 0 && (
        <div className="flex flex-wrap gap-2 mb-5">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-ink-100 text-ink-600 text-[12px] font-semibold">
            <CalendarDays className="w-3.5 h-3.5" />
            {t("schedule.total").replace("{count}", String(totalCount))}
          </span>
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 text-emerald-700 text-[12px] font-semibold">
            <ToggleRight className="w-3.5 h-3.5" />
            {t("schedule.active").replace("{count}", String(activeCount))}
          </span>
        </div>
      )}

      {/* ── Card ────────────────────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-ink-100 shadow-soft overflow-hidden">

        {/* Toolbar */}
        {!isLoading && !isError && totalCount > 0 && (
          <div className="px-4 py-3.5 border-b border-ink-100 flex flex-wrap gap-3 items-center">
            {/* Search */}
            <div className="relative flex-1 min-w-[160px] max-w-xs">
              <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-400 pointer-events-none" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("schedule.searchPlaceholder")}
                className="w-full h-9 ps-9 pe-3 rounded-lg border border-ink-200 bg-ink-50 text-[13px] text-ink-800 placeholder:text-ink-300 outline-none focus:border-brand-400 focus:ring-1 focus:ring-brand-100 transition-all"
              />
            </div>

            {/* Day filter */}
            <div className="relative">
              <select
                value={filterDay}
                onChange={(e) => setFilterDay(e.target.value)}
                className="h-9 ps-3 pe-8 rounded-lg border border-ink-200 bg-ink-50 text-[13px] text-ink-700 outline-none focus:border-brand-400 focus:ring-1 focus:ring-brand-100 transition-all appearance-none cursor-pointer"
              >
                <option value="">{t("schedule.allDays")}</option>
                {DAYS.map((d) => (
                  <option key={d} value={String(d)}>
                    {t(`schedule.day${d}` as Parameters<typeof t>[0])}
                  </option>
                ))}
              </select>
              <ChevronDown className="absolute end-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink-400 pointer-events-none" />
            </div>

            {/* Merch filter */}
            {merchs.length > 0 && (
              <div className="relative">
                <select
                  value={filterMerchId}
                  onChange={(e) => setFilterMerchId(e.target.value)}
                  className="h-9 ps-3 pe-8 rounded-lg border border-ink-200 bg-ink-50 text-[13px] text-ink-700 outline-none focus:border-brand-400 focus:ring-1 focus:ring-brand-100 transition-all appearance-none cursor-pointer"
                >
                  <option value="">{t("schedule.allMerchs")}</option>
                  {merchs.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.user.full_name}
                    </option>
                  ))}
                </select>
                <ChevronDown className="absolute end-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink-400 pointer-events-none" />
              </div>
            )}

            {/* Place filter */}
            {places.length > 0 && (
              <div className="relative">
                <select
                  value={filterPlaceId}
                  onChange={(e) => setFilterPlaceId(e.target.value)}
                  className="h-9 ps-3 pe-8 rounded-lg border border-ink-200 bg-ink-50 text-[13px] text-ink-700 outline-none focus:border-brand-400 focus:ring-1 focus:ring-brand-100 transition-all appearance-none cursor-pointer"
                >
                  <option value="">{t("schedule.allPlaces")}</option>
                  {places.map((p) => (
                    <option key={p.id} value={p.id}>
                      {locale === "ar" ? p.branch_ar : p.branch_en}
                    </option>
                  ))}
                </select>
                <ChevronDown className="absolute end-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink-400 pointer-events-none" />
              </div>
            )}

            {/* Clear filters */}
            {hasFilters && (
              <button
                onClick={clearFilters}
                className="h-9 px-3 rounded-lg text-[12.5px] font-semibold text-rose-500 hover:bg-rose-50 transition-all"
              >
                ✕ {t("common.filter")}
              </button>
            )}
          </div>
        )}

        {/* ── Loading ─────────────────────────────────────────────────── */}
        {isLoading && (
          view === "week" ? (
            <div className="p-4 overflow-x-auto">
              <SkeletonWeekly />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead><TableHead t={t} /></thead>
                <tbody>
                  {[...Array(5)].map((_, i) => <SkeletonRow key={i} />)}
                </tbody>
              </table>
            </div>
          )
        )}

        {/* ── Error ───────────────────────────────────────────────────── */}
        {isError && (
          <ErrorState message={(error as Error)?.message ?? t("common.noData")} />
        )}

        {/* ── Empty ───────────────────────────────────────────────────── */}
        {!isLoading && !isError && totalCount === 0 && (
          <EmptyState onAdd={() => setShowCreate(true)} t={t} />
        )}

        {/* ── Weekly view ─────────────────────────────────────────────── */}
        {!isLoading && !isError && totalCount > 0 && view === "week" && (
          <div className="p-4">
            {filtered.length === 0 ? (
              <p className="text-center text-ink-400 text-[13px] py-10">
                {t("common.noData")}
              </p>
            ) : (
              <WeeklyView
                schedules={filtered}
                onEdit={(s) => setEditTarget(s)}
                onDelete={(s) => setDeleteTarget(s)}
              />
            )}
          </div>
        )}

        {/* ── List view ───────────────────────────────────────────────── */}
        {!isLoading && !isError && totalCount > 0 && view === "list" && (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead><TableHead t={t} /></thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-12 text-center text-ink-400 text-[13px]">
                      {t("common.noData")}
                    </td>
                  </tr>
                ) : (
                  filtered.map((s) => (
                    <ScheduleRow
                      key={s.id}
                      schedule={s}
                      locale={locale}
                      t={t}
                      onEdit={() => setEditTarget(s)}
                      onDelete={() => setDeleteTarget(s)}
                    />
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Modals ──────────────────────────────────────────────────────── */}
      {showCreate && (
        <ScheduleModal onClose={() => setShowCreate(false)} />
      )}
      {editTarget && (
        <ScheduleModal schedule={editTarget} onClose={() => setEditTarget(null)} />
      )}
      {deleteTarget && (
        <DeleteModal schedule={deleteTarget} onClose={() => setDeleteTarget(null)} />
      )}
    </>
  );
}
