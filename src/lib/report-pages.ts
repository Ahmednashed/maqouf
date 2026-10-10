// Reports — reading a result that is larger than one API response.
//
// The Data API returns at most "Max rows" (1,000 on this project) per request.
// report-completeness.ts makes a read over that cap refuse itself; this loads
// such a read in pages instead, and keeps the same refusal for anything it
// cannot vouch for. It returns every row or throws — never part of a result.
//
// HOW A PAGE IS ASKED FOR
//   Keyset, not offset: rows are read in ascending order of a unique key, and
//   each page asks for the rows whose key is greater than the last one read.
//   With an offset, a row deleted from an earlier page slides every later row
//   up by one and the next page silently skips one; a keyset page cannot skip
//   or repeat a row that was there throughout the load.
//
// HOW A PAGE IS CHECKED
//   Every page carries PostgREST's exact count for its own query — which, with
//   the key condition applied, is the number of rows still to come, this page
//   included. So:
//     • the first page's count is the total, and must not exceed the maximum
//       (a larger range is declined as "too large", not reported as cut);
//     • each later count must equal the total minus the rows already read;
//     • a page must hold exactly min(page size, its count) rows;
//     • keys must be non-empty and strictly increasing, across pages too;
//     • the rows read must add up to the total.
//   A missing or unusable count, or any mismatch, refuses the whole load.
//
// WHAT THIS IS NOT
//   The pages are separate requests, so the result is NOT a transactional
//   snapshot. A row inserted or removed AHEAD of the cursor changes a later
//   count and the load is refused. But a change BEHIND the cursor — to rows in
//   pages already read — leaves every later count as expected and cannot be
//   seen: a row deleted after it was read stays in the result, a row inserted
//   with a key below the cursor is absent, and an edit to a row already read
//   is not picked up. That is the same staleness a single read has a moment
//   after it returns, stretched over the seconds a long load takes; it is not
//   a partial result, and nothing here claims more than that.
//
// Kept free of React and of the Supabase client so it can be tested directly.

import { ReportIncompleteError, type ReportName } from "@/lib/report-completeness";

/** Rows asked for per request. Must not exceed the Data API's "Max rows". */
export const REPORT_PAGE_SIZE = 1000;

/**
 * The most rows one report load will read: 20 requests at the page size above.
 * A range matching more than this is refused after its first page — whose count
 * already says so — rather than loaded for minutes and held in the browser.
 */
export const REPORT_MAX_ROWS = 20_000;

export interface ReportPage<T> {
  rows:  T[];
  /** PostgREST's exact count for this page's own query. */
  count: number | null | undefined;
}

export interface ReportPagesOptions<T> {
  report: ReportName;
  /**
   * Read one page: at most `limit` rows, in ascending key order, whose key is
   * greater than `after` (all rows when `after` is null), with the exact count
   * of that same query. Throw on a query error.
   */
  fetchPage: (after: string | null, limit: number) => Promise<ReportPage<T>>;
  /** The unique key the pages are ordered by. */
  keyOf: (row: T) => string;
  /** Aborted when the load is no longer wanted; no further page is requested. */
  signal?: AbortSignal;
  pageSize?: number;
  maxRows?:  number;
}

function stopIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return;
  throw signal.reason instanceof Error ? signal.reason : new DOMException("The report load was cancelled", "AbortError");
}

const usableCount = (count: unknown): count is number =>
  typeof count === "number" && Number.isSafeInteger(count) && count >= 0;

/** Load every row of a report read, page by page, or throw. See the file header. */
export async function loadAllReportPages<T>(options: ReportPagesOptions<T>): Promise<T[]> {
  const { report, fetchPage, keyOf, signal } = options;
  const pageSize = options.pageSize ?? REPORT_PAGE_SIZE;
  const maxRows  = options.maxRows  ?? REPORT_MAX_ROWS;

  const all: T[] = [];
  let total: number | null = null;
  let after: string | null = null;

  for (;;) {
    stopIfAborted(signal);
    const page = await fetchPage(after, pageSize);
    // Superseded while the page was in flight: drop it, and ask for no more.
    stopIfAborted(signal);

    const rows   = page.rows;
    const loaded = all.length + rows.length;
    const unverified = () => new ReportIncompleteError(report, "unverified", loaded, null);

    if (!usableCount(page.count)) throw unverified();
    const remaining = page.count;

    if (total === null) {
      total = remaining;
      // Known from the first page: refuse now rather than after 20 requests.
      // Its own reason, so the notice can name the maximum rather than imply
      // that this first page was all that could be read.
      if (total > maxRows) throw new ReportIncompleteError(report, "tooLarge", rows.length, total, maxRows);
    } else if (remaining !== total - all.length) {
      // Rows appeared or disappeared ahead of the cursor since the load began.
      throw unverified();
    }

    const expected = Math.min(pageSize, remaining);
    // Fewer than asked for although more match: the response was cut short.
    if (rows.length < expected) throw new ReportIncompleteError(report, "truncated", loaded, total);
    if (rows.length > expected) throw unverified();

    let previous: string | null = after;
    for (const row of rows) {
      const key = keyOf(row);
      if (typeof key !== "string" || key === "" || (previous !== null && !(key > previous))) throw unverified();
      previous = key;
      all.push(row);
    }

    // The count says this page was the last; no request is spent confirming it.
    if (rows.length === remaining) break;
    after = previous;
  }

  if (all.length !== total) throw new ReportIncompleteError(report, "unverified", all.length, null);
  return all;
}
