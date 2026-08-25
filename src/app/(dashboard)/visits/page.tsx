"use client";

import { Suspense, useState, useMemo, useCallback } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { ClipboardList, User, MapPin, ChevronDown, AlertCircle, ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useTranslation } from "@/hooks/use-translation";
import { useVisits } from "@/hooks/use-visits";
import { useSchedules } from "@/hooks/use-schedules";
import { useCompanyUsers } from "@/hooks/use-company-users";
import { usePlaces } from "@/hooks/use-places";
import type { VisitStatus } from "@/types";
import {
  toCalendarItem,
  buildScheduleTimeMap,
  groupByMerch,
  bucketByDate,
  type VisitLike,
} from "@/lib/calendar-model";
import {
  rangeFor, datesIn, shift, today as riyadhToday, isToday as isTodayIso,
  type CalendarView,
} from "@/lib/calendar-range";
import { VisitCreateModal } from "./_components/VisitCreateModal";
import { RecurringSchedulesPanel } from "./_components/RecurringSchedulesPanel";
import { CalendarToolbar } from "./_components/calendar/CalendarToolbar";
import { DayTimeline }     from "./_components/calendar/DayTimeline";
import { DayAgenda }       from "./_components/calendar/DayAgenda";
import { WeekGrid }        from "./_components/calendar/WeekGrid";
import { MonthGrid }       from "./_components/calendar/MonthGrid";

// ─────────────────────────────────────────────────────────────────────────────
// Visits — calendar-first field operations workspace.
//
// The calendar IS the workspace: it stays on screen even with zero visits, so
// a manager can always navigate and plan. Visits and schedules remain separate
// domain models; this page only adapts them for display.
//
// Query scoping: every view fetches ONLY its visible range via the existing
// range-capable useVisits({ date_from, date_to }). `useSchedules()` is fetched
// once to resolve planned start times (schedules is a small per-company table),
// so there is no per-merchandiser N+1.
// ─────────────────────────────────────────────────────────────────────────────

function isView(v: string | null): v is CalendarView {
  return v === "day" || v === "week" || v === "month";
}

function VisitsWorkspace() {
  const { t, locale }  = useTranslation();
  const router         = useRouter();
  const pathname       = usePathname();
  const searchParams   = useSearchParams();

  // URL-driven so every view/date is deep-linkable and back works.
  const rawView   = searchParams.get("view");
  const rawDate   = searchParams.get("date");
  const showRecurring = searchParams.get("tab") === "recurring";

  const view: CalendarView = isView(rawView) ? rawView : "day";
  const anchor = rawDate && /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : riyadhToday();

  const [showCreate,   setShowCreate]   = useState(false);
  const [merchFilter,  setMerchFilter]  = useState("");
  const [placeFilter,  setPlaceFilter]  = useState("");
  const [statusFilter, setStatusFilter] = useState<VisitStatus | "">("");

  const setParams = useCallback((next: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v === null) params.delete(k);
      else params.set(k, v);
    }
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [router, pathname, searchParams]);

  // ── Range-scoped data ────────────────────────────────────────────────────
  const range = useMemo(() => rangeFor(view, anchor), [view, anchor]);

  const { data: visits = [], isLoading, isError, error } = useVisits({
    date_from: range.from,
    date_to:   range.to,
    merch_id:  merchFilter  || undefined,
    place_id:  placeFilter  || undefined,
    status:    statusFilter || undefined,
  });

  const { data: schedules = [] } = useSchedules();
  const { data: members   = [] } = useCompanyUsers();
  const { data: places    = [] } = usePlaces();

  // ── Presentation adapter ─────────────────────────────────────────────────
  const items = useMemo(() => {
    const timeMap = buildScheduleTimeMap(
      schedules.map((s) => ({ id: s.id, start_time: s.start_time ?? null }))
    );
    return (visits as unknown as VisitLike[]).map((v) =>
      toCalendarItem(v, timeMap, locale, t("users.inactive"))
    );
  }, [visits, schedules, locale, t]);

  const allMerchs = useMemo(
    () => members.map((m) => ({
      id:    m.id,
      name:  m.user?.full_name?.trim() || t("users.inactive"),
      color: m.color ?? null,
    })),
    [members, t]
  );

  // Day view shows every rep (idle ones included); week narrows to those with
  // visits plus any explicitly filtered rep, to keep the grid scannable.
  const lanes = useMemo(
    () => groupByMerch(items, view === "day" ? allMerchs : []),
    [items, allMerchs, view]
  );

  const dates   = useMemo(() => datesIn(range), [range]);
  const buckets = useMemo(() => bucketByDate(items, dates), [items, dates]);

  // ── Labels ───────────────────────────────────────────────────────────────
  const intlLocale = locale === "ar" ? "ar-SA-u-ca-gregory" : "en-GB";

  const periodLabel = useMemo(() => {
    const d = new Date(anchor + "T12:00:00");
    if (view === "day") {
      return d.toLocaleDateString(intlLocale, {
        weekday: "long", day: "numeric", month: "long", year: "numeric",
      });
    }
    if (view === "month") {
      return d.toLocaleDateString(intlLocale, { month: "long", year: "numeric" });
    }
    const from = new Date(range.from + "T12:00:00");
    const to   = new Date(range.to   + "T12:00:00");
    const opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" };
    return `${from.toLocaleDateString(intlLocale, opts)} – ${to.toLocaleDateString(intlLocale, { ...opts, year: "numeric" })}`;
  }, [anchor, view, range, intlLocale]);

  const dayLabels = useMemo(
    () => datesIn(rangeFor("week", anchor)).map((d) =>
      new Date(d + "T12:00:00").toLocaleDateString(intlLocale, { weekday: "short" })
    ),
    [anchor, intlLocale]
  );

  const selectCls =
    "h-9 ps-8 pe-7 rounded-lg border border-ink-200 bg-white text-[12.5px] text-ink-700 outline-none focus:border-brand-400 focus:ring-1 focus:ring-brand-100 transition-all appearance-none";

  const hasFilters = !!(merchFilter || placeFilter || statusFilter);

  // ── Recurring management (secondary destination) ─────────────────────────
  if (showRecurring) {
    return (
      <>
        <div className="flex items-center gap-3 mb-5">
          <button
            onClick={() => setParams({ tab: null })}
            className="w-9 h-9 rounded-xl border border-ink-200 bg-white flex items-center justify-center text-ink-500 hover:text-brand-600 hover:border-brand-300 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
            aria-label={t("common.back")}
          >
            <ArrowLeft className="w-4 h-4 rtl:rotate-180" />
          </button>
          <div>
            <h1 className="text-[20px] font-bold text-ink-900">{t("visits.tabRecurring")}</h1>
            <p className="text-[12.5px] text-ink-400">{t("schedule.pageSubtitle")}</p>
          </div>
        </div>
        <RecurringSchedulesPanel />
      </>
    );
  }

  return (
    <>
      <div className="flex items-center justify-between gap-4 mb-4">
        <h1 className="text-[22px] font-bold text-ink-900 flex items-center gap-2.5">
          <ClipboardList className="w-5 h-5 text-brand-500" />
          {t("visits.pageTitle")}
        </h1>
      </div>

      <CalendarToolbar
        view={view}
        periodLabel={periodLabel}
        isToday={view === "day" && isTodayIso(anchor)}
        t={t}
        onViewChange={(v) => setParams({ view: v })}
        onPrev={() => setParams({ date: shift(view, anchor, -1) })}
        onNext={() => setParams({ date: shift(view, anchor,  1) })}
        onToday={() => setParams({ date: riyadhToday() })}
        onAddVisit={() => setShowCreate(true)}
        onManageRecurring={() => setParams({ tab: "recurring" })}
      />

      {/* Compact filter row */}
      <div className="flex flex-wrap gap-2 mb-4">
        <div className="relative">
          <User className="absolute start-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink-400 pointer-events-none" />
          <select
            value={merchFilter}
            onChange={(e) => setMerchFilter(e.target.value)}
            aria-label={t("visits.filterMerch")}
            className={selectCls}
          >
            <option value="">{t("visits.allMerchs")}</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.user?.full_name ?? t("users.inactive")}
              </option>
            ))}
          </select>
          <ChevronDown className="absolute end-2 top-1/2 -translate-y-1/2 w-3 h-3 text-ink-400 pointer-events-none" />
        </div>

        <div className="relative">
          <MapPin className="absolute start-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink-400 pointer-events-none" />
          <select
            value={placeFilter}
            onChange={(e) => setPlaceFilter(e.target.value)}
            aria-label={t("visits.filterBranch")}
            className={selectCls}
          >
            <option value="">{t("visits.allBranches")}</option>
            {places.map((p) => (
              <option key={p.id} value={p.id}>
                {locale === "ar" ? p.branch_ar : p.branch_en}
              </option>
            ))}
          </select>
          <ChevronDown className="absolute end-2 top-1/2 -translate-y-1/2 w-3 h-3 text-ink-400 pointer-events-none" />
        </div>

        <div className="relative">
          <ClipboardList className="absolute start-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink-400 pointer-events-none" />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as VisitStatus | "")}
            aria-label={t("visits.filterStatus")}
            className={selectCls}
          >
            <option value="">{t("visits.status.all")}</option>
            {(["pending", "inprogress", "completed", "missed"] as const).map((s) => (
              <option key={s} value={s}>{t(`visits.status.${s}`)}</option>
            ))}
          </select>
          <ChevronDown className="absolute end-2 top-1/2 -translate-y-1/2 w-3 h-3 text-ink-400 pointer-events-none" />
        </div>

        {hasFilters && (
          <button
            onClick={() => { setMerchFilter(""); setPlaceFilter(""); setStatusFilter(""); }}
            className="h-9 px-3 rounded-lg text-[12.5px] text-rose-500 hover:bg-rose-50 transition-all font-medium"
          >
            ✕ {t("common.filter")}
          </button>
        )}
      </div>

      {/* ── Calendar ─────────────────────────────────────────────────────── */}
      {isError ? (
        <div className="bg-white rounded-2xl border border-ink-100 flex items-center justify-center gap-2.5 py-10">
          <AlertCircle className="w-4 h-4 text-rose-400" />
          <p className="text-[12.5px] text-rose-500">
            {(error as Error)?.message ?? t("common.noData")}
          </p>
        </div>
      ) : isLoading ? (
        <div className="bg-white rounded-2xl border border-ink-100 shadow-sm p-4 space-y-2">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-12 rounded-xl bg-ink-100 animate-pulse" />
          ))}
        </div>
      ) : view === "day" ? (
        <>
          {/* Timeline on tablet/desktop, agenda on phones. */}
          <div className="hidden md:block"><DayTimeline lanes={lanes} t={t} /></div>
          <div className="md:hidden"><DayAgenda lanes={lanes} t={t} /></div>
        </>
      ) : view === "week" ? (
        <WeekGrid lanes={lanes} dates={dates} dayLabels={dayLabels} t={t} />
      ) : (
        <MonthGrid
          buckets={buckets}
          anchor={anchor}
          dayLabels={dayLabels}
          t={t}
          onPickDay={(d) => setParams({ view: "day", date: d })}
        />
      )}

      {showCreate && (
        <VisitCreateModal
          initialDate={anchor}
          onClose={() => setShowCreate(false)}
        />
      )}
    </>
  );
}

export default function VisitsPage() {
  return (
    <Suspense
      fallback={
        <div className="space-y-2">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-14 rounded-xl bg-ink-100 animate-pulse" />
          ))}
        </div>
      }
    >
      <VisitsWorkspace />
    </Suspense>
  );
}
