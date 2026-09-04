// fetchCompanyAttention — Batch 26 (migration 025).
//
// The panel used to derive six integers from five queries. These pin the
// replacement: one RPC, called with the Riyadh business day, mapped onto the
// same AttentionCounts shape the ranking already consumed.
//
// The date parameter is the reason this is a function rather than a view, so
// the test that it is actually passed through is the load-bearing one here.

import { eq, ok } from "./_harness.ts";
import { fetchCompanyAttention } from "@/services/attention";
import { attentionItems } from "@/lib/attention";
import { recordedRpcs, recordedCalls, queueResult, resetStub } from "./stubs/supabase-client.ts";

const FULL_ROW = {
  never_visited: 2, stale: 3, no_assortment: 1,
  unassigned: 4, orphan_products: 5, empty_templates: 6,
};

// ── Call shape ───────────────────────────────────────────────────────────────
resetStub();
queueResult({ data: [FULL_ROW], error: null });
await fetchCompanyAttention("2026-09-05");
{
  const rpcs = recordedRpcs();
  eq("issues exactly one rpc", rpcs.length, 1);
  eq("calls company_attention", rpcs[0].fn, "company_attention");
  eq("passes the day as p_today", rpcs[0].args, { p_today: "2026-09-05" });
  eq("reads no tables directly", recordedCalls().length, 0);
}

// The day must be whatever the caller passed — not today, not a default.
resetStub();
queueResult({ data: [FULL_ROW], error: null });
await fetchCompanyAttention("2026-01-01");
eq("the caller's day is passed through verbatim",
   recordedRpcs()[0].args, { p_today: "2026-01-01" });

// ── Mapping: snake_case row onto the camelCase counts ────────────────────────
resetStub();
queueResult({ data: [FULL_ROW], error: null });
eq("maps every column onto its count", await fetchCompanyAttention("2026-09-05"), {
  neverVisited: 2, stale: 3, noAssortment: 1,
  unassigned: 4, orphanProducts: 5, emptyTemplate: 6,
});

// Zeros are real answers, not missing data.
resetStub();
queueResult({ data: [{ never_visited: 0, stale: 0, no_assortment: 0, unassigned: 0, orphan_products: 0, empty_templates: 0 }], error: null });
{
  const counts = await fetchCompanyAttention("2026-09-05");
  eq("all-zero row maps to all-zero counts", counts, {
    neverVisited: 0, stale: 0, noAssortment: 0,
    unassigned: 0, orphanProducts: 0, emptyTemplate: 0,
  });
  eq("and produces no panel items", attentionItems(counts), []);
}

// ── Failure paths: loud, never a quiet zero ──────────────────────────────────
resetStub();
queueResult({ data: null, error: { code: "PGRST202", message: "function not found" } });
{
  let threw = false;
  try { await fetchCompanyAttention("2026-09-05"); } catch { threw = true; }
  ok("an rpc error throws rather than returning zeros", threw);
  ok("and does not fall back to reading tables", recordedCalls().length === 0);
}

// An empty array is the dangerous case: the SQL cannot produce it, and treating
// it as six zeros would render "everything is set up" from nothing.
resetStub();
queueResult({ data: [], error: null });
{
  let threw = false;
  try { await fetchCompanyAttention("2026-09-05"); } catch { threw = true; }
  ok("an empty result throws rather than being read as all-clear", threw);
}

resetStub();
queueResult({ data: null, error: null });
{
  let threw = false;
  try { await fetchCompanyAttention("2026-09-05"); } catch { threw = true; }
  ok("a null payload throws too", threw);
}

// ── End to end: counts → the same ranking the old path produced ──────────────
resetStub();
queueResult({ data: [FULL_ROW], error: null });
{
  const items = attentionItems(await fetchCompanyAttention("2026-09-05"));
  eq("red items rank before amber",
     items.map((i) => i.key),
     ["neverVisited", "noAssortment", "emptyTemplate", "stale", "unassigned", "orphanProducts"]);
  eq("counts survive onto the items",
     items.map((i) => i.count), [2, 1, 6, 3, 4, 5]);
  ok("every item carries a link and an action",
     items.every((i) => !!i.href && !!i.actionKey));
}

// A single non-zero count yields exactly one item — the live production shape.
resetStub();
queueResult({ data: [{ never_visited: 0, stale: 1, no_assortment: 0, unassigned: 0, orphan_products: 0, empty_templates: 0 }], error: null });
{
  const items = attentionItems(await fetchCompanyAttention("2026-09-05"));
  eq("one non-zero count yields one item", items.length, 1);
  eq("and it is the stale item", items[0].key, "stale");
  eq("with severity amber", items[0].severity, "amber");
}
