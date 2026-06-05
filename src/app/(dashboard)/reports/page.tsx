"use client";

import { useState, useCallback } from "react";
import { Download, ChevronDown, ChevronUp, ShieldCheck, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useTranslation } from "@/hooks/use-translation";
import {
  useVisitsReport,
  useMerchReport,
  useBranchReport,
  useProductReport,
  useGpsReport,
  type DateRange,
} from "@/hooks/use-reports";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function thisMonthRange(): DateRange {
  const now   = new Date();
  const from  = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const to    = now.toISOString().slice(0, 10);
  return { from, to };
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

async function exportXlsx(rows: Record<string, unknown>[], filename: string) {
  const XLSX = await import("xlsx");
  const ws   = XLSX.utils.json_to_sheet(rows);
  const wb   = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Report");
  XLSX.writeFile(wb, `${filename}.xlsx`);
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

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    completed:  "bg-emerald-100 text-emerald-700",
    inprogress: "bg-blue-100 text-blue-700",
    pending:    "bg-amber-100 text-amber-700",
    missed:     "bg-rose-100 text-rose-700",
  };
  return (
    <span className={cn("px-2.5 py-0.5 rounded-full text-[11px] font-semibold", map[status] ?? "bg-ink-100 text-ink-500")}>
      {status}
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

function VisitsTab({ range, locale }: { range: DateRange; locale: string }) {
  const { t }                                     = useTranslation();
  const { data = [], isLoading }                  = useVisitsReport(range);
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
      [t("reports.col.status")]:   r.status,
      [t("reports.col.duration")]: r.duration_minutes || "",
    }));
    await exportXlsx(rows, `visits-${range.from}-${range.to}`);
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
            {isLoading && <LoadingRow cols={6} />}
            {!isLoading && sorted.length === 0 && <EmptyRow cols={6} message={t("reports.noData")} />}
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
                  {r.duration_minutes > 0 ? `${r.duration_minutes}m` : "—"}
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

function MerchTab({ range, locale }: { range: DateRange; locale: string }) {
  const { t }                                    = useTranslation();
  const { data = [], isLoading }                 = useMerchReport(range);
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
    await exportXlsx(rows, `merch-${range.from}-${range.to}`);
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
                  {r.avg_duration > 0 ? `${r.avg_duration}m` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function BranchTab({ range, locale }: { range: DateRange; locale: string }) {
  const { t }                                    = useTranslation();
  const { data = [], isLoading }                 = useBranchReport(range);
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
    }));
    await exportXlsx(rows, `branches-${range.from}-${range.to}`);
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
            </tr>
          </thead>
          <tbody>
            {isLoading && <LoadingRow cols={7} />}
            {!isLoading && sorted.length === 0 && <EmptyRow cols={7} message={t("reports.noData")} />}
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
                <td className="text-end pe-4 py-2.5 text-ink-600">
                  {r.avg_duration > 0 ? `${r.avg_duration}m` : "—"}
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

function ProductTab({ range, locale }: { range: DateRange; locale: string }) {
  const { t }                                    = useTranslation();
  const { data = [], isLoading }                 = useProductReport(range);
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
    await exportXlsx(rows, `products-${range.from}-${range.to}`);
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

function GpsTab({ range }: { range: DateRange }) {
  const { t }                                    = useTranslation();
  const { data = [], isLoading }                 = useGpsReport(range);
  const { sorted, sortKey, sortDir, toggleSort } = useSortedData(data);
  type Row = (typeof data)[number];

  async function doExport() {
    const rows = sorted.map((r) => ({
      [t("reports.col.merch")]:       r.full_name,
      [t("reports.col.totalStarted")]:r.total_started,
      [t("reports.col.gpsVerified")]: r.gps_verified,
      [t("reports.col.missing")]:     r.gps_unverified,
      [t("reports.col.gpsRate")]:     `${r.verification_rate}%`,
      [t("reports.col.avgDistance")]: r.avg_distance || "",
    }));
    await exportXlsx(rows, `gps-compliance-${range.from}-${range.to}`);
  }

  return (
    <>
      <div className="flex items-center justify-between px-4 pt-3">
        {/* Brief description */}
        <p className="text-[11.5px] text-ink-400 flex items-center gap-1.5">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
          {t("reports.gpsDesc")}
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
              <SortTh<Row> col="gps_unverified"    label={t("reports.col.missing")}      sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="center" />
              <SortTh<Row> col="verification_rate" label={t("reports.col.gpsRate")}      sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="center" />
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
                <td className="text-center px-3 py-2.5 text-rose-500 font-semibold">{r.gps_unverified}</td>
                <td className="text-center px-3 py-2.5"><RateBadge rate={r.verification_rate} /></td>
                <td className="text-end pe-4 py-2.5 text-ink-600">
                  {r.avg_distance > 0 ? `${r.avg_distance}m` : "—"}
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

  function applyRange() { setRange({ ...draft }); }

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
        {tab === "visits"  && <VisitsTab  range={range} locale={locale} />}
        {tab === "merch"   && <MerchTab   range={range} locale={locale} />}
        {tab === "branch"  && <BranchTab  range={range} locale={locale} />}
        {tab === "product" && <ProductTab range={range} locale={locale} />}
        {tab === "gps"     && <GpsTab     range={range} />}
      </div>

    </div>
  );
}
