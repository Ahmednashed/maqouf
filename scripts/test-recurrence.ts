/* eslint-disable no-console */
// ─────────────────────────────────────────────────────────────────────────────
// Recurrence + generation-window tests.
//
//   npx tsx scripts/test-recurrence.ts
//
// Pure functions only: no network, no database, no secrets. Follows the same
// runner pattern as src/ai/validation/run.ts (the repo has no test framework).
//
// Lifecycle rules that need a database (inactive schedules produce nothing,
// unique-index idempotency, delete-preserves-history) are enforced by
// migration 019 + the generator's query filters; the pure parts of those rules
// are asserted here.
// ─────────────────────────────────────────────────────────────────────────────

import {
  occurrencesFor,
  generationWindow,
  riyadhToday,
  weekdayOrdinal,
  nthWeekdayOfMonth,
  alignForward,
  daysBetween,
  type RecurrenceRule,
  type DayOfWeek,
} from "../src/lib/recurrence";

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

// Reference calendar (all verified against real 2026 dates):
//   2026-08-02 Sun   2026-08-09 Sun   2026-08-16 Sun   2026-08-23 Sun
//   2026-08-30 Sun   2026-09-06 Sun   2026-09-13 Sun
const SUN: DayOfWeek = 0;

// ─── Weekly ───────────────────────────────────────────────────────────────────

console.log("\n── Weekly ──");

const weekly: RecurrenceRule = {
  anchorDate: "2026-08-09", dayOfWeek: SUN, frequency: "weekly",
};

eq(
  "W1: every matching Sunday in the window",
  occurrencesFor(weekly, "2026-08-09", "2026-09-06"),
  ["2026-08-09", "2026-08-16", "2026-08-23", "2026-08-30", "2026-09-06"]
);

eq(
  "W2: window start mid-week skips to next Sunday",
  occurrencesFor(weekly, "2026-08-11", "2026-08-25"),
  ["2026-08-16", "2026-08-23"]
);

eq(
  "W3: window boundaries are inclusive on both ends",
  occurrencesFor(weekly, "2026-08-16", "2026-08-30"),
  ["2026-08-16", "2026-08-23", "2026-08-30"]
);

eq(
  "W4: never generates before the anchor",
  occurrencesFor(weekly, "2026-07-01", "2026-08-16"),
  ["2026-08-09", "2026-08-16"]
);

const w5a = occurrencesFor(weekly, "2026-08-09", "2026-09-06");
const w5b = occurrencesFor(weekly, "2026-08-09", "2026-09-06");
check(
  "W5: repeated run is byte-identical (idempotent input → identical output)",
  JSON.stringify(w5a) === JSON.stringify(w5b),
  `${w5a.length} occurrences both runs`
);

check(
  "W6: every result falls on the configured weekday",
  occurrencesFor(weekly, "2026-08-01", "2026-10-01")
    .every((d) => new Date(d + "T00:00:00Z").getUTCDay() === SUN),
  "all Sundays"
);

eq("W7: inverted window yields nothing",
  occurrencesFor(weekly, "2026-09-01", "2026-08-01"), []);

// ─── Biweekly ─────────────────────────────────────────────────────────────────

console.log("\n── Biweekly ──");

const biweekly: RecurrenceRule = {
  anchorDate: "2026-08-09", dayOfWeek: SUN, frequency: "biweekly",
};

eq(
  "B1: anchored fortnights (the spec example: Aug 9, Aug 23, Sep 6)",
  occurrencesFor(biweekly, "2026-08-09", "2026-09-10"),
  ["2026-08-09", "2026-08-23", "2026-09-06"]
);

eq(
  "B2: window starting on an OFF week skips to the next on-week",
  occurrencesFor(biweekly, "2026-08-16", "2026-09-10"),
  ["2026-08-23", "2026-09-06"]
);

eq(
  "B3: window starting on an ON week includes it",
  occurrencesFor(biweekly, "2026-08-23", "2026-09-10"),
  ["2026-08-23", "2026-09-06"]
);

// The drift test that matters: parity must come from the anchor, not "today".
// Running the generator on three different days must never move the sequence.
const b4 = [
  occurrencesFor(biweekly, "2026-08-10", "2026-09-30"),
  occurrencesFor(biweekly, "2026-08-11", "2026-09-30"),
  occurrencesFor(biweekly, "2026-08-17", "2026-09-30"),
];
check(
  "B4: parity is anchor-relative — sequence never drifts across run days",
  b4.every((r) => JSON.stringify(r) === JSON.stringify(b4[0])),
  JSON.stringify(b4[0])
);

check(
  "B5: consecutive occurrences are exactly 14 days apart",
  occurrencesFor(biweekly, "2026-08-09", "2026-12-31")
    .every((d, i, arr) => i === 0 || daysBetween(arr[i - 1], d) === 14),
  "all gaps = 14d"
);

eq(
  "B6: anchor on an odd start still produces the anchor itself first",
  occurrencesFor(
    { anchorDate: "2026-08-16", dayOfWeek: SUN, frequency: "biweekly" },
    "2026-08-01", "2026-09-15"
  ),
  ["2026-08-16", "2026-08-30", "2026-09-13"]
);

// ─── Monthly (nth-weekday-of-month — the only schema-representable model) ─────

console.log("\n── Monthly ──");

// 2026-08-09 is the 2nd Sunday of August.
eq("M0: anchor ordinal detected", weekdayOrdinal("2026-08-09"), 2);

const monthly: RecurrenceRule = {
  anchorDate: "2026-08-09", dayOfWeek: SUN, frequency: "monthly",
};

eq(
  "M1: same weekday-ordinal each month (2nd Sunday)",
  occurrencesFor(monthly, "2026-08-01", "2026-11-30"),
  ["2026-08-09", "2026-09-13", "2026-10-11", "2026-11-08"]
);

eq(
  "M2: February — 2nd Sunday 2027",
  occurrencesFor(monthly, "2027-02-01", "2027-02-28"),
  ["2027-02-14"]
);

// February 2027 has 28 days starting Monday → only four Sundays (7,14,21,28).
eq(
  "M3: February has no 5th Sunday → month skipped, never shifted",
  occurrencesFor(
    { anchorDate: "2026-08-30", dayOfWeek: SUN, frequency: "monthly" },  // 5th Sunday
    "2027-02-01", "2027-02-28"
  ),
  []
);

eq("M4: 5th-Sunday ordinal detected", weekdayOrdinal("2026-08-30"), 5);

eq(
  "M5: 5th-Sunday rule only fires in months that actually have one",
  occurrencesFor(
    { anchorDate: "2026-08-30", dayOfWeek: SUN, frequency: "monthly" },
    "2026-08-01", "2026-12-31"
  ),
  ["2026-08-30", "2026-11-29"]
);

eq("M6: nthWeekdayOfMonth returns null when absent",
  nthWeekdayOfMonth(2027, 1, SUN, 5), null);

eq("M7: leap February 2028 — 2nd Sunday",
  occurrencesFor(monthly, "2028-02-01", "2028-02-29"), ["2028-02-13"]);

check(
  "M8: monthly never returns a date before the anchor",
  occurrencesFor(monthly, "2026-01-01", "2026-12-31")
    .every((d) => d >= monthly.anchorDate),
  "all >= 2026-08-09"
);

// NOTE: "same day-of-month" recurrence (and therefore 29/30/31 handling) is not
// representable — `schedules` has no day-of-month column. Asserted explicitly
// so the limitation is visible in the test output rather than assumed.
check(
  "M9: day-of-month semantics intentionally unsupported (no such column)",
  true,
  "documented in migration 019 + recurrence.ts"
);

// ─── Timezone (Asia/Riyadh, UTC+3, no DST) ───────────────────────────────────

console.log("\n── Timezone ──");

eq(
  "T1: 21:30 UTC is already the NEXT Riyadh day (00:30 local)",
  riyadhToday(new Date("2026-08-08T21:30:00Z")), "2026-08-09"
);

eq(
  "T2: 20:59 UTC is still the same Riyadh day (23:59 local)",
  riyadhToday(new Date("2026-08-08T20:59:00Z")), "2026-08-08"
);

eq(
  "T3: cron fires 00:00 UTC = 03:00 Riyadh, same calendar day",
  riyadhToday(new Date("2026-08-09T00:00:00Z")), "2026-08-09"
);

eq(
  "T4: midnight UTC on a month boundary resolves to the Riyadh date",
  riyadhToday(new Date("2026-08-31T22:00:00Z")), "2026-09-01"
);

// ─── Generation window ────────────────────────────────────────────────────────

console.log("\n── Window ──");

const win = generationWindow(new Date("2026-08-08T09:00:00Z"));
eq("G1: window is Riyadh-today → +30 days", win, { from: "2026-08-08", to: "2026-09-07" });

const winNext = generationWindow(new Date("2026-08-09T09:00:00Z"));
eq("G2: window rolls forward by exactly one day", winNext, { from: "2026-08-09", to: "2026-09-08" });

// Yesterday's run covered through Sep 7; today's adds only Sep 8.
const covered  = occurrencesFor(weekly, win.from, win.to);
const coveredT = occurrencesFor(weekly, winNext.from, winNext.to);
const added    = coveredT.filter((d) => !covered.includes(d));
eq("G3: a day later only the newly uncovered occurrence appears", added, []);

check(
  "G4: window never reaches into the past",
  generationWindow(new Date("2026-08-08T09:00:00Z")).from === riyadhToday(new Date("2026-08-08T09:00:00Z")),
  "from === Riyadh today"
);

check(
  "G5: window is bounded at 30 days (not a year)",
  daysBetween(win.from, win.to) === 30,
  "30 days"
);

// ─── Lifecycle (pure parts) ───────────────────────────────────────────────────

console.log("\n── Lifecycle ──");

check(
  "L1: an occurrence set contains no duplicates (per-date uniqueness)",
  (() => {
    const all = occurrencesFor(weekly, "2026-08-01", "2027-08-01");
    return new Set(all).size === all.length;
  })(),
  "no repeated dates"
);

eq(
  "L2: a schedule anchored in the future generates nothing before it",
  occurrencesFor(
    { anchorDate: "2026-12-06", dayOfWeek: SUN, frequency: "weekly" },
    "2026-08-08", "2026-09-07"
  ),
  []
);

eq("L3: alignForward keeps an already-matching date unchanged",
  alignForward("2026-08-09", SUN), "2026-08-09");

eq("L4: alignForward rolls forward, never backward",
  alignForward("2026-08-10", SUN), "2026-08-16");

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n${passed}/${passed + failed} checks passed`);
process.exit(failed > 0 ? 1 : 0);
