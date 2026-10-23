// Reports — is the data a tab is about to show actually all of it?
//
// The Data API caps any read at "Max rows" (1,000 on this project) and cuts the
// result WITHOUT an error. For the Visits tab that means a silently shortened
// list. For the other four it is worse: they aggregate the rows in the browser,
// so a cut produces plausible, wrong totals, rates and averages — and an Excel
// export of them — with nothing to say so.
//
// Every tab read therefore asks PostgREST for the exact number of matching rows
// alongside the rows themselves. If a count is missing, or the rows received do
// not account for it exactly, the read is refused: nothing is shown and nothing
// can be exported. A partial aggregate is never presented as valid.
//
// All five tabs now read in pages (report-pages.ts), so a range over the cap
// loads instead of being refused; the loader applies this rule to every page
// and throws the errors defined here. What remains refused is a result that
// cannot be vouched for, and one over the loader's stated maximum.
// assertReportComplete below is the same rule for a single, unpaged read; no
// tab makes one any more, and it is kept as the rule's plainest statement.
//
// Kept free of React and of the Supabase client so it can be tested directly.

import type { TranslationFn } from "@/hooks/use-translation";

export type ReportName = "visits" | "merch" | "branch" | "product" | "gps";

/**
 *   truncated  — more rows match than were returned (the cap cut the read)
 *   unverified — the count is missing or inconsistent, so completeness cannot
 *                be established either way
 *   tooLarge   — more rows match than one report load will read at all (the
 *                paged loader's hard maximum; see report-pages.ts). Nothing was
 *                cut: the load was declined, on the strength of the count
 */
export type ReportIncompleteReason = "truncated" | "unverified" | "tooLarge";

/**
 * What the counted rows are, so the notice can say so.
 *
 *   rows     — the rows of the range: visits, or audit rows (the default)
 *   branches — Branch Coverage's list of branches, or its one-row-per-branch
 *              last-visit read. Neither depends on the date range, so the
 *              notice must not suggest narrowing it.
 */
export type ReportIncompleteSubject = "rows" | "branches";

export class ReportIncompleteError extends Error {
  readonly report: ReportName;
  readonly reason: ReportIncompleteReason;
  /** Rows actually received. */
  readonly loaded: number;
  /** Rows that match, when known. */
  readonly total: number | null;
  /** The most rows a load will read — set only when that is why it was refused. */
  readonly max: number | null;
  readonly subject: ReportIncompleteSubject;

  constructor(
    report: ReportName, reason: ReportIncompleteReason, loaded: number, total: number | null,
    max: number | null = null, subject: ReportIncompleteSubject = "rows",
  ) {
    super(
      reason === "truncated"
        ? `${report} report is incomplete: ${loaded} of ${total} rows were returned`
        : reason === "tooLarge"
          ? `${report} report is too large to load: ${total} rows match, the maximum is ${max}`
          : `${report} report could not be verified as complete (${loaded} rows returned, no usable count)`,
    );
    this.name = "ReportIncompleteError";
    this.report = report;
    this.reason = reason;
    this.loaded = loaded;
    this.total = total;
    this.max = max;
    this.subject = subject;
  }
}

/** The same refusal, about a different subject. Anything else is returned as it is. */
export function aboutSubject(error: unknown, subject: ReportIncompleteSubject): unknown {
  if (!(error instanceof ReportIncompleteError) || error.subject === subject) return error;
  return new ReportIncompleteError(error.report, error.reason, error.loaded, error.total, error.max, subject);
}

/**
 * Throw unless `count` proves `rows` is the whole result.
 *
 * `count` is PostgREST's exact count for the same filtered query. Anything but
 * an exact match is refused: larger means truncated; missing, non-integer or
 * smaller means the count cannot be trusted, which is just as unusable.
 */
export function assertReportComplete(
  report: ReportName,
  rows: readonly unknown[],
  count: number | null | undefined,
): void {
  const loaded = rows.length;
  if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0) {
    throw new ReportIncompleteError(report, "unverified", loaded, null);
  }
  if (count > loaded) throw new ReportIncompleteError(report, "truncated", loaded, count);
  if (count < loaded) throw new ReportIncompleteError(report, "unverified", loaded, null);
}

// ─── Tab state ────────────────────────────────────────────────────────────────

/**
 * What a tab may show. `rows` is empty in every state except `ready`, so
 * nothing downstream — sorting, paging, the table, the export — can pick up
 * rows whose completeness or currency is in doubt.
 *
 *   loading    — no rows yet and a request is owed (in flight, or paused offline)
 *   ready      — a complete result, current as of its last successful load
 *   truncated  — the read was cut by the row cap
 *   tooLarge   — the range matches more rows than a load will read
 *   unverified — completeness could not be established
 *   error      — the request failed. `hadRows` marks a failed REFRESH: rows from
 *                an earlier load exist but are withheld, because they can no
 *                longer be shown as current
 *
 * `subject` is present only when the refused read was not of the range's rows
 * (see ReportIncompleteSubject), so every other state is exactly as it was.
 */
export type ReportTabState<T> =
  | { kind: "loading";    rows: T[] }
  | { kind: "ready";      rows: T[] }
  | { kind: "truncated";  rows: T[]; loaded: number; total: number; subject?: "branches" }
  | { kind: "tooLarge";   rows: T[]; total: number; max: number; subject?: "branches" }
  | { kind: "unverified"; rows: T[]; subject?: "branches" }
  | { kind: "error";      rows: T[]; hadRows: boolean };

export function reportTabState<T>(q: {
  data?:      T[];
  isFetching: boolean;
  isPaused:   boolean;
  isError:    boolean;
  error:      unknown;
}): ReportTabState<T> {
  // An error wins over cached rows. TanStack Query keeps the previous rows when
  // a refresh fails; showing them would present an earlier answer as current —
  // and if the refresh failed BECAUSE the range grew past the cap, as complete.
  if (q.isError) {
    const e = q.error;
    if (e instanceof ReportIncompleteError) {
      const about = e.subject === "branches" ? { subject: "branches" as const } : {};
      if (e.reason === "tooLarge" && e.total !== null && e.max !== null) {
        return { kind: "tooLarge", rows: [], total: e.total, max: e.max, ...about };
      }
      return e.reason === "truncated" && e.total !== null
        ? { kind: "truncated", rows: [], loaded: e.loaded, total: e.total, ...about }
        : { kind: "unverified", rows: [], ...about };
    }
    return { kind: "error", rows: [], hadRows: Array.isArray(q.data) };
  }
  if (q.data) return { kind: "ready", rows: q.data };
  // Paused (offline) is still owed, not empty: "no data for this period" would
  // be a claim about the period that nothing has checked.
  if (q.isFetching || q.isPaused) return { kind: "loading", rows: [] };
  // Not requested at all (no usable date range): an empty, ordinary table.
  return { kind: "ready", rows: [] };
}

/** Export is allowed only for a complete, current, non-empty result. */
export function canExportReport<T>(state: ReportTabState<T>): boolean {
  return state.kind === "ready" && state.rows.length > 0;
}

/**
 * The message for a tab that cannot show its data, or null when it can.
 * The counts are stated in parentheses rather than attached to a noun, so the
 * sentence needs no plural forms in either language.
 *
 * A refusal about branches (Branch Coverage's branch list or last-visit read)
 * says so, and its second line does not suggest a narrower range: the range
 * does not change those reads.
 */
export function reportTabMessage<T>(
  state: ReportTabState<T>,
  t: TranslationFn,
): { title: string; detail: string } | null {
  switch (state.kind) {
    case "truncated":
      return state.subject === "branches"
        ? { title:  t("reports.data.branchesTruncated", { total: state.total, loaded: state.loaded }),
            detail: t("reports.data.branchesRetry") }
        : { title:  t("reports.data.truncated", { total: state.total, loaded: state.loaded }),
            detail: t("reports.data.narrow") };
    case "tooLarge": {
      // Grouped digits: these are the only large figures a notice shows.
      const vars = { total: state.total.toLocaleString("en-US"), max: state.max.toLocaleString("en-US") };
      return state.subject === "branches"
        ? { title: t("reports.data.branchesTooLarge", vars), detail: t("reports.data.branchesTooMany") }
        : { title: t("reports.data.tooLarge", vars),         detail: t("reports.data.narrow") };
    }
    case "unverified":
      return state.subject === "branches"
        ? { title: t("reports.data.branchesUnverified"), detail: t("reports.data.branchesRetry") }
        : { title: t("reports.data.unverified"),         detail: t("reports.data.narrow") };
    case "error":
      return {
        title:  state.hadRows ? t("reports.data.refreshError") : t("reports.data.loadError"),
        detail: t("reports.data.noExport"),
      };
    default:
      return null;
  }
}

// ─── The notice, through a Retry ──────────────────────────────────────────────
//
// reportTabState alone is not enough to drive the notice. When a tab has no
// cached rows (a failed first load, a truncated or an unverified read),
// TanStack Query answers a Retry by resetting the query to "pending" — so the
// state becomes `loading`, the notice would unmount, and the Retry button the
// user had just activated would disappear from under their keyboard focus.
//
// So the notice has a little memory: while a Retry the USER started is in
// flight, the last problem stays on screen, marked as retrying. The button is
// the same element throughout, so focus never leaves it — whether the retry
// succeeds, fails, or is still running. Rows stay hidden either way: this is
// about the notice, never about what data is shown.

export type ReportProblemState<T> = Extract<ReportTabState<T>, { kind: "truncated" | "tooLarge" | "unverified" | "error" }>;

export function isReportProblem<T>(state: ReportTabState<T>): state is ReportProblemState<T> {
  return state.kind === "truncated" || state.kind === "tooLarge" || state.kind === "unverified" || state.kind === "error";
}

export interface ReportNotice<T> {
  problem:  ReportProblemState<T>;
  /** A retry is running: the button shows progress and ignores activation. */
  retrying: boolean;
}

export interface ReportNoticeMemory<T> {
  /** The range and filters this memory belongs to; a different key starts clean. */
  key:            string;
  lastProblem:    ReportProblemState<T> | null;
  /** The user activated Retry and it has not settled yet. */
  retryRequested: boolean;
  /** Whether the notice was on screen after the previous render. */
  noticeShown:    boolean;
}

export function emptyNoticeMemory<T>(key: string): ReportNoticeMemory<T> {
  return { key, lastProblem: null, retryRequested: false, noticeShown: false };
}

/** The user activated Retry. */
export function requestReportRetry<T>(memory: ReportNoticeMemory<T>): ReportNoticeMemory<T> {
  return { ...memory, retryRequested: true };
}

/**
 * What notice to render now. Pure: called on every render.
 *
 *   • a problem state shows itself; it is "retrying" while a fetch runs (the
 *     failed-refresh case, where TanStack keeps the error during the retry);
 *   • `loading` during a retry the user asked for keeps showing the last
 *     problem, as retrying;
 *   • anything else shows nothing — including `loading` for a different range
 *     or filter, which must not inherit the previous one's problem.
 */
export function reportNotice<T>(
  memory: ReportNoticeMemory<T>,
  input: { key: string; state: ReportTabState<T>; isFetching: boolean },
): { memory: ReportNoticeMemory<T>; notice: ReportNotice<T> | null } {
  const m = memory.key === input.key ? memory : emptyNoticeMemory<T>(input.key);
  if (isReportProblem(input.state)) {
    return {
      memory: { ...m, lastProblem: input.state },
      notice: { problem: input.state, retrying: input.isFetching },
    };
  }
  if (input.state.kind === "loading" && m.retryRequested && m.lastProblem) {
    return { memory: m, notice: { problem: m.lastProblem, retrying: true } };
  }
  return { memory: m, notice: null };
}

/**
 * Called after each render, with what was actually rendered.
 *
 * `focusResults` is true in exactly one situation: the user's own Retry
 * succeeded, the notice (and the button they were on) has just gone, and focus
 * fell to the page body as a result. Then focus belongs on the results. It is
 * never moved while a retry is pending or after it fails (the button is still
 * there), for a recovery the user did not ask for, or if they have moved focus
 * somewhere else in the meantime.
 */
export function settleReportNotice<T>(
  memory: ReportNoticeMemory<T>,
  input: { state: ReportTabState<T>; isFetching: boolean; noticeShown: boolean; focusWasLost: boolean },
): { memory: ReportNoticeMemory<T>; focusResults: boolean } {
  const focusResults =
    memory.retryRequested && memory.noticeShown && !input.noticeShown &&
    input.state.kind === "ready" && input.focusWasLost;
  // The retry is over once the notice has gone, or a problem is showing with
  // nothing in flight (it failed).
  const settled = !input.noticeShown || (isReportProblem(input.state) && !input.isFetching);
  return {
    memory: { ...memory, noticeShown: input.noticeShown, retryRequested: settled ? false : memory.retryRequested },
    focusResults,
  };
}
