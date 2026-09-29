// fetchReportSummary — report_summary RPC (migration 026).
//
// The summary used to fetch every visit and audit row in the range and count
// them in the browser, which the Data API's 1,000-row cap could silently cut.
// These pin the replacement: one RPC with the caller's range and filters, an
// exact result shape, the old JavaScript rounding, and loud failures.
//
// Everything runs against the recording stub (tests/register.mjs); nothing here
// reaches Supabase or needs a session. Genuine signed-in API behaviour is NOT
// proven by these tests.

import { eq, ok } from "./_harness.ts";
import { fetchReportSummary } from "@/services/reports";
import { recordedRpcs, recordedCalls, queueResult, resetStub } from "./stubs/supabase-client.ts";

const RANGE = { from: "2026-05-01", to: "2026-09-19" };

// The live owner result for 2026-05-01..2026-09-19, which the app showed as
// 14 / 13 / 0 / 0 / 100% / 2 / 1 of 2 / 7714 min / 0 of 1.
const ROW = {
  total_visits: 14, completed: 13, missed: 0, pending: 0, inprogress: 1,
  active_merchandisers: 2, covered_branches: 1, scheduled_branches: 2,
  duration_sum: 92566, duration_count: 12,
  audited_products: 1, products_with_shortfall: 0,
};

async function rejects(run: () => Promise<unknown>): Promise<string | null> {
  try { await run(); return null; } catch (e) {
    // Supabase errors are plain objects carrying `message`, not Error instances.
    return (e as { message?: string } | null)?.message ?? String(e);
  }
}

// ── Call shape ───────────────────────────────────────────────────────────────
resetStub();
queueResult({ data: [ROW], error: null });
await fetchReportSummary(RANGE);
{
  const rpcs = recordedRpcs();
  eq("issues exactly one rpc", rpcs.length, 1);
  eq("calls report_summary", rpcs[0].fn, "report_summary");
  eq("no filters → range plus three NULLs", rpcs[0].args, {
    p_from: "2026-05-01", p_to: "2026-09-19", p_merch_id: null, p_place_id: null, p_status: null,
  });
  eq("reads no tables at all (no visits / visit_products fetch)", recordedCalls().length, 0);
}

resetStub();
queueResult({ data: [ROW], error: null });
await fetchReportSummary(RANGE, {
  merchId: "638e2e67-441d-499c-87e3-eda24ca45178",
  placeId: "3908bfc7-f93c-439a-a0b0-a53535d97396",
  status:  "inprogress",
});
eq("every filter is passed through verbatim", recordedRpcs()[0].args, {
  p_from: "2026-05-01", p_to: "2026-09-19",
  p_merch_id: "638e2e67-441d-499c-87e3-eda24ca45178",
  p_place_id: "3908bfc7-f93c-439a-a0b0-a53535d97396",
  p_status:   "inprogress",
});

// "" would reach PostgreSQL as an invalid uuid / enum value — it must be NULL.
resetStub();
queueResult({ data: [ROW], error: null });
await fetchReportSummary(RANGE, { merchId: "", placeId: "", status: "" });
{
  const args = recordedRpcs()[0].args as Record<string, unknown>;
  eq("empty-string filters become NULL", [args.p_merch_id, args.p_place_id, args.p_status], [null, null, null]);
  ok("no argument is ever an empty string", Object.values(args).every((v) => v !== ""));
}

// lastVisit narrows Branch Coverage only; it has no RPC parameter.
resetStub();
queueResult({ data: [ROW], error: null });
await fetchReportSummary(RANGE, { lastVisit: "gt30" });
eq("lastVisit is not sent to the summary", Object.keys(recordedRpcs()[0].args as object).sort(),
   ["p_from", "p_merch_id", "p_place_id", "p_status", "p_to"]);

// ── Mapping ──────────────────────────────────────────────────────────────────
resetStub();
queueResult({ data: [ROW], error: null });
eq("maps the live owner row onto the cards the app showed", await fetchReportSummary(RANGE), {
  total_visits: 14, completed: 13, missed: 0, pending: 0, inprogress: 1,
  completion_rate: 100,
  active_merchandisers: 2, covered_branches: 1, scheduled_branches: 2,
  avg_duration: 7714,
  audited_products: 1, products_with_shortfall: 0,
});

// No audit rows: unknown, not zero — the card says "no audits".
resetStub();
queueResult({ data: [{ ...ROW, total_visits: 1, completed: 0, inprogress: 1, active_merchandisers: 1,
  covered_branches: 0, scheduled_branches: 1, duration_sum: 0, duration_count: 0,
  audited_products: null, products_with_shortfall: null }], error: null });
{
  const s = await fetchReportSummary(RANGE);
  eq("NULL product figures stay null", [s.audited_products, s.products_with_shortfall], [null, null]);
  eq("nothing finished → rate 0", s.completion_rate, 0);
  eq("no recorded durations → average 0", s.avg_duration, 0);
}

// ── Rounding: JavaScript, same order as before ───────────────────────────────
async function summaryFor(over: Partial<typeof ROW>) {
  resetStub();
  queueResult({ data: [{ ...ROW, ...over }], error: null });
  return fetchReportSummary(RANGE);
}

eq("23 of 40 finished shows 57% (JavaScript), not SQL's exact 58%",
   (await summaryFor({ completed: 23, missed: 17 })).completion_rate, 57);
eq("which is exactly the old formula's result",
   Math.round((23 / 40) * 100), 57);
eq("pending and in-progress visits do not count against the rate",
   (await summaryFor({ completed: 3, missed: 1, pending: 50, inprogress: 50 })).completion_rate, 75);
eq("all missed → 0%", (await summaryFor({ completed: 0, missed: 4 })).completion_rate, 0);
eq("average is sum / count, rounded once",
   (await summaryFor({ duration_sum: 7, duration_count: 2 })).avg_duration, 4);
eq("average rounds down below .5",
   (await summaryFor({ duration_sum: 92566, duration_count: 12 })).avg_duration, 7714);

// ── Failure paths: loud, never a quiet zero, never a table fallback ──────────
async function failsWith(label: string, result: { data: unknown; error: unknown }) {
  resetStub();
  queueResult(result);
  const msg = await rejects(() => fetchReportSummary(RANGE));
  ok(`${label}: throws`, msg !== null);
  ok(`${label}: no table read as fallback`, recordedCalls().length === 0);
  ok(`${label}: exactly one rpc attempt`, recordedRpcs().length === 1);
}

await failsWith("rpc error", { data: null, error: { code: "42501", message: "permission denied for function report_summary" } });
await failsWith("function missing (PGRST202)", { data: null, error: { code: "PGRST202", message: "not found" } });
await failsWith("null payload", { data: null, error: null });
await failsWith("empty array", { data: [], error: null });
await failsWith("two rows", { data: [ROW, ROW], error: null });
await failsWith("a bare object instead of an array", { data: ROW, error: null });
await failsWith("a null row", { data: [null], error: null });
await failsWith("a missing count column", { data: [{ ...ROW, completed: undefined }], error: null });
await failsWith("a null count column", { data: [{ ...ROW, total_visits: null }], error: null });
await failsWith("a string count", { data: [{ ...ROW, duration_sum: "92566" }], error: null });
await failsWith("a fractional count", { data: [{ ...ROW, missed: 1.5 }], error: null });
await failsWith("a negative count", { data: [{ ...ROW, pending: -1 }], error: null });
await failsWith("a string product figure", { data: [{ ...ROW, audited_products: "1" }], error: null });
await failsWith("one product figure NULL, the other not",
  { data: [{ ...ROW, audited_products: null, products_with_shortfall: 0 }], error: null });

resetStub();
queueResult({ data: null, error: { code: "42501", message: "permission denied for function report_summary" } });
{
  const msg = await rejects(() => fetchReportSummary(RANGE));
  eq("the Supabase error itself is surfaced", msg, "permission denied for function report_summary");
}
