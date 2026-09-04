// fetchPlaceOperations / fetchBranchLastVisits / daysSinceIso — Batch 15
// (migration 022).
//
// Both services read v_branch_operations. The properties pinned here are the
// query shape — one query, the view, never the base tables — and the two map
// shapes staying distinct: place operations carries assortment counts, last
// visits carries only the three visit fields. See docs/PERFORMANCE-RISKS.md
// §1 and §2.

import { eq, ok } from "./_harness.ts";
import { fetchPlaceOperations, fetchBranchLastVisits, daysSinceIso } from "@/services/places";
import { recordedCalls, queueResult, resetStub } from "./stubs/supabase-client.ts";

const ROWS = [
  {
    place_id: "kharees", last_visit_date: "2026-08-29", last_visit_status: "inprogress",
    last_visit_merch: "u1", product_count: 1, required_count: 1,
  },
  {
    place_id: "testp1", last_visit_date: null, last_visit_status: null,
    last_visit_merch: null, product_count: 2, required_count: 1,
  },
];

// ── Query shape ──────────────────────────────────────────────────────────────
resetStub();
queueResult({ data: ROWS, error: null });
const ops = await fetchPlaceOperations();
{
  const calls = recordedCalls();
  eq("exactly one query", calls.length, 1);
  eq("against v_branch_operations", calls[0].table, "v_branch_operations");
  ok("never touches visits", !calls.some((c) => c.table === "visits"));
  ok("never touches place_products", !calls.some((c) => c.table === "place_products"));
}

// ── fetchPlaceOperations mapping ─────────────────────────────────────────────
eq("visited branch keeps its date", ops.kharees.last_visit_date, "2026-08-29");
eq("visited branch keeps its status", ops.kharees.last_visit_status, "inprogress");
eq("merch carried through", ops.kharees.last_visit_merch, "u1");
eq("assortment counts carried through",
   [ops.kharees.product_count, ops.kharees.required_count], [1, 1]);
eq("never-visited branch has a null date", ops.testp1.last_visit_date, null);
eq("never-visited branch still has assortment counts",
   [ops.testp1.product_count, ops.testp1.required_count], [2, 1]);
ok("a branch the view did not return is simply absent", ops.nosuch === undefined);

// ── fetchBranchLastVisits returns the narrower shape ─────────────────────────
resetStub();
queueResult({ data: ROWS, error: null });
const last = await fetchBranchLastVisits();
eq("three fields only", Object.keys(last.kharees).sort(),
   ["last_visit_date", "last_visit_merch", "last_visit_status"]);
ok("no product counts leak in",
   !("product_count" in last.kharees) && !("required_count" in last.kharees));
eq("unvisited branch present with nulls", last.testp1,
   { last_visit_date: null, last_visit_status: null, last_visit_merch: null });

// ── daysSinceIso ─────────────────────────────────────────────────────────────
eq("23 days", daysSinceIso("2026-08-06", "2026-08-29"), 23);
eq("same day is 0, not null", daysSinceIso("2026-08-29", "2026-08-29"), 0);
eq("never visited is null", daysSinceIso(null, "2026-08-29"), null);
eq("a future date goes negative rather than clamping",
   daysSinceIso("2026-09-02", "2026-08-29"), -4);

// ── Empty payloads ───────────────────────────────────────────────────────────
resetStub();
queueResult({ data: [], error: null });
eq("no rows yields an empty map, not a throw", await fetchPlaceOperations(), {});

resetStub();
queueResult({ data: null, error: null });
eq("null data yields an empty map", await fetchBranchLastVisits(), {});

// ── Errors propagate; no fallback to the old visits scan ─────────────────────
resetStub();
queueResult({ data: null, error: { code: "PGRST205", message: "missing" } });
{
  let threw = false;
  try { await fetchPlaceOperations(); } catch { threw = true; }
  ok("fetchPlaceOperations throws", threw);
  eq("and does not fall back to a second query", recordedCalls().length, 1);
}

resetStub();
queueResult({ data: null, error: { code: "PGRST205", message: "missing" } });
{
  let threw = false;
  try { await fetchBranchLastVisits(); } catch { threw = true; }
  ok("fetchBranchLastVisits throws", threw);
  ok("no visits query on the error path",
     !recordedCalls().some((c) => c.table === "visits"));
}
