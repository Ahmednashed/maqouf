// Product Availability — the audit rows behind it, read in pages.
//
// The base table, visit_products, has no id of its own: its primary key is the
// pair (visit_id, product_id), and the read is narrowed through an inner join
// on the parent visit. So this tab's cursor is composite — "a later visit, or
// the same visit and a later product" — and its count is of audit rows after
// the join's filters. Both are what PostgREST is asked for here; how the real
// API answers is observed separately against it, read-only.
//
// The shared suite (tests/_report-paging.ts) checks what every paged tab must
// do. The rest of this file is what is particular to this one: the composite
// cursor landing in the middle of a visit, the join's filters on every page,
// keys that cannot safely form a cursor being refused, and the figures,
// fallbacks, order and workbook fields being what they were.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { eq, ok } from "./_harness.ts";
import { fetchProductReport, type ProductReportRow } from "@/services/reports";
import { useProductReport } from "@/hooks/use-reports";
import { RANGE, cursors, key, outcome, queuePages, refusal, runPagedTabSuite, tabCalls, type PagedTab } from "./_report-paging.ts";

// ── Fixture ──────────────────────────────────────────────────────────────────
// Three audit rows per visit, in product order, so the 1,000-row boundary falls
// INSIDE visit 334: its first product ends page 1, its other two start page 2.
// Visits 333–335 audit "prod-Cx" instead of "prod-C" — a product with exactly
// three rows, one on page 1 and two on page 2.
const info = (n: string) => ({ id: `prod-${n}`, name_ar: `منتج ${n}`, name_en: `Product ${n}`, sku: `SKU-${n}`, unit: n === "A" ? "box" : "pc" });
interface Raw { visit_id: string; product_id: string; qty_found: number | null; qty_missing: number | null; product: ReturnType<typeof info> | null }

const EDGE: Record<number, { qty_found: number | null; qty_missing: number | null }> = {
  999:  { qty_found: 5, qty_missing: 0 },      // visit 333, on page 1
  1002: { qty_found: 0, qty_missing: 3 },      // visit 334, on page 2
  1005: { qty_found: 2, qty_missing: null },   // visit 335, on page 2
};
function row(n: number, visitOffset = 0): Raw {
  const visit = Math.floor((n - 1) / 3) + 1;
  const visit_id = key(visitOffset + visit);
  if (EDGE[n] && visitOffset === 0) return { visit_id, product_id: "prod-Cx", ...EDGE[n], product: info("Cx") };
  const letter = ["A", "B", "C"][(n - 1) % 3];
  return {
    visit_id, product_id: `prod-${letter}`,
    qty_found:   n % 4 === 0 ? 0 : n % 6 === 0 ? null : n % 9,
    qty_missing: n % 5 === 0 ? (n % 7) + 1 : n % 8 === 0 ? null : 0,
    // Product B's record is gone: its names fall back to a dash.
    product: letter === "B" ? null : info(letter),
  };
}
const rowsOf = (n: number) => Array.from({ length: n }, (_, i) => row(i + 1));

// ── The answer, worked out a second way ──────────────────────────────────────
function reference(rows: Raw[]): ProductReportRow[] {
  const ids = [...new Set(rows.map((r) => r.product_id))];
  const out = ids.map((id) => {
    const mine = rows.filter((r) => r.product_id === id);
    const found = mine.filter((r) => (r.qty_found ?? 0) > 0).length;
    const missing = mine.filter((r) => (r.qty_missing ?? 0) > 0);
    const p = mine[0].product;
    return {
      product_id: id, name_ar: p?.name_ar ?? "—", name_en: p?.name_en ?? "—", sku: p?.sku ?? "—", unit: p?.unit ?? "—",
      audited_count: mine.length, found_count: found, missing_count: missing.length,
      availability_pct: mine.length > 0 ? Math.round((found / mine.length) * 100) : 0,
      total_missing: missing.reduce((a, r) => a + (r.qty_missing as number), 0),
    };
  });
  // Least available first; ties keep first-met order.
  return out.map((r, i) => ({ r, i })).sort((a, b) => a.r.availability_pct - b.r.availability_pct || a.i - b.i).map((x) => x.r);
}

const cursorAfter = (r: Raw) => ["or", `visit_id.gt.${r.visit_id},and(visit_id.eq.${r.visit_id},product_id.gt.${r.product_id})`];

const TAB: PagedTab<Raw, ProductReportRow> = {
  name: "product", table: "visit_products",
  run: (filters, signal) => fetchProductReport(RANGE, filters, signal),
  rowsOf, reference, cursorAfter,
  dateColumn: "visit.scheduled_date", merchColumn: "visit.merch_id", placeColumn: "visit.place_id",
  fixedFilters: [{ column: "visit.status", value: "completed" }],
  fixedConditions: [],
  orders: [{ column: "visit_id", ascending: true }, { column: "product_id", ascending: true }],
  outputKeys: ["audited_count", "availability_pct", "found_count", "missing_count", "name_ar", "name_en", "product_id", "sku", "total_missing", "unit"],
  leak: /k\d{6}/,
  narrowed: { filters: { merchId: "m-ahmed" }, rows: Array.from({ length: 1200 }, (_, i) => row(i + 1, 60_000)) },
};

await runPagedTabSuite(TAB);

// ── Particular to Product ────────────────────────────────────────────────────
console.log("product: the composite cursor, the join's filters, and the figures");
{
  const rows = rowsOf(2300);
  queuePages(TAB, rows);
  const out = await fetchProductReport(RANGE, { merchId: "M", placeId: "P" });
  const c = tabCalls(TAB);

  eq("the first boundary falls inside a visit: its first product ends page 1, the next starts page 2",
     [rows[999].visit_id, rows[999].product_id, rows[1000].visit_id, rows[1000].product_id], [key(334), "prod-A", key(334), "prod-B"]);
  eq("page 2 asks for a later visit, or the same visit and a later product",
     cursors(TAB)[1], ["or", `visit_id.gt.${key(334)},and(visit_id.eq.${key(334)},product_id.gt.prod-A)`]);
  eq("page 3 likewise, from where page 2 ended", cursors(TAB)[2], cursorAfter(rows[1999]));
  ok("the cursor is one condition on the audit table itself — not on the joined visit", c.slice(1).every((x) =>
    x.conditions.filter((k) => k.op === "or").length === 1 && !String(x.conditions.find((k) => k.op === "or")!.value).includes("visit.")));
  ok("the first page has no cursor at all", !c[0].conditions.some((k) => k.op === "or" || k.op === "gt"));

  const cols = c[0].columns.replace(/\s+/g, "");
  ok("both halves of the key are selected", cols.startsWith("visit_id,product_id,qty_found,qty_missing,"));
  ok("the read is still an INNER join to visits, so the join's filters narrow the counted rows", cols.includes("visit:visits!inner(scheduled_date,status,merch_id,place_id)"));
  ok("the product columns are unchanged", cols.includes("product:products(id,name_ar,name_en,sku,unit)"));
  ok("only completed visits' audit rows, on every page", c.every((x) => x.filters.some((f) => f.column === "visit.status" && f.value === "completed")));
  ok("the merchandiser and branch filters go through the join, on every page",
     c.every((x) => x.filters.some((f) => f.column === "visit.merch_id" && f.value === "M") && x.filters.some((f) => f.column === "visit.place_id" && f.value === "P")));
  ok("the date range goes through the join, on every page", c.every((x) =>
    JSON.stringify(x.conditions.filter((k) => k.column === "visit.scheduled_date").map((k) => [k.op, k.value])) === JSON.stringify([["gte", RANGE.from], ["lte", RANGE.to]])));

  // Found 5 on page 1; found 0 / missing 3 and found 2 on page 2:
  // 2 of 3 found → 67%; 1 row missing, 3 units.
  eq("a product audited on both pages is one row, rounded as before", out.find((r) => r.product_id === "prod-Cx"),
     { product_id: "prod-Cx", name_ar: "منتج Cx", name_en: "Product Cx", sku: "SKU-Cx", unit: "pc", audited_count: 3, found_count: 2, missing_count: 1, availability_pct: 67, total_missing: 3 });
  ok("the fixture really does split it: one audit on page 1, two on page 2",
     rows.slice(0, 1000).filter((r) => r.product_id === "prod-Cx").length === 1 && rows.slice(1000, 2000).filter((r) => r.product_id === "prod-Cx").length === 2);
  eq("a product whose record is gone shows dashes, as before",
     (({ name_ar, name_en, sku, unit }) => [name_ar, name_en, sku, unit])(out.find((r) => r.product_id === "prod-B")!), ["—", "—", "—", "—"]);
  ok("least available first", out.every((r, i) => i === 0 || out[i - 1].availability_pct <= r.availability_pct));
  eq("every audit row is counted once", out.reduce((a, r) => a + r.audited_count, 0), 2300);
  eq("null quantities count as nothing found and nothing missing",
     (() => { const o = out.find((r) => r.product_id === "prod-B")!;
              return [o.found_count, o.missing_count, o.total_missing]; })(),
     (() => { const b = rows.filter((r) => r.product_id === "prod-B");
              return [b.filter((r) => (r.qty_found ?? 0) > 0).length, b.filter((r) => (r.qty_missing ?? 0) > 0).length, b.reduce((a, r) => a + Math.max(r.qty_missing ?? 0, 0), 0)]; })());
}

console.log("product: keys that cannot safely form a cursor");
{
  const N = 1001;
  const bad: Array<[string, (r: Raw) => Record<string, unknown>]> = [
    ["a row with no visit_id",                       (r) => ({ ...r, visit_id: undefined })],
    ["a row with no product_id",                     (r) => ({ ...r, product_id: null })],
    ["an empty visit_id",                            (r) => ({ ...r, visit_id: "" })],
    ["an id that is not a string",                   (r) => ({ ...r, product_id: 7 })],
    ["an id containing filter syntax (a comma)",     (r) => ({ ...r, visit_id: "a,b" })],
    ["an id containing filter syntax (a bracket)",   (r) => ({ ...r, product_id: "x)" })],
    ["an id containing a dot",                       (r) => ({ ...r, visit_id: "a.gt.b" })],
  ];
  for (const [label, breakIt] of bad) {
    // The bad row is the last of page 1 — the one the next cursor would be built from.
    queuePages(TAB, rowsOf(N), (p, i) => (i === 0 ? { ...p, data: (p.data as Raw[]).map((r, k) => (k === 999 ? breakIt(r) : r)) } : p));
    const r = await outcome(() => fetchProductReport(RANGE));
    eq(`${label} → refused as unverified; no cursor is built from it and page 2 is never requested`,
       [refusal(r.error), r.value, tabCalls(TAB).length], [["product", "unverified", 1000, null, null], undefined, 1]);
  }
  // Two rows with the same pair are a duplicate key, even though each half is fine.
  queuePages(TAB, rowsOf(N), (p, i) => (i === 0 ? { ...p, data: (p.data as Raw[]).map((r, k, all) => (k === 500 ? all[499] : r)) } : p));
  eq("a repeated (visit, product) pair → refused", refusal((await outcome(() => fetchProductReport(RANGE))).error), ["product", "unverified", 1000, null, null]);
  // The same product under a later visit is NOT a duplicate; neither is a later product under the same visit.
  queuePages(TAB, [
    { visit_id: "v1", product_id: "prod-B", qty_found: 1, qty_missing: 0, product: null },
    { visit_id: "v2", product_id: "prod-A", qty_found: 1, qty_missing: 0, product: null },
    { visit_id: "v2", product_id: "prod-B", qty_found: 0, qty_missing: 2, product: null },
  ]);
  eq("pairs are ordered by visit first, then product: a 'smaller' product under a later visit is in order",
     (await fetchProductReport(RANGE)).map((r) => [r.product_id, r.audited_count]).sort(), [["prod-A", 1], ["prod-B", 2]]);
  // Ids of different lengths still order as pairs.
  queuePages(TAB, [
    { visit_id: "v9",  product_id: "p-z", qty_found: 1, qty_missing: 0, product: null },
    { visit_id: "v90", product_id: "p-a", qty_found: 1, qty_missing: 0, product: null },
  ]);
  eq("a visit id that is a prefix of the next one is still 'before' it", (await fetchProductReport(RANGE)).length, 2);
  queuePages(TAB, [
    { visit_id: "v90", product_id: "p-a", qty_found: 1, qty_missing: 0, product: null },
    { visit_id: "v9",  product_id: "p-z", qty_found: 1, qty_missing: 0, product: null },
  ]);
  eq("…and the reverse is out of order, so refused", refusal((await outcome(() => fetchProductReport(RANGE))).error), ["product", "unverified", 2, null, null]);
}

console.log("product: hook wiring and export fields");
{
  const client = new QueryClient();
  function Probe() { useProductReport(RANGE, { merchId: "M" }); return null; }
  renderToString(createElement(QueryClientProvider, { client }, createElement(Probe)));
  const query = client.getQueryCache().getAll().find((q) => q.queryKey[1] === "product")!;
  const fn = query.options.queryFn as unknown as (context: { signal: AbortSignal }) => Promise<ProductReportRow[]>;
  eq("the hook's key is unchanged: range and filters", [...query.queryKey], ["reports", "product", RANGE.from, RANGE.to, "M", "", "", ""]);
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
     tabCalls(TAB).length === 2 && tabCalls(TAB).every((c) => c.signal === live.signal && c.filters.some((f) => f.column === "visit.merch_id" && f.value === "M")));
  client.clear();

  // (Source check: the tab cannot be rendered in this runner.)
  const src = readFileSync(join(import.meta.dirname, "..", "src", "app", "(dashboard)", "reports", "page.tsx"), "utf8");
  const start = src.indexOf("function ProductTab(");
  const tab = src.slice(start, src.indexOf("\nfunction ", start + 10));
  const exportBlock = tab.slice(tab.indexOf("async function doExport()"), tab.indexOf("exportReportXlsx("));
  eq("the export maps exactly the report fields it always did",
     (exportBlock.match(/\br\.([a-z_]+)/g) ?? []).map((m) => m.slice(2)),
     ["name_ar", "name_en", "sku", "audited_count", "found_count", "missing_count", "availability_pct", "total_missing"]);
  ok("the Product tab never reads a visit id", !/\br\.visit_id\b/.test(tab));
}
