"use client";

import { useState, useCallback, useMemo } from "react";
import { Download, ChevronDown, ChevronUp, ShieldCheck, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { riyadhToday, startOfMonthIso } from "@/lib/utils/date";
import { useTranslation, type TranslationFn } from "@/hooks/use-translation";
import type { TranslationKey } from "@/lib/i18n/translations";
import {
  useVisitsReport,
  useMerchReport,
  useBranchReport,
  useProductReport,
  useGpsReport,
  useReportSummary,
  type DateRange,
  type ReportFilters,
  type ReportSummary,
  type LastVisitBucket,
} from "@/hooks/use-reports";
import { useCompanyUsers } from "@/hooks/use-company-users";
import { usePlaces } from "@/hooks/use-places";
import { memberDisplayName } from "@/services/company-users";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Default report window: the 1st of the current month → today, on the Riyadh
 * business day. Using toISOString() here previously produced a `from` in the
 * PREVIOUS month (local midnight converts back a day in UTC+3) and a `to` of
 * yesterday during the small hours, which excluded today's visits from every
 * report.
 */
function thisMonthRange(): DateRange {
  const today = riyadhToday();
  return { from: startOfMonthIso(today), to: today };
}

type SortDir = "asc" | "desc";

function useSortedData<T extends object>(
  data: T[]
): { sorted: T[]; sortKey: keyof T | null; sortDir: SortDir; toggleSort: (k: keyof T) => void } {
  const [sortKey, setSortKey] = useState<keyof T | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  function toggleSort(k: keyof T) {
    if (sortKey === k) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(k);
      setSortDir("desc");
    }
  }

  const sorted = [...data].sort((a, b) => {
    if (!sortKey) return 0;
    const av = a[sortKey];
    const bv = b[sortKey];
    if (typeof av === "number" && typeof bv === "number") {
      return sortDir === "asc" ? av - bv : bv - av;
    }
    return sortDir === "asc"
      ? String(av).localeCompare(String(bv))
      : String(bv).localeCompare(String(av));
  });

  return { sorted, sortKey, sortDir, toggleSort };
}

// ─── Pagination hook ──────────────────────────────────────────────────────────

const PAGE_SIZE = 50;

function usePagination<T>(data: T[]) {
  const [page, setPage] = useState(0);
  const totalPages = Math.max(1, Math.ceil(data.length / PAGE_SIZE));
  const slice = data.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  // Reset to page 0 when data changes
  const reset = useCallback(() => setPage(0), []);

  return { slice, page, setPage, totalPages, reset };
}

// ─── Excel export ─────────────────────────────────────────────────────────────

/**
 * One sheet of headline numbers and the filters that produced them, written
 * ahead of the data sheet.
 *
 * Without it an exported file is a bare grid: a week later nobody can tell
 * which window it covered or whether it was filtered to one merchandiser, and
 * a filtered export is indistinguishable from a complete one.
 */
export interface ExportMeta {
  sheetName: string;
  rows:      Record<string, unknown>[];
  dataSheet: string;
}

async function exportXlsx(
  rows: Record<string, unknown>[],
  filename: string,
  meta?: ExportMeta,
) {
  const XLSX = await import("xlsx");
  const wb   = XLSX.utils.book_new();

  if (meta) {
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(meta.rows),
      meta.sheetName,
    );
  }

  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(rows),
    meta?.dataSheet ?? "Report",
  );

  XLSX.writeFile(wb, `${filename}.xlsx`);
}

// ─── Summary cards ────────────────────────────────────────────────────────────

/**
 * One headline figure. `hint` carries the denominator that makes the number
 * mean something — "8 branches covered" is noise until you know it is 8 of 40.
 */
function SummaryCard({
  label, value, hint, tone = "plain", loading,
}: {
  label:   string;
  value:   string;
  hint?:   string;
  tone?:   "plain" | "good" | "warn" | "bad";
  loading: boolean;
}) {
  const toneCls =
    tone === "good" ? "text-emerald-600" :
    tone === "warn" ? "text-amber-600"   :
    tone === "bad"  ? "text-rose-600"    :
                      "text-ink-900";

  return (
    <div className="bg-white rounded-xl border border-ink-100 px-3.5 py-3">
      <p className="text-[11px] font-semibold text-ink-400 leading-tight">{label}</p>
      {loading ? (
        <div className="mt-1.5 h-6 w-14 rounded-md bg-ink-100 animate-pulse" />
      ) : (
        <p className={cn("mt-0.5 text-[20px] font-bold leading-tight", toneCls)}>{value}</p>
      )}
      {hint && !loading && (
        <p className="mt-0.5 text-[10.5px] text-ink-400 leading-tight">{hint}</p>
      )}
    </div>
  );
}

function SummaryCards({
  summary, isLoading, t,
}: { summary?: ReportSummary; isLoading: boolean; t: TranslationFn }) {
  const s = summary;
  const num = (n: number | undefined) => (n == null ? "—" : String(n));

  // Completion rate is only reassuring above 80; below half it is a problem.
  const rateTone: "good" | "warn" | "bad" =
    !s ? "warn" : s.completion_rate >= 80 ? "good" : s.completion_rate >= 50 ? "warn" : "bad";

  return (
    <div>
      <p className="text-[12px] font-semibold text-ink-500 mb-2">{t("reports.summaryTitle")}</p>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2.5">
        <SummaryCard
          loading={isLoading}
          label={t("reports.sum.totalVisits")}
          value={num(s?.total_visits)}
        />
        <SummaryCard
          loading={isLoading}
          label={t("reports.sum.completed")}
          value={num(s?.completed)}
          tone="good"
        />
        <SummaryCard
          loading={isLoading}
          label={t("reports.sum.missed")}
          value={num(s?.missed)}
          tone={s && s.missed > 0 ? "bad" : "plain"}
        />
        <SummaryCard
          loading={isLoading}
          label={t("reports.sum.pending")}
          value={num(s?.pending)}
        />
        <SummaryCard
          loading={isLoading}
          label={t("reports.sum.rate")}
          value={s ? `${s.completion_rate}%` : "—"}
          tone={rateTone}
        />
        <SummaryCard
          loading={isLoading}
          label={t("reports.sum.activeMerch")}
          value={num(s?.active_merchandisers)}
        />
        <SummaryCard
          loading={isLoading}
          label={t("reports.sum.coveredBranches")}
          value={num(s?.covered_branches)}
          hint={s ? t("reports.sum.ofScheduled").replace("{count}", String(s.scheduled_branches)) : undefined}
        />
        <SummaryCard
          loading={isLoading}
          label={t("reports.sum.avgDuration")}
          value={s ? durationLabel(s.avg_duration, t) : "—"}
        />
        {/* Products short on shelf. When no audit happened the figure is
            unknown, not zero — a confident 0 would read as "all good". */}
        <SummaryCard
          loading={isLoading}
          label={t("reports.sum.productIssues")}
          value={
            !s ? "—"
            : s.products_with_shortfall == null ? t("reports.sum.noAudits")
            : String(s.products_with_shortfall)
          }
          tone={s && (s.products_with_shortfall ?? 0) > 0 ? "bad" : "plain"}
          hint={
            s && s.audited_products != null
              ? t("reports.sum.ofAudited").replace("{count}", String(s.audited_products))
              : s && s.products_with_shortfall == null
                ? t("reports.sum.noAuditsHint")
                : undefined
          }
        />
      </div>
    </div>
  );
}

// ─── Shared UI atoms ──────────────────────────────────────────────────────────

function SortTh<T>({
  col, label, sortKey, sortDir, onSort, align = "start",
}: {
  col: keyof T; label: string; sortKey: keyof T | null; sortDir: SortDir;
  onSort: (k: keyof T) => void; align?: "start" | "center" | "end";
}) {
  const active = sortKey === col;
  return (
    <th
      className={cn(
        "py-2.5 font-semibold text-ink-500 cursor-pointer select-none hover:text-ink-800 transition-colors",
        align === "start" ? "text-start ps-4" : align === "end" ? "text-end pe-4" : "text-center px-3"
      )}
      onClick={() => onSort(col)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {active
          ? sortDir === "asc" ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />
          : <ChevronDown className="w-3 h-3 opacity-0 group-hover:opacity-50" />}
      </span>
    </th>
  );
}

function EmptyRow({ cols, message }: { cols: number; message: string }) {
  return (
    <tr>
      <td colSpan={cols} className="py-10 text-center text-[13px] text-ink-400">{message}</td>
    </tr>
  );
}

function LoadingRow({ cols }: { cols: number }) {
  return (
    <tr>
      <td colSpan={cols} className="py-10 text-center text-[13px] text-ink-400">
        <span className="animate-pulse">⋯</span>
      </td>
    </tr>
  );
}

function RateBadge({ rate }: { rate: number }) {
  const cls =
    rate >= 80 ? "bg-emerald-100 text-emerald-700" :
    rate >= 50 ? "bg-amber-100 text-amber-700"     :
                 "bg-rose-100 text-rose-700";
  return (
    <span className={cn("px-2 py-0.5 rounded-full text-[11px] font-bold", cls)}>{rate}%</span>
  );
}

/** Visit statuses are stored as English DB enums — always render them through
 *  the shared `visits.status.*` labels, never as the raw value. */
const STATUS_LABEL_KEY: Record<string, TranslationKey> = {
  completed:  "visits.status.completed",
  inprogress: "visits.status.inprogress",
  pending:    "visits.status.pending",
  missed:     "visits.status.missed",
};

function statusLabel(status: string, t: TranslationFn): string {
  const key = STATUS_LABEL_KEY[status];
  return key ? t(key) : status;
}

/** "45 د" / "45 min" — never the bare English "45m". */
function durationLabel(minutes: number, t: TranslationFn): string {
  return minutes > 0 ? `${minutes} ${t("common.minutesShort")}` : "—";
}

function StatusBadge({ status }: { status: string }) {
  const { t } = useTranslation();
  const map: Record<string, string> = {
    completed:  "bg-emerald-100 text-emerald-700",
    inprogress: "bg-blue-100 text-blue-700",
    pending:    "bg-amber-100 text-amber-700",
    missed:     "bg-rose-100 text-rose-700",
  };
  return (
    <span className={cn("px-2.5 py-0.5 rounded-full text-[11px] font-semibold", map[status] ?? "bg-ink-100 text-ink-500")}>
      {statusLabel(status, t)}
    </span>
  );
}

function Pagination({
  page, totalPages, total, pageSize, onPage,
}: {
  page: number; totalPages: number; total: number; pageSize: number; onPage: (p: number) => void;
}) {
  if (totalPages <= 1) return null;
  const from = page * pageSize + 1;
  const to   = Math.min((page + 1) * pageSize, total);
  return (
    <div className="flex items-center justify-between px-4 py-3 border-t border-ink-100">
      <span className="text-[11.5px] text-ink-400">{from}–{to} / {total}</span>
      <div className="flex items-center gap-1">
        <button
          onClick={() => onPage(page - 1)}
          disabled={page === 0}
          className="w-7 h-7 rounded-lg border border-ink-200 flex items-center justify-center text-ink-500 hover:bg-ink-50 disabled:opacity-30 transition-all"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
        </button>
        <span className="text-[12px] text-ink-600 font-semibold px-2">{page + 1} / {totalPages}</span>
        <button
          onClick={() => onPage(page + 1)}
          disabled={page >= totalPages - 1}
          className="w-7 h-7 rounded-lg border border-ink-200 flex items-center justify-center text-ink-500 hover:bg-ink-50 disabled:opacity-30 transition-all"
        >
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

// ─── Tab components ───────────────────────────────────────────────────────────

function VisitsTab({ range, locale, filters, meta }: { range: DateRange; locale: string; filters: ReportFilters; meta?: ExportMeta }) {
  const { t }                                     = useTranslation();
  const { data = [], isLoading }                  = useVisitsReport(range, filters);
  const { sorted, sortKey, sortDir, toggleSort }  = useSortedData(data);
  const { slice, page, setPage, totalPages }      = usePagination(sorted);
  type Row = (typeof data)[number];

  const isAr = locale === "ar";

  async function doExport() {
    const rows = sorted.map((r) => ({
      [t("reports.col.date")]:     r.scheduled_date,
      [t("reports.col.branch")]:   isAr ? r.branch_ar : r.branch_en,
      [t("reports.col.chain")]:    isAr ? r.chain_ar  : r.chain_en,
      [t("reports.col.merch")]:    r.merch_name,
      [t("reports.col.status")]:   statusLabel(r.status, t),
      [t("reports.col.duration")]: r.duration_minutes || "",
    }));
    await exportXlsx(rows, `visits-${range.from}-${range.to}`, meta);
  }

  return (
    <>
      <div className="flex justify-end px-4 pt-3">
        <button
          onClick={doExport}
          disabled={data.length === 0 || isLoading}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-ink-200 text-[12px] text-ink-600 hover:bg-ink-50 disabled:opacity-40 transition-all"
        >
          <Download className="w-3.5 h-3.5" />
          {t("reports.export")}
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="border-b border-ink-100 bg-ink-50/50">
              <SortTh<Row> col="scheduled_date"  label={t("reports.col.date")}     sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
              <SortTh<Row> col="branch_ar"       label={t("reports.col.branch")}   sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
              <SortTh<Row> col="chain_ar"        label={t("reports.col.chain")}    sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
              <SortTh<Row> col="merch_name"      label={t("reports.col.merch")}    sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
              <th className="text-center px-3 py-2.5 font-semibold text-ink-500">{t("reports.col.status")}</th>
              <SortTh<Row> col="duration_minutes" label={t("reports.col.duration")} sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="end" />
            </tr>
          </thead>
          <tbody>
            {isLoading && <LoadingRow cols={7} />}
            {!isLoading && sorted.length === 0 && <EmptyRow cols={7} message={t("reports.noData")} />}
            {!isLoading && slice.map((r, i) => (
              <tr key={r.id} className={cn(i > 0 && "border-t border-ink-50")}>
                <td className="ps-4 py-2.5 text-ink-600 font-mono text-[11.5px]">{r.scheduled_date}</td>
                <td className="px-3 py-2.5">
                  <p className="font-semibold text-ink-800">{isAr ? r.branch_ar : r.branch_en}</p>
                  <p className="text-[11px] text-ink-400">{r.branch_code}</p>
                </td>
                <td className="px-3 py-2.5 text-ink-600">{isAr ? r.chain_ar : r.chain_en}</td>
                <td className="px-3 py-2.5 text-ink-700">{r.merch_name}</td>
                <td className="text-center px-3 py-2.5"><StatusBadge status={r.status} /></td>
                <td className="text-end pe-4 py-2.5 text-ink-600">
                  {durationLabel(r.duration_minutes, t)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination page={page} totalPages={totalPages} total={sorted.length} pageSize={PAGE_SIZE} onPage={setPage} />
    </>
  );
}

function MerchTab({ range, locale, filters, meta }: { range: DateRange; locale: string; filters: ReportFilters; meta?: ExportMeta }) {
  const { t }                                    = useTranslation();
  const { data = [], isLoading }                 = useMerchReport(range, filters);
  const { sorted, sortKey, sortDir, toggleSort } = useSortedData(data);
  type Row = (typeof data)[number];

  async function doExport() {
    const rows = sorted.map((r) => ({
      [t("reports.col.merch")]:       r.full_name,
      [t("reports.col.total")]:       r.total_visits,
      [t("reports.col.completed")]:   r.completed,
      [t("reports.col.missed")]:      r.missed,
      [t("reports.col.rate")]:        `${r.completion_rate}%`,
      [t("reports.col.avgDuration")]: r.avg_duration || "",
    }));
    await exportXlsx(rows, `merch-${range.from}-${range.to}`, meta);
  }

  return (
    <>
      <div className="flex justify-end px-4 pt-3">
        <button
          onClick={doExport}
          disabled={data.length === 0 || isLoading}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-ink-200 text-[12px] text-ink-600 hover:bg-ink-50 disabled:opacity-40 transition-all"
        >
          <Download className="w-3.5 h-3.5" />
          {t("reports.export")}
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="border-b border-ink-100 bg-ink-50/50">
              <SortTh<Row> col="full_name"       label={t("reports.col.merch")}       sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
              <SortTh<Row> col="total_visits"    label={t("reports.col.total")}       sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="center" />
              <SortTh<Row> col="completed"       label={t("reports.col.completed")}   sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="center" />
              <SortTh<Row> col="missed"          label={t("reports.col.missed")}      sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="center" />
              <SortTh<Row> col="completion_rate" label={t("reports.col.rate")}        sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="center" />
              <SortTh<Row> col="avg_duration"    label={t("reports.col.avgDuration")} sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="end" />
            </tr>
          </thead>
          <tbody>
            {isLoading && <LoadingRow cols={6} />}
            {!isLoading && sorted.length === 0 && <EmptyRow cols={6} message={t("reports.noData")} />}
            {!isLoading && sorted.map((r, i) => (
              <tr key={r.merch_id} className={cn(i > 0 && "border-t border-ink-50")}>
                <td className="ps-4 py-2.5 font-semibold text-ink-800">{r.full_name}</td>
                <td className="text-center px-3 py-2.5 font-bold text-ink-700">{r.total_visits}</td>
                <td className="text-center px-3 py-2.5 text-emerald-600 font-semibold">{r.completed}</td>
                <td className="text-center px-3 py-2.5 text-rose-500 font-semibold">{r.missed}</td>
                <td className="text-center px-3 py-2.5"><RateBadge rate={r.completion_rate} /></td>
                <td className="text-end pe-4 py-2.5 text-ink-600">
                  {durationLabel(r.avg_duration, t)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function BranchTab({ range, locale, filters, meta }: { range: DateRange; locale: string; filters: ReportFilters; meta?: ExportMeta }) {
  const { t }                                    = useTranslation();
  const { data = [], isLoading }                 = useBranchReport(range, filters);
  const { sorted, sortKey, sortDir, toggleSort } = useSortedData(data);
  const { slice, page, setPage, totalPages }     = usePagination(sorted);
  type Row = (typeof data)[number];
  const isAr = locale === "ar";

  async function doExport() {
    const rows = sorted.map((r) => ({
      [t("reports.col.branch")]:      isAr ? r.branch_ar : r.branch_en,
      [t("reports.col.chain")]:       isAr ? r.chain_ar  : r.chain_en,
      [t("reports.col.total")]:       r.total_visits,
      [t("reports.col.completed")]:   r.completed,
      [t("reports.col.missed")]:      r.missed,
      [t("reports.col.rate")]:        `${r.completion_rate}%`,
      [t("reports.col.avgDuration")]: r.avg_duration || "",
      [t("reports.col.lastVisit")]:   r.last_visit_date ?? t("reports.neverVisited"),
      [t("reports.col.daysSince")]:   r.days_since ?? "",
    }));
    await exportXlsx(rows, `branches-${range.from}-${range.to}`, meta);
  }

  return (
    <>
      <div className="flex justify-end px-4 pt-3">
        <button
          onClick={doExport}
          disabled={data.length === 0 || isLoading}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-ink-200 text-[12px] text-ink-600 hover:bg-ink-50 disabled:opacity-40 transition-all"
        >
          <Download className="w-3.5 h-3.5" />
          {t("reports.export")}
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="border-b border-ink-100 bg-ink-50/50">
              <SortTh<Row> col="branch_ar"       label={t("reports.col.branch")}      sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
              <SortTh<Row> col="chain_ar"        label={t("reports.col.chain")}       sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
              <SortTh<Row> col="total_visits"    label={t("reports.col.total")}       sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="center" />
              <SortTh<Row> col="completed"       label={t("reports.col.completed")}   sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="center" />
              <SortTh<Row> col="missed"          label={t("reports.col.missed")}      sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="center" />
              <SortTh<Row> col="completion_rate" label={t("reports.col.rate")}        sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="center" />
              <SortTh<Row> col="avg_duration"    label={t("reports.col.avgDuration")} sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="end" />
              <SortTh<Row> col="days_since"      label={t("reports.col.lastVisit")}   sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="end" />
            </tr>
          </thead>
          <tbody>
            {isLoading && <LoadingRow cols={8} />}
            {!isLoading && sorted.length === 0 && <EmptyRow cols={8} message={t("reports.noData")} />}
            {!isLoading && slice.map((r, i) => (
              <tr key={r.place_id} className={cn(i > 0 && "border-t border-ink-50")}>
                <td className="ps-4 py-2.5">
                  <p className="font-semibold text-ink-800">{isAr ? r.branch_ar : r.branch_en}</p>
                  <p className="text-[11px] text-ink-400 font-mono">{r.branch_code}</p>
                </td>
                <td className="px-3 py-2.5 text-ink-600">{isAr ? r.chain_ar : r.chain_en}</td>
                <td className="text-center px-3 py-2.5 font-bold text-ink-700">{r.total_visits}</td>
                <td className="text-center px-3 py-2.5 text-emerald-600 font-semibold">{r.completed}</td>
                <td className="text-center px-3 py-2.5 text-rose-500 font-semibold">{r.missed}</td>
                <td className="text-center px-3 py-2.5"><RateBadge rate={r.completion_rate} /></td>
                <td className="text-end px-3 py-2.5 text-ink-600">
                  {durationLabel(r.avg_duration, t)}
                </td>
                <td className="text-end pe-4 py-2.5">
                  {r.days_since == null ? (
                    <span className="inline-flex px-2 py-0.5 rounded-full bg-rose-50 text-rose-600 text-[11px] font-semibold">
                      {t("reports.neverVisited")}
                    </span>
                  ) : (
                    <>
                      <span
                        className={cn(
                          "inline-flex px-2 py-0.5 rounded-full text-[11px] font-semibold",
                          r.days_since > 14 ? "bg-amber-50 text-amber-700" : "bg-ink-100 text-ink-600"
                        )}
                      >
                        {r.days_since === 0
                          ? t("places.visitToday")
                          : r.days_since === 1
                            ? t("places.visitYesterday")
                            : t("places.visitDaysAgo").replace("{count}", String(r.days_since))}
                      </span>
                      <p className="mt-0.5 text-[10.5px] text-ink-400 font-mono">{r.last_visit_date}</p>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination page={page} totalPages={totalPages} total={sorted.length} pageSize={PAGE_SIZE} onPage={setPage} />
    </>
  );
}

function ProductTab({ range, locale, filters, meta }: { range: DateRange; locale: string; filters: ReportFilters; meta?: ExportMeta }) {
  const { t }                                    = useTranslation();
  const { data = [], isLoading }                 = useProductReport(range, filters);
  const { sorted, sortKey, sortDir, toggleSort } = useSortedData(data);
  type Row = (typeof data)[number];
  const isAr = locale === "ar";

  async function doExport() {
    const rows = sorted.map((r) => ({
      [t("reports.col.product")]:      isAr ? r.name_ar : r.name_en,
      [t("reports.col.sku")]:          r.sku,
      [t("reports.col.audited")]:      r.audited_count,
      [t("reports.col.found")]:        r.found_count,
      [t("reports.col.missing")]:      r.missing_count,
      [t("reports.col.availability")]: `${r.availability_pct}%`,
      [t("reports.col.totalMissing")]: r.total_missing,
    }));
    await exportXlsx(rows, `products-${range.from}-${range.to}`, meta);
  }

  return (
    <>
      <div className="flex justify-end px-4 pt-3">
        <button
          onClick={doExport}
          disabled={data.length === 0 || isLoading}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-ink-200 text-[12px] text-ink-600 hover:bg-ink-50 disabled:opacity-40 transition-all"
        >
          <Download className="w-3.5 h-3.5" />
          {t("reports.export")}
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="border-b border-ink-100 bg-ink-50/50">
              <SortTh<Row> col="name_ar"          label={t("reports.col.product")}      sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
              <th className="text-center px-3 py-2.5 font-semibold text-ink-500">{t("reports.col.sku")}</th>
              <SortTh<Row> col="audited_count"    label={t("reports.col.audited")}      sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="center" />
              <SortTh<Row> col="found_count"      label={t("reports.col.found")}        sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="center" />
              <SortTh<Row> col="missing_count"    label={t("reports.col.missing")}      sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="center" />
              <SortTh<Row> col="availability_pct" label={t("reports.col.availability")} sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="center" />
              <SortTh<Row> col="total_missing"    label={t("reports.col.totalMissing")} sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="end" />
            </tr>
          </thead>
          <tbody>
            {isLoading && <LoadingRow cols={7} />}
            {!isLoading && sorted.length === 0 && <EmptyRow cols={7} message={t("reports.noData")} />}
            {!isLoading && sorted.map((r, i) => (
              <tr key={r.product_id} className={cn(i > 0 && "border-t border-ink-50")}>
                <td className="ps-4 py-2.5">
                  <p className="font-semibold text-ink-800">{isAr ? r.name_ar : r.name_en}</p>
                  <p className="text-[11px] text-ink-400">{isAr ? r.name_en : r.name_ar}</p>
                </td>
                <td className="text-center px-3 py-2.5 font-mono text-[11.5px] text-ink-500">{r.sku}</td>
                <td className="text-center px-3 py-2.5 font-bold text-ink-700">{r.audited_count}</td>
                <td className="text-center px-3 py-2.5 text-emerald-600 font-semibold">{r.found_count}</td>
                <td className="text-center px-3 py-2.5 text-rose-500 font-semibold">{r.missing_count}</td>
                <td className="text-center px-3 py-2.5"><RateBadge rate={r.availability_pct} /></td>
                <td className="text-end pe-4 py-2.5">
                  {r.total_missing > 0 ? (
                    <span className="px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 font-bold text-[11px]">
                      {r.total_missing}
                    </span>
                  ) : (
                    <span className="text-ink-400">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function GpsTab({ range, filters, meta }: { range: DateRange; filters: ReportFilters; meta?: ExportMeta }) {
  const { t }                                    = useTranslation();
  const { data = [], isLoading }                 = useGpsReport(range, filters);
  const { sorted, sortKey, sortDir, toggleSort } = useSortedData(data);
  type Row = (typeof data)[number];

  async function doExport() {
    const rows = sorted.map((r) => ({
      [t("reports.col.merch")]:       r.full_name,
      [t("reports.col.totalStarted")]:r.total_started,
      [t("reports.col.gpsVerified")]:     r.gps_verified,
      [t("reports.col.gpsOutside")]:      r.gps_outside,
      [t("reports.col.gpsNotRecorded")]:  r.gps_not_recorded,
      [t("reports.col.noBranchCoords")]:  r.no_branch_coords,
      // Empty, not 0%: a rate of zero would assert every check failed.
      [t("reports.col.gpsRate")]:         r.verification_rate === null ? "" : `${r.verification_rate}%`,
      [t("reports.col.avgDistance")]:     r.avg_distance ?? "",
    }));
    await exportXlsx(rows, `gps-compliance-${range.from}-${range.to}`, meta);
  }

  return (
    <>
      <div className="flex items-center justify-between px-4 pt-3">
        {/* Brief description */}
        <p className="text-[11.5px] text-ink-400 flex items-center gap-1.5">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
          <span>
            {t("reports.gpsDesc")}
            <span className="block text-[10.5px] text-ink-300">{t("reports.gpsRateHint")}</span>
          </span>
        </p>
        <button
          onClick={doExport}
          disabled={data.length === 0 || isLoading}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-ink-200 text-[12px] text-ink-600 hover:bg-ink-50 disabled:opacity-40 transition-all"
        >
          <Download className="w-3.5 h-3.5" />
          {t("reports.export")}
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="border-b border-ink-100 bg-ink-50/50">
              <SortTh<Row> col="full_name"         label={t("reports.col.merch")}        sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
              <SortTh<Row> col="total_started"     label={t("reports.col.totalStarted")} sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="center" />
              <SortTh<Row> col="gps_verified"      label={t("reports.col.gpsVerified")}  sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="center" />
              <SortTh<Row> col="gps_outside"       label={t("reports.col.gpsOutside")}     sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="center" />
              <SortTh<Row> col="gps_not_recorded"  label={t("reports.col.gpsNotRecorded")} sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="center" />
              <SortTh<Row> col="verification_rate" label={t("reports.col.gpsRate")}        sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="center" />
              <SortTh<Row> col="avg_distance"      label={t("reports.col.avgDistance")}  sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="end" />
            </tr>
          </thead>
          <tbody>
            {isLoading && <LoadingRow cols={6} />}
            {!isLoading && sorted.length === 0 && <EmptyRow cols={6} message={t("reports.noData")} />}
            {!isLoading && sorted.map((r, i) => (
              <tr key={r.merch_id} className={cn(i > 0 && "border-t border-ink-50")}>
                <td className="ps-4 py-2.5 font-semibold text-ink-800">{r.full_name}</td>
                <td className="text-center px-3 py-2.5 font-bold text-ink-700">{r.total_started}</td>
                <td className="text-center px-3 py-2.5">
                  <span className="inline-flex items-center gap-1 text-emerald-600 font-semibold">
                    <ShieldCheck className="w-3 h-3" />
                    {r.gps_verified}
                  </span>
                </td>
                {/* A captured position that did not validate IS a failure. */}
                <td className={cn("text-center px-3 py-2.5 font-semibold", r.gps_outside > 0 ? "text-rose-500" : "text-ink-300")}>
                  {r.gps_outside}
                </td>
                {/* Nothing measured is not a failure, so it is not painted as one. */}
                <td className="text-center px-3 py-2.5">
                  <span className={cn("font-semibold", r.gps_not_recorded > 0 ? "text-ink-500" : "text-ink-300")}>
                    {r.gps_not_recorded}
                  </span>
                  {r.no_branch_coords > 0 && (
                    <span className="block text-[10.5px] text-amber-600 font-medium" title={t("reports.col.noBranchCoords")}>
                      {r.no_branch_coords} {t("reports.col.noBranchCoords")}
                    </span>
                  )}
                </td>
                <td className="text-center px-3 py-2.5">
                  {r.verification_rate === null
                    ? <span className="text-[11px] text-ink-400">{t("reports.gpsNoMeasurement")}</span>
                    : <RateBadge rate={r.verification_rate} />}
                </td>
                <td className="text-end pe-4 py-2.5 text-ink-600">
                  {r.avg_distance !== null ? `${r.avg_distance}m` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

const TABS = ["visits", "merch", "branch", "product", "gps"] as const;
type Tab   = (typeof TABS)[number];

export default function ReportsPage() {
  const { t, locale } = useTranslation();
  const dir           = locale === "ar" ? "rtl" : "ltr";

  const [range, setRange] = useState<DateRange>(thisMonthRange);
  const [draft, setDraft] = useState<DateRange>(thisMonthRange);
  const [tab,   setTab]   = useState<Tab>("visits");

  // ── Filters ───────────────────────────────────────────────────────────────
  const [merchId, setMerchId] = useState("");
  const [placeId, setPlaceId] = useState("");
  const [status,  setStatus]  = useState("");
  const [lastVisit, setLastVisit] = useState<"" | LastVisitBucket>("");

  const { data: members = [] } = useCompanyUsers();
  const { data: places  = [] } = usePlaces();

  const activeMembers = useMemo(
    () => members.filter((m) => m.status === "active"),
    [members],
  );

  // The status filter narrows the Visits tab only — the other four aggregate
  // by status, so pinning one value would blank their columns. Keeping it out
  // of the filter object elsewhere means the tabs and their exports agree.
  const filters: ReportFilters = useMemo(
    () => ({
      merchId: merchId || undefined,
      placeId: placeId || undefined,
      status:  tab === "visits" ? (status || undefined) : undefined,
      // Branch Coverage is the only per-branch report, so recency only narrows
      // there — same rule as status narrowing the Visits tab only.
      lastVisit: tab === "branch" ? (lastVisit || undefined) : undefined,
    }),
    [merchId, placeId, status, lastVisit, tab],
  );

  const filtersApplied = Boolean(merchId || placeId || status || lastVisit);

  function clearFilters() {
    setMerchId("");
    setPlaceId("");
    setStatus("");
    setLastVisit("");
    // The date range is deliberately left alone: it is a separate control with
    // its own Apply, and silently moving someone's reporting window while they
    // think they are clearing a merchandiser is worse than leaving it set.
  }

  const LAST_VISIT_OPTIONS: { value: LastVisitBucket; key: TranslationKey }[] = [
    { value: "never", key: "reports.filter.lvNever" },
    { value: "le7",   key: "reports.filter.lvLe7"   },
    { value: "le14",  key: "reports.filter.lvLe14"  },
    { value: "gt14",  key: "reports.filter.lvGt14"  },
    { value: "gt30",  key: "reports.filter.lvGt30"  },
  ];

  const lastVisitLabel = lastVisit
    ? t(LAST_VISIT_OPTIONS.find((o) => o.value === lastVisit)!.key)
    : t("reports.exp.none");

  const summary = useReportSummary(range, filters);

  function applyRange() { setRange({ ...draft }); }

  // ── Export metadata ───────────────────────────────────────────────────────
  const merchLabel = merchId
    ? (activeMembers.find((m) => m.id === merchId)
        ? memberDisplayName(activeMembers.find((m) => m.id === merchId)!)
        : merchId)
    : t("reports.exp.none");

  const placeLabel = placeId
    ? (() => {
        const p = places.find((x) => x.id === placeId);
        if (!p) return placeId;
        return locale === "ar" ? p.branch_ar : p.branch_en;
      })()
    : t("reports.exp.none");

  const exportMeta: ExportMeta | undefined = summary.data
    ? {
        sheetName: t("reports.exp.sheetSummary"),
        dataSheet: t("reports.exp.sheetData"),
        rows: [
          { [t("reports.exp.metric")]: t("reports.exp.range"),        [t("reports.exp.value")]: `${range.from} → ${range.to}` },
          { [t("reports.exp.metric")]: t("reports.exp.filterMerch"),  [t("reports.exp.value")]: merchLabel },
          { [t("reports.exp.metric")]: t("reports.exp.filterBranch"), [t("reports.exp.value")]: placeLabel },
          { [t("reports.exp.metric")]: t("reports.exp.filterStatus"), [t("reports.exp.value")]: status ? statusLabel(status, t) : t("reports.exp.none") },
          { [t("reports.exp.metric")]: t("reports.exp.filterLastVisit"), [t("reports.exp.value")]: lastVisitLabel },
          { [t("reports.exp.metric")]: t("reports.sum.totalVisits"),     [t("reports.exp.value")]: summary.data.total_visits },
          { [t("reports.exp.metric")]: t("reports.sum.completed"),       [t("reports.exp.value")]: summary.data.completed },
          { [t("reports.exp.metric")]: t("reports.sum.missed"),          [t("reports.exp.value")]: summary.data.missed },
          { [t("reports.exp.metric")]: t("reports.sum.pending"),         [t("reports.exp.value")]: summary.data.pending },
          { [t("reports.exp.metric")]: t("reports.sum.rate"),            [t("reports.exp.value")]: `${summary.data.completion_rate}%` },
          { [t("reports.exp.metric")]: t("reports.sum.activeMerch"),     [t("reports.exp.value")]: summary.data.active_merchandisers },
          { [t("reports.exp.metric")]: t("reports.sum.coveredBranches"), [t("reports.exp.value")]: `${summary.data.covered_branches} / ${summary.data.scheduled_branches}` },
          { [t("reports.exp.metric")]: t("reports.sum.avgDuration"),     [t("reports.exp.value")]: durationLabel(summary.data.avg_duration, t) },
          {
            [t("reports.exp.metric")]: t("reports.sum.productIssues"),
            [t("reports.exp.value")]: summary.data.products_with_shortfall == null
              ? t("reports.sum.noAudits")
              : summary.data.products_with_shortfall,
          },
        ],
      }
    : undefined;

  const tabLabel: Record<Tab, string> = {
    visits:  t("reports.tab.visits"),
    merch:   t("reports.tab.merch"),
    branch:  t("reports.tab.branch"),
    product: t("reports.tab.product"),
    gps:     t("reports.tab.gps"),
  };

  return (
    <div className="space-y-5 pb-10" dir={dir}>

      {/* Header */}
      <div>
        <h1 className="text-[22px] font-bold text-ink-900">{t("reports.title")}</h1>
        <p className="text-ink-500 text-[13px] mt-0.5">{t("reports.subtitle")}</p>
      </div>

      {/* Date range filter */}
      <div className="bg-white rounded-2xl border border-ink-100 shadow-sm px-4 py-3 flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-[11.5px] font-semibold text-ink-500">{t("reports.dateFrom")}</label>
          <input
            type="date"
            value={draft.from}
            onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value }))}
            className="h-9 px-3 rounded-xl border border-ink-200 bg-white text-[13px] text-ink-800 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-50 transition-all"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[11.5px] font-semibold text-ink-500">{t("reports.dateTo")}</label>
          <input
            type="date"
            value={draft.to}
            onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))}
            className="h-9 px-3 rounded-xl border border-ink-200 bg-white text-[13px] text-ink-800 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-50 transition-all"
          />
        </div>
        <button
          onClick={applyRange}
          className="h-9 px-4 rounded-xl bg-brand-500 hover:bg-brand-600 text-white text-[13px] font-semibold shadow-pop transition-all"
        >
          {t("reports.apply")}
        </button>
        <p className="text-[11.5px] text-ink-400 self-end pb-1" dir="ltr">
          {range.from} → {range.to}
        </p>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-2xl border border-ink-100 shadow-sm px-4 py-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1 min-w-[160px]">
            <label className="text-[11.5px] font-semibold text-ink-500">{t("reports.filter.merch")}</label>
            <select
              value={merchId}
              onChange={(e) => setMerchId(e.target.value)}
              className="h-9 px-3 rounded-xl border border-ink-200 bg-white text-[13px] text-ink-800 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-50 transition-all cursor-pointer"
            >
              <option value="">{t("reports.filter.allMerch")}</option>
              {activeMembers.map((m) => (
                <option key={m.id} value={m.id}>{memberDisplayName(m)}</option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1 min-w-[160px]">
            <label className="text-[11.5px] font-semibold text-ink-500">{t("reports.filter.branch")}</label>
            <select
              value={placeId}
              onChange={(e) => setPlaceId(e.target.value)}
              className="h-9 px-3 rounded-xl border border-ink-200 bg-white text-[13px] text-ink-800 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-50 transition-all cursor-pointer"
            >
              <option value="">{t("reports.filter.allBranches")}</option>
              {places.map((p) => (
                <option key={p.id} value={p.id}>
                  {locale === "ar" ? p.branch_ar : p.branch_en}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1 min-w-[150px]">
            <label className="text-[11.5px] font-semibold text-ink-500">{t("reports.filter.status")}</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              disabled={tab !== "visits"}
              className={cn(
                "h-9 px-3 rounded-xl border border-ink-200 bg-white text-[13px] text-ink-800 outline-none transition-all cursor-pointer",
                "focus:border-brand-500 focus:ring-2 focus:ring-brand-50",
                "disabled:opacity-50 disabled:cursor-not-allowed"
              )}
            >
              <option value="">{t("reports.filter.allStatuses")}</option>
              {(["pending", "inprogress", "completed", "missed"] as const).map((s) => (
                <option key={s} value={s}>{statusLabel(s, t)}</option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1 min-w-[190px]">
            <label className="text-[11.5px] font-semibold text-ink-500">{t("reports.filter.lastVisit")}</label>
            <select
              value={lastVisit}
              onChange={(e) => setLastVisit(e.target.value as "" | LastVisitBucket)}
              disabled={tab !== "branch"}
              className={cn(
                "h-9 px-3 rounded-xl border border-ink-200 bg-white text-[13px] text-ink-800 outline-none transition-all cursor-pointer",
                "focus:border-brand-500 focus:ring-2 focus:ring-brand-50",
                "disabled:opacity-50 disabled:cursor-not-allowed"
              )}
            >
              <option value="">{t("reports.filter.lvAll")}</option>
              {LAST_VISIT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{t(o.key)}</option>
              ))}
            </select>
          </div>

          {filtersApplied && (
            <button
              onClick={clearFilters}
              className="h-9 px-4 rounded-xl border border-ink-200 text-[12.5px] font-semibold text-ink-600 hover:bg-ink-50 transition-all"
            >
              {t("reports.filter.clear")}
            </button>
          )}
        </div>

        {tab !== "visits" && status && (
          <p className="mt-2 text-[11px] text-amber-600">{t("reports.filter.statusNote")}</p>
        )}
        {tab !== "branch" && lastVisit && (
          <p className="mt-1 text-[11px] text-amber-600">{t("reports.filter.lvNote")}</p>
        )}
        {tab === "branch" && (
          <p className="mt-2 text-[11px] text-ink-400">{t("reports.filter.lvHint")}</p>
        )}
      </div>

      {/* Period summary */}
      <SummaryCards summary={summary.data} isLoading={summary.isLoading} t={t} />

      {/* Tab strip */}
      <div className="flex gap-1 bg-ink-100/60 p-1 rounded-xl w-fit overflow-x-auto max-w-full">
        {TABS.map((tb) => (
          <button
            key={tb}
            onClick={() => setTab(tb)}
            className={cn(
              "px-3 h-8 rounded-lg text-[12.5px] font-semibold transition-all whitespace-nowrap",
              tb === "gps" && "flex items-center gap-1",
              tab === tb ? "bg-white text-ink-900 shadow-sm" : "text-ink-500 hover:text-ink-800"
            )}
          >
            {tb === "gps" && <ShieldCheck className="w-3 h-3" />}
            {tabLabel[tb]}
          </button>
        ))}
      </div>

      {/* Table card */}
      <div className="bg-white rounded-2xl border border-ink-100 shadow-sm overflow-hidden">
        {tab === "visits"  && <VisitsTab  range={range} locale={locale} filters={filters} meta={exportMeta} />}
        {tab === "merch"   && <MerchTab   range={range} locale={locale} filters={filters} meta={exportMeta} />}
        {tab === "branch"  && <BranchTab  range={range} locale={locale} filters={filters} meta={exportMeta} />}
        {tab === "product" && <ProductTab range={range} locale={locale} filters={filters} meta={exportMeta} />}
        {tab === "gps"     && <GpsTab     range={range} filters={filters} meta={exportMeta} />}
      </div>

    </div>
  );
}
