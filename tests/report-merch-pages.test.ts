// Merch Performance — the visit rows behind it, read in pages.
//
// The tab's answer is a few rows, one per merchandiser, but it is computed in
// the browser from every visit in the range. Those visits are now read through
// the paged loader (tests/report-pages.test.ts pins the loader itself). What
// matters here is that paging changes nothing about the answer:
//
//   • the same figures, names, rounding and order as before, whether the
//     visits arrive in one request or several — including for a merchandiser
//     whose visits straddle a page boundary;
//   • nothing at all, rather than a partial aggregate, when any page is
//     missing, miscounted, cut short or failed, or the range is too large;
//   • the visit `id` used as the paging key never reaches a report row.
//
// The expected figures come from a second implementation written here, plainly,
// plus a few literal values, so the fetcher is not being compared with itself.
// Everything runs against the recording stub at the real page size.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider, QueryObserver } from "@tanstack/react-query";
import { eq, ok } from "./_harness.ts";
import { fetchMerchReport, type MerchReportRow } from "@/services/reports";
import { useMerchReport } from "@/hooks/use-reports";
import { REPORT_MAX_ROWS, REPORT_PAGE_SIZE } from "@/lib/report-pages";
import { ReportIncompleteError, canExportReport, reportTabMessage, reportTabState } from "@/lib/report-completeness";
import { translations } from "@/lib/i18n/translations";
import { recordedCalls, queueResultFor, resetStub } from "./stubs/supabase-client.ts";

const RANGE = { from: "2026-01-01", to: "2026-12-31" };
const key = (n: number) => `k${String(n).padStart(6, "0")}`;

// ── Fixture ──────────────────────────────────────────────────────────────────
// Four merchandisers take turns, so each has visits on every page. A fifth,
// "edge", has exactly three visits placed across the first page boundary.
const STATUSES = ["completed", "missed", "pending", "inprogress", "completed"] as const;
const MERCHS = [
  { id: "m-ahmed", merch: { id: "m-ahmed", display_name: null,      user: { full_name: "Ahmed" } } },
  { id: "m-sara",  merch: { id: "m-sara",  display_name: " Sara ",  user: { full_name: "ignored" } } },
  { id: "m-blank", merch: { id: "m-blank", display_name: "   ",     user: { full_name: "Fallback Name" } } },
  { id: "m-gone",  merch: null },
];
// Rows 1000 and 1001 sit either side of the boundary; 1002 follows on page 2.
const EDGE: Record<number, { status: string; duration_minutes: number | null }> = {
  1000: { status: "completed", duration_minutes: 10 },
  1001: { status: "completed", duration_minutes: 15 },
  1002: { status: "missed",    duration_minutes: 0 },
};
const EDGE_MERCH = { id: "m-edge", display_name: null, user: { full_name: "Edge Case" } };

interface Raw { id: string; status: string; duration_minutes: number | null; merch_id: string; merch: (typeof MERCHS)[number]["merch"] | typeof EDGE_MERCH }
function row(n: number): Raw {
  if (EDGE[n]) return { id: key(n), ...EDGE[n], merch_id: EDGE_MERCH.id, merch: EDGE_MERCH };
  const m = MERCHS[n % MERCHS.length];
  const duration = n % 7 === 0 ? null : n % 11 === 0 ? 0 : (n % 50) + 1;
  return { id: key(n), status: STATUSES[n % STATUSES.length], duration_minutes: duration, merch_id: m.id, merch: m.merch };
}
const rowsOf = (n: number) => Array.from({ length: n }, (_, i) => row(i + 1));

// ── The answer, worked out a second way ──────────────────────────────────────
function reference(rows: Raw[]): MerchReportRow[] {
  const ids = [...new Set(rows.map((r) => r.merch_id))];           // first-met order
  const out = ids.map((id) => {
    const mine = rows.filter((r) => r.merch_id === id);
    const count = (s: string) => mine.filter((r) => r.status === s).length;
    const timed = mine.filter((r) => r.status === "completed" && typeof r.duration_minutes === "number" && r.duration_minutes > 0)
      .map((r) => r.duration_minutes as number);
    const completed = count("completed"), missed = count("missed");
    const first = mine[0].merch;
    return {
      merch_id:        id,
      full_name:       (first?.display_name ?? "").trim() || first?.user?.full_name || "—",
      total_visits:    mine.length,
      completed, missed,
      pending:         count("pending"),
      inprogress:      count("inprogress"),
      completion_rate: completed + missed > 0 ? Math.round((completed / (completed + missed)) * 100) : 0,
      avg_duration:    timed.length > 0 ? Math.round(timed.reduce((a, b) => a + b, 0) / timed.length) : 0,
    };
  });
  // Most completed first; ties keep first-met order.
  return out.map((r, i) => ({ r, i })).sort((a, b) => b.r.completed - a.r.completed || a.i - b.i).map((x) => x.r);
}

// ── Stub plumbing ────────────────────────────────────────────────────────────
type Page = { data: unknown; error: unknown; count?: number | null };
function queuePages(rows: Raw[], tamper?: (page: Page, index: number) => Page) {
  resetStub();
  for (let start = 0, i = 0; start < rows.length || i === 0; start += REPORT_PAGE_SIZE, i++) {
    const page: Page = { data: rows.slice(start, start + REPORT_PAGE_SIZE), error: null, count: rows.length - start };
    queueResultFor("visits", tamper ? tamper(page, i) : page);
  }
}
const calls = () => recordedCalls().filter((c) => c.table === "visits");
const cursors = () => calls().map((c) => c.conditions.filter((x) => x.op === "gt").map((x) => [x.column, x.value]));
const outcome = async <T,>(run: () => Promise<T>) => {
  try { return { value: await run(), error: undefined as unknown }; } catch (error) { return { value: undefined, error }; }
};
const refusal = (e: unknown) =>
  e instanceof ReportIncompleteError ? [e.report, e.reason, e.loaded, e.total, e.max] : ["not a ReportIncompleteError", String(e)];
const OUTPUT_KEYS = ["avg_duration", "completed", "completion_rate", "full_name", "inprogress", "merch_id", "missed", "pending", "total_visits"];

// ── 1) Sizes around the page boundary ────────────────────────────────────────
console.log("1) merch: one page, a full page, and beyond");
for (const [label, n, pages] of [["a handful", 6, 1], ["exactly a full page", 1000, 1], ["one row over", 1001, 2], ["several pages", 2300, 3]] as const) {
  const rows = rowsOf(n);
  queuePages(rows);
  const out = await fetchMerchReport(RANGE);
  eq(`${label} (${n} visits): ${pages} request${pages === 1 ? "" : "s"}`, calls().length, pages);
  eq(`${label}: the figures are exactly the reference's`, out, reference(rows));
  eq(`${label}: every visit is counted once`, out.reduce((a, r) => a + r.total_visits, 0), n);
  ok(`${label}: most completed first`, out.every((r, i) => i === 0 || out[i - 1].completed >= r.completed));
  ok(`${label}: rows have the report's fields and nothing else`, out.every((r) => JSON.stringify(Object.keys(r).sort()) === JSON.stringify(OUTPUT_KEYS)));
  ok(`${label}: no visit id appears anywhere in the output`, !/k\d{6}/.test(JSON.stringify(out)) && out.every((r) => !("id" in r)));
}

// ── 2) The requests ──────────────────────────────────────────────────────────
console.log("2) merch: what each page asks for");
{
  const rows = rowsOf(2300);
  queuePages(rows);
  await fetchMerchReport(RANGE, { merchId: "M", placeId: "P", status: "completed" });
  const c = calls();
  eq("cursors: none, then the last visit id of each page before", cursors(), [[], [["id", key(1000)]], [["id", key(2000)]]]);
  ok("every page asks for an exact count", c.every((x) => JSON.stringify(x.selectOptions) === '{"count":"exact"}'));
  ok("every page is ordered by id ascending, and by nothing else", c.every((x) => JSON.stringify(x.orders) === '[{"column":"id","ascending":true}]'));
  ok("every page asks for at most the cap", c.every((x) => x.limit === REPORT_PAGE_SIZE));
  ok("every page carries the same date range", c.every((x) =>
    JSON.stringify(x.conditions.filter((k) => k.column === "scheduled_date").map((k) => [k.op, k.value])) === JSON.stringify([["gte", RANGE.from], ["lte", RANGE.to]])));
  ok("every page carries the merchandiser and branch filters, and only those", c.every((x) =>
    JSON.stringify(x.filters) === JSON.stringify([{ column: "merch_id", value: "M" }, { column: "place_id", value: "P" }])));
  ok("the status filter still does not narrow this tab", c.every((x) => !x.filters.some((f) => f.column === "status")));
  ok("every page selects the same columns", new Set(c.map((x) => x.columns)).size === 1);
  const cols = c[0].columns.replace(/\s+/g, "");
  ok("the visit id is selected, as the paging key", cols.startsWith("id,status,duration_minutes,merch_id,"));
  ok("the columns the report is built from are unchanged", cols.includes("merch:company_users(id,display_name,user:users!company_users_user_id_fkey(full_name))"));
}

// ── 3) A merchandiser across the boundary; rounding ──────────────────────────
console.log("3) merch: a merchandiser spanning two pages");
{
  const rows = rowsOf(2300);
  queuePages(rows);
  const out = await fetchMerchReport(RANGE);
  const edge = out.find((r) => r.merch_id === "m-edge")!;
  // Completed 10 min on page 1, completed 15 min and one missed on page 2:
  // 2 of 3 finished → 67%; (10 + 15) / 2 = 12.5 → 13.
  eq("its visits on both pages are combined into one row, rounded as before", edge,
     { merch_id: "m-edge", full_name: "Edge Case", total_visits: 3, completed: 2, missed: 1, pending: 0, inprogress: 0, completion_rate: 67, avg_duration: 13 });
  ok("the fixture really does split it: one visit on page 1, two on page 2",
     rows.slice(0, 1000).filter((r) => r.merch_id === "m-edge").length === 1 && rows.slice(1000, 2000).filter((r) => r.merch_id === "m-edge").length === 2);
  eq("every other merchandiser has visits on all three pages",
     MERCHS.map((m) => [0, 1000, 2000].every((s) => rows.slice(s, s + 1000).some((r) => r.merch_id === m.id))), [true, true, true, true]);
  eq("names: user name, trimmed display name, blank display name falling back, and no record at all",
     ["m-ahmed", "m-sara", "m-blank", "m-gone"].map((id) => out.find((r) => r.merch_id === id)!.full_name), ["Ahmed", "Sara", "Fallback Name", "—"]);

  // Parity with a one-page result. A page cannot hold more than 1,000 rows, so
  // the comparison is made on the first 1,000 visits: read as one page, and as
  // the head of a longer range whose remaining rows belong to someone else.
  const head = rowsOf(1000);
  queuePages(head);
  const onePage = await fetchMerchReport(RANGE);
  const padded = [...head, ...Array.from({ length: 700 }, (_, i) => ({ ...row(i + 1), id: key(5000 + i), merch_id: "m-other", merch: null, status: "pending", duration_minutes: null }))];
  queuePages(padded);
  const twoPages = await fetchMerchReport(RANGE);
  eq("the first 1,000 visits give the same rows whether they are the whole read or its first page",
     twoPages.filter((r) => r.merch_id !== "m-other"), onePage);
  eq("…and the rest is one further row", twoPages.filter((r) => r.merch_id === "m-other").map((r) => [r.total_visits, r.pending, r.full_name]), [[700, 700, "—"]]);
}

// ── 4) Refusals: nothing, never a partial aggregate ──────────────────────────
console.log("4) merch: a page that cannot be trusted");
{
  const N = 2300;
  const refusals: Array<[string, (p: Page, i: number) => Page, unknown[], number]> = [
    ["a count that drifts on page 2", (p, i) => (i === 1 ? { ...p, count: (p.count as number) + 1 } : p), ["merch", "unverified", 2000, null, null], 2],
    ["no count on page 2",            (p, i) => (i === 1 ? { data: p.data, error: null } : p),            ["merch", "unverified", 2000, null, null], 2],
    ["no count on page 1",            (p, i) => (i === 0 ? { data: p.data, error: null } : p),            ["merch", "unverified", 1000, null, null], 1],
    ["a short page 2",                (p, i) => (i === 1 ? { ...p, data: (p.data as unknown[]).slice(0, 999) } : p), ["merch", "truncated", 1999, N, null], 2],
    ["a short page 1 (a lower cap)",  (p, i) => (i === 0 ? { ...p, data: (p.data as unknown[]).slice(0, 500) } : p), ["merch", "truncated", 500, N, null], 1],
    ["page 2 repeating page 1",       (p, i) => (i === 1 ? { ...p, data: rowsOf(1000) } : p),             ["merch", "unverified", 2000, null, null], 2],
    ["a row without an id",           (p, i) => (i === 0 ? { ...p, data: (p.data as Raw[]).map((r, k) => (k === 3 ? { ...r, id: undefined } : r)) } : p), ["merch", "unverified", 1000, null, null], 1],
  ];
  for (const [label, tamper, expected, requests] of refusals) {
    queuePages(rowsOf(N), tamper);
    const r = await outcome(() => fetchMerchReport(RANGE));
    eq(`${label} → refused, no partial aggregate, no further page`, [refusal(r.error), r.value, calls().length], [expected, undefined, requests]);
  }
  {
    const dbError = { code: "57014", message: "canceling statement due to statement timeout" };
    queuePages(rowsOf(N), (p, i) => (i === 1 ? { data: null, error: dbError, count: null } : p));
    const r = await outcome(() => fetchMerchReport(RANGE));
    ok("a query error on page 2 is thrown as the Supabase error itself", r.error === dbError);
    eq("…with no partial aggregate and no third request", [r.value, calls().length], [undefined, 2]);
  }
  {
    resetStub();
    queueResultFor("visits", { data: rowsOf(1000), error: null, count: REPORT_MAX_ROWS + 1 });
    const r = await outcome(() => fetchMerchReport(RANGE));
    eq("20,001 visits → refused as too large after one request, naming the maximum",
       [refusal(r.error), r.value, calls().length], [["merch", "tooLarge", 1000, 20_001, 20_000], undefined, 1]);
  }
}

// ── 5) On a real TanStack Query observer ─────────────────────────────────────
// The options mirror useMerchReport: the key carries range and filters, the
// query function hands the fetcher TanStack's signal, and the outer retry is off.
const stateOf = (r: { data?: MerchReportRow[]; isFetching: boolean; isPaused: boolean; isError: boolean; error: unknown }) =>
  reportTabState<MerchReportRow>({ data: r.data, isFetching: r.isFetching, isPaused: r.isPaused, isError: r.isError, error: r.error });
const optionsFor = (filters?: { merchId?: string }) => ({
  queryKey: ["reports", "merch", RANGE.from, RANGE.to, filters?.merchId ?? ""] as const,
  queryFn:  ({ signal }: { signal: AbortSignal }) => fetchMerchReport(RANGE, filters, signal),
  retry:    false as const,
});
const idle = async (o: QueryObserver<MerchReportRow[]>) => {
  for (let i = 0; i < 400 && o.getCurrentResult().fetchStatus !== "idle"; i++) await new Promise((r) => setTimeout(r, 5));
  await new Promise((r) => setTimeout(r, 60));
};
const en = (k: string, vars?: Record<string, string | number>) => {
  let s = (translations.en as Record<string, string>)[k] ?? k;
  if (vars) for (const [name, v] of Object.entries(vars)) s = s.split(`{${name}}`).join(String(v));
  return s;
};

console.log("5) merch: a failed second page, then Retry");
{
  const problems: Array<[string, (p: Page, i: number) => Page, string]> = [
    ["a query error on page 2", (p, i) => (i === 1 ? { data: null, error: { code: "57014", message: "statement timeout" }, count: null } : p), "error"],
    ["a count that drifts on page 2", (p, i) => (i === 1 ? { ...p, count: (p.count as number) - 1 } : p), "unverified"],
    ["a short page 2", (p, i) => (i === 1 ? { ...p, data: (p.data as unknown[]).slice(0, 10) } : p), "truncated"],
  ];
  const rows = rowsOf(2300);
  const expected = reference(rows);
  for (const [label, tamper, kind] of problems) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: 1, retryDelay: 5 } } });
    client.mount();
    queuePages(rows, tamper);
    const observer = new QueryObserver<MerchReportRow[]>(client, optionsFor());
    const published: MerchReportRow[][] = [];
    const unsubscribe = observer.subscribe((r) => { if (r.data) published.push(r.data); });
    await idle(observer);

    const failed = stateOf(observer.getCurrentResult());
    eq(`${label}: the tab is in the ${kind} state after two requests, with no rows`, [failed.kind, failed.rows.length, calls().length], [kind, 0, 2]);
    eq(`${label}: Export is off, and no aggregate of page 1 alone was ever published`, [canExportReport(failed), published.length], [false, 0]);
    ok(`${label}: there is a notice to show`, reportTabMessage(failed, en) !== null);

    // The user's Retry: a fresh load from the first page.
    queuePages(rows);
    await observer.refetch();
    await idle(observer);
    const retried = stateOf(observer.getCurrentResult());
    eq(`${label}: Retry starts again from page 1 and reads every page`, [calls().length, cursors()[0]], [3, []]);
    eq(`${label}: the rows and Export are back`, [retried.kind, canExportReport(retried)], ["ready", true]);
    eq(`${label}: …and they are the complete figures`, retried.rows, expected);
    ok(`${label}: only the complete figures were ever published`, published.length > 0 && published.every((p) => JSON.stringify(p) === JSON.stringify(expected)));

    // A later refresh whose page 2 fails withholds the figures it had.
    queuePages(rows, tamper);
    await observer.refetch();
    await idle(observer);
    const refreshed = stateOf(observer.getCurrentResult());
    eq(`${label}: on a failed refresh the earlier figures are withheld and Export is off`,
       [refreshed.kind, refreshed.rows.length, canExportReport(refreshed)], [kind, 0, false]);
    unsubscribe();
    client.unmount();
    client.clear();
  }

  // The range is too large: its own notice, on this tab too.
  {
    const client = new QueryClient({ defaultOptions: { queries: { retry: 1, retryDelay: 5 } } });
    client.mount();
    resetStub();
    queueResultFor("visits", { data: rowsOf(1000), error: null, count: 25_340 });
    const observer = new QueryObserver<MerchReportRow[]>(client, optionsFor());
    const unsubscribe = observer.subscribe(() => {});
    await idle(observer);
    const state = stateOf(observer.getCurrentResult());
    eq("over the maximum: the too-large state, no rows, no export, one request",
       [state.kind, state.rows.length, canExportReport(state), calls().length], ["tooLarge", 0, false, 1]);
    ok("over the maximum: the notice names 20,000", reportTabMessage(state, en)!.title.includes("20,000"));
    unsubscribe();
    client.unmount();
    client.clear();
  }
}

console.log("6) merch: the filter changes mid-load");
{
  const client = new QueryClient({ defaultOptions: { queries: { retry: 1, retryDelay: 5 } } });
  client.mount();
  const all = rowsOf(2300);
  // The merchandiser filter: 1,200 visits of one merchandiser, with ids of their own.
  const filtered = Array.from({ length: 1200 }, (_, i) => ({ ...row(4), id: key(60_000 + i + 1), status: i % 2 ? "completed" : "missed", duration_minutes: i % 2 ? 20 : null }));
  const A = optionsFor();
  const B = optionsFor({ merchId: "m-ahmed" });

  const observer = new QueryObserver<MerchReportRow[]>(client, A);
  resetStub();
  // The unfiltered load's first page: as it arrives, the user picks a merchandiser.
  queueResultFor("visits", { error: null, count: all.length, get data() { observer.setOptions(B); return all.slice(0, 1000); } });
  queueResultFor("visits", { data: filtered.slice(0, 1000), error: null, count: 1200 });
  queueResultFor("visits", { data: filtered.slice(1000), error: null, count: 200 });
  // If the old load asked for another page, it would get this — and be counted.
  queueResultFor("visits", { data: all.slice(1000, 2000), error: null, count: 1300 });

  const published: MerchReportRow[][] = [];
  const unsubscribe = observer.subscribe((r) => { if (r.data) published.push(r.data); });
  await idle(observer);

  const filterOf = (i: number) => calls()[i].filters.filter((f) => f.column === "merch_id").map((f) => f.value);
  eq("three requests: one for the old filter, two for the new", calls().length, 3);
  eq("the old load was asked for once, unfiltered, and never for a second page", [filterOf(0), cursors()[0]], [[], []]);
  eq("both later requests are the new filter's pages", [filterOf(1), filterOf(2), cursors().slice(1)], [["m-ahmed"], ["m-ahmed"], [[], [["id", key(61_000)]]]]);
  ok("the old query holds no figures", client.getQueryData(A.queryKey) === undefined);
  const result = observer.getCurrentResult();
  eq("the tab shows the new filter's figures, complete", [result.status, result.data], ["success", reference(filtered)]);
  eq("…one merchandiser, 1,200 visits", result.data?.map((r) => [r.merch_id, r.total_visits, r.completed, r.missed]), [["m-ahmed", 1200, 600, 600]]);
  ok("nothing from the unfiltered load was ever published",
     published.length > 0 && published.every((p) => p.length === 1 && p[0].merch_id === "m-ahmed" && p[0].total_visits === 1200));
  unsubscribe();
  client.unmount();
  client.clear();
}

// ── 7) The hook, the signal, and the export ──────────────────────────────────
console.log("7) merch: hook wiring and export fields");
{
  const client = new QueryClient();
  function Probe() { useMerchReport(RANGE, { merchId: "M" }); return null; }
  renderToString(createElement(QueryClientProvider, { client }, createElement(Probe)));
  const query = client.getQueryCache().getAll().find((q) => q.queryKey[1] === "merch")!;
  const fn = query.options.queryFn as unknown as (context: { signal: AbortSignal }) => Promise<MerchReportRow[]>;
  eq("the hook's key is unchanged: range and filters", [...query.queryKey], ["reports", "merch", RANGE.from, RANGE.to, "M", "", "", ""]);
  eq("the outer retry is still off, and staleTime unchanged", [query.options.retry, (query.options as { staleTime?: number }).staleTime], [false, 120_000]);

  const aborted = new AbortController();
  aborted.abort();
  queuePages(rowsOf(2300));
  const r = await outcome(() => fn({ signal: aborted.signal }));
  eq("the hook hands TanStack's signal to the fetcher: aborted means no request", [calls().length, (r.error as Error)?.name], [0, "AbortError"]);

  queuePages(rowsOf(2300));
  const live = new AbortController();
  await fn({ signal: live.signal });
  ok("…and the fetcher attaches it to every page request", calls().length === 3 && calls().every((c) => c.signal === live.signal));
  ok("the hook's filters reach every page", calls().every((c) => c.filters.some((f) => f.column === "merch_id" && f.value === "M")));
  client.clear();

  // The workbook is built from these six fields of a report row — none of them
  // the visit id, which a report row does not have. (Source check: the tab
  // cannot be rendered in this runner.)
  const src = readFileSync(join(import.meta.dirname, "..", "src", "app", "(dashboard)", "reports", "page.tsx"), "utf8");
  const start = src.indexOf("function MerchTab(");
  const tab = src.slice(start, src.indexOf("\nfunction ", start + 10));
  const exportBlock = tab.slice(tab.indexOf("async function doExport()"), tab.indexOf("exportReportXlsx("));
  eq("the export maps exactly the six report fields it always did",
     (exportBlock.match(/\br\.([a-z_]+)/g) ?? []).map((m) => m.slice(2)),
     ["full_name", "total_visits", "completed", "missed", "completion_rate", "avg_duration"]);
  ok("the Merch tab never reads a visit id", !/\br\.id\b/.test(tab));
}
