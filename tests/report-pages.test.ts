// Reports — loading a read in pages, and the Visits tab that does.
//
// A range can match more rows than one API response holds. The loader reads
// such a result page by page and must return all of it or nothing: a page that
// is short, uncounted, miscounted, out of order or failed refuses the whole
// load, and so does a result over the hard maximum.
//
// Part 1 drives the loader with a small in-memory table, so each rule is pinned
// on its own. Part 2 drives the real Visits fetcher against the recording stub
// at the real page size. Part 3 checks that the hook hands the fetcher
// TanStack's abort signal, and that cancelling a query stops its pages. Part 4
// is the over-maximum notice. Part 5 runs multi-page loads on a real TanStack
// Query observer: a range changed mid-load, and a page that fails.
//
// What none of this shows is how the real API counts and orders — that is
// observed separately against it, read-only.

import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider, QueryObserver } from "@tanstack/react-query";
import { eq, ok } from "./_harness.ts";
import {
  loadAllReportPages, REPORT_MAX_ROWS, REPORT_PAGE_SIZE, type ReportPage,
} from "@/lib/report-pages";
import { ReportIncompleteError, canExportReport, reportTabMessage, reportTabState } from "@/lib/report-completeness";
import { translations } from "@/lib/i18n/translations";
import type { TranslationFn } from "@/hooks/use-translation";
import { fetchVisitsReport } from "@/services/reports";
import {
  useVisitsReport, useMerchReport, useBranchReport, useProductReport, useGpsReport, useReportSummary,
} from "@/hooks/use-reports";
import { recordedCalls, queueResultFor, resetStub } from "./stubs/supabase-client.ts";

type Row = { id: string };
const key = (n: number) => `k${String(n).padStart(6, "0")}`;
const table = (n: number): Row[] => Array.from({ length: n }, (_, i) => ({ id: key(i + 1) }));

interface Source {
  requests: Array<{ after: string | null; limit: number }>;
  fetchPage: (after: string | null, limit: number) => Promise<ReportPage<Row>>;
}
/** An in-memory table answering keyset pages; `tamper` may alter one answer. */
function source(rows: Row[], tamper?: (page: ReportPage<Row>, index: number) => ReportPage<Row> | Promise<ReportPage<Row>>): Source {
  const requests: Source["requests"] = [];
  return {
    requests,
    fetchPage: async (after, limit) => {
      const index = requests.length;
      requests.push({ after, limit });
      const rest = rows.filter((r) => after === null || r.id > after);
      const page = { rows: rest.slice(0, limit), count: rest.length };
      return tamper ? tamper(page, index) : page;
    },
  };
}

async function load(src: Source, extra: { pageSize?: number; maxRows?: number; signal?: AbortSignal } = {}) {
  try {
    const value = await loadAllReportPages<Row>({ report: "visits", fetchPage: src.fetchPage, keyOf: (r) => r.id, pageSize: 5, ...extra });
    return { value, error: undefined as unknown };
  } catch (error) {
    return { value: undefined, error };
  }
}
const refusal = (e: unknown) =>
  e instanceof ReportIncompleteError ? [e.report, e.reason, e.loaded, e.total] : ["not a ReportIncompleteError", String(e)];

// ── 1) The loader ────────────────────────────────────────────────────────────
console.log("1) loadAllReportPages");
{
  eq("the page size is the Data API's cap, and the maximum is twenty pages of it", [REPORT_PAGE_SIZE, REPORT_MAX_ROWS], [1000, 20_000]);

  for (const [label, n, requests] of [
    ["no rows", 0, [null]],
    ["one short page", 3, [null]],
    ["exactly one full page", 5, [null]],
    ["one row over a page", 6, [null, key(5)]],
    ["several pages", 12, [null, key(5), key(10)]],
    ["an exact multiple of the page size", 15, [null, key(5), key(10)]],
  ] as const) {
    const src = source(table(n));
    const r = await load(src);
    eq(`${label}: every row, in key order`, r.value, table(n));
    eq(`${label}: cursors asked for, and no request to confirm the end`, src.requests.map((q) => q.after), requests);
    ok(`${label}: every request asks for one page`, src.requests.every((q) => q.limit === 5));
  }

  {
    const src = source(table(2300));
    const value = await loadAllReportPages<Row>({ report: "visits", fetchPage: src.fetchPage, keyOf: (r) => r.id });
    eq("at the default page size: 2,300 rows in three requests of 1,000", [value.length, src.requests.map((q) => q.limit)], [2300, [1000, 1000, 1000]]);
  }

  // ── Counts ────────────────────────────────────────────────────────────────
  for (const [label, count] of [["absent", undefined], ["null", null], ["NaN", Number.NaN], ["negative", -1],
                                ["fractional", 7.5], ["a string", "12"]] as const) {
    const first = source(table(12), (p, i) => (i === 0 ? { ...p, count: count as number } : p));
    const r1 = await load(first);
    eq(`count ${label} on the first page → unverified, one request, nothing returned`,
       [refusal(r1.error), first.requests.length, r1.value], [["visits", "unverified", 5, null], 1, undefined]);
    const later = source(table(12), (p, i) => (i === 1 ? { ...p, count: count as number } : p));
    const r2 = await load(later);
    eq(`count ${label} on a later page → unverified, and no further request`,
       [refusal(r2.error), later.requests.length, r2.value], [["visits", "unverified", 10, null], 2, undefined]);
  }
  for (const [label, delta] of [["a row appeared ahead of the cursor", 1], ["a row disappeared ahead of the cursor", -1]] as const) {
    const src = source(table(12), (p, i) => (i === 1 ? { ...p, count: (p.count as number) + delta } : p));
    const r = await load(src);
    eq(`count drift (${label}) → unverified, no further request`,
       [refusal(r.error), src.requests.length, r.value], [["visits", "unverified", 10, null], 2, undefined]);
  }
  {
    // The last page is checked like any other.
    const src = source(table(12), (p, i) => (i === 2 ? { ...p, count: 3 } : p));
    eq("count drift on the last page → unverified", refusal((await load(src)).error), ["visits", "unverified", 12, null]);
  }

  // ── Page length ───────────────────────────────────────────────────────────
  {
    const cut = source(table(12), (p, i) => (i === 0 ? { ...p, rows: p.rows.slice(0, 3) } : p));
    const r = await load(cut);
    eq("a first page shorter than asked (a lower cap) → truncated, with both figures",
       [refusal(r.error), cut.requests.length, r.value], [["visits", "truncated", 3, 12], 1, undefined]);
    const later = source(table(12), (p, i) => (i === 1 ? { ...p, rows: p.rows.slice(0, 4) } : p));
    eq("a later page shorter than asked → truncated", refusal((await load(later)).error), ["visits", "truncated", 9, 12]);
    const last = source(table(12), (p, i) => (i === 2 ? { ...p, rows: p.rows.slice(0, 1) } : p));
    eq("a short last page → truncated", refusal((await load(last)).error), ["visits", "truncated", 11, 12]);
    const empty = source(table(12), (p, i) => (i === 1 ? { ...p, rows: [] } : p));
    eq("an empty page while rows remain → truncated, not an endless loop",
       [refusal((await load(empty)).error), empty.requests.length], [["visits", "truncated", 5, 12], 2]);
    const long = source(table(3), (p) => ({ ...p, count: 2 }));
    eq("more rows than the count allows → unverified", refusal((await load(long)).error), ["visits", "unverified", 3, null]);
    const overLimit = source(table(12), (p, i) => (i === 0 ? { rows: table(7), count: 12 } : p));
    eq("more rows than the page asked for → unverified", refusal((await load(overLimit)).error), ["visits", "unverified", 7, null]);
  }

  // ── Keys ──────────────────────────────────────────────────────────────────
  {
    const swap = (rows: Row[], a: number, b: number) => { const c = rows.slice(); [c[a], c[b]] = [c[b], c[a]]; return c; };
    const cases: Array<[string, (p: ReportPage<Row>, i: number) => ReportPage<Row>, number]> = [
      ["a duplicate key within a page", (p, i) => (i === 0 ? { ...p, rows: [p.rows[0], p.rows[0], ...p.rows.slice(2)] } : p), 5],
      ["keys out of order within a page", (p, i) => (i === 0 ? { ...p, rows: swap(p.rows, 1, 3) } : p), 5],
      ["a page that repeats the cursor row", (p, i) => (i === 1 ? { ...p, rows: [{ id: key(5) }, ...p.rows.slice(1)] } : p), 10],
      ["a page that starts before the cursor", (p, i) => (i === 1 ? { ...p, rows: [{ id: key(2) }, ...p.rows.slice(1)] } : p), 10],
      ["an empty key", (p, i) => (i === 0 ? { ...p, rows: [{ id: "" }, ...p.rows.slice(1)] } : p), 5],
      ["a key that is not a string", (p, i) => (i === 0 ? { ...p, rows: [{ id: 7 as unknown as string }, ...p.rows.slice(1)] } : p), 5],
      ["a row with no key", (p, i) => (i === 0 ? { ...p, rows: [{} as Row, ...p.rows.slice(1)] } : p), 5],
    ];
    for (const [label, tamper, loaded] of cases) {
      const src = source(table(12), tamper);
      const r = await load(src);
      eq(`${label} → unverified, nothing returned`, [refusal(r.error), r.value], [["visits", "unverified", loaded, null], undefined]);
    }
  }

  // ── A failed page ─────────────────────────────────────────────────────────
  for (const failAt of [0, 1, 2]) {
    const boom = { code: "57014", message: "canceling statement due to statement timeout" };
    const src = source(table(12), (p, i) => { if (i === failAt) throw boom; return p; });
    const r = await load(src);
    ok(`page ${failAt + 1} fails → that error itself, not a completeness problem`, r.error === boom);
    eq(`page ${failAt + 1} fails → nothing returned, no further request`, [r.value, src.requests.length], [undefined, failAt + 1]);
  }

  // ── The hard maximum ──────────────────────────────────────────────────────
  {
    const at = source(table(10));
    eq("a total exactly at the maximum loads", [(await load(at, { maxRows: 10 })).value?.length, at.requests.length], [10, 2]);
    const over = source(table(11));
    const r = await load(over, { maxRows: 10 });
    eq("one row over the maximum → refused as too large after the first page, with the real total",
       [refusal(r.error), over.requests.length, r.value], [["visits", "tooLarge", 5, 11], 1, undefined]);
    eq("…carrying the maximum that applied, not the page it happened to read", (r.error as ReportIncompleteError).max, 10);
    // The count alone decides: nothing is fetched to find out.
    const huge = source(table(5), (p) => ({ ...p, count: 5_000_000 }));
    eq("a very large total costs one request", [refusal((await load(huge)).error), huge.requests.length], [["visits", "tooLarge", 5, 5_000_000], 1]);
    const real = source(table(3), (p) => ({ ...p, count: REPORT_MAX_ROWS + 1 }));
    const rr = await loadAllReportPages<Row>({ report: "visits", fetchPage: real.fetchPage, keyOf: (r) => r.id }).then(() => null, (e) => e);
    eq("the default maximum is the documented one", [refusal(rr), (rr as ReportIncompleteError).max], [["visits", "tooLarge", 3, REPORT_MAX_ROWS + 1], REPORT_MAX_ROWS]);
    // A page cut short is still "truncated": the two are different problems.
    const cut = source(table(12), (p, i) => (i === 0 ? { ...p, rows: p.rows.slice(0, 3) } : p));
    const cutError = (await load(cut)).error as ReportIncompleteError;
    eq("a short page is still truncated, with no maximum attached", [cutError.reason, cutError.max], ["truncated", null]);
  }

  // ── Cancellation ──────────────────────────────────────────────────────────
  {
    const isAbort = (e: unknown) => e instanceof Error && e.name === "AbortError";

    const before = new AbortController();
    before.abort();
    const s0 = source(table(12));
    const r0 = await load(s0, { signal: before.signal });
    eq("aborted before it starts: no request, nothing returned", [s0.requests.length, r0.value, isAbort(r0.error)], [0, undefined, true]);

    for (const abortAt of [0, 1]) {
      const ac = new AbortController();
      const src = source(table(12), (p, i) => { if (i === abortAt) ac.abort(); return p; });
      const r = await load(src, { signal: ac.signal });
      eq(`aborted while page ${abortAt + 1} is in flight: that page is dropped and no more are asked for`,
         [src.requests.length, r.value, isAbort(r.error)], [abortAt + 1, undefined, true]);
    }
    {
      // Even the page that would have completed the load is not returned.
      const ac = new AbortController();
      const src = source(table(12), (p, i) => { if (i === 2) ac.abort(); return p; });
      const r = await load(src, { signal: ac.signal });
      eq("aborted during the last page: still nothing returned", [r.value, isAbort(r.error)], [undefined, true]);
    }
    {
      const ac = new AbortController();
      const reason = new Error("superseded");
      ac.abort(reason);
      ok("an Error given as the abort reason is thrown as itself", (await load(source(table(3)), { signal: ac.signal })).error === reason);
    }
    {
      const ac = new AbortController();
      const src = source(table(12));
      eq("a signal that is never aborted changes nothing", [(await load(src, { signal: ac.signal })).value?.length, src.requests.length], [12, 3]);
    }
  }
}

// ── 2) The Visits fetcher, at the real page size ─────────────────────────────
const RANGE = { from: "2026-01-01", to: "2026-12-31" };
const DATES = ["2026-08-01", "2026-08-02", "2026-08-03", "2026-08-04", "2026-08-05", "2026-08-06", "2026-08-07"];
const visit = (n: number) => ({
  // Ids ascend with n; dates do not, so restoring the tab's order is real work.
  id: key(n), scheduled_date: DATES[(n * 5) % DATES.length], status: "completed", duration_minutes: n % 90,
  merch_id: "m", place_id: "p", place: null, merch: null,
});
const visits = (n: number) => Array.from({ length: n }, (_, i) => visit(i + 1));

/** Queue the pages a keyset read of `rows` would get, with optional tampering. */
function queuePages(rows: ReturnType<typeof visits>, tamper?: (page: { data: unknown; error: unknown; count?: number | null }, index: number) => typeof page) {
  resetStub();
  for (let start = 0, i = 0; start < rows.length || i === 0; start += REPORT_PAGE_SIZE, i++) {
    const page = { data: rows.slice(start, start + REPORT_PAGE_SIZE), error: null, count: rows.length - start };
    queueResultFor("visits", tamper ? tamper(page, i) : page);
  }
}
const outcome = async (run: () => Promise<unknown>) => {
  try { return { value: await run(), error: undefined as unknown }; } catch (error) { return { value: undefined, error }; }
};
const visitCalls = () => recordedCalls().filter((c) => c.table === "visits");
const cursors = () => visitCalls().map((c) => c.conditions.filter((x) => x.op === "gt").map((x) => [x.column, x.value]));

console.log("2) fetchVisitsReport, paged");
{
  for (const [label, n, pages] of [["under a page", 3, 1], ["exactly a full page", 1000, 1], ["one row over", 1001, 2], ["several pages", 2300, 3]] as const) {
    const rows = visits(n);
    queuePages(rows);
    const out = await fetchVisitsReport(RANGE);
    eq(`${label} (${n}): every visit is returned, in ${pages} request${pages === 1 ? "" : "s"}`, [out.length, visitCalls().length], [n, pages]);
    ok(`${label}: each id appears exactly once`, new Set(out.map((r) => r.id)).size === n);
    ok(`${label}: newest date first, then id descending — the tab's and the export's order`,
       out.every((r, i) => i === 0 || out[i - 1].scheduled_date > r.scheduled_date
         || (out[i - 1].scheduled_date === r.scheduled_date && out[i - 1].id > r.id)));
  }

  {
    const rows = visits(2300);
    queuePages(rows);
    const out = await fetchVisitsReport(RANGE, { merchId: "M", placeId: "P", status: "completed" });
    const calls = visitCalls();
    eq("page cursors: none, then the last id of each page before", cursors(), [[], [["id", key(1000)]], [["id", key(2000)]]]);
    ok("every page asks for an exact count", calls.every((c) => JSON.stringify(c.selectOptions) === '{"count":"exact"}'));
    ok("every page is ordered by id ascending, and by nothing else", calls.every((c) => JSON.stringify(c.orders) === '[{"column":"id","ascending":true}]'));
    ok("every page asks for at most the cap", calls.every((c) => c.limit === REPORT_PAGE_SIZE));
    ok("every page carries the same date range", calls.every((c) =>
      JSON.stringify(c.conditions.filter((x) => x.column === "scheduled_date").map((x) => [x.op, x.value])) === JSON.stringify([["gte", RANGE.from], ["lte", RANGE.to]])));
    ok("every page carries the same filters, so each count is of the same query", calls.every((c) =>
      JSON.stringify(c.filters) === JSON.stringify([{ column: "merch_id", value: "M" }, { column: "place_id", value: "P" }, { column: "status", value: "completed" }])));
    ok("every page selects the same columns", new Set(calls.map((c) => c.columns)).size === 1 && calls[0].columns.includes("scheduled_date"));

    // The mapping is what it was: compared against a sort written differently.
    const expected = rows.slice().sort((a, b) => b.scheduled_date.localeCompare(a.scheduled_date) || b.id.localeCompare(a.id));
    eq("the rows are the same rows, mapped as before", out.map((r) => [r.id, r.scheduled_date, r.duration_minutes, r.branch_ar, r.merch_name]),
       expected.map((r) => [r.id, r.scheduled_date, r.duration_minutes, "—", "—"]));
    eq("the first and last rows shown", [out[0].scheduled_date, out[out.length - 1].scheduled_date], ["2026-08-07", "2026-08-01"]);
  }

  // ── Refusals reach the caller as the errors the tab already understands ───
  const refusals: Array<[string, Parameters<typeof queuePages>[1], unknown[], number]> = [
    ["a count that drifts on page 2", (p, i) => (i === 1 ? { ...p, count: (p.count as number) + 1 } : p), ["visits", "unverified", 2000, null], 2],
    ["no count on page 2",            (p, i) => (i === 1 ? { data: p.data, error: null } : p),            ["visits", "unverified", 2000, null], 2],
    ["no count on page 1",            (p, i) => (i === 0 ? { data: p.data, error: null } : p),            ["visits", "unverified", 1000, null], 1],
    ["a short page 2",                (p, i) => (i === 1 ? { ...p, data: (p.data as unknown[]).slice(0, 999) } : p), ["visits", "truncated", 1999, 2300], 2],
    ["a short page 1 (a lower cap)",  (p, i) => (i === 0 ? { ...p, data: (p.data as unknown[]).slice(0, 500) } : p), ["visits", "truncated", 500, 2300], 1],
    ["page 2 repeating page 1",       (p, i) => (i === 1 ? { ...p, data: visits(1000) } : p),             ["visits", "unverified", 2000, null], 2],
    ["a null page body",              (p, i) => (i === 1 ? { ...p, data: null } : p),                     ["visits", "truncated", 1000, 2300], 2],
  ];
  for (const [label, tamper, expected, requests] of refusals) {
    queuePages(visits(2300), tamper);
    const r = await outcome(() => fetchVisitsReport(RANGE));
    eq(`${label} → refused, no partial rows, no further page`, [refusal(r.error), r.value, visitCalls().length], [expected, undefined, requests]);
  }
  {
    const dbError = { code: "57014", message: "canceling statement due to statement timeout" };
    queuePages(visits(2300), (p, i) => (i === 1 ? { data: null, error: dbError, count: null } : p));
    const r = await outcome(() => fetchVisitsReport(RANGE));
    ok("a query error on page 2 is thrown as the Supabase error itself", r.error === dbError);
    eq("…with no partial rows and no third request", [r.value, visitCalls().length], [undefined, 2]);
  }
  {
    resetStub();
    queueResultFor("visits", { data: visits(1000), error: null, count: REPORT_MAX_ROWS + 1 });
    const r = await outcome(() => fetchVisitsReport(RANGE));
    eq("a range over the hard maximum → refused as too large after one request",
       [refusal(r.error), (r.error as ReportIncompleteError).max, r.value, visitCalls().length],
       [["visits", "tooLarge", 1000, REPORT_MAX_ROWS + 1], REPORT_MAX_ROWS, undefined, 1]);
  }

  // ── Cancellation ──────────────────────────────────────────────────────────
  {
    const before = new AbortController();
    before.abort();
    queuePages(visits(2300));
    const r = await outcome(() => fetchVisitsReport(RANGE, undefined, before.signal));
    eq("an already-aborted signal: no request at all", [visitCalls().length, r.value, (r.error as Error)?.name], [0, undefined, "AbortError"]);

    // Aborted as the fetcher reads page 1's body — i.e. while the load is under way.
    const ac = new AbortController();
    const rows = visits(2300);
    queuePages(rows, (p, i) => (i === 0 ? { error: null, count: p.count, get data() { ac.abort(); return rows.slice(0, 1000); } } : p));
    const mid = await outcome(() => fetchVisitsReport(RANGE, undefined, ac.signal));
    eq("aborted during page 1: nothing returned, and page 2 is never requested", [visitCalls().length, mid.value, (mid.error as Error)?.name], [1, undefined, "AbortError"]);

    queuePages(visits(2300));
    const live = new AbortController();
    await fetchVisitsReport(RANGE, undefined, live.signal);
    ok("the signal is attached to every page request", visitCalls().length === 3 && visitCalls().every((c) => c.signal === live.signal));
    queuePages(visits(3));
    await fetchVisitsReport(RANGE);
    ok("with no signal, none is attached", visitCalls()[0].signal === undefined);
  }
}

// ── 3) The hook hands over TanStack's signal ─────────────────────────────────
console.log("3) the Visits hook and cancellation");
{
  const client = new QueryClient({ defaultOptions: { queries: { retry: 1, retryDelay: 5 } } });
  function Probe() {
    useReportSummary(RANGE); useVisitsReport(RANGE); useMerchReport(RANGE);
    useBranchReport(RANGE); useProductReport(RANGE); useGpsReport(RANGE);
    return null;
  }
  renderToString(createElement(QueryClientProvider, { client }, createElement(Probe)));
  type Fn = (context: { signal: AbortSignal }) => Promise<unknown>;
  const fnOf = (tab: string) => client.getQueryCache().getAll().find((q) => q.queryKey[1] === tab)!.options.queryFn as unknown as Fn;

  // Which hooks read the signal TanStack offers them.
  const usesSignal: Record<string, boolean> = {};
  for (const tab of ["summary", "visits", "merch", "branch", "product", "gps"]) {
    resetStub();
    let read = false;
    const context = { get signal() { read = true; return new AbortController().signal; } };
    await fnOf(tab)(context).catch(() => {});
    usesSignal[tab] = read;
  }
  eq("only the Visits hook takes the abort signal in this batch",
     usesSignal, { summary: false, visits: true, merch: false, branch: false, product: false, gps: false });

  {
    const aborted = new AbortController();
    aborted.abort();
    queuePages(visits(2300));
    const r = await outcome(() => fnOf("visits")({ signal: aborted.signal }));
    eq("the hook's signal reaches the fetcher: aborted means no request", [visitCalls().length, (r.error as Error)?.name], [0, "AbortError"]);
  }

  // A real query, cancelled the way a changed range or filter cancels it.
  {
    client.mount();
    const queryKey = ["reports", "visits", "cancel-me"];
    const rows = visits(2300);
    queuePages(rows, (p, i) => (i === 0
      ? { error: null, count: p.count, get data() { void client.cancelQueries({ queryKey }); return rows.slice(0, 1000); } }
      : p));
    const observer = new QueryObserver(client, { queryKey, queryFn: fnOf("visits") as never, retry: false });
    const unsubscribe = observer.subscribe(() => {});
    for (let i = 0; i < 400 && observer.getCurrentResult().fetchStatus !== "idle"; i++) await new Promise((r) => setTimeout(r, 5));
    await new Promise((r) => setTimeout(r, 60));
    const result = observer.getCurrentResult();
    eq("a cancelled query stops after the page in flight", visitCalls().length, 1);
    eq("…and holds no rows", [result.data, result.fetchStatus], [undefined, "idle"]);

    // The same query, left alone, loads all three pages.
    queuePages(rows);
    await observer.refetch();
    eq("left alone, the same query loads every page", [visitCalls().length, (observer.getCurrentResult().data as unknown[] | undefined)?.length], [3, 2300]);
    unsubscribe();
    client.unmount();
  }
  client.clear();
}

// ── 4) The over-maximum notice ───────────────────────────────────────────────
function tFor(locale: "ar" | "en"): TranslationFn {
  const dict = translations[locale] as Record<string, string>;
  return (k, vars) => {
    let str = dict[k] ?? k;
    if (vars) for (const [name, v] of Object.entries(vars)) str = str.split(`{${name}}`).join(String(v));
    return str;
  };
}
function stateOf<T>(r: { data?: T[]; isFetching: boolean; isPaused: boolean; isError: boolean; error: unknown }) {
  return reportTabState<T>({ data: r.data, isFetching: r.isFetching, isPaused: r.isPaused, isError: r.isError, error: r.error });
}

console.log("4) a range over the maximum");
{
  const tooLarge = new ReportIncompleteError("visits", "tooLarge", 1000, 25_340, REPORT_MAX_ROWS);
  const cut      = new ReportIncompleteError("visits", "truncated", 500, 2300);
  const failed   = { data: undefined, isFetching: false, isPaused: false, isError: true };

  const state = stateOf<Row>({ ...failed, error: tooLarge });
  eq("its own state, with the real total and the maximum — and no rows", state, { kind: "tooLarge", rows: [], total: 25_340, max: REPORT_MAX_ROWS });
  eq("no export", canExportReport(state), false);
  eq("rows cached from an earlier, smaller range are withheld too",
     stateOf<Row>({ ...failed, data: table(3), error: tooLarge }), { kind: "tooLarge", rows: [], total: 25_340, max: REPORT_MAX_ROWS });
  eq("without its figures it falls back to unverified rather than print a blank",
     stateOf<Row>({ ...failed, error: new ReportIncompleteError("visits", "tooLarge", 0, null, null) }).kind, "unverified");

  for (const locale of ["ar", "en"] as const) {
    const dict = translations[locale] as Record<string, string>;
    const m = reportTabMessage(state, tFor(locale))!;
    eq(`[${locale}] the notice is the too-large sentence, filled in`,
       m.title, dict["reports.data.tooLarge"].replace("{total}", "25,340").replace("{max}", "20,000"));
    ok(`[${locale}] it states the supported maximum of 20,000 and the range's own count`, m.title.includes("20,000") && m.title.includes("25,340"));
    ok(`[${locale}] it does not present the first page (1,000) as a limit or as loaded`,
       !/1,000|1000/.test(m.title.replace("25,340", "").replace("20,000", "")));
    ok(`[${locale}] no placeholder is left unfilled`, !/[{}]/.test(m.title + m.detail));
    eq(`[${locale}] it tells the user to narrow the range`, m.detail, dict["reports.data.narrow"]);
    ok(`[${locale}] the sentence names a maximum`,
       locale === "ar" ? dict["reports.data.tooLarge"].includes("الحد الأقصى") : /maximum/i.test(dict["reports.data.tooLarge"]));

    // A page that really was cut short keeps the notice it always had.
    const cutState = stateOf<Row>({ ...failed, error: cut });
    eq(`[${locale}] a short page is still the truncated notice, with rows loaded and total`,
       [cutState, reportTabMessage(cutState, tFor(locale))!.title],
       [{ kind: "truncated", rows: [], loaded: 500, total: 2300 }, dict["reports.data.truncated"].replace("{total}", "2300").replace("{loaded}", "500")]);
  }
}

// ── 5) Multi-page loads on a real TanStack Query observer ────────────────────
// The options mirror the Visits hook: the key carries the range, the query
// function hands the fetcher TanStack's signal, and the outer retry is off.
console.log("5) a changed range mid-load, and a failed page");
{
  type Out = Awaited<ReturnType<typeof fetchVisitsReport>>;
  const optionsFor = (range: { from: string; to: string }) => ({
    queryKey: ["reports", "visits", range.from, range.to] as const,
    queryFn:  ({ signal }: { signal: AbortSignal }) => fetchVisitsReport(range, undefined, signal),
    retry:    false as const,
  });
  const idle = async (o: QueryObserver<Out>) => {
    for (let i = 0; i < 400 && o.getCurrentResult().fetchStatus !== "idle"; i++) await new Promise((r) => setTimeout(r, 5));
    await new Promise((r) => setTimeout(r, 60));
  };
  const datesOf = (i: number) => visitCalls()[i].conditions.filter((c) => c.column === "scheduled_date").map((c) => c.value);

  // ── The range changes while page 1 of the old range is in flight ──────────
  {
    const client = new QueryClient({ defaultOptions: { queries: { retry: 1, retryDelay: 5 } } });
    client.mount();
    const A = { from: "2026-01-01", to: "2026-06-30" };
    const B = { from: "2026-07-01", to: "2026-12-31" };
    const rowsA = visits(2300);
    const rowsB = Array.from({ length: 1200 }, (_, i) => visit(50_000 + i + 1));

    const observer = new QueryObserver<Out>(client, optionsFor(A));
    resetStub();
    // A's first page: as it arrives, the user changes the range.
    queueResultFor("visits", { error: null, count: rowsA.length, get data() { observer.setOptions(optionsFor(B)); return rowsA.slice(0, 1000); } });
    // Whatever is asked next is answered with B's pages.
    queueResultFor("visits", { data: rowsB.slice(0, 1000), error: null, count: 1200 });
    queueResultFor("visits", { data: rowsB.slice(1000), error: null, count: 200 });
    // If the old load asked for another page, it would get this — and be counted.
    queueResultFor("visits", { data: rowsA.slice(1000, 2000), error: null, count: 1300 });

    const seen: Array<{ rows: number; firstId: string | undefined }> = [];
    const unsubscribe = observer.subscribe((r) => { if (r.data) seen.push({ rows: r.data.length, firstId: r.data[0]?.id }); });
    await idle(observer);

    eq("three requests in all: one for the old range, two for the new", visitCalls().length, 3);
    eq("the old range was asked for once, and never for a second page", [datesOf(0), cursors()[0]], [[A.from, A.to], []]);
    eq("both later requests are the new range's pages", [datesOf(1), datesOf(2), cursors().slice(1)],
       [[B.from, B.to], [B.from, B.to], [[], [["id", key(51_000)]]]]);
    ok("the old range's query holds no rows", client.getQueryData(optionsFor(A).queryKey) === undefined);
    const result = observer.getCurrentResult();
    const bIds = new Set(rowsB.map((r) => r.id));
    eq("the tab shows the new range, complete", [result.status, result.data?.length], ["success", 1200]);
    ok("…and every row shown belongs to the new range", (result.data ?? []).every((r) => bIds.has(r.id)));
    ok("the old range's rows were never published to the observer",
       seen.length > 0 && seen.every((s) => s.rows === 1200 && bIds.has(s.firstId ?? "")));
    ok("the new range's cache holds only its own rows",
       ((client.getQueryData(optionsFor(B).queryKey) as Out | undefined) ?? []).every((r) => bIds.has(r.id)));
    unsubscribe();
    client.unmount();
    client.clear();
  }

  // ── Page 2 fails; Retry loads everything ──────────────────────────────────
  const pageTwoProblems: Array<[string, Parameters<typeof queuePages>[1], string]> = [
    ["a query error on page 2", (p, i) => (i === 1 ? { data: null, error: { code: "57014", message: "statement timeout" }, count: null } : p), "error"],
    ["a count that drifts on page 2", (p, i) => (i === 1 ? { ...p, count: (p.count as number) - 1 } : p), "unverified"],
    ["a short page 2", (p, i) => (i === 1 ? { ...p, data: (p.data as unknown[]).slice(0, 10) } : p), "truncated"],
  ];
  for (const [label, tamper, kind] of pageTwoProblems) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: 1, retryDelay: 5 } } });
    client.mount();
    const rows = visits(2300);
    queuePages(rows, tamper);
    const observer = new QueryObserver<Out>(client, optionsFor(RANGE));
    const published: number[] = [];
    const unsubscribe = observer.subscribe((r) => { if (r.data) published.push(r.data.length); });
    await idle(observer);

    const failedState = stateOf<Out[number]>(observer.getCurrentResult());
    eq(`${label}: the tab is in the ${kind} state after two requests, with no rows`,
       [failedState.kind, failedState.rows.length, visitCalls().length], [kind, 0, 2]);
    eq(`${label}: nothing to export, and the first page was never published`, [canExportReport(failedState), published.slice()], [false, []]);
    ok(`${label}: there is a notice to show`, reportTabMessage(failedState, tFor("en")) !== null);

    // The user's Retry: a fresh load from the first page.
    queuePages(rows);
    await observer.refetch();
    await idle(observer);
    const retried = stateOf<Out[number]>(observer.getCurrentResult());
    eq(`${label}: Retry starts again from page 1 and loads every page`, [visitCalls().length, cursors()[0]], [3, []]);
    eq(`${label}: rows and Export are back, complete`, [retried.kind, retried.rows.length, canExportReport(retried)], ["ready", 2300, true]);
    eq(`${label}: only the complete result was ever published`, [...new Set(published)], [2300]);

    // A later refresh whose page 2 fails withholds the rows it had.
    queuePages(rows, tamper);
    await observer.refetch();
    await idle(observer);
    const refreshed = stateOf<Out[number]>(observer.getCurrentResult());
    eq(`${label}: on a failed refresh the earlier rows are withheld and Export is off`,
       [refreshed.kind, refreshed.rows.length, canExportReport(refreshed)], [kind, 0, false]);
    unsubscribe();
    client.unmount();
    client.clear();
  }
}
