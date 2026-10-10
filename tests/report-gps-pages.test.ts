// GPS Compliance — the started visits behind it, read in pages.
//
// The shared suite (tests/_report-paging.ts) checks what every paged tab must
// do. This file supplies the GPS fixture and a second implementation of the
// answer, then pins what is particular to this tab: only started visits are
// read, on every page; a merchandiser whose check-ins straddle a page boundary
// is tallied once, with the rate and average distance rounded as before; and
// the row that goes into the workbook has the columns it always had.

import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { eq, ok } from "./_harness.ts";
import { fetchGpsReport, type GpsReportRow } from "@/services/reports";
import { useGpsReport } from "@/hooks/use-reports";
import { gpsExportRow } from "@/lib/gps-report";
import { RANGE, key, queuePages, runPagedTabSuite, tabCalls, en, type PagedTab } from "./_report-paging.ts";

// ── Fixture ──────────────────────────────────────────────────────────────────
const MERCHS = [
  { id: "m-ahmed", merch: { display_name: null,     user: { full_name: "Ahmed" } } },
  { id: "m-sara",  merch: { display_name: " Sara ", user: { full_name: "ignored" } } },
  { id: "m-blank", merch: { display_name: "  ",     user: { full_name: "Fallback Name" } } },
  { id: "m-gone",  merch: null },
];
const EDGE_MERCH = { display_name: null, user: { full_name: "Edge Case" } };
const HERE = { lat: 24.7, lng: 46.6 };

interface Raw {
  id: string; merch_id: string;
  checkin_verified: boolean | null; checkin_lat: number | null; checkin_lng: number | null; checkin_distance_meters: number | null;
  place: { lat: number | null; lng: number | null } | null;
  merch: { display_name: string | null; user: { full_name: string } | null } | null;
}
// Rows 1000 | 1001–1003 sit either side of the first page boundary.
const EDGE: Record<number, Omit<Raw, "id" | "merch_id" | "merch">> = {
  1000: { checkin_verified: true,  checkin_lat: 24.7, checkin_lng: 46.6, checkin_distance_meters: 40,   place: HERE },
  1001: { checkin_verified: true,  checkin_lat: 24.7, checkin_lng: 46.6, checkin_distance_meters: 45,   place: HERE },
  1002: { checkin_verified: false, checkin_lat: 24.9, checkin_lng: 46.9, checkin_distance_meters: 900,  place: HERE },
  1003: { checkin_verified: null,  checkin_lat: null, checkin_lng: null, checkin_distance_meters: null, place: { lat: null, lng: null } },
};
function row(n: number): Raw {
  if (EDGE[n]) return { id: key(n), merch_id: "m-edge", merch: EDGE_MERCH, ...EDGE[n] };
  const m = MERCHS[n % MERCHS.length];
  const place = n % 13 === 0 ? null : n % 9 === 0 ? { lat: null, lng: null } : HERE;
  const base = { id: key(n), merch_id: m.id, merch: m.merch, place };
  switch (n % 5) {
    case 0:  return { ...base, checkin_verified: true,  checkin_lat: 24.7, checkin_lng: 46.6, checkin_distance_meters: (n % 300) + 1 };
    case 1:  return { ...base, checkin_verified: true,  checkin_lat: 24.7, checkin_lng: 46.6, checkin_distance_meters: null };
    case 2:  return { ...base, checkin_verified: false, checkin_lat: 24.9, checkin_lng: 46.9, checkin_distance_meters: 800 };
    case 3:  return { ...base, checkin_verified: null,  checkin_lat: null, checkin_lng: null, checkin_distance_meters: null };
    default: return { ...base, checkin_verified: null,  checkin_lat: 24.8, checkin_lng: 46.7, checkin_distance_meters: null };
  }
}
const rowsOf = (n: number) => Array.from({ length: n }, (_, i) => row(i + 1));

// ── The answer, worked out a second way ──────────────────────────────────────
function reference(rows: Raw[]): GpsReportRow[] {
  const ids = [...new Set(rows.map((r) => r.merch_id))];
  const out = ids.map((id) => {
    const mine = rows.filter((r) => r.merch_id === id);
    const hasFix = (r: Raw) => r.checkin_lat != null && r.checkin_lng != null;
    const verified = mine.filter((r) => r.checkin_verified === true);
    const outside  = mine.filter((r) => r.checkin_verified !== true && hasFix(r));
    const dists    = verified.map((r) => r.checkin_distance_meters).filter((d): d is number => d != null);
    const measured = verified.length + outside.length;
    const first = mine[0].merch;
    return {
      merch_id:          id,
      full_name:         (first?.display_name ?? "").trim() || first?.user?.full_name || "—",
      total_started:     mine.length,
      gps_verified:      verified.length,
      gps_outside:       outside.length,
      gps_not_recorded:  mine.length - verified.length - outside.length,
      no_branch_coords:  mine.filter((r) => r.place?.lat == null || r.place?.lng == null).length,
      verification_rate: measured > 0 ? Math.round((verified.length / measured) * 100) : null,
      avg_distance:      dists.length > 0 ? Math.round(dists.reduce((a, b) => a + b, 0) / dists.length) : null,
    };
  });
  return out.map((r, i) => ({ r, i })).sort((a, b) => b.r.total_started - a.r.total_started || a.i - b.i).map((x) => x.r);
}

const TAB: PagedTab<Raw, GpsReportRow> = {
  name: "gps", table: "visits",
  run: (filters, signal) => fetchGpsReport(RANGE, filters, signal),
  rowsOf, reference,
  cursorAfter: (r) => ["gt", "id", r.id],
  dateColumn: "scheduled_date", merchColumn: "merch_id", placeColumn: "place_id",
  fixedFilters: [],
  fixedConditions: [["not", "started_at", "is", null]],
  orders: [{ column: "id", ascending: true }],
  outputKeys: ["avg_distance", "full_name", "gps_not_recorded", "gps_outside", "gps_verified", "merch_id", "no_branch_coords", "total_started", "verification_rate"],
  leak: /k\d{6}/,
  narrowed: {
    filters: { merchId: "m-ahmed" },
    rows: Array.from({ length: 1200 }, (_, i) => ({ ...row(4), id: key(60_000 + i + 1), checkin_distance_meters: 10 + (i % 7) })),
  },
};

await runPagedTabSuite(TAB);

// ── Particular to GPS ────────────────────────────────────────────────────────
console.log("gps: started visits only, a merchandiser across the boundary, and the workbook row");
{
  const rows = rowsOf(2300);
  queuePages(TAB, rows);
  const out = await fetchGpsReport(RANGE);

  ok("only started visits are read, on every page",
     tabCalls(TAB).length === 3 && tabCalls(TAB).every((c) => c.conditions.some((x) => x.op === "not" && x.column === "started_at" && x.operator === "is" && x.value === null)));
  const cols = tabCalls(TAB)[0].columns.replace(/\s+/g, "");
  ok("the visit id is selected, as the paging key", cols.startsWith("id,merch_id,checkin_verified,checkin_lat,checkin_lng,checkin_distance_meters,"));
  ok("the columns the report is built from are unchanged",
     cols.includes("place:places(lat,lng)") && cols.includes("merch:company_users(display_name,user:users!company_users_user_id_fkey(full_name))"));

  // One verified check-in (40 m) on page 1; a verified one (45 m), one outside
  // and one unrecorded at a branch without coordinates on page 2.
  // 2 of 3 measured → 67%; (40 + 45) / 2 = 42.5 → 43.
  eq("a merchandiser's check-ins on both pages are tallied once, rounded as before", out.find((r) => r.merch_id === "m-edge"),
     { merch_id: "m-edge", full_name: "Edge Case", total_started: 4, gps_verified: 2, gps_outside: 1, gps_not_recorded: 1, no_branch_coords: 1, verification_rate: 67, avg_distance: 43 });
  ok("the fixture really does split it across the boundary",
     rows.slice(0, 1000).filter((r) => r.merch_id === "m-edge").length === 1 && rows.slice(1000, 2000).filter((r) => r.merch_id === "m-edge").length === 3);
  eq("names: user name, trimmed display name, blank display name falling back, and no record at all",
     ["m-ahmed", "m-sara", "m-blank", "m-gone"].map((id) => out.find((r) => r.merch_id === id)!.full_name), ["Ahmed", "Sara", "Fallback Name", "—"]);
  ok("most started first", out.every((r, i) => i === 0 || out[i - 1].total_started >= r.total_started));
  eq("every started visit is counted once", out.reduce((a, r) => a + r.total_started, 0), 2300);
  ok("the missing-coordinates count the tab's warning is built from is carried through",
     out.reduce((a, r) => a + r.no_branch_coords, 0) === rows.filter((r) => r.place?.lat == null || r.place?.lng == null).length);

  // A merchandiser with nothing measured has no rate and no distance — not zeros.
  queuePages(TAB, [3, 8, 13].map((n, i) => ({ ...row(3), id: key(i + 1), merch_id: "m-none", merch: null })));
  eq("nothing measured → null rate and null distance, as before",
     (await fetchGpsReport(RANGE)).map((r) => [r.total_started, r.gps_not_recorded, r.verification_rate, r.avg_distance]), [[3, 3, null, null]]);

  // The workbook row: the same eight columns, built from report fields only.
  const exported = out.map((r) => gpsExportRow(r, en));
  eq("the workbook row has the eight columns it always had", Object.keys(exported[0]),
     ["reports.col.merch", "reports.col.totalStarted", "reports.col.gpsVerified", "reports.col.gpsOutside",
      "reports.col.gpsNotRecorded", "reports.col.noBranchCoords", "reports.col.gpsRate", "reports.col.avgDistance"].map((k) => en(k)));
  ok("no visit id reaches a workbook row", !/k\d{6}/.test(JSON.stringify(exported)));
}

console.log("gps: hook wiring");
{
  const client = new QueryClient();
  function Probe() { useGpsReport(RANGE, { merchId: "M" }); return null; }
  renderToString(createElement(QueryClientProvider, { client }, createElement(Probe)));
  const query = client.getQueryCache().getAll().find((q) => q.queryKey[1] === "gps")!;
  const fn = query.options.queryFn as unknown as (context: { signal: AbortSignal }) => Promise<GpsReportRow[]>;
  eq("the hook's key is unchanged: range and filters", [...query.queryKey], ["reports", "gps", RANGE.from, RANGE.to, "M", "", "", ""]);
  eq("the outer retry is still off, and staleTime unchanged", [query.options.retry, (query.options as { staleTime?: number }).staleTime], [false, 120_000]);

  const aborted = new AbortController();
  aborted.abort();
  queuePages(TAB, rowsOf(2300));
  const r = await fn({ signal: aborted.signal }).then(() => null, (e) => e as Error);
  eq("the hook hands TanStack's signal to the fetcher: aborted means no request", [tabCalls(TAB).length, r?.name], [0, "AbortError"]);

  queuePages(TAB, rowsOf(1001));
  const live = new AbortController();
  await fn({ signal: live.signal });
  ok("…and its filters and signal reach every page",
     tabCalls(TAB).length === 2 && tabCalls(TAB).every((c) => c.signal === live.signal && c.filters.some((f) => f.column === "merch_id" && f.value === "M")));
  client.clear();
}
