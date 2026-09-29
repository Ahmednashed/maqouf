// Reports — the Excel workbook and the summary state that feeds it.
//
// Kept out of the page so it can be exercised without React: the workbook is
// built from plain data, and the tests round-trip it through the real `xlsx`
// library.
//
// The invariant this module exists for: an exported workbook ALWAYS carries the
// summary sheet, with the period and the filters that produced it. The headline
// figures on that sheet come from the period summary; when the summary could
// not be loaded the sheet says so in words instead of being left out. Before,
// a failed summary silently produced a bare data grid that could not be told
// apart from a complete, unfiltered export.

import type { TranslationFn } from "@/hooks/use-translation";
import type { DateRange, ReportSummary } from "@/services/reports";

type Xlsx = typeof import("xlsx");

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

/** "45 د" / "45 min" — never the bare English "45m". */
export function durationLabel(minutes: number, t: TranslationFn): string {
  return minutes > 0 ? `${minutes} ${t("common.minutesShort")}` : "—";
}

// ─── Summary state ────────────────────────────────────────────────────────────

/**
 *   ready       — figures are on hand (a later background refresh that failed
 *                 keeps the figures already loaded for the same range/filters)
 *   loading     — no figures yet and a request is still owed: in flight (first
 *                 load, a new range/filter, a retry, or Retry after an error)
 *                 or paused (offline, or a retry waiting for the tab to be
 *                 visible again). A paused request has not failed.
 *   error       — no figures, and the request failed after its retries
 *   unavailable — no figures and nothing requested (the query is disabled
 *                 because there is no usable range)
 */
export type SummaryStatus = "ready" | "loading" | "error" | "unavailable";

export function summaryStatus(q: {
  data?:      ReportSummary;
  isFetching: boolean;
  isPaused:   boolean;
  isError:    boolean;
}): SummaryStatus {
  if (q.data) return "ready";
  // TanStack Query 5: a fetch with no data yet reports status "pending" with
  // fetchStatus "fetching" — or "paused" when it cannot run (offline, or a
  // retry held until the tab is visible), which is NOT isFetching. Starting a
  // fetch with no data also resets status to "pending" and clears the error,
  // so a Retry after a failure is not isError while it runs. Checking only
  // isFetching treated a paused request as finished and unavailable.
  if (q.isFetching || q.isPaused) return "loading";
  if (q.isError) return "error";
  return "unavailable";
}

// ─── Summary sheet ────────────────────────────────────────────────────────────

export interface ExportMetaInput {
  t:              TranslationFn;
  range:          DateRange;
  /** Already-resolved display labels, exactly as the page shows them. */
  merchLabel:     string;
  placeLabel:     string;
  statusText:     string;
  lastVisitLabel: string;
  /** null when the summary is not available — the sheet then says so. */
  summary:        ReportSummary | null;
}

export function buildExportMeta({
  t, range, merchLabel, placeLabel, statusText, lastVisitLabel, summary,
}: ExportMetaInput): ExportMeta {
  const row = (metric: string, value: unknown) =>
    ({ [t("reports.exp.metric")]: metric, [t("reports.exp.value")]: value });

  // The period and filters never depend on the summary, so they are written
  // whether or not the figures arrived.
  const context = [
    row(t("reports.exp.range"),           `${range.from} → ${range.to}`),
    row(t("reports.exp.filterMerch"),     merchLabel),
    row(t("reports.exp.filterBranch"),    placeLabel),
    row(t("reports.exp.filterStatus"),    statusText),
    row(t("reports.exp.filterLastVisit"), lastVisitLabel),
  ];

  const figures = summary
    ? [
        row(t("reports.sum.totalVisits"),     summary.total_visits),
        row(t("reports.sum.completed"),       summary.completed),
        row(t("reports.sum.missed"),          summary.missed),
        row(t("reports.sum.pending"),         summary.pending),
        row(t("reports.sum.rate"),            `${summary.completion_rate}%`),
        row(t("reports.sum.activeMerch"),     summary.active_merchandisers),
        row(t("reports.sum.coveredBranches"), `${summary.covered_branches} / ${summary.scheduled_branches}`),
        row(t("reports.sum.avgDuration"),     durationLabel(summary.avg_duration, t)),
        row(
          t("reports.sum.productIssues"),
          summary.products_with_shortfall == null
            ? t("reports.sum.noAudits")
            : summary.products_with_shortfall,
        ),
      ]
    : [row(t("reports.exp.summaryFigures"), t("reports.exp.summaryUnavailable"))];

  return {
    sheetName: t("reports.exp.sheetSummary"),
    dataSheet: t("reports.exp.sheetData"),
    rows:      [...context, ...figures],
  };
}

/**
 * What an export may carry in this summary state. null while the summary is
 * still owed (loading or paused): Export waits rather than write "unavailable"
 * for figures that have not failed. Otherwise always a summary sheet — with
 * the figures when ready, with the "unavailable" row after a failure.
 */
export function summaryExportMeta(
  status: SummaryStatus,
  input: Omit<ExportMetaInput, "summary">,
  summary: ReportSummary | undefined,
): ExportMeta | null {
  if (status === "loading") return null;
  return buildExportMeta({ ...input, summary: status === "ready" && summary ? summary : null });
}

// ─── Workbook ─────────────────────────────────────────────────────────────────

/**
 * Summary sheet first, data sheet second. `meta` is required: there is no way
 * to build a report workbook without the summary sheet.
 */
export function buildReportWorkbook(
  XLSX: Xlsx,
  rows: Record<string, unknown>[],
  meta: ExportMeta,
) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(meta.rows), meta.sheetName);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), meta.dataSheet);
  return wb;
}

export async function exportReportXlsx(
  rows: Record<string, unknown>[],
  filename: string,
  meta: ExportMeta,
) {
  const XLSX = await import("xlsx");
  XLSX.writeFile(buildReportWorkbook(XLSX, rows, meta), `${filename}.xlsx`);
}
