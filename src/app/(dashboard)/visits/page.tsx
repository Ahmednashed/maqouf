"use client";

import { Suspense, useState, useMemo, useCallback } from "react";
import Link from "next/link";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import {
  ClipboardList,
  Plus,
  MapPin,
  User,
  CalendarDays,
  Play,
  RotateCcw,
  Eye,
  XCircle,
  AlertCircle,
  ChevronDown,
  Clock,
  Repeat,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useTranslation, type TranslationFn } from "@/hooks/use-translation";
import type { TranslationKey } from "@/lib/i18n/translations";
import { useVisits, useStartVisit, useMarkMissed } from "@/hooks/use-visits";
import { useCompanyUsers } from "@/hooks/use-company-users";
import { usePlaces } from "@/hooks/use-places";
import type { VisitWithDetails } from "@/services/visits";
import type { VisitStatus } from "@/types";
import { VisitCreateModal } from "./_components/VisitCreateModal";
import { RecurringSchedulesPanel } from "./_components/RecurringSchedulesPanel";

// ─────────────────────────────────────────────────────────────────────────────
// Visits workspace.
//
// One destination for everything visit-related. The tabs are a PRESENTATION
// layer only — visits and recurring schedules stay separate domain models
// backed by separate tables and separate hooks:
//   • visit    = executable instance  (`visits`,    useVisits)
//   • schedule = recurring assignment (`schedules`, useSchedules)
// Nothing here creates one from the other.
// ─────────────────────────────────────────────────────────────────────────────

type TabKey = "today" | "upcoming" | "inprogress" | "completed" | "missed" | "recurring";

const TABS: readonly TabKey[] = [
  "today", "upcoming", "inprogress", "completed", "missed", "recurring",
] as const;

function isTabKey(v: string | null): v is TabKey {
  return !!v && (TABS as readonly string[]).includes(v);
}

/** Tab → label key (reusing existing status/date strings wherever they exist). */
const TAB_LABEL: Record<TabKey, TranslationKey> = {
  today:      "visits.today"            as TranslationKey,
  upcoming:   "visits.tabUpcoming"      as TranslationKey,
  inprogress: "visits.status.inprogress" as TranslationKey,
  completed:  "visits.status.completed"  as TranslationKey,
  missed:     "visits.status.missed"     as TranslationKey,
  recurring:  "visits.tabRecurring"      as TranslationKey,
};

const TAB_EMPTY: Partial<Record<TabKey, TranslationKey>> = {
  today:    "visits.emptyToday"    as TranslationKey,
  upcoming: "visits.emptyUpcoming" as TranslationKey,
};

function isoDay(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

/**
 * Tab → server-side visit filters. Each tab is its own scoped query (and its
 * own React Query cache entry), so no tab ever fetches the full visit table.
 */
function filtersForTab(tab: TabKey, explicitDate: string): {
  status?: VisitStatus | "all";
  date_from?: string;
  date_to?: string;
} {
  // An explicit date always wins over the tab's implicit window.
  if (explicitDate) {
    const base = { date_from: explicitDate, date_to: explicitDate };
    if (tab === "inprogress" || tab === "completed" || tab === "missed") {
      return { ...base, status: tab };
    }
    return base;
  }

  switch (tab) {
    case "today":      return { date_from: isoDay(0), date_to: isoDay(0) };
    case "upcoming":   return { date_from: isoDay(1) };
    case "inprogress": return { status: "inprogress" };
    case "completed":  return { status: "completed" };
    case "missed":     return { status: "missed" };
    default:           return {};
  }
}

// ─── Status styling ───────────────────────────────────────────────────────────

function statusBadgeCls(status: VisitStatus) {
  switch (status) {
    case "pending":    return "bg-amber-50 text-amber-700 border-amber-200";
    case "inprogress": return "bg-blue-50 text-blue-700 border-blue-200";
    case "completed":  return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "missed":     return "bg-rose-50 text-rose-600 border-rose-200";
  }
}

// ─── Date label helper ────────────────────────────────────────────────────────

function useDateLabel() {
  const { t, locale } = useTranslation();
  const today     = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

  return (dateStr: string) => {
    if (dateStr === today)     return t("visits.today");
    if (dateStr === yesterday) return t("visits.yesterday");
    return new Date(dateStr + "T12:00:00").toLocaleDateString(
      locale === "ar" ? "ar-SA" : "en-GB",
      { weekday: "long", day: "numeric", month: "short" }
    );
  };
}

// ─── Empty / Error states ─────────────────────────────────────────────────────

function EmptyState({
  onAdd, t, message,
}: { onAdd: () => void; t: TranslationFn; message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-14 text-center">
      <div className="w-14 h-14 rounded-2xl bg-ink-100 flex items-center justify-center mb-3">
        <ClipboardList className="w-7 h-7 text-ink-300" />
      </div>
      <h3 className="text-[14px] font-semibold text-ink-700 mb-1">
        {t("visits.emptyTitle")}
      </h3>
      <p className="text-[12.5px] text-ink-400 mb-5 max-w-xs">{message}</p>
      <button
        onClick={onAdd}
        className="inline-flex items-center gap-2 h-10 px-5 rounded-xl bg-brand-500 hover:bg-brand-600 text-white text-[13px] font-semibold shadow-pop transition-all"
      >
        <Plus className="w-4 h-4" />
        {t("visits.add")}
      </button>
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-14 text-center">
      <div className="w-12 h-12 rounded-2xl bg-rose-50 flex items-center justify-center mb-3">
        <AlertCircle className="w-6 h-6 text-rose-400" />
      </div>
      <p className="text-[13px] text-rose-500">{message}</p>
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="bg-white rounded-2xl border border-ink-100 p-4 space-y-3">
      <div className="flex justify-between">
        <div className="h-4 w-40 rounded-md bg-ink-100 animate-pulse" />
        <div className="h-6 w-20 rounded-full bg-ink-100 animate-pulse" />
      </div>
      <div className="h-3 w-28 rounded-md bg-ink-100 animate-pulse" />
      <div className="flex items-center justify-between pt-1">
        <div className="h-3 w-24 rounded-md bg-ink-100 animate-pulse" />
        <div className="h-9 w-28 rounded-xl bg-ink-100 animate-pulse" />
      </div>
    </div>
  );
}

// ─── Visit card ───────────────────────────────────────────────────────────────

interface VisitCardProps {
  visit:       VisitWithDetails;
  t:           TranslationFn;
  locale:      string;
  onStart:     () => void;
  onMarkMissed:() => void;
  startPending: boolean;
  missedPending:boolean;
}

function VisitCard({
  visit, t, locale, onStart, onMarkMissed, startPending, missedPending,
}: VisitCardProps) {
  const branchName = locale === "ar" ? visit.place.branch_ar : visit.place.branch_en;
  const chainName  = locale === "ar" ? visit.place.chain?.name_ar : visit.place.chain?.name_en;
  const chainColor = visit.place.chain?.color ?? "#6366F1";
  // merch.user can be null if the auth user was deleted — always use safe access
  const merchName  = visit.merch.user?.full_name ?? t("users.inactive");
  const initials   = merchantInitials(visit.merch.user?.full_name ?? "");
  const merchColor = visit.merch.color ?? "#6366F1";

  const statusKey = `visits.status.${visit.status}` as const;

  return (
    <div className="bg-white rounded-2xl border border-ink-100 shadow-sm overflow-hidden group hover:shadow-md transition-shadow">
      {/* Chain colour top accent */}
      <div className="h-1" style={{ backgroundColor: chainColor }} />

      <div className="p-4">
        {/* Branch + status */}
        <div className="flex items-start justify-between gap-3 mb-1">
          <div className="flex-1 min-w-0">
            <p className="font-bold text-ink-900 text-[14px] leading-tight truncate">
              {branchName}
            </p>
            {chainName && (
              <p className="text-[12px] text-ink-400 leading-tight mt-0.5 truncate">
                {chainName} · {visit.place.code}
              </p>
            )}
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {/* Origin: generated from a recurring schedule vs. created by hand.
                Quiet by design — a generated visit behaves like any other. */}
            {visit.schedule_id && (
              <span
                title={t("visits.fromScheduleHint")}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[10.5px] font-semibold border border-ink-200 bg-ink-50 text-ink-500"
              >
                <Repeat className="w-3 h-3" />
                {t("visits.fromSchedule")}
              </span>
            )}
            <span
              className={cn(
                "inline-flex items-center px-2.5 py-1 rounded-full text-[11.5px] font-semibold border",
                statusBadgeCls(visit.status)
              )}
            >
              {t(statusKey)}
            </span>
          </div>
        </div>

        {/* Merch row */}
        <div className="flex items-center gap-2 my-3">
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center text-white text-[11px] font-bold shrink-0"
            style={{ backgroundColor: merchColor }}
          >
            {initials}
          </div>
          <span className="text-[13px] text-ink-600 font-medium">{merchName}</span>

          {visit.started_at && visit.status === "inprogress" && (
            <span className="ms-auto flex items-center gap-1 text-[11.5px] text-blue-500 font-semibold">
              <Clock className="w-3 h-3 animate-pulse" />
              {t("visits.status.inprogress")}
            </span>
          )}
        </div>

        {/* Footer: date + action */}
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-[12px] text-ink-400">
            <CalendarDays className="w-3.5 h-3.5" />
            {formatDate(visit.scheduled_date, locale)}
          </span>

          <div className="flex items-center gap-1.5">
            {/* Mark missed (only for pending, not on completed/missed) */}
            {(visit.status === "pending" || visit.status === "inprogress") && (
              <button
                onClick={onMarkMissed}
                disabled={missedPending}
                title={t("visits.markMissed")}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-ink-300 hover:text-rose-400 hover:bg-rose-50 transition-all"
              >
                <XCircle className="w-4 h-4" />
              </button>
            )}

            {/* Primary action */}
            {visit.status === "pending" && (
              <button
                onClick={onStart}
                disabled={startPending}
                className="inline-flex items-center gap-1.5 h-9 px-4 rounded-xl bg-brand-500 hover:bg-brand-600 disabled:opacity-60 text-white text-[12.5px] font-semibold shadow-pop transition-all"
              >
                <Play className="w-3.5 h-3.5" />
                {t("visits.start")}
              </button>
            )}

            {visit.status === "inprogress" && (
              <Link
                href={`/visits/${visit.id}`}
                className="inline-flex items-center gap-1.5 h-9 px-4 rounded-xl bg-blue-500 hover:bg-blue-600 text-white text-[12.5px] font-semibold shadow-pop transition-all"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                {t("visits.continue")}
              </Link>
            )}

            {(visit.status === "completed" || visit.status === "missed") && (
              <Link
                href={`/visits/${visit.id}`}
                className="inline-flex items-center gap-1.5 h-9 px-4 rounded-xl border border-ink-200 text-ink-600 hover:bg-ink-50 text-[12.5px] font-semibold transition-all"
              >
                <Eye className="w-3.5 h-3.5" />
                {t("visits.view")}
              </Link>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function merchantInitials(name: string): string {
  return (name ?? "")
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase() || "?";
}

function formatDate(dateStr: string, locale: string): string {
  return new Date(dateStr + "T12:00:00").toLocaleDateString(
    locale === "ar" ? "ar-SA" : "en-GB",
    { day: "numeric", month: "short", year: "numeric" }
  );
}

// ─── Visits panel (one of the five visit tabs) ───────────────────────────────

function VisitsPanel({
  tab,
  onAdd,
}: {
  tab:   Exclude<TabKey, "recurring">;
  onAdd: () => void;
}) {
  const { t, locale } = useTranslation();
  const dateLabel     = useDateLabel();

  // Shared secondary filters (status now lives in the tabs)
  const [merchFilter, setMerchFilter] = useState("");
  const [placeFilter, setPlaceFilter] = useState("");
  const [dateFilter,  setDateFilter]  = useState("");

  const tabFilters = filtersForTab(tab, dateFilter);

  const { data: visits = [], isLoading, isError, error } = useVisits({
    ...tabFilters,
    merch_id: merchFilter || undefined,
    place_id: placeFilter || undefined,
  });

  const { data: members = [] } = useCompanyUsers();
  const { data: places  = [] } = usePlaces();

  const startMutation  = useStartVisit();
  const missedMutation = useMarkMissed();

  // Group by date. Upcoming reads best nearest-first; history newest-first.
  const grouped = useMemo(() => {
    const groups: Record<string, VisitWithDetails[]> = {};
    visits.forEach((v) => {
      (groups[v.scheduled_date] ??= []).push(v);
    });
    const entries = Object.entries(groups);
    return tab === "upcoming"
      ? entries.sort(([a], [b]) => a.localeCompare(b))
      : entries.sort(([a], [b]) => b.localeCompare(a));
  }, [visits, tab]);

  const totalCount = visits.length;
  const hasFilters = !!(merchFilter || placeFilter || dateFilter);

  const selectCls =
    "h-9 ps-3 pe-8 rounded-lg border border-ink-200 bg-ink-50 text-[13px] text-ink-700 outline-none focus:border-brand-400 focus:ring-1 focus:ring-brand-100 transition-all appearance-none";

  const emptyKey = TAB_EMPTY[tab];

  return (
    <>
      {/* ── Secondary filters (merchandiser · branch · date) ──────────────── */}
      <div className="flex flex-wrap gap-2 mb-4">
        <div className="relative">
          <User className="absolute start-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink-400 pointer-events-none" />
          <select
            value={merchFilter}
            onChange={(e) => setMerchFilter(e.target.value)}
            aria-label={t("visits.filterMerch")}
            className={cn(selectCls, "ps-8")}
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
            className={cn(selectCls, "ps-8")}
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
          <CalendarDays className="absolute start-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink-400 pointer-events-none" />
          <input
            type="date"
            value={dateFilter}
            aria-label={t("visits.filterDate")}
            onChange={(e) => setDateFilter(e.target.value)}
            className={cn(selectCls, "ps-8 min-w-[150px]")}
          />
        </div>

        {hasFilters && (
          <button
            onClick={() => { setMerchFilter(""); setPlaceFilter(""); setDateFilter(""); }}
            className="h-9 px-3 rounded-lg text-[12.5px] text-rose-500 hover:bg-rose-50 transition-all font-medium"
          >
            ✕ {t("common.filter")}
          </button>
        )}
      </div>

      {!isLoading && !isError && totalCount > 0 && (
        <p className="text-[12px] text-ink-400 mb-4 font-medium">
          {t("visits.total").replace("{count}", String(totalCount))}
        </p>
      )}

      {isLoading && (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => <SkeletonCard key={i} />)}
        </div>
      )}

      {isError && (
        <div className="bg-white rounded-2xl border border-ink-100">
          <ErrorState message={(error as Error)?.message ?? t("common.noData")} />
        </div>
      )}

      {!isLoading && !isError && totalCount === 0 && (
        <div className="bg-white rounded-2xl border border-ink-100">
          <EmptyState
            onAdd={onAdd}
            t={t}
            message={emptyKey ? t(emptyKey) : t("visits.emptyDesc")}
          />
        </div>
      )}

      {/* ── Date-grouped timeline ─────────────────────────────────────────── */}
      {!isLoading && !isError && totalCount > 0 && (
        <div className="space-y-6">
          {grouped.map(([date, dayVisits]) => (
            <section key={date}>
              <h2 className="text-[12px] font-bold text-ink-400 uppercase tracking-widest mb-3 px-1">
                {dateLabel(date)}
              </h2>
              <div className="space-y-3">
                {dayVisits.map((visit) => (
                  <VisitCard
                    key={visit.id}
                    visit={visit}
                    t={t}
                    locale={locale}
                    startPending={startMutation.isPending}
                    missedPending={missedMutation.isPending}
                    onStart={() => startMutation.mutate({ visitId: visit.id })}
                    onMarkMissed={() => missedMutation.mutate(visit.id)}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </>
  );
}

// ─── Workspace ────────────────────────────────────────────────────────────────

function VisitsWorkspace() {
  const { t }       = useTranslation();
  const router      = useRouter();
  const pathname    = usePathname();
  const searchParams = useSearchParams();

  const rawTab = searchParams.get("tab");
  const tab: TabKey = isTabKey(rawTab) ? rawTab : "today";

  const [showCreate, setShowCreate] = useState(false);

  // Tab state lives in the URL so every tab is deep-linkable and the browser
  // back button works. replace() avoids stacking history on each tab click.
  const setTab = useCallback(
    (next: TabKey) => {
      const params = new URLSearchParams(searchParams.toString());
      if (next === "today") params.delete("tab");
      else params.set("tab", next);
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname, searchParams]
  );

  return (
    <>
      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-5">
        <div>
          <h1 className="text-[24px] font-bold text-ink-900 flex items-center gap-2.5">
            <ClipboardList className="w-6 h-6 text-brand-500" />
            {t("visits.pageTitle")}
          </h1>
          <p className="text-[13px] text-ink-400 mt-0.5">
            {t("visits.pageSubtitle")}
          </p>
        </div>

        {/* Add Visit stays on every tab — creating a visit never creates a
            schedule, on any tab. */}
        <button
          onClick={() => setShowCreate(true)}
          className="inline-flex items-center gap-2 h-10 px-5 rounded-xl bg-brand-500 hover:bg-brand-600 text-white text-[13.5px] font-semibold shadow-pop transition-all shrink-0"
        >
          <Plus className="w-4 h-4" />
          {t("visits.add")}
        </button>
      </div>

      {/* ── Tabs ──────────────────────────────────────────────────────────── */}
      <div
        role="tablist"
        aria-label={t("visits.pageTitle")}
        className="flex gap-1.5 mb-4 overflow-x-auto pb-1 -mx-1 px-1"
      >
        {TABS.map((key) => {
          const isActive  = tab === key;
          const isRecurring = key === "recurring";
          return (
            <button
              key={key}
              role="tab"
              aria-selected={isActive}
              onClick={() => setTab(key)}
              className={cn(
                "inline-flex items-center gap-1.5 h-8 px-4 rounded-full text-[12.5px] font-semibold whitespace-nowrap transition-all",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400",
                isActive
                  ? "bg-brand-500 text-white shadow-pop"
                  : "bg-ink-100 text-ink-500 hover:bg-ink-200",
                // The planning tab sits apart from the five execution tabs.
                isRecurring && !isActive && "ms-auto",
                isRecurring && isActive && "ms-auto"
              )}
            >
              {isRecurring && <Repeat className="w-3.5 h-3.5" />}
              {t(TAB_LABEL[key])}
            </button>
          );
        })}
      </div>

      {/* ── Panel ─────────────────────────────────────────────────────────── */}
      {tab === "recurring" ? (
        <RecurringSchedulesPanel />
      ) : (
        <VisitsPanel key={tab} tab={tab} onAdd={() => setShowCreate(true)} />
      )}

      {/* ── Create modal (visits only) ────────────────────────────────────── */}
      {showCreate && <VisitCreateModal onClose={() => setShowCreate(false)} />}
    </>
  );
}

// `useSearchParams` needs a Suspense boundary in the App Router.
export default function VisitsPage() {
  return (
    <Suspense fallback={<div className="space-y-3">{[...Array(3)].map((_, i) => <SkeletonCard key={i} />)}</div>}>
      <VisitsWorkspace />
    </Suspense>
  );
}
