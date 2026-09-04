// fetchTeamWorkload / blankWorkload — Batch 7.
//
// The property worth protecting as the team grows is the query COUNT: exactly
// two reads, never one per member. The rest pins the counting rules, which are
// easy to get subtly wrong — missed visits belong in the total but in neither
// sub-count, and a member with branches but no visits must still appear.

import { eq, ok } from "./_harness.ts";
import { fetchTeamWorkload, blankWorkload } from "@/services/team-workload";
import { recordedCalls, queueResult, resetStub } from "./stubs/supabase-client.ts";

const DATE = "2026-08-29";

/** Queue the two reads the service makes, in the order it makes them. */
function given(visits: unknown[], places: unknown[]): void {
  resetStub();
  queueResult({ data: visits, error: null });
  queueResult({ data: places, error: null });
}

// ── Counting rules ───────────────────────────────────────────────────────────
given(
  [
    { merch_id: "m1", status: "completed" },
    { merch_id: "m1", status: "completed" },
    { merch_id: "m1", status: "pending" },
    { merch_id: "m1", status: "inprogress" },
    { merch_id: "m1", status: "missed" },
  ],
  [{ assigned_user_id: "m1" }, { assigned_user_id: "m1" }],
);
const wl = await fetchTeamWorkload(DATE);
eq("total counts every visit including missed", wl.m1.visits_today, 5);
eq("completed counts only completed", wl.m1.completed_today, 2);
eq("open is pending + inprogress", wl.m1.open_today, 2);
ok("missed is in neither sub-count",
   wl.m1.completed_today + wl.m1.open_today === 4 && wl.m1.visits_today === 5);
eq("assigned branches counted", wl.m1.assigned_branches, 2);

// ── Query shape: two reads, never per-member ─────────────────────────────────
{
  const calls = recordedCalls();
  eq("exactly two queries, never one per member", calls.length, 2);
  eq("first reads visits", calls[0].table, "visits");
  eq("second reads places", calls[1].table, "places");
  ok("visits are filtered by the date given",
     calls[0].filters.some((f) => f.value === DATE),
     JSON.stringify(calls[0].filters));
  ok("places are filtered to active only",
     calls[1].filters.some((f) => f.column === "is_active" && f.value === true),
     JSON.stringify(calls[1].filters));
}

// ── Members appearing on only one side ───────────────────────────────────────
given(
  [{ merch_id: "visits_only", status: "completed" }],
  [{ assigned_user_id: "branches_only" }],
);
const split = await fetchTeamWorkload(DATE);
eq("a member with visits but no branches is present with 0 branches",
   split.visits_only.assigned_branches, 0);
eq("...and keeps their visit counts", split.visits_only.completed_today, 1);
eq("a member with branches but no visits is present with 0 visits",
   split.branches_only.visits_today, 0);
eq("...and keeps their branch count", split.branches_only.assigned_branches, 1);
ok("an unknown id is simply absent", split.nobody === undefined);

// ── Unassigned branches create no member ─────────────────────────────────────
given([], [{ assigned_user_id: null }, { assigned_user_id: "m2" }]);
const unassigned = await fetchTeamWorkload(DATE);
ok("a null assigned_user_id creates no key",
   !Object.prototype.hasOwnProperty.call(unassigned, "null"),
   JSON.stringify(Object.keys(unassigned)));
eq("only the real member is present", Object.keys(unassigned), ["m2"]);
eq("m2 is credited with one branch", unassigned.m2.assigned_branches, 1);
eq("m2 has no visits", unassigned.m2.visits_today, 0);

// ── Empty input ──────────────────────────────────────────────────────────────
given([], []);
eq("empty data yields an empty map, not a throw", await fetchTeamWorkload(DATE), {});

// ── blankWorkload ────────────────────────────────────────────────────────────
eq("blankWorkload is all zeroes", blankWorkload(),
   { visits_today: 0, completed_today: 0, open_today: 0, assigned_branches: 0 });
ok("blankWorkload returns a fresh object each call",
   blankWorkload() !== blankWorkload());
