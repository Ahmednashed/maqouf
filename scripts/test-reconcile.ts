/* eslint-disable no-console */
// ─────────────────────────────────────────────────────────────────────────────
// Reconciliation + template-inheritance tests.
//
//   npx tsx scripts/test-reconcile.ts
//
// Pure functions only. The database half of the safety model (which rows are
// even eligible) is enforced by v_untouched_generated_visits in migration 020;
// here the `untouched` flag stands in for that view's verdict, and the tests
// assert the planner NEVER proposes a row the view rejected.
// ─────────────────────────────────────────────────────────────────────────────

import {
  planReconciliation,
  isNoopPlan,
  type ExistingGeneratedVisit,
} from "../src/lib/schedule-reconcile";
import { occurrencesFor, type RecurrenceRule } from "../src/lib/recurrence";

let passed = 0;
let failed = 0;

function check(name: string, ok: boolean, detail: string) {
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name} — ${detail}`);
  ok ? passed++ : failed++;
}

function eq(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  check(name, a === e, a === e ? a : `expected ${e}, got ${a}`);
}

const TODAY = "2026-08-10";
const TPL_A = "tpl-aaaa";
const TPL_B = "tpl-bbbb";

/** Shorthand builder; `untouched` defaults to true (the safe-to-touch case). */
function v(
  id: string,
  date: string,
  opts: { template?: string | null; untouched?: boolean } = {}
): ExistingGeneratedVisit {
  return {
    id,
    scheduled_date: date,
    template_id:    opts.template === undefined ? TPL_A : opts.template,
    untouched:      opts.untouched === undefined ? true : opts.untouched,
  };
}

// ─── Idempotency ──────────────────────────────────────────────────────────────

console.log("\n── Idempotency ──");

const steadyState = planReconciliation({
  desiredDates: ["2026-08-16", "2026-08-23"],
  existing:     [v("v1", "2026-08-16"), v("v2", "2026-08-23")],
  templateId:   TPL_A,
  today:        TODAY,
});

check(
  "I1: an unchanged schedule plans nothing at all",
  isNoopPlan(steadyState) && steadyState.unchanged === 2,
  `noop=${isNoopPlan(steadyState)} unchanged=${steadyState.unchanged}`
);

const repeat = planReconciliation({
  desiredDates: ["2026-08-16", "2026-08-23"],
  existing:     [v("v1", "2026-08-16"), v("v2", "2026-08-23")],
  templateId:   TPL_A,
  today:        TODAY,
});
check(
  "I2: repeated planning is byte-identical",
  JSON.stringify(steadyState) === JSON.stringify(repeat),
  "identical plans"
);

eq(
  "I3: missing occurrences are inserted, nothing else touched",
  planReconciliation({
    desiredDates: ["2026-08-16", "2026-08-23", "2026-08-30"],
    existing:     [v("v1", "2026-08-16")],
    templateId:   TPL_A,
    today:        TODAY,
  }),
  {
    toInsert: ["2026-08-23", "2026-08-30"],
    toDelete: [], toRetemplate: [], protectedStale: [], unchanged: 1,
  }
);

// ─── Template inheritance ─────────────────────────────────────────────────────

console.log("\n── Template inheritance ──");

const tplChanged = planReconciliation({
  desiredDates: ["2026-08-16", "2026-08-23"],
  existing:     [v("v1", "2026-08-16", { template: TPL_A }),
                 v("v2", "2026-08-23", { template: TPL_A })],
  templateId:   TPL_B,                       // schedule switched checklist
  today:        TODAY,
});
eq("T1: template change re-templates untouched future visits",
  tplChanged.toRetemplate, ["v1", "v2"]);
eq("T2: …and deletes nothing", tplChanged.toDelete, []);

eq(
  "T3: attaching a checklist to a previously template-less schedule",
  planReconciliation({
    desiredDates: ["2026-08-16"],
    existing:     [v("v1", "2026-08-16", { template: null })],
    templateId:   TPL_A,
    today:        TODAY,
  }).toRetemplate,
  ["v1"]
);

eq(
  "T4: clearing the checklist propagates to untouched future visits",
  planReconciliation({
    desiredDates: ["2026-08-16"],
    existing:     [v("v1", "2026-08-16", { template: TPL_A })],
    templateId:   null,
    today:        TODAY,
  }).toRetemplate,
  ["v1"]
);

const tplOperational = planReconciliation({
  desiredDates: ["2026-08-16"],
  existing:     [v("v1", "2026-08-16", { template: TPL_A, untouched: false })],
  templateId:   TPL_B,
  today:        TODAY,
});
eq("T5: an OPERATIONAL visit is never re-templated", tplOperational.toRetemplate, []);
eq("T5b: …it is reported as protected instead", tplOperational.protectedStale, ["v1"]);

eq(
  "T6: template mismatch on a PAST visit is left alone",
  planReconciliation({
    desiredDates: ["2026-08-05"],
    existing:     [v("v1", "2026-08-05", { template: TPL_A })],
    templateId:   TPL_B,
    today:        TODAY,
  }).toRetemplate,
  []
);

// ─── Stale deletion after a schedule edit ─────────────────────────────────────

console.log("\n── Stale deletion ──");

// Weekday moved Sunday → Monday: old Sunday visits are no longer valid.
const dayMoved = planReconciliation({
  desiredDates: ["2026-08-17", "2026-08-24"],           // Mondays
  existing:     [v("s1", "2026-08-16"), v("s2", "2026-08-23")],  // Sundays
  templateId:   TPL_A,
  today:        TODAY,
});
eq("S1: stale untouched future visits are deleted", dayMoved.toDelete, ["s1", "s2"]);
eq("S2: the new occurrences are inserted", dayMoved.toInsert, ["2026-08-17", "2026-08-24"]);
eq("S3: nothing is protected in the clean case", dayMoved.protectedStale, []);

const dayMovedOperational = planReconciliation({
  desiredDates: ["2026-08-17"],
  existing:     [v("s1", "2026-08-16", { untouched: false })],
  templateId:   TPL_A,
  today:        TODAY,
});
eq("S4: a STARTED stale visit is never deleted", dayMovedOperational.toDelete, []);
eq("S4b: …it is reported as protected", dayMovedOperational.protectedStale, ["s1"]);
eq("S4c: …and the new occurrence is still created",
  dayMovedOperational.toInsert, ["2026-08-17"]);

eq(
  "S5: stale visits in the PAST are never deleted, even if untouched",
  planReconciliation({
    desiredDates: ["2026-08-17"],
    existing:     [v("old", "2026-08-03")],
    templateId:   TPL_A,
    today:        TODAY,
  }).toDelete,
  []
);

eq(
  "S6: TODAY's visit is protected — the strict > cut, not >=",
  planReconciliation({
    desiredDates: ["2026-08-17"],
    existing:     [v("today", TODAY)],
    templateId:   TPL_A,
    today:        TODAY,
  }).toDelete,
  []
);

// ─── Invariants ───────────────────────────────────────────────────────────────

console.log("\n── Invariants ──");

const mixed = planReconciliation({
  desiredDates: ["2026-08-17", "2026-08-24", "2026-08-31"],
  existing: [
    v("keep",      "2026-08-17"),                        // valid + right template
    v("retpl",     "2026-08-24", { template: TPL_B }),   // valid + wrong template
    v("stale",     "2026-08-16"),                        // invalid + untouched
    v("staleOp",   "2026-08-19", { untouched: false }),  // invalid + operational
    v("pastStale", "2026-08-02"),                        // invalid + past
  ],
  templateId: TPL_A,
  today:      TODAY,
});

const touchedIds = [...mixed.toDelete, ...mixed.toRetemplate];
check(
  "V1: never proposes a row the database marked as touched",
  !touchedIds.includes("staleOp"),
  `touched=[${touchedIds.join(",")}]`
);
check(
  "V2: never proposes a row dated on/before today",
  !touchedIds.includes("pastStale"),
  "pastStale excluded"
);
check(
  "V3: delete / retemplate / protected id-sets are mutually disjoint",
  (() => {
    const all = [...mixed.toDelete, ...mixed.toRetemplate, ...mixed.protectedStale];
    // No id may appear in two buckets, and no inserted date may belong to a
    // visit that already exists (insert is by date, the others by id).
    const idsDisjoint = new Set(all).size === all.length;
    const existingDates = new Set(
      ["2026-08-17", "2026-08-24", "2026-08-16", "2026-08-19", "2026-08-02"]
    );
    const insertsAreNew = mixed.toInsert.every((d) => !existingDates.has(d));
    return idsDisjoint && insertsAreNew;
  })(),
  `delete=${mixed.toDelete.length} retpl=${mixed.toRetemplate.length} ` +
  `protected=${mixed.protectedStale.length} insert=${mixed.toInsert.length}`
);
eq("V4: the one genuinely missing occurrence is inserted",
  mixed.toInsert, ["2026-08-31"]);
eq("V5: both unsafe rows are reported, not silently dropped",
  mixed.protectedStale.sort(), ["pastStale", "staleOp"]);
check("V6: the untouched valid row is counted as unchanged",
  mixed.unchanged === 1, `unchanged=${mixed.unchanged}`);

// ─── End-to-end with the real recurrence engine ───────────────────────────────

console.log("\n── End-to-end ──");

const weeklyRule: RecurrenceRule = {
  anchorDate: "2026-08-09", dayOfWeek: 0, frequency: "weekly",
};
const desired = occurrencesFor(weeklyRule, "2026-08-10", "2026-09-09");

const firstRun = planReconciliation({
  desiredDates: desired, existing: [], templateId: TPL_A, today: TODAY,
});
eq("E1: first run inserts every occurrence with the schedule's template",
  firstRun.toInsert, desired);

// Simulate that run having happened, then plan again.
const afterFirst: ExistingGeneratedVisit[] = desired.map((d, i) =>
  v(`gen${i}`, d, { template: TPL_A })
);
check(
  "E2: second run is a complete no-op (DB-level idempotency mirrored in the plan)",
  isNoopPlan(planReconciliation({
    desiredDates: desired, existing: afterFirst, templateId: TPL_A, today: TODAY,
  })),
  "no inserts, deletes or re-templates"
);

// Now the manager switches the checklist mid-cycle, and one visit is done.
const oneCompleted = afterFirst.map((x, i) =>
  i === 0 ? { ...x, untouched: false } : x
);
const afterTplSwitch = planReconciliation({
  desiredDates: desired, existing: oneCompleted, templateId: TPL_B, today: TODAY,
});
check(
  "E3: switching checklist re-templates only the untouched future visits",
  afterTplSwitch.toRetemplate.length === desired.length - 1 &&
    afterTplSwitch.protectedStale.length === 1 &&
    afterTplSwitch.toDelete.length === 0,
  `retpl=${afterTplSwitch.toRetemplate.length} protected=${afterTplSwitch.protectedStale.length}`
);

console.log(`\n${passed}/${passed + failed} checks passed`);
process.exit(failed > 0 ? 1 : 0);
