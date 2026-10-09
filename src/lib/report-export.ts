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
import { riyadhToday } from "@/lib/utils/date";
import { riyadhClock } from "@/lib/calendar-model";

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
 *   ready       — figures are on hand and current (including while a background
 *                 refresh runs, or is paused, and has not failed)
 *   stale       — figures are on hand but the latest refresh FAILED after its
 *                 retries: they are the last successful load, not current.
 *                 Shown with a notice and exported with a note, never as zeros
 *   loading     — no figures yet and a request is still owed: in flight (first
 *                 load, a new range/filter, a retry, or Retry after an error)
 *                 or paused (offline, or a retry waiting for the tab to be
 *                 visible again). A paused request has not failed.
 *   error       — no figures, and the request failed after its retries
 *   unavailable — no figures and nothing requested (the query is disabled
 *                 because there is no usable range)
 */
export type SummaryStatus = "ready" | "stale" | "loading" | "error" | "unavailable";

export function summaryStatus(q: {
  data?:      ReportSummary;
  isFetching: boolean;
  isPaused:   boolean;
  isError:    boolean;
}): SummaryStatus {
  // With figures on hand, TanStack Query 5 keeps them when a refresh fails and
  // reports status "error" — and, unlike the no-data case, it stays isError
  // while a Retry runs. Those figures are the last successful load: "stale"
  // until a refresh succeeds, including while one is in flight.
  if (q.data) return q.isError ? "stale" : "ready";
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

/**
 * When the figures on hand were last loaded successfully, as "YYYY-MM-DD HH:mm"
 * on the Riyadh clock — the business timezone the rest of the app uses, not the
 * viewer's machine. `dataUpdatedAt` is TanStack Query's epoch-ms timestamp,
 * which a failed refresh leaves untouched.
 *
 * null when there is no real load time: TanStack reports 0 before any success,
 * and formatting that would print a confident "1970-01-01 03:00".
 */
export function summaryLoadedAt(dataUpdatedAt: number | null | undefined): string | null {
  if (typeof dataUpdatedAt !== "number" || !Number.isFinite(dataUpdatedAt) || dataUpdatedAt <= 0) {
    return null;
  }
  const at = new Date(dataUpdatedAt);
  return `${riyadhToday(at)} ${riyadhClock(at.toISOString())}`;
}

/**
 * The stale notice's sentence, split around its load time.
 *
 * On screen the time must sit in its own left-to-right isolated element: in the
 * Arabic sentence the bidi algorithm otherwise lays the hyphen-separated date
 * out right-to-left, so "2026-10-09 14:57" is DRAWN as "14:57 09-10-2026". The
 * split is positional only — `before + time + after` is exactly the translated
 * sentence, and neither the timestamp value nor the Excel text changes.
 */
export function staleNoticeParts(
  t: TranslationFn,
  loadedAt: string | null,
): { before: string; time: string | null; after: string } {
  if (!loadedAt) return { before: t("reports.sum.staleNoTime"), time: null, after: "" };
  const template = t("reports.sum.stale");
  const at = template.indexOf("{time}");
  // A translation without the placeholder: show it whole rather than drop it.
  if (at < 0) return { before: t("reports.sum.stale", { time: loadedAt }), time: null, after: "" };
  return { before: template.slice(0, at), time: loadedAt, after: template.slice(at + "{time}".length) };
}

/**
 * After the user's own Retry succeeds the stale notice — and the Retry button
 * they were focused on — is removed, which drops keyboard focus to the page
 * body. Focus should then move to a stable element nearby, but only in exactly
 * that case: never while the retry is pending or has failed (the button is
 * still there and keeps focus), never for a refresh the user did not ask for,
 * and never if they have already moved focus somewhere else.
 */
export function shouldFocusSummaryAfterRetry(a: {
  previous:       SummaryStatus;
  current:        SummaryStatus;
  retryRequested: boolean;
  focusWasLost:   boolean;
}): boolean {
  return a.retryRequested && a.previous === "stale" && a.current === "ready" && a.focusWasLost;
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
  /**
   * Set only when `summary` is the last successful load and a later refresh
   * failed: when that load happened, from summaryLoadedAt(), or null when no
   * real load time is known. Either way the sheet states the figures were not
   * refreshed, right after the period and filters — with the time only when
   * there is one.
   */
  staleSince?:    string | null;
}

export function buildExportMeta({
  t, range, merchLabel, placeLabel, statusText, lastVisitLabel, summary, staleSince,
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

  // Previous figures are kept — they are real, just not current — but the
  // sheet says so before them, next to the period and filters, so a reader
  // meets the caveat before the numbers.
  const staleNote = summary && staleSince !== undefined
    ? [row(
        t("reports.exp.summaryStatus"),
        staleSince
          ? t("reports.exp.summaryStale", { time: staleSince })
          : t("reports.sum.staleNoTime"),
      )]
    : [];

  return {
    sheetName: t("reports.exp.sheetSummary"),
    dataSheet: t("reports.exp.sheetData"),
    rows:      [...context, ...staleNote, ...figures],
  };
}

/**
 * What an export may carry in this summary state. null while the summary is
 * still owed (loading or paused): Export waits rather than write "unavailable"
 * for figures that have not failed. Otherwise always a summary sheet — with
 * the figures when ready; with the previous figures and a "not refreshed" note
 * when stale; with the "unavailable" row after a failure with no figures.
 */
export function summaryExportMeta(
  status: SummaryStatus,
  input: Omit<ExportMetaInput, "summary" | "staleSince">,
  summary: ReportSummary | undefined,
  // Required, not defaulted: a forgotten timestamp must not become "1970".
  dataUpdatedAt: number | null | undefined,
): ExportMeta | null {
  if (status === "loading") return null;
  if (status === "stale" && summary) {
    return buildExportMeta({ ...input, summary, staleSince: summaryLoadedAt(dataUpdatedAt) });
  }
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
