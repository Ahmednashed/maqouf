// The five Reports tab fetchers and the 1,000-row cap.
//
// The Data API cuts any read at "Max rows" without an error. Four of these
// fetchers aggregate their rows in the browser, so a cut read becomes plausible,
// wrong numbers. Each read now asks for PostgREST's exact count and refuses the
// result unless the count equals the rows received.
//
// These pin, for every fetcher: the count and a deterministic order are
// requested; a complete result passes through with its aggregation unchanged;
// a truncated, uncounted or inconsistently counted result throws; and a query
// error is surfaced as itself.
//
// Everything runs against the recording stub. Nothing here proves how the real
// API counts — in particular the Product read's count across its inner join is
// verified separately against the real API, not here.

import { check, eq, ok } from "./_harness.ts";
import {
  fetchVisitsReport, fetchMerchReport, fetchBranchReport, fetchProductReport, fetchGpsReport,
} from "@/services/reports";
import { ReportIncompleteError } from "@/lib/report-completeness";
import { tallyGps } from "@/lib/gps-status";
import { daysSinceIso } from "@/services/places";
import { riyadhToday } from "@/lib/utils/date";
import {
  recordedCalls, recordedRpcs, queueResultFor, resetStub, type RecordedCall,
} from "./stubs/supabase-client.ts";

const RANGE = { from: "2026-08-01", to: "2026-08-31" };
const M1 = "11111111-1111-4111-8111-111111111111";
const M2 = "22222222-2222-4222-8222-222222222222";
const P1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const P2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const P3 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const place = (n: string) => ({ branch_ar: `فرع ${n}`, branch_en: `Branch ${n}`, code: `BR-${n}`, chain: { name_ar: "سلسلة", name_en: "Chain" } });
const merch = (name: string) => ({ display_name: null, user: { full_name: name } });

// ── Fixtures and the exact output each must produce ──────────────────────────
// Visits are read in ascending `id` order (the paging key) and put back into
// the tab's order afterwards, so the fixture arrives by id and VISIT_OUT is in
// the order the tab has always shown: newest date first, then id descending.
const VISIT_ROWS = [
  { id: "v1", scheduled_date: "2026-08-05", status: "pending",   duration_minutes: 0, merch_id: M1, place_id: P1, place: place("1"), merch: { display_name: " Sara ", user: { full_name: "ignored" } } },
  { id: "v2", scheduled_date: "2026-08-05", status: "missed",    duration_minutes: null, merch_id: M2, place_id: P2, place: null, merch: null },
  { id: "v3", scheduled_date: "2026-08-06", status: "completed", duration_minutes: 10, merch_id: M1, place_id: P1, place: place("1"), merch: merch("Ahmed") },
];
const VISIT_OUT = [
  { id: "v3", merch_id: M1, place_id: P1, scheduled_date: "2026-08-06", status: "completed", duration_minutes: 10, branch_ar: "فرع 1", branch_en: "Branch 1", branch_code: "BR-1", chain_ar: "سلسلة", chain_en: "Chain", merch_name: "Ahmed" },
  { id: "v2", merch_id: M2, place_id: P2, scheduled_date: "2026-08-05", status: "missed", duration_minutes: 0, branch_ar: "—", branch_en: "—", branch_code: "—", chain_ar: "—", chain_en: "—", merch_name: "—" },
  { id: "v1", merch_id: M1, place_id: P1, scheduled_date: "2026-08-05", status: "pending", duration_minutes: 0, branch_ar: "فرع 1", branch_en: "Branch 1", branch_code: "BR-1", chain_ar: "سلسلة", chain_en: "Chain", merch_name: "Sara" },
];

// Each row carries its visit `id`, ascending: the key the read is paged by.
// It is not part of the report, so MERCH_OUT is exactly what it always was.
const MERCH_ROWS = [
  { id: "v1", status: "completed",  duration_minutes: 10,   merch_id: M1, merch: { id: M1, ...merch("Ahmed") } },
  { id: "v2", status: "completed",  duration_minutes: 15,   merch_id: M1, merch: { id: M1, ...merch("Ahmed") } },
  { id: "v3", status: "missed",     duration_minutes: 0,    merch_id: M1, merch: { id: M1, ...merch("Ahmed") } },
  { id: "v4", status: "pending",    duration_minutes: null, merch_id: M1, merch: { id: M1, ...merch("Ahmed") } },
  { id: "v5", status: "completed",  duration_minutes: 0,    merch_id: M2, merch: { id: M2, ...merch("Sara") } },
  { id: "v6", status: "inprogress", duration_minutes: null, merch_id: M2, merch: { id: M2, ...merch("Sara") } },
];
const MERCH_OUT = [
  // 2 of 3 finished → 67%; (10 + 15) / 2 = 12.5 → 13.
  { merch_id: M1, full_name: "Ahmed", total_visits: 4, completed: 2, missed: 1, pending: 1, inprogress: 0, completion_rate: 67, avg_duration: 13 },
  // A completed visit with a zero duration counts as completed but not toward the average.
  { merch_id: M2, full_name: "Sara",  total_visits: 2, completed: 1, missed: 0, pending: 0, inprogress: 1, completion_rate: 100, avg_duration: 0 },
];

const BRANCH_VISITS = [
  { status: "completed", duration_minutes: 20, place_id: P1, place: place("1") },
  { status: "missed",    duration_minutes: 0,  place_id: P1, place: place("1") },
  { status: "completed", duration_minutes: 5,  place_id: P3, place: place("3") },   // inactive branch: not in the places list
];
const BRANCH_PLACES = [
  { id: P1, ...place("1"), is_active: true },
  { id: P2, ...place("2"), is_active: true },   // no visits: must still appear
];
const BRANCH_OPS = [
  { place_id: P1, last_visit_date: "2026-08-06", last_visit_status: "completed", last_visit_merch: "Ahmed" },
  { place_id: P2, last_visit_date: null,          last_visit_status: null,        last_visit_merch: null },
];
const TODAY = riyadhToday();
const branchRow = (id: string, n: string, o: Record<string, unknown>) => ({
  place_id: id, branch_ar: `فرع ${n}`, branch_en: `Branch ${n}`, branch_code: `BR-${n}`, chain_ar: "سلسلة", chain_en: "Chain",
  total_visits: 0, completed: 0, missed: 0, completion_rate: 0, avg_duration: 0, last_visit_date: null, days_since: null, ...o,
});
const BRANCH_OUT = [
  branchRow(P1, "1", { total_visits: 2, completed: 1, missed: 1, completion_rate: 50, avg_duration: 20, last_visit_date: "2026-08-06", days_since: daysSinceIso("2026-08-06", TODAY) }),
  branchRow(P3, "3", { total_visits: 1, completed: 1, completion_rate: 100, avg_duration: 5 }),
  branchRow(P2, "2", {}),
];

const prod = (n: string) => ({ id: `prod-${n}`, name_ar: `منتج ${n}`, name_en: `Product ${n}`, sku: `SKU-${n}`, unit: "pc" });
const PRODUCT_ROWS = [
  { product_id: "prod-A", qty_found: 5, qty_missing: 0,    product: prod("A") },
  { product_id: "prod-A", qty_found: 0, qty_missing: 3,    product: prod("A") },
  { product_id: "prod-B", qty_found: 2, qty_missing: null, product: prod("B") },
];
const PRODUCT_OUT = [
  { product_id: "prod-A", name_ar: "منتج A", name_en: "Product A", sku: "SKU-A", unit: "pc", audited_count: 2, found_count: 1, missing_count: 1, availability_pct: 50,  total_missing: 3 },
  { product_id: "prod-B", name_ar: "منتج B", name_en: "Product B", sku: "SKU-B", unit: "pc", audited_count: 1, found_count: 1, missing_count: 0, availability_pct: 100, total_missing: 0 },
];

const GPS_ROWS = [
  { merch_id: M1, checkin_verified: true,  checkin_lat: 24.7, checkin_lng: 46.6, checkin_distance_meters: 40, place: { lat: 24.7, lng: 46.6 }, merch: merch("Ahmed") },
  { merch_id: M1, checkin_verified: false, checkin_lat: 24.9, checkin_lng: 46.9, checkin_distance_meters: 900, place: { lat: 24.7, lng: 46.6 }, merch: merch("Ahmed") },
  { merch_id: M1, checkin_verified: null,  checkin_lat: null, checkin_lng: null, checkin_distance_meters: null, place: { lat: 24.7, lng: 46.6 }, merch: merch("Ahmed") },
  { merch_id: M2, checkin_verified: null,  checkin_lat: 24.7, checkin_lng: 46.6, checkin_distance_meters: null, place: { lat: null, lng: null }, merch: merch("Sara") },
];
const gpsOut = (id: string, name: string, rows: typeof GPS_ROWS) => {
  const tally = tallyGps(rows);
  return { merch_id: id, full_name: name, total_started: tally.started, gps_verified: tally.verified, gps_outside: tally.outside,
           gps_not_recorded: tally.notRecorded, no_branch_coords: tally.noBranchCoords, verification_rate: tally.rate, avg_distance: tally.avgDistance };
};
const GPS_OUT = [gpsOut(M1, "Ahmed", GPS_ROWS.slice(0, 3)), gpsOut(M2, "Sara", GPS_ROWS.slice(3))];

// ── One description per fetcher ──────────────────────────────────────────────
interface Spec {
  name:   "visits" | "merch" | "branch" | "product" | "gps";
  table:  string;                         // the base-row table the count is for
  rows:   unknown[];
  out:    unknown[];
  run:    (filters?: Record<string, string>) => Promise<unknown[]>;
  orders: Array<{ column: string; ascending: boolean }>;
  dateColumn: string;
  /** Other reads the fetcher issues, queued per table. */
  extras?: Array<[string, unknown[]]>;
  emptyOut: unknown[];
}

const SPECS: Spec[] = [
  { name: "visits", table: "visits", rows: VISIT_ROWS, out: VISIT_OUT, dateColumn: "scheduled_date", emptyOut: [],
    run: (f) => fetchVisitsReport(RANGE, f),
    // Paged by primary key; the tab's own order is restored after loading
    // (tests/report-pages.test.ts covers the paging itself).
    orders: [{ column: "id", ascending: true }] },
  { name: "merch", table: "visits", rows: MERCH_ROWS, out: MERCH_OUT, dateColumn: "scheduled_date", emptyOut: [],
    run: (f) => fetchMerchReport(RANGE, f),
    orders: [{ column: "id", ascending: true }] },
  { name: "branch", table: "visits", rows: BRANCH_VISITS, out: BRANCH_OUT, dateColumn: "scheduled_date",
    run: (f) => fetchBranchReport(RANGE, f),
    orders: [{ column: "id", ascending: true }],
    extras: [["places", BRANCH_PLACES], ["v_branch_operations", BRANCH_OPS]],
    // No visits at all: every active branch still appears, as an honest zero row.
    emptyOut: [
      branchRow(P1, "1", { last_visit_date: "2026-08-06", days_since: daysSinceIso("2026-08-06", TODAY) }),
      branchRow(P2, "2", {}),
    ] },
  { name: "product", table: "visit_products", rows: PRODUCT_ROWS, out: PRODUCT_OUT, dateColumn: "visit.scheduled_date", emptyOut: [],
    run: (f) => fetchProductReport(RANGE, f),
    orders: [{ column: "visit_id", ascending: true }, { column: "product_id", ascending: true }] },
  { name: "gps", table: "visits", rows: GPS_ROWS, out: GPS_OUT, dateColumn: "scheduled_date", emptyOut: [],
    run: (f) => fetchGpsReport(RANGE, f),
    orders: [{ column: "id", ascending: true }] },
];

function arrange(spec: Spec, base: { data: unknown; error: unknown; count?: number | null }) {
  resetStub();
  queueResultFor(spec.table, base);
  for (const [table, rows] of spec.extras ?? []) queueResultFor(table, { data: rows, error: null });
}
const baseCall = (spec: Spec): RecordedCall => recordedCalls().find((c) => c.table === spec.table)!;

async function outcome(run: () => Promise<unknown>): Promise<{ value?: unknown; error?: unknown }> {
  try { return { value: await run() }; } catch (error) { return { error }; }
}

for (const spec of SPECS) {
  console.log(`${spec.name}: exact count, stable order, refusal when incomplete`);
  const n = spec.rows.length;

  // ── Complete result: passes through, aggregation unchanged ────────────────
  arrange(spec, { data: spec.rows, error: null, count: n });
  eq(`[${spec.name}] a complete result produces exactly the expected rows`, await spec.run(), spec.out);
  {
    const call = baseCall(spec);
    eq(`[${spec.name}] asks ${spec.table} for an exact count`, call.selectOptions, { count: "exact" });
    eq(`[${spec.name}] orders deterministically, ending in a unique key`, call.orders, spec.orders);
    eq(`[${spec.name}] the count covers the same date-bounded query`,
       call.conditions.filter((c) => c.column === spec.dateColumn).map((c) => [c.op, c.value]),
       [["gte", RANGE.from], ["lte", RANGE.to]]);
    eq(`[${spec.name}] issues no RPC`, recordedRpcs().length, 0);
    eq(`[${spec.name}] reads the base table exactly once (no second, uncounted read)`,
       recordedCalls().filter((c) => c.table === spec.table).length, 1);
  }

  // The count is for the FILTERED query: filters are applied to the same read.
  arrange(spec, { data: spec.rows, error: null, count: n });
  await spec.run({ merchId: M1, placeId: P1 });
  {
    const prefix = spec.name === "product" ? "visit." : "";
    const applied = baseCall(spec).filters.filter((f) => [`${prefix}merch_id`, `${prefix}place_id`].includes(f.column));
    eq(`[${spec.name}] merchandiser and branch filters are on the counted read`,
       applied.map((f) => [f.column, f.value]), [[`${prefix}merch_id`, M1], [`${prefix}place_id`, P1]]);
  }

  // ── Empty but complete: a real "nothing", not a refusal ───────────────────
  arrange(spec, { data: [], error: null, count: 0 });
  eq(`[${spec.name}] zero rows with a zero count is a valid, complete result`, await spec.run(), spec.emptyOut);

  // ── Truncated ─────────────────────────────────────────────────────────────
  arrange(spec, { data: spec.rows, error: null, count: n + 997 });
  {
    const r = await outcome(spec.run);
    const e = r.error as ReportIncompleteError;
    ok(`[${spec.name}] more matching rows than returned → throws ReportIncompleteError`, e instanceof ReportIncompleteError);
    eq(`[${spec.name}] …as truncated, with both figures`,
       [e?.report, e?.reason, e?.loaded, e?.total], [spec.name, "truncated", n, n + 997]);
    ok(`[${spec.name}] …and returns no partial rows`, r.value === undefined);
  }
  // One row over is enough.
  arrange(spec, { data: spec.rows, error: null, count: n + 1 });
  ok(`[${spec.name}] a single missing row is refused too`,
     (await outcome(spec.run)).error instanceof ReportIncompleteError);

  // ── Count missing or unusable ─────────────────────────────────────────────
  for (const [label, count] of [["absent", undefined], ["null", null], ["NaN", Number.NaN], ["negative", -1],
                                ["fractional", n + 0.5], ["a string", String(n)], ["smaller than the rows", n - 1]] as const) {
    arrange(spec, { data: spec.rows, error: null, count: count as number | null | undefined });
    const e = (await outcome(spec.run)).error as ReportIncompleteError;
    check(`[${spec.name}] count ${label} → refused as unverified`,
       e instanceof ReportIncompleteError && e.reason === "unverified" && e.total === null && e.loaded === n,
       e instanceof Error ? e.message : e);
  }

  // ── Query error: surfaced as itself, never as a completeness problem ──────
  const dbError = { code: "42501", message: "permission denied for table " + spec.table };
  arrange(spec, { data: null, error: dbError, count: null });
  {
    const r = await outcome(spec.run);
    ok(`[${spec.name}] a query error is thrown as the Supabase error itself`, r.error === dbError);
    ok(`[${spec.name}] …not disguised as an incomplete report`, !(r.error instanceof ReportIncompleteError));
  }
}

// ── Things specific to one fetcher ───────────────────────────────────────────
console.log("fetcher-specific contracts");
{
  // Visits: status narrows this tab only, and is part of the counted query.
  resetStub();
  queueResultFor("visits", { data: VISIT_ROWS, error: null, count: VISIT_ROWS.length });
  await fetchVisitsReport(RANGE, { status: "completed" });
  eq("[visits] the status filter is on the counted read",
     recordedCalls()[0].filters.filter((f) => f.column === "status"), [{ column: "status", value: "completed" }]);

  // Product: the count is of visit_products rows, filtered through the inner join.
  resetStub();
  queueResultFor("visit_products", { data: PRODUCT_ROWS, error: null, count: PRODUCT_ROWS.length });
  await fetchProductReport(RANGE);
  const p = recordedCalls()[0];
  ok("[product] the read is an INNER join to visits, so the join's filters narrow the counted rows",
     p.columns.includes("visit:visits!inner"));
  eq("[product] only completed visits' audit rows are counted",
     p.filters.filter((f) => f.column === "visit.status"), [{ column: "visit.status", value: "completed" }]);

  // GPS: only started visits are counted.
  resetStub();
  queueResultFor("visits", { data: GPS_ROWS, error: null, count: GPS_ROWS.length });
  await fetchGpsReport(RANGE);
  eq("[gps] the started-visits condition is on the counted read",
     recordedCalls()[0].conditions.filter((c) => c.op === "not"),
     [{ op: "not", column: "started_at", value: null, operator: "is" }]);

  // Branch: a truncated visit read is refused even though the places list loaded —
  // it would otherwise show covered branches as uncovered.
  resetStub();
  queueResultFor("visits", { data: BRANCH_VISITS, error: null, count: 5000 });
  queueResultFor("places", { data: BRANCH_PLACES, error: null });
  queueResultFor("v_branch_operations", { data: BRANCH_OPS, error: null });
  const b = await outcome(() => fetchBranchReport(RANGE));
  ok("[branch] truncated visits are refused, with no zero-visit rows returned",
     b.error instanceof ReportIncompleteError && b.value === undefined);

  // Branch: the last-visit filter still applies after a complete read.
  resetStub();
  queueResultFor("visits", { data: BRANCH_VISITS, error: null, count: BRANCH_VISITS.length });
  queueResultFor("places", { data: BRANCH_PLACES, error: null });
  queueResultFor("v_branch_operations", { data: BRANCH_OPS, error: null });
  const never = await fetchBranchReport(RANGE, { lastVisit: "never" });
  eq("[branch] the last-visit filter narrows a complete result as before",
     never.map((r) => r.place_id), [P3, P2]);
}
