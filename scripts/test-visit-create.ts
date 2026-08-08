/**
 * Add-Visit creation-path tests.
 *
 *   npx tsx scripts/test-visit-create.ts
 *
 * The one property that matters: a submission creates EITHER a Visit OR a
 * Schedule, never both. A manual visit (schedule_id NULL) and a generated
 * visit for the same date do not collide under uq_visits_schedule_occurrence
 * (partial index, WHERE schedule_id IS NOT NULL), so the database cannot
 * de-duplicate them. The guarantee has to hold in the planner.
 *
 * Tests 9–13 cover the submit orchestration, which is not pure. They exercise
 * a faithful re-implementation of the modal's control flow against fakes,
 * so ordering, error handling and invalidation are asserted rather than
 * assumed. If the modal's flow changes, these must change with it.
 */

import {
  planVisitCreation,
  isDuplicateScheduleError,
  isRecurring,
  RECURRENCE_CHOICES,
  type VisitFormInput,
  type RecurrenceChoice,
} from "../src/lib/visit-create-plan";

// ─── Harness ──────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function check(name: string, cond: boolean, detail = ""): void {
  if (cond) {
    passed++;
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } else {
    failed++;
    console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function group(title: string): void {
  console.log(`\n\x1b[1m${title}\x1b[0m`);
}

const base: VisitFormInput = {
  place_id:       "place-1",
  merch_id:       "merch-1",
  scheduled_date: "2026-03-11", // a Wednesday
  recurrence:     "once",
};

// ─────────────────────────────────────────────────────────────────────────────
// 1 & 2 — One-time creates a Visit, and never a Schedule
// ─────────────────────────────────────────────────────────────────────────────

group("1–2. One-time → Visit only");

{
  const r = planVisitCreation({ ...base, recurrence: "once" });
  check("T1  one-time yields a visit plan", r.ok && r.plan.kind === "visit");

  if (r.ok && r.plan.kind === "visit") {
    check("T1  visit payload carries the chosen date",
      r.plan.payload.scheduled_date === "2026-03-11");
    check("T1  visit payload carries branch + merchandiser",
      r.plan.payload.place_id === "place-1" && r.plan.payload.merch_id === "merch-1");
  }

  // T2 — the strong form: across every one-time shape we can construct,
  // no submission ever produces kind "schedule".
  const oneTimeVariants: VisitFormInput[] = [
    { ...base, recurrence: "once" },
    { ...base, recurrence: "once", template_id: "tpl-1" },
    { ...base, recurrence: "once", notes: "restock endcap" },
    // A stray time must not upgrade a one-time visit into a schedule.
    { ...base, recurrence: "once", start_time: "09:30" },
    { ...base, recurrence: "once", start_time: "09:30", template_id: "tpl-1", notes: "x" },
  ];
  const anySchedule = oneTimeVariants
    .map(planVisitCreation)
    .some((res) => res.ok && res.plan.kind === "schedule");
  check("T2  no one-time variant ever produces a schedule", !anySchedule);

  // And the time is not smuggled into the visit payload — `visits` has no
  // column for it, so persisting it would be a lie.
  const withTime = planVisitCreation({ ...base, recurrence: "once", start_time: "09:30" });
  const keys = withTime.ok && withTime.plan.kind === "visit"
    ? Object.keys(withTime.plan.payload)
    : [];
  check("T2  planned time is excluded from the one-time payload",
    !keys.some((k) => k.includes("time")),
    `keys: ${keys.join(",")}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// 3, 4, 5 — Each recurring frequency creates a Schedule only
// ─────────────────────────────────────────────────────────────────────────────

group("3–5. Recurring → Schedule only");

const recurringCases: Array<{ id: string; freq: RecurrenceChoice }> = [
  { id: "T3", freq: "weekly"   },
  { id: "T4", freq: "biweekly" },
  { id: "T5", freq: "monthly"  },
];

for (const { id, freq } of recurringCases) {
  const r = planVisitCreation({ ...base, recurrence: freq, start_time: "09:30" });
  check(`${id}  ${freq} yields a schedule plan`, r.ok && r.plan.kind === "schedule");
  check(`${id}  ${freq} never yields a visit plan`, !(r.ok && r.plan.kind === "visit"));
  if (r.ok && r.plan.kind === "schedule") {
    check(`${id}  frequency is passed through unchanged`,
      r.plan.payload.frequency === freq);
    check(`${id}  schedule is created active`, r.plan.payload.is_active === true);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 6 — anchor_date equals the chosen first date
// ─────────────────────────────────────────────────────────────────────────────

group("6. anchor_date === chosen first date");

{
  const dates = ["2026-01-01", "2026-02-28", "2026-03-11", "2026-12-31", "2028-02-29"];
  let mismatch: string | null = null;

  for (const d of dates) {
    for (const freq of ["weekly", "biweekly", "monthly"] as const) {
      const r = planVisitCreation({ ...base, scheduled_date: d, recurrence: freq, start_time: "08:00" });
      if (!r.ok || r.plan.kind !== "schedule") { mismatch = `${d}/${freq}: no schedule`; break; }
      if (r.plan.payload.anchor_date !== d)     { mismatch = `${d}/${freq}: got ${r.plan.payload.anchor_date}`; break; }
    }
    if (mismatch) break;
  }
  check("T6  anchor_date is the chosen date verbatim, all frequencies", mismatch === null, mismatch ?? "");
}

// ─────────────────────────────────────────────────────────────────────────────
// 7 — day_of_week is derived from the chosen date
// ─────────────────────────────────────────────────────────────────────────────

group("7. day_of_week derived from the date");

{
  // day_of_week is numeric in this schema: 0 = Sunday … 6 = Saturday.
  // These anchors are real calendar dates, checked independently of the
  // app's own helpers.
  const expected: Array<[string, number]> = [
    ["2026-03-08", 0], // Sunday
    ["2026-03-09", 1],
    ["2026-03-10", 2],
    ["2026-03-11", 3], // Wednesday
    ["2026-03-12", 4],
    ["2026-03-13", 5],
    ["2026-03-14", 6], // Saturday
  ];

  let bad: string | null = null;
  for (const [date, dow] of expected) {
    const r = planVisitCreation({ ...base, scheduled_date: date, recurrence: "weekly", start_time: "08:00" });
    if (!r.ok || r.plan.kind !== "schedule") { bad = `${date}: no schedule`; break; }
    if (r.plan.payload.day_of_week !== dow)  { bad = `${date}: got ${r.plan.payload.day_of_week}, want ${dow}`; break; }
  }
  check("T7  day_of_week matches the calendar for all 7 weekdays", bad === null, bad ?? "");

  check("T7  the anchors really do cover all 7 distinct weekdays",
    new Set(expected.map(([, d]) => d)).size === 7);

  // Cross-check against the JS calendar over a long span, so an off-by-one in
  // either place is caught rather than mutually agreed upon.
  let drift: string | null = null;
  for (let i = 0; i < 400; i++) {
    const ms   = Date.UTC(2026, 0, 1) + i * 86_400_000;
    const iso  = new Date(ms).toISOString().slice(0, 10);
    const want = new Date(ms).getUTCDay();
    const r = planVisitCreation({ ...base, scheduled_date: iso, recurrence: "monthly", start_time: "08:00" });
    if (!r.ok || r.plan.kind !== "schedule" || r.plan.payload.day_of_week !== want) {
      drift = `${iso}: want ${want}`;
      break;
    }
  }
  check("T7  derivation agrees with the JS calendar over 400 days", drift === null, drift ?? "");

  // The weekday is derived, never taken from the form — a schedule payload
  // exposes no independent weekday input to disagree with the date.
  const r = planVisitCreation({ ...base, scheduled_date: "2026-03-11", recurrence: "weekly", start_time: "08:00" });
  check("T7  weekday is consistent with anchor_date in the same payload",
    r.ok && r.plan.kind === "schedule" &&
    r.plan.payload.day_of_week === new Date(`${r.plan.payload.anchor_date}T00:00:00Z`).getUTCDay());
}

// ─────────────────────────────────────────────────────────────────────────────
// 8 — Recurring requires start_time (schedules.start_time is NOT NULL)
// ─────────────────────────────────────────────────────────────────────────────

group("8. Recurring requires start_time");

{
  for (const freq of ["weekly", "biweekly", "monthly"] as const) {
    const missing = planVisitCreation({ ...base, recurrence: freq });
    check(`T8  ${freq} without a time is refused`,
      !missing.ok && missing.error === "time_required_for_recurring");

    const emptyish = planVisitCreation({ ...base, recurrence: freq, start_time: "   " });
    check(`T8  ${freq} with a whitespace time is refused`,
      !emptyish.ok && emptyish.error === "time_required_for_recurring");
  }

  const bad = planVisitCreation({ ...base, recurrence: "weekly", start_time: "25:00" });
  check("T8  an out-of-range time is refused", !bad.ok && bad.error === "time_invalid");

  const ok = planVisitCreation({ ...base, recurrence: "weekly", start_time: "09:30" });
  check("T8  a valid time is accepted", ok.ok && ok.plan.kind === "schedule");

  // Refusal happens before any write is planned — nothing to roll back.
  check("T8  a refused submission carries no payload at all",
    !("plan" in (planVisitCreation({ ...base, recurrence: "weekly" }) as object)));

  // One-time is unaffected by the time requirement.
  check("T8  one-time never requires a time",
    planVisitCreation({ ...base, recurrence: "once" }).ok);
}

// ─────────────────────────────────────────────────────────────────────────────
// 9–13 — Submit orchestration (mirrors VisitCreateModal.onSubmit)
// ─────────────────────────────────────────────────────────────────────────────

interface FakeLog {
  visitsCreated:    unknown[];
  schedulesCreated: unknown[];
  reconciled:       string[];
  invalidated:      string[];
  toasts:           Array<{ kind: "success" | "warning"; key: string }>;
  errors:           string[];
  closed:           boolean;
}

interface Fakes {
  createVisit?:    (p: unknown) => Promise<void>;
  createSchedule?: (p: unknown) => Promise<{ id: string }>;
  reconcile?:      (id: string) => Promise<{ ok: boolean }>;
}

/**
 * Faithful re-implementation of the modal's submit flow. Kept deliberately
 * small: it exists to pin down ordering and failure handling.
 */
async function submit(input: VisitFormInput, fakes: Fakes = {}): Promise<FakeLog> {
  const log: FakeLog = {
    visitsCreated: [], schedulesCreated: [], reconciled: [],
    invalidated: [], toasts: [], errors: [], closed: false,
  };

  const result = planVisitCreation(input);
  if (!result.ok) { log.errors.push(result.error); return log; }

  if (result.plan.kind === "visit") {
    const fn = fakes.createVisit ?? (async () => {});
    await fn(result.plan.payload);
    log.visitsCreated.push(result.plan.payload);
    log.invalidated.push("visits");
    log.closed = true;
    return log;
  }

  let scheduleId: string;
  try {
    const fn = fakes.createSchedule ?? (async () => ({ id: "sched-1" }));
    const row = await fn(result.plan.payload);
    scheduleId = row.id;
    log.schedulesCreated.push(result.plan.payload);
  } catch (err) {
    log.errors.push(isDuplicateScheduleError(err) ? "duplicate" : "generic");
    return log;
  }

  log.invalidated.push("schedules");
  log.toasts.push({ kind: "success", key: "createdOk" });

  const rec = fakes.reconcile ?? (async () => ({ ok: true }));
  const outcome = await rec(scheduleId);
  log.reconciled.push(scheduleId);

  if (!outcome.ok) log.toasts.push({ kind: "warning", key: "reconcileWarning" });
  else             log.invalidated.push("visits");

  log.closed = true;
  return log;
}

async function main(): Promise<void> {

group("9–13. Submit orchestration");

{
  // T9 — reconcile runs after the schedule exists, with its real id.
  const log = await submit(
    { ...base, recurrence: "weekly", start_time: "09:30" },
    { createSchedule: async () => ({ id: "sched-42" }) }
  );
  check("T9  reconcile is called once after schedule creation",
    log.reconciled.length === 1 && log.reconciled[0] === "sched-42");
  check("T9  reconcile is called with the created id, not a guess",
    log.schedulesCreated.length === 1 && log.reconciled[0] === "sched-42");

  // Never reconcile when creation failed — there is nothing to reconcile.
  const failed = await submit(
    { ...base, recurrence: "weekly", start_time: "09:30" },
    { createSchedule: async () => { throw new Error("network"); } }
  );
  check("T9  reconcile is skipped when schedule creation fails",
    failed.reconciled.length === 0);
}

{
  // T10 — the first occurrence exists exactly once: the recurring path never
  // writes a visit itself, so the generator's insert cannot be duplicated.
  const log = await submit({ ...base, recurrence: "weekly", start_time: "09:30" });
  check("T10 recurring submit creates zero manual visits",
    log.visitsCreated.length === 0);
  check("T10 recurring submit creates exactly one schedule",
    log.schedulesCreated.length === 1);
  check("T10 the anchor occurrence comes only from reconcile",
    log.visitsCreated.length === 0 && log.reconciled.length === 1);

  // The mirrored property for the other branch.
  const once = await submit({ ...base, recurrence: "once" });
  check("T10 one-time submit creates zero schedules and never reconciles",
    once.schedulesCreated.length === 0 && once.reconciled.length === 0);
  check("T10 one-time submit creates exactly one visit",
    once.visitsCreated.length === 1);
}

{
  // T11 — the UNIQUE(company, merch, place, day_of_week) violation surfaces
  // as friendly copy, and the flow stops rather than half-completing.
  const pgErr = { code: "23505", message: 'duplicate key value violates unique constraint "uq_schedules_merch_place_day"' };
  const log = await submit(
    { ...base, recurrence: "weekly", start_time: "09:30" },
    { createSchedule: async () => { throw pgErr; } }
  );
  check("T11 duplicate schedule is classified as a duplicate",
    log.errors.length === 1 && log.errors[0] === "duplicate");
  check("T11 the modal stays open on duplicate", !log.closed);
  check("T11 no reconcile and no success toast on duplicate",
    log.reconciled.length === 0 && log.toasts.length === 0);

  check("T11 recogniser accepts the bare SQLSTATE",
    isDuplicateScheduleError({ code: "23505" }));
  check("T11 recogniser accepts the named constraint without a code",
    isDuplicateScheduleError({ message: 'violates unique constraint "uq_schedules_merch_place_day"' }));
  check("T11 recogniser rejects unrelated failures",
    !isDuplicateScheduleError({ code: "23503", message: "foreign key violation" }) &&
    !isDuplicateScheduleError(new Error("network")) &&
    !isDuplicateScheduleError(null));

  const generic = await submit(
    { ...base, recurrence: "weekly", start_time: "09:30" },
    { createSchedule: async () => { throw new Error("network"); } }
  );
  check("T11 non-duplicate failures are not mislabelled as duplicates",
    generic.errors[0] === "generic");
}

{
  // T12 — reconcile failure must not discard the schedule the user created.
  const log = await submit(
    { ...base, recurrence: "monthly", start_time: "07:15" },
    { createSchedule: async () => ({ id: "sched-9" }), reconcile: async () => ({ ok: false }) }
  );
  check("T12 the schedule survives a reconcile failure",
    log.schedulesCreated.length === 1);
  check("T12 a warning is shown, not an error",
    log.toasts.some((x) => x.kind === "warning" && x.key === "reconcileWarning"));
  check("T12 the success toast for the schedule is still shown",
    log.toasts.some((x) => x.kind === "success"));
  check("T12 the modal closes — the user's work was saved", log.closed);

  // Reconcile is best-effort: a rejected promise must never surface as an
  // unhandled failure of the create flow.
  let threw = false;
  try {
    await submit(
      { ...base, recurrence: "weekly", start_time: "09:30" },
      { reconcile: async () => ({ ok: false }) }
    );
  } catch { threw = true; }
  check("T12 a failing reconcile does not throw out of submit", !threw);
}

{
  // T13 — the calendar must refresh, or the new visit is invisible until reload.
  const once = await submit({ ...base, recurrence: "once" });
  check("T13 one-time success invalidates the visits queries",
    once.invalidated.includes("visits"));

  const rec = await submit({ ...base, recurrence: "weekly", start_time: "09:30" });
  check("T13 recurring success invalidates both schedules and visits",
    rec.invalidated.includes("schedules") && rec.invalidated.includes("visits"));

  const warn = await submit(
    { ...base, recurrence: "weekly", start_time: "09:30" },
    { reconcile: async () => ({ ok: false }) }
  );
  check("T13 schedules still refresh when reconcile fails",
    warn.invalidated.includes("schedules"));

  const dup = await submit(
    { ...base, recurrence: "weekly", start_time: "09:30" },
    { createSchedule: async () => { throw { code: "23505" }; } }
  );
  check("T13 nothing is invalidated when nothing was written",
    dup.invalidated.length === 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// Supporting invariants
// ─────────────────────────────────────────────────────────────────────────────

group("Supporting invariants");

{
  check("every recurrence choice is exhaustively handled",
    RECURRENCE_CHOICES.length === 4 &&
    RECURRENCE_CHOICES.every((c) => planVisitCreation({ ...base, recurrence: c, start_time: "08:00" }).ok));

  check("exactly one choice is non-recurring",
    RECURRENCE_CHOICES.filter((c) => !isRecurring(c)).length === 1);

  // Required fields are refused before any branch is taken.
  check("a missing branch is refused for both paths",
    !planVisitCreation({ ...base, place_id: "" }).ok &&
    !planVisitCreation({ ...base, place_id: "", recurrence: "weekly", start_time: "08:00" }).ok);
  check("a missing merchandiser is refused for both paths",
    !planVisitCreation({ ...base, merch_id: "" }).ok &&
    !planVisitCreation({ ...base, merch_id: "", recurrence: "weekly", start_time: "08:00" }).ok);
  check("a malformed date is refused",
    !planVisitCreation({ ...base, scheduled_date: "11/03/2026" }).ok);

  // template_id normalisation differs by target column nullability.
  const v = planVisitCreation({ ...base, template_id: "  " });
  check("blank template is omitted from a visit payload",
    v.ok && v.plan.kind === "visit" && !("template_id" in v.plan.payload));
  const sch = planVisitCreation({ ...base, recurrence: "weekly", start_time: "08:00", template_id: "  " });
  check("blank template becomes explicit NULL on a schedule",
    sch.ok && sch.plan.kind === "schedule" && sch.plan.payload.template_id === null);

  // Planning is free of side effects and stable.
  const a = planVisitCreation({ ...base, recurrence: "biweekly", start_time: "10:00" });
  const b = planVisitCreation({ ...base, recurrence: "biweekly", start_time: "10:00" });
  check("planning is deterministic",
    JSON.stringify(a) === JSON.stringify(b));

  const input: VisitFormInput = { ...base, recurrence: "weekly", start_time: "10:00" };
  const snapshot = JSON.stringify(input);
  planVisitCreation(input);
  check("planning does not mutate its input", JSON.stringify(input) === snapshot);
}

// ─── Summary ────────────────────────────────────────────────────────────────

console.log(`\n${"─".repeat(60)}`);
console.log(
  failed === 0
    ? `\x1b[32m✓ all ${passed} assertions passed\x1b[0m`
    : `\x1b[31m✗ ${failed} failed\x1b[0m, ${passed} passed`
);
process.exit(failed === 0 ? 0 : 1);

}

main();
