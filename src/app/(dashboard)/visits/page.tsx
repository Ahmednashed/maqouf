"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
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
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useTranslation, type TranslationFn } from "@/hooks/use-translation";
import { useVisits, useStartVisit, useMarkMissed } from "@/hooks/use-visits";
import { useCompanyUsers } from "@/hooks/use-company-users";
import { usePlaces } from "@/hooks/use-places";
import type { VisitWithDetails } from "@/services/visits";
import type { VisitStatus } from "@/types";
import { VisitCreateModal } from "./_components/VisitCreateModal";

// ─── Status config ────────────────────────────────────────────────────────────

const STATUS_TABS: Array<{ value: VisitStatus | "all"; colorClass: string }> = [
  { value: "all",        colorClass: "bg-ink-100 text-ink-600" },
  { value: "pending",    colorClass: "bg-amber-50 text-amber-700" },
  { value: "inprogress", colorClass: "bg-blue-50 text-blue-700" },
  { value: "completed",  colorClass: "bg-emerald-50 text-emerald-700" },
  { value: "missed",     colorClass: "bg-rose-50 text-rose-600" },
];

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

function EmptyState({ onAdd, t }: { onAdd: () => void; t: TranslationFn }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="w-16 h-16 rounded-2xl bg-ink-100 flex items-center justify-center mb-4">
        <ClipboardList className="w-8 h-8 text-ink-300" />
      </div>
      <h3 className="text-[15px] font-semibold text-ink-700 mb-1">
        {t("visits.emptyTitle")}
      </h3>
      <p className="text-[13px] text-ink-400 mb-6 max-w-xs">
        {t("visits.emptyDesc")}
      </p>
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
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="w-14 h-14 rounded-2xl bg-rose-50 flex items-center justify-center mb-4">
        <AlertCircle className="w-7 h-7 text-rose-400" />
      </div>
      <p className="text-[13px] text-rose-500">{message}</p>
    </div>
  );
}

// ─── Skeleton card ────────────────────────────────────────────────────────────

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
          <span
            className={cn(
              "inline-flex items-center px-2.5 py-1 rounded-full text-[11.5px] font-semibold border shrink-0",
              statusBadgeCls(visit.status)
            )}
          >
            {t(statusKey)}
          </span>
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

// ─── Main page ────────────────────────────────────────────────────────────────

export default function VisitsPage() {
  const { t, locale }  = useTranslation();
  const dateLabel       = useDateLabel();

  // ── Filters ─────────────────────────────────────────────────────────────────
  const [statusFilter, setStatusFilter] = useState<VisitStatus | "all">("all");
  const [merchFilter,  setMerchFilter]  = useState("");
  const [placeFilter,  setPlaceFilter]  = useState("");
  const [dateFilter,   setDateFilter]   = useState("");
  const [showCreate,   setShowCreate]   = useState(false);

  // ── Data ────────────────────────────────────────────────────────────────────
  const { data: visits = [], isLoading, isError, error } = useVisits({
    status:    statusFilter,
    merch_id:  merchFilter  || undefined,
    place_id:  placeFilter  || undefined,
    date_from: dateFilter   || undefined,
    date_to:   dateFilter   || undefined,
  });

  const { data: members = [] } = useCompanyUsers();
  const { data: places  = [] } = usePlaces();

  // ── Mutations ────────────────────────────────────────────────────────────────
  const startMutation  = useStartVisit();
  const missedMutation = useMarkMissed();

  // ── Group visits by scheduled_date ──────────────────────────────────────────
  const grouped = useMemo(() => {
    const groups: Record<string, VisitWithDetails[]> = {};
    visits.forEach((v) => {
      if (!groups[v.scheduled_date]) groups[v.scheduled_date] = [];
      groups[v.scheduled_date].push(v);
    });
    return Object.entries(groups).sort(([a], [b]) => b.localeCompare(a));
  }, [visits]);

  const totalCount = visits.length;

  const selectCls =
    "h-9 ps-3 pe-8 rounded-lg border border-ink-200 bg-ink-50 text-[13px] text-ink-700 outline-none focus:border-brand-400 focus:ring-1 focus:ring-brand-100 transition-all appearance-none";

  return (
    <>
      {/* ── Page header ──────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-[24px] font-bold text-ink-900 flex items-center gap-2.5">
            <ClipboardList className="w-6 h-6 text-brand-500" />
            {t("visits.pageTitle")}
          </h1>
          <p className="text-[13px] text-ink-400 mt-0.5">
            {t("visits.pageSubtitle")}
          </p>
        </div>

        <button
          onClick={() => setShowCreate(true)}
          className="inline-flex items-center gap-2 h-10 px-5 rounded-xl bg-brand-500 hover:bg-brand-600 text-white text-[13.5px] font-semibold shadow-pop transition-all shrink-0"
        >
          <Plus className="w-4 h-4" />
          {t("visits.add")}
        </button>
      </div>

      {/* ── Status tabs ──────────────────────────────────────────────────── */}
      <div className="flex gap-1.5 mb-4 overflow-x-auto pb-1 -mx-1 px-1">
        {STATUS_TABS.map(({ value, colorClass }) => {
          const labelKey = `visits.status.${value}` as const;
          const isActive = statusFilter === value;
          return (
            <button
              key={value}
              onClick={() => setStatusFilter(value)}
              className={cn(
                "h-8 px-4 rounded-full text-[12.5px] font-semibold whitespace-nowrap transition-all",
                isActive
                  ? cn(colorClass, "ring-2 ring-offset-1 ring-current")
                  : "bg-ink-100 text-ink-500 hover:bg-ink-200"
              )}
            >
              {t(labelKey)}
            </button>
          );
        })}
      </div>

      {/* ── Secondary filters ────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-2 mb-5">
        {/* Merch */}
        <div className="relative">
          <User className="absolute start-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink-400 pointer-events-none" />
          <select
            value={merchFilter}
            onChange={(e) => setMerchFilter(e.target.value)}
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

        {/* Branch */}
        <div className="relative">
          <MapPin className="absolute start-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink-400 pointer-events-none" />
          <select
            value={placeFilter}
            onChange={(e) => setPlaceFilter(e.target.value)}
            className={cn(selectCls, "ps-8")}
          >
            <option value="">{t("visits.allBranches")}</option>
            {places.map((p) => (
              <option key={p.id} value={p.id}>
                {p.branch_ar}
              </option>
            ))}
          </select>
          <ChevronDown className="absolute end-2 top-1/2 -translate-y-1/2 w-3 h-3 text-ink-400 pointer-events-none" />
        </div>

        {/* Date */}
        <div className="relative">
          <CalendarDays className="absolute start-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink-400 pointer-events-none" />
          <input
            type="date"
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value)}
            className={cn(selectCls, "ps-8 min-w-[150px]")}
          />
        </div>

        {/* Clear filters */}
        {(merchFilter || placeFilter || dateFilter || statusFilter !== "all") && (
          <button
            onClick={() => {
              setMerchFilter("");
              setPlaceFilter("");
              setDateFilter("");
              setStatusFilter("all");
            }}
            className="h-9 px-3 rounded-lg text-[12.5px] text-rose-500 hover:bg-rose-50 transition-all font-medium"
          >
            ✕ {t("common.filter")}
          </button>
        )}
      </div>

      {/* ── Stats pill ───────────────────────────────────────────────────── */}
      {!isLoading && !isError && totalCount > 0 && (
        <p className="text-[12px] text-ink-400 mb-4 font-medium">
          {t("visits.total").replace("{count}", String(totalCount))}
        </p>
      )}

      {/* ── Loading ──────────────────────────────────────────────────────── */}
      {isLoading && (
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => <SkeletonCard key={i} />)}
        </div>
      )}

      {/* ── Error ────────────────────────────────────────────────────────── */}
      {isError && (
        <div className="bg-white rounded-2xl border border-ink-100">
          <ErrorState message={(error as Error)?.message ?? t("common.noData")} />
        </div>
      )}

      {/* ── Empty ────────────────────────────────────────────────────────── */}
      {!isLoading && !isError && totalCount === 0 && (
        <div className="bg-white rounded-2xl border border-ink-100">
          <EmptyState onAdd={() => setShowCreate(true)} t={t} />
        </div>
      )}

      {/* ── Grouped visit cards ───────────────────────────────────────────── */}
      {!isLoading && !isError && totalCount > 0 && (
        <div className="space-y-6">
          {grouped.map(([date, dayVisits]) => (
            <section key={date}>
              {/* Date header */}
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
                    onStart={() => {
                      startMutation.mutate({ visitId: visit.id });
                    }}
                    onMarkMissed={() => missedMutation.mutate(visit.id)}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {/* ── Create modal ─────────────────────────────────────────────────── */}
      {showCreate && <VisitCreateModal onClose={() => setShowCreate(false)} />}
    </>
  );
}
