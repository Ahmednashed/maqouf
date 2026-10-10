// The checks every paged report tab must pass, written once.
//
// GPS Compliance, Branch Coverage and Product Availability each build a few
// aggregate rows in the browser from a large base read, and each now makes that
// read through the paged loader (tests/report-pages.test.ts pins the loader;
// tests/report-merch-pages.test.ts is the same idea, written out longhand, for
// Merch). What a tab has to show is the same in every case:
//
//   • the same answer however many requests the rows arrive in;
//   • the same count, order, limit and filters on every page, and a cursor that
//     advances by the tab's unique key;
//   • nothing at all — never a partial aggregate, never an enabled Export —
//     when a page is uncounted, miscounted, short, out of order or failed, or
//     the range is over the maximum;
//   • Retry starting again from the first page; and a load whose filters have
//     changed stopping, without publishing anything.
//
// Each tab's test file supplies its fetcher, a fixture, and a second, plainly
// written implementation of the answer, then calls runPagedTabSuite.
// This is not a test file itself (the runner only collects *.test.ts).

import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { eq, ok } from "./_harness.ts";
import { REPORT_MAX_ROWS, REPORT_PAGE_SIZE } from "@/lib/report-pages";
import { ReportIncompleteError, canExportReport, reportTabMessage, reportTabState } from "@/lib/report-completeness";
import { translations } from "@/lib/i18n/translations";
import type { ReportFilters } from "@/services/reports";
import { recordedCalls, queueResultFor, resetStub, type RecordedCall } from "./stubs/supabase-client.ts";

export type Page = { data: unknown; error: unknown; count?: number | null };
export type Tamper = (page: Page, index: number) => Page;
export type Filters = ReportFilters;

export interface PagedTab<Raw, Out> {
  name:  "gps" | "branch" | "product";
  /** The base table the paged read is against. */
  table: string;
  run:   (filters?: Filters, signal?: AbortSignal) => Promise<Out[]>;
  /** `n` base rows, in ascending cursor order. */
  rowsOf: (n: number) => Raw[];
  /** The answer for those rows, worked out independently of the fetcher. */
  reference: (rows: Raw[]) => Out[];
  /** The cursor condition the page AFTER `row` must carry, as the stub records it. */
  cursorAfter: (row: Raw) => unknown[];
  /** Other reads the fetcher makes on every load (Branch), queued per load. */
  queueExtras?: () => void;
  dateColumn:  string;
  merchColumn: string;
  placeColumn: string;
  /** `eq` filters the read always carries, besides merchandiser and branch. */
  fixedFilters: Array<{ column: string; value: unknown }>;
  /** Non-`eq`, non-date, non-cursor conditions the read always carries. */
  fixedConditions: unknown[][];
  orders: Array<{ column: string; ascending: boolean }>;
  /** Exactly the fields of an output row, sorted. */
  outputKeys: string[];
  /** Matches any cursor value of the fixture; must not match the output. */
  leak: RegExp;
  /** A narrower load for the "filters changed mid-load" case: 1,001–2,000 rows with keys of their own. */
  narrowed: { filters: Filters; rows: Raw[] };
}

export const RANGE = { from: "2026-01-01", to: "2026-12-31" };
export const key = (n: number) => `k${String(n).padStart(6, "0")}`;

export function tabCalls(tab: { table: string }): RecordedCall[] {
  return recordedCalls().filter((c) => c.table === tab.table);
}
/** The cursor conditions each page request carried: [] for a first page. */
export function cursors(tab: { table: string }): unknown[][] {
  return tabCalls(tab).map((c) => c.conditions
    .filter((x) => x.op === "gt" || x.op === "or")
    .flatMap((x) => (x.op === "gt" ? ["gt", x.column, x.value] : ["or", x.value])));
}

/** Queue the pages a keyset read of `rows` would get (after a reset), with optional tampering. */
export function queuePages<Raw, Out>(tab: PagedTab<Raw, Out>, rows: Raw[], tamper?: Tamper, reset = true): void {
  if (reset) resetStub();
  for (let start = 0, i = 0; start < rows.length || i === 0; start += REPORT_PAGE_SIZE, i++) {
    const page: Page = { data: rows.slice(start, start + REPORT_PAGE_SIZE), error: null, count: rows.length - start };
    queueResultFor(tab.table, tamper ? tamper(page, i) : page);
  }
  tab.queueExtras?.();
}

export async function outcome<T>(run: () => Promise<T>): Promise<{ value?: T; error?: unknown }> {
  try { return { value: await run() }; } catch (error) { return { error }; }
}
export const refusal = (e: unknown) =>
  e instanceof ReportIncompleteError ? [e.report, e.reason, e.loaded, e.total, e.max] : ["not a ReportIncompleteError", String(e)];

export function stateOf<Out>(r: { data?: Out[]; isFetching: boolean; isPaused: boolean; isError: boolean; error: unknown }) {
  return reportTabState<Out>({ data: r.data, isFetching: r.isFetching, isPaused: r.isPaused, isError: r.isError, error: r.error });
}
export const en = (k: string, vars?: Record<string, string | number>) => {
  let s = (translations.en as Record<string, string>)[k] ?? k;
  if (vars) for (const [name, v] of Object.entries(vars)) s = s.split(`{${name}}`).join(String(v));
  return s;
};
export async function idle<Out>(o: QueryObserver<Out[]>): Promise<void> {
  for (let i = 0; i < 400 && o.getCurrentResult().fetchStatus !== "idle"; i++) await new Promise((r) => setTimeout(r, 5));
  await new Promise((r) => setTimeout(r, 60));
}
/** Options shaped like the tab's hook: filters in the key, the signal passed on, the outer retry off. */
export function optionsFor<Raw, Out>(tab: PagedTab<Raw, Out>, filters?: Filters) {
  return {
    queryKey: ["reports", tab.name, RANGE.from, RANGE.to, JSON.stringify(filters ?? {})] as const,
    queryFn:  ({ signal }: { signal: AbortSignal }) => tab.run(filters, signal),
    retry:    false as const,
  };
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const sorted = (xs: unknown[]) => xs.map((x) => JSON.stringify(x)).sort();

export async function runPagedTabSuite<Raw, Out extends object>(tab: PagedTab<Raw, Out>): Promise<void> {
  const T = tab.name;

  // ── Sizes around the page boundary ─────────────────────────────────────────
  console.log(`${T}: one page, a full page, and beyond`);
  for (const [label, n, pages] of [["a handful", 7, 1], ["exactly a full page", 1000, 1], ["one row over", 1001, 2], ["several pages", 2300, 3]] as const) {
    const rows = tab.rowsOf(n);
    queuePages(tab, rows);
    const out = await tab.run();
    eq(`[${T}] ${label} (${n} rows): ${pages} request${pages === 1 ? "" : "s"}`, tabCalls(tab).length, pages);
    eq(`[${T}] ${label}: the figures are exactly the reference's`, out, tab.reference(rows));
    ok(`[${T}] ${label}: rows have the report's fields and nothing else`,
       out.length > 0 && out.every((r) => same(Object.keys(r).sort(), tab.outputKeys)));
    ok(`[${T}] ${label}: no cursor value appears anywhere in the output`, !tab.leak.test(JSON.stringify(out)));
  }

  // ── What each page asks for ────────────────────────────────────────────────
  console.log(`${T}: what each page asks for`);
  {
    const rows = tab.rowsOf(2300);
    queuePages(tab, rows);
    await tab.run({ merchId: "M", placeId: "P", status: "completed" });
    const c = tabCalls(tab);
    eq(`[${T}] cursors: none, then the key of the last row of each page before`,
       cursors(tab), [[], tab.cursorAfter(rows[999]), tab.cursorAfter(rows[1999])]);
    ok(`[${T}] every page asks for an exact count`, c.every((x) => same(x.selectOptions, { count: "exact" })));
    ok(`[${T}] every page has the same unique order`, c.every((x) => same(x.orders, tab.orders)));
    ok(`[${T}] every page asks for at most the cap`, c.every((x) => x.limit === REPORT_PAGE_SIZE));
    ok(`[${T}] every page carries the same date range`, c.every((x) =>
      same(x.conditions.filter((k) => k.column === tab.dateColumn).map((k) => [k.op, k.value]), [["gte", RANGE.from], ["lte", RANGE.to]])));
    const expectedFilters = sorted([...tab.fixedFilters, { column: tab.merchColumn, value: "M" }, { column: tab.placeColumn, value: "P" }]);
    ok(`[${T}] every page carries the merchandiser and branch filters, and no filter that was not there before`,
       c.every((x) => same(sorted(x.filters), expectedFilters)));
    ok(`[${T}] every page carries the read's own fixed conditions`, c.every((x) =>
      same(x.conditions.filter((k) => k.column !== tab.dateColumn && k.op !== "gt" && k.op !== "or").map((k) => [k.op, k.column, k.operator ?? null, k.value]),
           tab.fixedConditions)));
    ok(`[${T}] every page selects the same columns`, new Set(c.map((x) => x.columns)).size === 1);
  }

  // ── Refusals: nothing, never a partial aggregate ───────────────────────────
  console.log(`${T}: a page that cannot be trusted`);
  {
    const N = 2300;
    const refusals: Array<[string, Tamper, unknown[], number]> = [
      ["a count that drifts on page 2", (p, i) => (i === 1 ? { ...p, count: (p.count as number) + 1 } : p), [T, "unverified", 2000, null, null], 2],
      ["no count on page 2",            (p, i) => (i === 1 ? { data: p.data, error: null } : p),            [T, "unverified", 2000, null, null], 2],
      ["no count on page 1",            (p, i) => (i === 0 ? { data: p.data, error: null } : p),            [T, "unverified", 1000, null, null], 1],
      ["a short page 2",                (p, i) => (i === 1 ? { ...p, data: (p.data as unknown[]).slice(0, 999) } : p), [T, "truncated", 1999, N, null], 2],
      ["a short page 1 (a lower cap)",  (p, i) => (i === 0 ? { ...p, data: (p.data as unknown[]).slice(0, 500) } : p), [T, "truncated", 500, N, null], 1],
      ["page 2 repeating page 1",       (p, i) => (i === 1 ? { ...p, data: tab.rowsOf(1000) } : p),         [T, "unverified", 2000, null, null], 2],
      ["page 2 out of order",           (p, i) => (i === 1 ? { ...p, data: (p.data as unknown[]).slice().reverse() } : p), [T, "unverified", 2000, null, null], 2],
    ];
    for (const [label, tamper, expected, requests] of refusals) {
      queuePages(tab, tab.rowsOf(N), tamper);
      const r = await outcome(() => tab.run());
      eq(`[${T}] ${label} → refused, no partial aggregate, no further page`, [refusal(r.error), r.value, tabCalls(tab).length], [expected, undefined, requests]);
    }
    {
      const dbError = { code: "57014", message: "canceling statement due to statement timeout" };
      queuePages(tab, tab.rowsOf(N), (p, i) => (i === 1 ? { data: null, error: dbError, count: null } : p));
      const r = await outcome(() => tab.run());
      ok(`[${T}] a query error on page 2 is thrown as the Supabase error itself`, r.error === dbError);
      eq(`[${T}] …with no partial aggregate and no third request`, [r.value, tabCalls(tab).length], [undefined, 2]);
    }
    {
      queuePages(tab, tab.rowsOf(1000), (p) => ({ ...p, count: REPORT_MAX_ROWS + 1 }));
      const r = await outcome(() => tab.run());
      eq(`[${T}] 20,001 rows → refused as too large after one request, naming the maximum`,
         [refusal(r.error), r.value, tabCalls(tab).length], [[T, "tooLarge", 1000, 20_001, 20_000], undefined, 1]);
    }
  }

  // ── On a real TanStack Query observer ──────────────────────────────────────
  console.log(`${T}: a failed second page, then Retry`);
  {
    const problems: Array<[string, Tamper, string]> = [
      ["a query error on page 2", (p, i) => (i === 1 ? { data: null, error: { code: "57014", message: "statement timeout" }, count: null } : p), "error"],
      ["a count that drifts on page 2", (p, i) => (i === 1 ? { ...p, count: (p.count as number) - 1 } : p), "unverified"],
      ["a short page 2", (p, i) => (i === 1 ? { ...p, data: (p.data as unknown[]).slice(0, 10) } : p), "truncated"],
    ];
    const rows = tab.rowsOf(2300);
    const expected = tab.reference(rows);
    for (const [label, tamper, kind] of problems) {
      const client = new QueryClient({ defaultOptions: { queries: { retry: 1, retryDelay: 5 } } });
      client.mount();
      queuePages(tab, rows, tamper);
      const observer = new QueryObserver<Out[]>(client, optionsFor(tab));
      const published: Out[][] = [];
      const unsubscribe = observer.subscribe((r) => { if (r.data) published.push(r.data); });
      await idle(observer);

      const failed = stateOf<Out>(observer.getCurrentResult());
      eq(`[${T}] ${label}: the tab is in the ${kind} state after two requests, with no rows`, [failed.kind, failed.rows.length, tabCalls(tab).length], [kind, 0, 2]);
      eq(`[${T}] ${label}: Export is off, and no aggregate of page 1 alone was ever published`, [canExportReport(failed), published.length], [false, 0]);
      ok(`[${T}] ${label}: there is a notice to show`, reportTabMessage(failed, en) !== null);

      queuePages(tab, rows);
      await observer.refetch();
      await idle(observer);
      const retried = stateOf<Out>(observer.getCurrentResult());
      eq(`[${T}] ${label}: Retry starts again from page 1 and reads every page`, [tabCalls(tab).length, cursors(tab)[0]], [3, []]);
      eq(`[${T}] ${label}: the rows and Export are back`, [retried.kind, canExportReport(retried)], ["ready", true]);
      eq(`[${T}] ${label}: …and they are the complete figures`, retried.rows, expected);
      ok(`[${T}] ${label}: only the complete figures were ever published`, published.length > 0 && published.every((p) => same(p, expected)));

      queuePages(tab, rows, tamper);
      await observer.refetch();
      await idle(observer);
      const refreshed = stateOf<Out>(observer.getCurrentResult());
      eq(`[${T}] ${label}: on a failed refresh the earlier figures are withheld and Export is off`,
         [refreshed.kind, refreshed.rows.length, canExportReport(refreshed)], [kind, 0, false]);
      unsubscribe();
      client.unmount();
      client.clear();
    }

    {
      const client = new QueryClient({ defaultOptions: { queries: { retry: 1, retryDelay: 5 } } });
      client.mount();
      queuePages(tab, tab.rowsOf(1000), (p) => ({ ...p, count: 25_340 }));
      const observer = new QueryObserver<Out[]>(client, optionsFor(tab));
      const unsubscribe = observer.subscribe(() => {});
      await idle(observer);
      const state = stateOf<Out>(observer.getCurrentResult());
      eq(`[${T}] over the maximum: the too-large state, no rows, no export, one request`,
         [state.kind, state.rows.length, canExportReport(state), tabCalls(tab).length], ["tooLarge", 0, false, 1]);
      ok(`[${T}] over the maximum: the notice names 20,000`, reportTabMessage(state, en)!.title.includes("20,000"));
      unsubscribe();
      client.unmount();
      client.clear();
    }
  }

  // ── The filters change mid-load ────────────────────────────────────────────
  console.log(`${T}: the filter changes mid-load`);
  {
    const client = new QueryClient({ defaultOptions: { queries: { retry: 1, retryDelay: 5 } } });
    client.mount();
    const all = tab.rowsOf(2300);
    const { filters, rows: narrowed } = tab.narrowed;
    const A = optionsFor(tab);
    const B = optionsFor(tab, filters);
    const observer = new QueryObserver<Out[]>(client, A);

    resetStub();
    // The unfiltered load's first page: as it arrives, the user narrows the report.
    queueResultFor(tab.table, { error: null, count: all.length, get data() { observer.setOptions(B); return all.slice(0, 1000); } });
    queueResultFor(tab.table, { data: narrowed.slice(0, 1000), error: null, count: narrowed.length });
    queueResultFor(tab.table, { data: narrowed.slice(1000), error: null, count: narrowed.length - 1000 });
    // If the old load asked for another page, it would get this — and be counted.
    queueResultFor(tab.table, { data: all.slice(1000, 2000), error: null, count: 1300 });
    tab.queueExtras?.();
    tab.queueExtras?.();

    const published: Out[][] = [];
    const unsubscribe = observer.subscribe((r) => { if (r.data) published.push(r.data); });
    await idle(observer);

    const merchOf = (i: number) => tabCalls(tab)[i].filters.filter((f) => f.column === tab.merchColumn).map((f) => f.value);
    const expected = tab.reference(narrowed);
    eq(`[${T}] three requests: one for the old filters, two for the new`, tabCalls(tab).length, 3);
    eq(`[${T}] the old load was asked for once, unfiltered, and never for a second page`, [merchOf(0), cursors(tab)[0]], [[], []]);
    eq(`[${T}] both later requests are the new filters' pages`,
       [merchOf(1), merchOf(2), cursors(tab).slice(1)], [[filters.merchId], [filters.merchId], [[], tab.cursorAfter(narrowed[999])]]);
    ok(`[${T}] the old query holds no figures`, client.getQueryData(A.queryKey) === undefined);
    const result = observer.getCurrentResult();
    eq(`[${T}] the tab shows the new filters' figures, complete`, [result.status, result.data], ["success", expected]);
    ok(`[${T}] nothing from the unfiltered load was ever published`, published.length > 0 && published.every((p) => same(p, expected)));
    unsubscribe();
    client.unmount();
    client.clear();
  }

  // ── The signal ─────────────────────────────────────────────────────────────
  console.log(`${T}: the abort signal`);
  {
    const aborted = new AbortController();
    aborted.abort();
    queuePages(tab, tab.rowsOf(2300));
    const r = await outcome(() => tab.run(undefined, aborted.signal));
    eq(`[${T}] an already-aborted signal: no request to ${tab.table}, nothing returned`,
       [tabCalls(tab).length, r.value, (r.error as Error)?.name], [0, undefined, "AbortError"]);

    const ac = new AbortController();
    const rows = tab.rowsOf(2300);
    queuePages(tab, rows, (p, i) => (i === 0 ? { error: null, count: p.count, get data() { ac.abort(); return rows.slice(0, 1000); } } : p));
    const mid = await outcome(() => tab.run(undefined, ac.signal));
    eq(`[${T}] aborted during page 1: nothing returned, and page 2 is never requested`,
       [tabCalls(tab).length, mid.value, (mid.error as Error)?.name], [1, undefined, "AbortError"]);

    queuePages(tab, tab.rowsOf(2300));
    const live = new AbortController();
    await tab.run(undefined, live.signal);
    ok(`[${T}] the signal is attached to every page request`, tabCalls(tab).length === 3 && tabCalls(tab).every((c) => c.signal === live.signal));
  }
}
