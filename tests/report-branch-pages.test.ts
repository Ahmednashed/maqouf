// Branch Coverage — three reads, all of them paged and counted.
//
// The tab seeds a row for every active branch, folds in the visits of the
// range, and stamps each branch with its last real visit. That is three reads:
// `visits`, `places` and the `v_branch_operations` view. Each can exceed what
// one API response holds, and a cut in any of them is silently wrong — covered
// branches shown as uncovered, branches missing altogether, or "never visited"
// against a branch that was. So all three go through the paged loader.
//
// The shared suite (tests/_report-paging.ts) checks the visits read. The rest
// of this file is what is particular to this tab: the two other reads paging
// and refusing in their own right, which failure is reported when more than one
// read fails, the zero-visit rows, and the workbook fields.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { eq, ok } from "./_harness.ts";
import { fetchBranchReport, type BranchReportRow } from "@/services/reports";
import { useBranchReport } from "@/hooks/use-reports";
import { daysSinceIso } from "@/services/places";
import { riyadhToday } from "@/lib/utils/date";
import { REPORT_MAX_ROWS } from "@/lib/report-pages";
import { recordedCalls, queueResultFor, resetStub } from "./stubs/supabase-client.ts";
import { RANGE, key, outcome, queuePages, refusal, runPagedTabSuite, tabCalls, type Page, type PagedTab } from "./_report-paging.ts";

const TODAY = riyadhToday();
const pid = (n: number) => `pl-${String(n).padStart(5, "0")}`;
const placeInfo = (n: number) => ({ branch_ar: `فرع ${n}`, branch_en: `Branch ${n}`, code: `BR-${n}`, chain: n % 3 === 0 ? null : { name_ar: "سلسلة", name_en: "Chain" } });

// ── Fixture ──────────────────────────────────────────────────────────────────
// Six active branches; visits go to four of them, to an inactive one (7) that
// is not in the branch list, and to "edge" (8), also inactive, whose three
// visits sit across the first page boundary. Branches 5 and 6 get no visits.
interface PlaceRow { id: string; branch_ar: string; branch_en: string; code: string; is_active: boolean; chain: { name_ar: string; name_en: string } | null }
interface OpsRow { place_id: string; last_visit_date: string | null }
interface Raw { id: string; status: string; duration_minutes: number | null; place_id: string; place: ReturnType<typeof placeInfo> | null }

const activePlaces = (n: number): PlaceRow[] => Array.from({ length: n }, (_, i) => ({ id: pid(i + 1), ...placeInfo(i + 1), is_active: true }));
const opsFor = (n: number): OpsRow[] => Array.from({ length: n }, (_, i) => ({ place_id: pid(i + 1), last_visit_date: (i + 1) % 4 === 0 ? null : `2026-08-${String(((i + 1) % 27) + 1).padStart(2, "0")}` }));
const PLACES = activePlaces(6);
const OPS = [...opsFor(6), { place_id: pid(7), last_visit_date: "2026-07-01" }];

const STATUSES = ["completed", "missed", "pending", "inprogress", "completed"] as const;
const EDGE: Record<number, { status: string; duration_minutes: number | null }> = {
  1000: { status: "completed", duration_minutes: 10 },
  1001: { status: "completed", duration_minutes: 15 },
  1002: { status: "missed",    duration_minutes: 0 },
};
const VISITED = [1, 2, 3, 4, 7];
function row(n: number): Raw {
  if (EDGE[n]) return { id: key(n), ...EDGE[n], place_id: pid(8), place: placeInfo(8) };
  const p = VISITED[n % VISITED.length];
  // The inactive branch arrives with its own details; one visited branch has lost its place record.
  const place = p === 2 && n % 2 === 0 ? null : placeInfo(p);
  const duration = n % 7 === 0 ? null : n % 11 === 0 ? 0 : (n % 50) + 1;
  return { id: key(n), status: STATUSES[n % STATUSES.length], duration_minutes: duration, place_id: pid(p), place };
}
const rowsOf = (n: number) => Array.from({ length: n }, (_, i) => row(i + 1));

// ── The answer, worked out a second way ──────────────────────────────────────
function referenceWith(places: PlaceRow[], ops: OpsRow[]) {
  return (rows: Raw[]): BranchReportRow[] => {
    const last = new Map(ops.map((o) => [o.place_id, o.last_visit_date]));
    const seen = new Map<string, { branch_ar: string; branch_en: string; code: string; chain_ar: string; chain_en: string }>();
    for (const p of places) seen.set(p.id, { branch_ar: p.branch_ar, branch_en: p.branch_en, code: p.code, chain_ar: p.chain?.name_ar ?? "—", chain_en: p.chain?.name_en ?? "—" });
    for (const r of rows) {
      if (!seen.has(r.place_id)) {
        seen.set(r.place_id, { branch_ar: r.place?.branch_ar ?? "—", branch_en: r.place?.branch_en ?? "—", code: r.place?.code ?? "—",
                               chain_ar: r.place?.chain?.name_ar ?? "—", chain_en: r.place?.chain?.name_en ?? "—" });
      }
    }
    const out = [...seen.entries()].map(([id, info]) => {
      const mine = rows.filter((r) => r.place_id === id);
      const completed = mine.filter((r) => r.status === "completed").length;
      const missed = mine.filter((r) => r.status === "missed").length;
      const timed = mine.filter((r) => r.status === "completed" && typeof r.duration_minutes === "number" && r.duration_minutes > 0).map((r) => r.duration_minutes as number);
      const date = last.get(id) ?? null;
      return {
        place_id: id, branch_ar: info.branch_ar, branch_en: info.branch_en, branch_code: info.code, chain_ar: info.chain_ar, chain_en: info.chain_en,
        total_visits: mine.length, completed, missed,
        completion_rate: completed + missed > 0 ? Math.round((completed / (completed + missed)) * 100) : 0,
        avg_duration: timed.length > 0 ? Math.round(timed.reduce((a, b) => a + b, 0) / timed.length) : 0,
        last_visit_date: date, days_since: daysSinceIso(date, TODAY),
      };
    });
    return out.map((r, i) => ({ r, i })).sort((a, b) => b.r.total_visits - a.r.total_visits || a.i - b.i).map((x) => x.r);
  };
}

const queueExtras = () => {
  queueResultFor("places", { data: PLACES, error: null, count: PLACES.length });
  queueResultFor("v_branch_operations", { data: OPS, error: null, count: OPS.length });
};

const TAB: PagedTab<Raw, BranchReportRow> = {
  name: "branch", table: "visits",
  run: (filters, signal) => fetchBranchReport(RANGE, filters, signal),
  rowsOf, reference: referenceWith(PLACES, OPS),
  cursorAfter: (r) => ["gt", "id", r.id],
  queueExtras,
  dateColumn: "scheduled_date", merchColumn: "merch_id", placeColumn: "place_id",
  fixedFilters: [], fixedConditions: [],
  orders: [{ column: "id", ascending: true }],
  outputKeys: ["avg_duration", "branch_ar", "branch_code", "branch_en", "chain_ar", "chain_en", "completed", "completion_rate",
               "days_since", "last_visit_date", "missed", "place_id", "total_visits"],
  leak: /k\d{6}/,
  narrowed: {
    filters: { merchId: "m-ahmed" },
    rows: Array.from({ length: 1200 }, (_, i) => ({ ...row((i % 5) + 1), id: key(60_000 + i + 1) })),
  },
};

await runPagedTabSuite(TAB);

// ── Particular to Branch ─────────────────────────────────────────────────────
const callsTo = (table: string) => recordedCalls().filter((c) => c.table === table);
const cursorsOf = (table: string) => callsTo(table).map((c) => c.conditions.filter((x) => x.op === "gt").map((x) => [x.column, x.value]));
const pagesOf = <T,>(rows: T[]): Page[] => {
  const pages: Page[] = [];
  for (let start = 0, i = 0; start < rows.length || i === 0; start += 1000, i++) pages.push({ data: rows.slice(start, start + 1000), error: null, count: rows.length - start });
  return pages;
};
/** Queue an exact set of pages for each of the three reads. */
function arrange(reads: { visits: Page[]; places: Page[]; ops: Page[] }) {
  resetStub();
  for (const p of reads.visits) queueResultFor("visits", p);
  for (const p of reads.places) queueResultFor("places", p);
  for (const p of reads.ops) queueResultFor("v_branch_operations", p);
}

console.log("branch: a branch across the boundary, zero-visit rows, and the request shape");
{
  const rows = rowsOf(2300);
  queuePages(TAB, rows);
  const out = await fetchBranchReport(RANGE);

  // Completed 10 min on page 1; completed 15 min and one missed on page 2:
  // 2 of 2+1 finished → 67%; (10 + 15) / 2 = 12.5 → 13. Inactive, never in the
  // branch list, and with no last-visit row.
  eq("a branch's visits on both pages are combined into one row, rounded as before", out.find((r) => r.place_id === pid(8)),
     { place_id: pid(8), branch_ar: "فرع 8", branch_en: "Branch 8", branch_code: "BR-8", chain_ar: "سلسلة", chain_en: "Chain",
       total_visits: 3, completed: 2, missed: 1, completion_rate: 67, avg_duration: 13, last_visit_date: null, days_since: null });
  ok("the fixture really does split it across the boundary",
     rows.slice(0, 1000).filter((r) => r.place_id === pid(8)).length === 1 && rows.slice(1000, 2000).filter((r) => r.place_id === pid(8)).length === 2);
  eq("active branches with no visits still get their zero rows, in branch-id order after the visited ones",
     out.filter((r) => r.total_visits === 0).map((r) => [r.place_id, r.completed, r.completion_rate, r.avg_duration]),
     [[pid(5), 0, 0, 0], [pid(6), 0, 0, 0]]);
  eq("a zero row carries the branch's own details and last visit",
     out.find((r) => r.place_id === pid(5)), { place_id: pid(5), branch_ar: "فرع 5", branch_en: "Branch 5", branch_code: "BR-5", chain_ar: "سلسلة", chain_en: "Chain",
       total_visits: 0, completed: 0, missed: 0, completion_rate: 0, avg_duration: 0, last_visit_date: "2026-08-06", days_since: daysSinceIso("2026-08-06", TODAY) });
  ok("an inactive branch with visits in the range is kept, from the visit's own details",
     out.some((r) => r.place_id === pid(7) && r.total_visits > 0 && r.branch_en === "Branch 7" && r.last_visit_date === "2026-07-01"));
  ok("a branch with no chain shows a dash", out.find((r) => r.place_id === pid(3))!.chain_en === "—");
  ok("most visits first", out.every((r, i) => i === 0 || out[i - 1].total_visits >= r.total_visits));
  eq("every visit is counted once", out.reduce((a, r) => a + r.total_visits, 0), 2300);

  const v = callsTo("visits")[0].columns.replace(/\s+/g, "");
  ok("the visit id is selected, as the paging key", v.startsWith("id,status,duration_minutes,place_id,"));
  ok("the visit columns the report is built from are unchanged", v.includes("place:places(branch_ar,branch_en,code,chain:chains(name_ar,name_en))"));
  eq("one request each for the branch list and the last visits, when they fit a page", [callsTo("places").length, callsTo("v_branch_operations").length], [1, 1]);

  // The last-visit bucket still narrows a complete result.
  queuePages(TAB, rows);
  const never = await fetchBranchReport(RANGE, { lastVisit: "never" });
  ok("the last-visit filter narrows a complete result as before",
     never.length > 0 && never.every((r) => r.days_since === null) && never.some((r) => r.place_id === pid(4)) && never.some((r) => r.place_id === pid(8)));

  // A branch filter narrows the visits AND the branch list, on the counted reads.
  queuePages(TAB, rows);
  await fetchBranchReport(RANGE, { placeId: pid(2) });
  ok("the branch filter is on every visits page", callsTo("visits").every((c) => c.filters.some((f) => f.column === "place_id" && f.value === pid(2))));
  eq("…and on the branch list, alongside active-only", callsTo("places")[0].filters, [{ column: "is_active", value: true }, { column: "id", value: pid(2) }]);
  eq("the last-visit read is never filtered: it is a fact about the branch, not the range", callsTo("v_branch_operations")[0].filters, []);
}

console.log("branch: the branch list and the last-visit read are paged and counted too");
{
  const N = 2300;
  const places = activePlaces(N);
  const ops = opsFor(N);
  const visits = rowsOf(7);
  arrange({ visits: pagesOf(visits), places: pagesOf(places), ops: pagesOf(ops) });
  const out = await fetchBranchReport(RANGE);

  eq("2,300 active branches: three requests for the list, three for the last visits, one for the visits",
     [callsTo("places").length, callsTo("v_branch_operations").length, callsTo("visits").length], [3, 3, 1]);
  eq("the branch list pages by id", cursorsOf("places"), [[], [["id", pid(1000)]], [["id", pid(2000)]]]);
  eq("the last-visit read pages by place_id", cursorsOf("v_branch_operations"), [[], [["place_id", pid(1000)]], [["place_id", pid(2000)]]]);
  for (const [table, order] of [["places", "id"], ["v_branch_operations", "place_id"]] as const) {
    const c = callsTo(table);
    ok(`${table}: every page asks for an exact count`, c.every((x) => JSON.stringify(x.selectOptions) === '{"count":"exact"}'));
    ok(`${table}: every page is ordered by its unique key, ${order}`, c.every((x) => JSON.stringify(x.orders) === JSON.stringify([{ column: order, ascending: true }])));
    ok(`${table}: every page asks for at most the cap`, c.every((x) => x.limit === 1000));
    ok(`${table}: every page selects the same columns`, new Set(c.map((x) => x.columns)).size === 1);
  }
  ok("every page of the branch list is active-only", callsTo("places").every((c) => JSON.stringify(c.filters) === JSON.stringify([{ column: "is_active", value: true }])));
  eq("the report is the reference's, for all 2,300 branches", out, referenceWith(places, ops)(visits));
  eq("no branch is missing or repeated: one row each", [out.length, new Set(out.map((r) => r.place_id)).size], [N, N]);
  ok("a branch on the last page has its last visit, not a false 'never'",
     out.find((r) => r.place_id === pid(2299))!.last_visit_date === ops[2298].last_visit_date && ops[2298].last_visit_date !== null);

  // Each secondary read refuses in its own right.
  const good = () => ({ visits: pagesOf(visits), places: pagesOf(places), ops: pagesOf(ops) });
  const cases: Array<[string, (r: ReturnType<typeof good>) => void, unknown[]]> = [
    ["the branch list's count drifts on page 2", (r) => { r.places[1] = { ...r.places[1], count: 1301 }; }, ["branch", "unverified", 2000, null, null]],
    ["the branch list has no count", (r) => { r.places[0] = { data: r.places[0].data, error: null }; }, ["branch", "unverified", 1000, null, null]],
    ["the branch list's page 2 is short", (r) => { r.places[1] = { ...r.places[1], data: (r.places[1].data as unknown[]).slice(0, 40) }; }, ["branch", "truncated", 1040, N, null]],
    ["the branch list is over the maximum", (r) => { r.places = [{ ...r.places[0], count: REPORT_MAX_ROWS + 1 }]; }, ["branch", "tooLarge", 1000, 20_001, 20_000]],
    ["the last-visit read's count drifts on page 3", (r) => { r.ops[2] = { ...r.ops[2], count: 299 }; }, ["branch", "unverified", 2300, null, null]],
    ["the last-visit read has no count", (r) => { r.ops[0] = { data: r.ops[0].data, error: null }; }, ["branch", "unverified", 1000, null, null]],
    ["the last-visit read's page 1 is short", (r) => { r.ops[0] = { ...r.ops[0], data: (r.ops[0].data as unknown[]).slice(0, 999) }; }, ["branch", "truncated", 999, N, null]],
    ["the last-visit read repeats a branch", (r) => { r.ops[1] = { ...r.ops[1], data: ops.slice(0, 1000) }; }, ["branch", "unverified", 2000, null, null]],
  ];
  for (const [label, breakIt, expected] of cases) {
    const reads = good();
    breakIt(reads);
    arrange(reads);
    const r = await outcome(() => fetchBranchReport(RANGE));
    eq(`${label} → the report is refused, with no rows`, [refusal(r.error), r.value], [expected, undefined]);
  }
}

console.log("branch: which failure is reported when more than one read fails");
{
  const visits = rowsOf(7);
  const E = (name: string) => ({ code: "XX000", message: `${name} failed` });
  const visitsErr = E("visits"), placesErr = E("places"), opsErr = E("last visits");
  const fine = { visits: pagesOf(visits), places: pagesOf(PLACES), ops: pagesOf(OPS) };
  const errPage = (error: unknown): Page[] => [{ data: null, error, count: null }];
  const truncated: Page[] = [{ data: visits, error: null, count: 5000 }];
  const uncounted = (rows: unknown[]): Page[] => [{ data: rows, error: null }];

  const run = async (reads: Partial<typeof fine>) => { arrange({ ...fine, ...reads }); return (await outcome(() => fetchBranchReport(RANGE))).error; };
  ok("all three fail → the last-visit read's error, as before", (await run({ visits: errPage(visitsErr), places: errPage(placesErr), ops: errPage(opsErr) })) === opsErr);
  ok("visits and the branch list fail → the visits error, as before", (await run({ visits: errPage(visitsErr), places: errPage(placesErr) })) === visitsErr);
  ok("the branch list fails and the visits are cut → the branch list's error, as before", (await run({ visits: truncated, places: errPage(placesErr) })) === placesErr);
  ok("the last-visit read fails and the visits are cut → the last-visit error, as before", (await run({ visits: truncated, ops: errPage(opsErr) })) === opsErr);
  eq("the visits are cut and both other reads are uncounted → the visits' truncation",
     refusal(await run({ visits: truncated, places: uncounted(PLACES), ops: uncounted(OPS) })), ["branch", "truncated", 7, 5000, null]);
  eq("only the other two are uncounted → the branch list's refusal",
     refusal(await run({ places: uncounted(PLACES), ops: uncounted(OPS) })), ["branch", "unverified", PLACES.length, null, null]);
  eq("only the last-visit read is uncounted → its refusal",
     refusal(await run({ ops: uncounted(OPS) })), ["branch", "unverified", OPS.length, null, null]);
  eq("nothing fails → rows", ((await (async () => { arrange(fine); return outcome(() => fetchBranchReport(RANGE)); })()).value ?? []).length > 0, true);

  // Cancelled: none of the three reads is asked for anything.
  const aborted = new AbortController();
  aborted.abort();
  arrange(fine);
  const r = await outcome(() => fetchBranchReport(RANGE, undefined, aborted.signal));
  eq("an already-aborted signal: no request to any of the three reads", [recordedCalls().length, (r.error as Error)?.name], [0, "AbortError"]);
  // Cancelled while another read has also failed: it is reported as a
  // cancellation, not as that read's error — a superseded load has no error
  // worth showing, whichever read noticed first.
  const mid = new AbortController();
  arrange({ ...fine, ops: errPage(opsErr),
            visits: [{ error: null, count: visits.length, get data() { mid.abort(); return visits; } }] });
  const cancelled = (await outcome(() => fetchBranchReport(RANGE, undefined, mid.signal))).error;
  eq("cancelled while the last-visit read has failed → a cancellation, not that error",
     [(cancelled as Error)?.name, cancelled === opsErr], ["AbortError", false]);

  arrange(fine);
  const live = new AbortController();
  await fetchBranchReport(RANGE, undefined, live.signal);
  ok("the signal is attached to all three reads", recordedCalls().length === 3 && recordedCalls().every((c) => c.signal === live.signal));
}

console.log("branch: hook wiring and export fields");
{
  const client = new QueryClient();
  function Probe() { useBranchReport(RANGE, { merchId: "M", lastVisit: "never" }); return null; }
  renderToString(createElement(QueryClientProvider, { client }, createElement(Probe)));
  const query = client.getQueryCache().getAll().find((q) => q.queryKey[1] === "branch")!;
  const fn = query.options.queryFn as unknown as (context: { signal: AbortSignal }) => Promise<BranchReportRow[]>;
  eq("the hook's key is unchanged: range and filters", [...query.queryKey], ["reports", "branch", RANGE.from, RANGE.to, "M", "", "", "never"]);
  eq("the outer retry is still off, and staleTime unchanged", [query.options.retry, (query.options as { staleTime?: number }).staleTime], [false, 120_000]);

  const aborted = new AbortController();
  aborted.abort();
  queuePages(TAB, rowsOf(2300));
  const r = await fn({ signal: aborted.signal }).then(() => null, (e) => e as Error);
  eq("the hook hands TanStack's signal to the fetcher: aborted means no request", [recordedCalls().length, r?.name], [0, "AbortError"]);

  queuePages(TAB, rowsOf(1001));
  const live = new AbortController();
  await fn({ signal: live.signal });
  ok("…and its filters and signal reach every visits page",
     tabCalls(TAB).length === 2 && tabCalls(TAB).every((c) => c.signal === live.signal && c.filters.some((f) => f.column === "merch_id" && f.value === "M")));
  client.clear();

  // (Source check: the tab cannot be rendered in this runner.)
  const src = readFileSync(join(import.meta.dirname, "..", "src", "app", "(dashboard)", "reports", "page.tsx"), "utf8");
  const start = src.indexOf("function BranchTab(");
  const tab = src.slice(start, src.indexOf("\nfunction ", start + 10));
  const exportBlock = tab.slice(tab.indexOf("async function doExport()"), tab.indexOf("exportReportXlsx("));
  eq("the export maps exactly the report fields it always did",
     (exportBlock.match(/\br\.([a-z_]+)/g) ?? []).map((m) => m.slice(2)),
     ["branch_ar", "branch_en", "chain_ar", "chain_en", "total_visits", "completed", "missed", "completion_rate", "avg_duration", "last_visit_date", "days_since"]);
  ok("the Branch tab never reads a visit id", !/\br\.id\b/.test(tab));
}
