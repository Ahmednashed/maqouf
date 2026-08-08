/* eslint-disable no-console */
// ─────────────────────────────────────────────────────────────────────────────
// Authorization + idempotency tests for per-schedule reconciliation.
//
//   npx tsx scripts/test-reconcile-auth.ts
//
// Two layers are covered:
//   1. authorizeScheduleReconcile() — the explicit pre-check (pure).
//   2. planReconciliation()         — that a repeated reconcile is a no-op and
//                                     protected visits survive (pure).
//
// The ultimate boundary is RLS, which cannot be unit-tested without a database:
// the endpoint performs every read/write with the caller's own session, so
// visits_insert/update/delete (owner|admin, same company) and
// v_untouched_generated_visits (security_invoker, migration 021) are enforced
// by Postgres regardless of these results.
// ─────────────────────────────────────────────────────────────────────────────

import { authorizeScheduleReconcile } from "../src/lib/reconcile-auth";
import {
  planReconciliation,
  isNoopPlan,
  type ExistingGeneratedVisit,
} from "../src/lib/schedule-reconcile";

let passed = 0;
let failed = 0;

function check(name: string, ok: boolean, detail: string) {
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name} — ${detail}`);
  ok ? passed++ : failed++;
}

const CO_A = "company-aaaa";
const CO_B = "company-bbbb";
const SCHED_A = { id: "sched-1", company_id: CO_A };

const member = (role: string, company = CO_A, status = "active") =>
  ({ company_id: company, role, status });

// ─── Authorized ───────────────────────────────────────────────────────────────

console.log("\n── Authorized ──");

for (const role of ["owner", "admin"]) {
  const r = authorizeScheduleReconcile({
    userId: "user-1", schedule: SCHED_A, membership: member(role),
  });
  check(`A1-${role}: ${role} of the schedule's company is allowed`,
    r.ok && r.status === 200, `status=${r.status}`);
}

// ─── Unauthenticated ──────────────────────────────────────────────────────────

console.log("\n── Unauthenticated ──");

const noSession = authorizeScheduleReconcile({
  userId: null, schedule: SCHED_A, membership: member("owner"),
});
check("U1: no session → 401, even with a valid-looking membership",
  !noSession.ok && noSession.status === 401 && noSession.reason === "unauthenticated",
  `status=${noSession.status} reason=${noSession.reason}`);

// ─── Insufficient role ────────────────────────────────────────────────────────

console.log("\n── Role ──");

const merch = authorizeScheduleReconcile({
  userId: "user-2", schedule: SCHED_A, membership: member("merchandiser"),
});
check("R1: merchandiser is refused with 403 (never a silent no-op)",
  !merch.ok && merch.status === 403 && merch.reason === "insufficient_role",
  `status=${merch.status} reason=${merch.reason}`);

const inactiveOwner = authorizeScheduleReconcile({
  userId: "user-3", schedule: SCHED_A, membership: member("owner", CO_A, "inactive"),
});
check("R2: an INACTIVE owner is refused",
  !inactiveOwner.ok && inactiveOwner.status === 404,
  `status=${inactiveOwner.status} reason=${inactiveOwner.reason}`);

// ─── Cross-company ────────────────────────────────────────────────────────────

console.log("\n── Cross-company ──");

// RLS hides the row entirely → the route passes schedule: null.
const hiddenByRls = authorizeScheduleReconcile({
  userId: "user-4", schedule: null, membership: member("owner", CO_B),
});
check("X1: another company's schedule is invisible → 404, not 403",
  !hiddenByRls.ok && hiddenByRls.status === 404 && hiddenByRls.reason === "schedule_not_found",
  `status=${hiddenByRls.status} reason=${hiddenByRls.reason}`);

// Defence in depth: even if the row were somehow visible, membership is looked
// up scoped to the SCHEDULE's company, so a foreign owner resolves to null.
const foreignOwnerNoMembership = authorizeScheduleReconcile({
  userId: "user-5", schedule: SCHED_A, membership: null,
});
check("X2: owner of a DIFFERENT company has no membership here → 404",
  !foreignOwnerNoMembership.ok && foreignOwnerNoMembership.status === 404,
  `status=${foreignOwnerNoMembership.status} reason=${foreignOwnerNoMembership.reason}`);

// And if a mismatched membership were ever passed in, it is still rejected.
const mismatched = authorizeScheduleReconcile({
  userId: "user-6", schedule: SCHED_A, membership: member("owner", CO_B),
});
check("X3: membership in the wrong company is rejected even with role=owner",
  !mismatched.ok && mismatched.status === 404 && mismatched.reason === "no_membership",
  `status=${mismatched.status} reason=${mismatched.reason}`);

check("X4: cross-company refusals never return 403 (no tenant enumeration)",
  [hiddenByRls, foreignOwnerNoMembership, mismatched].every((r) => r.status === 404),
  "all 404");

// ─── Idempotency of the applied plan ──────────────────────────────────────────

console.log("\n── Idempotency ──");

const TODAY = "2026-08-10";
const TPL   = "tpl-a";
const desired = ["2026-08-16", "2026-08-23", "2026-08-30"];

const v = (id: string, date: string, untouched = true): ExistingGeneratedVisit =>
  ({ id, scheduled_date: date, template_id: TPL, untouched });

// First reconcile after an edit: everything must be created.
const first = planReconciliation({
  desiredDates: desired, existing: [], templateId: TPL, today: TODAY,
});
check("P1: first reconcile inserts the full window",
  first.toInsert.length === 3, `inserted=${first.toInsert.length}`);

// Second reconcile on the resulting state: nothing at all.
const afterFirst = desired.map((d, i) => v(`g${i}`, d));
const second = planReconciliation({
  desiredDates: desired, existing: afterFirst, templateId: TPL, today: TODAY,
});
check("P2: immediate re-run is a complete no-op (safe to retry)",
  isNoopPlan(second), `insert=${second.toInsert.length} delete=${second.toDelete.length} retpl=${second.toRetemplate.length}`);

const third = planReconciliation({
  desiredDates: desired, existing: afterFirst, templateId: TPL, today: TODAY,
});
check("P3: a third run is identical to the second (converged)",
  JSON.stringify(second) === JSON.stringify(third), "identical plans");

// ─── Protected visits survive ─────────────────────────────────────────────────

console.log("\n── Protected ──");

// The manager moves the schedule to a different weekday. One of the existing
// visits has already been started in the field.
const started = [
  v("done", "2026-08-16", false),   // operational — must survive
  v("free", "2026-08-23", true),    // untouched   — may be removed
];
const moved = planReconciliation({
  desiredDates: ["2026-08-17", "2026-08-24"],
  existing:     started,
  templateId:   TPL,
  today:        TODAY,
});
check("S1: the started visit is NOT deleted",
  !moved.toDelete.includes("done"), `delete=[${moved.toDelete.join(",")}]`);
check("S2: it is reported as protected instead of vanishing",
  moved.protectedStale.includes("done"), `protected=[${moved.protectedStale.join(",")}]`);
check("S3: the untouched stale visit IS removed",
  moved.toDelete.includes("free"), "free deleted");
check("S4: re-running after the move leaves the protected visit alone again",
  (() => {
    const post: ExistingGeneratedVisit[] = [
      v("done", "2026-08-16", false),
      v("n1", "2026-08-17"), v("n2", "2026-08-24"),
    ];
    const again = planReconciliation({
      desiredDates: ["2026-08-17", "2026-08-24"],
      existing: post, templateId: TPL, today: TODAY,
    });
    return again.toDelete.length === 0 && again.protectedStale.includes("done");
  })(),
  "stable across repeated runs"
);

console.log(`\n${passed}/${passed + failed} checks passed`);
process.exit(failed > 0 ? 1 : 0);
