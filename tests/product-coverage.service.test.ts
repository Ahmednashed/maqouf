// fetchProductCoverage — Batch 18 (migration 024).
//
// These pin the swap from the unbounded place_products scan to
// v_product_coverage. The properties that matter are the query SHAPE (one
// query, the view, those columns) and the absence of a fallback: a silent
// fallback would quietly restore the whole-table read the view exists to
// remove. See docs/PERFORMANCE-RISKS.md §3.

import { eq, ok } from "./_harness.ts";
import { fetchProductCoverage } from "@/services/products";
import { recordedCalls, queueResult, resetStub } from "./stubs/supabase-client.ts";

// ── Query shape ──────────────────────────────────────────────────────────────
resetStub();
queueResult({ data: [], error: null });
await fetchProductCoverage();
{
  const calls = recordedCalls();
  eq("issues exactly one query", calls.length, 1);
  eq("reads the view, not place_products", calls[0].table, "v_product_coverage");
  eq("selects exactly the columns the view exposes",
     calls[0].columns, "product_id, branch_count, required_count");
  eq("applies no filters — the view is already company-scoped by RLS",
     calls[0].filters.length, 0);
  ok("never touches place_products",
     !calls.some((c) => c.table === "place_products"));
}

// ── Mapping ──────────────────────────────────────────────────────────────────
resetStub();
queueResult({
  data: [
    { product_id: "a", branch_count: 3, required_count: 1 },
    { product_id: "b", branch_count: 0, required_count: 0 },
  ],
  error: null,
});
const mapped = await fetchProductCoverage();
eq("keys the map by product_id", Object.keys(mapped).sort(), ["a", "b"]);
eq("carries branch_count through", mapped.a.branch_count, 3);
eq("carries required_count through", mapped.a.required_count, 1);
eq("an orphan is present with zeros, not absent",
   mapped.b, { branch_count: 0, required_count: 0 });
ok("the orphan key really exists in the map",
   Object.prototype.hasOwnProperty.call(mapped, "b"));

// ── Empty and null payloads ──────────────────────────────────────────────────
resetStub();
queueResult({ data: [], error: null });
eq("empty result yields an empty map", await fetchProductCoverage(), {});

resetStub();
queueResult({ data: null, error: null });
eq("null data yields an empty map, not a crash", await fetchProductCoverage(), {});

// ── Errors propagate; there is deliberately no fallback ──────────────────────
resetStub();
queueResult({ data: null, error: { code: "PGRST205", message: "not found in schema cache" } });
{
  let threw = false;
  try { await fetchProductCoverage(); } catch { threw = true; }
  const calls = recordedCalls();
  ok("a failed query throws rather than returning {}", threw);
  eq("does not retry or fall back — still exactly one query", calls.length, 1);
  ok("no place_products query on the error path",
     !calls.some((c) => c.table === "place_products"));
}

// ── Payload does not scale with assortment size ──────────────────────────────
// 500 products means 500 rows, one per product, in one query. That is the
// property the view exists to provide.
resetStub();
queueResult({
  data: Array.from({ length: 500 }, (_, i) => ({
    product_id: `p${i}`, branch_count: i % 7, required_count: i % 3,
  })),
  error: null,
});
const big = await fetchProductCoverage();
eq("one query regardless of row count", recordedCalls().length, 1);
eq("one map entry per product row", Object.keys(big).length, 500);
eq("values survive the batch", big.p8, { branch_count: 1, required_count: 2 });
