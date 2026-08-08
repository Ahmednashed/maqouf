/* eslint-disable no-console */
// ─────────────────────────────────────────────────────────────────────────────
// Calendar presentation-model + range tests.
//
//   npx tsx scripts/test-calendar.ts
//
// Pure functions only. The critical invariant under test is that a time is
// NEVER fabricated: a visit with no started_at and no source schedule must end
// up in the unscheduled lane, not at midnight.
// ─────────────────────────────────────────────────────────────────────────────

import {
  toCalendarItem,
  buildScheduleTimeMap,
  groupByMerch,
  computeDayAxis,
  positionPercent,
  bucketByDate,
  packIntoRows,
  parseClock,
  riyadhClock,
  type VisitLike,
} from "../src/lib/calendar-model";
import {
  rangeFor,
  datesIn,
  shift,
  startOfWeek,
  startOfMonth,
  endOfMonth,
  isSameMonth,
} from "../src/lib/calendar-range";

let passed = 0;
let failed = 0;

function check(name: string, ok: boolean, detail: string) {
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name} — ${detail}`);
  ok ? passed++ : failed++;
}
function eq(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  check(name, a === e, a === e ? a : `expected ${e}, got ${a}`);
}

const DATE = "2026-08-16";

function visit(over: Partial<VisitLike> & { id: string }): VisitLike {
  return {
    merch_id: "m1",
    scheduled_date: DATE,
    status: "pending",
    place: { branch_ar: "بندة", branch_en: "Panda", chain: { name_en: "Panda", name_ar: "بندة", color: "#0a0" } },
    merch: { color: "#123456", user: { full_name: "Ahmed Ali" } },
    ...over,
  };
}

// ─── Time resolution ──────────────────────────────────────────────────────────

console.log("\n── Time resolution ──");

const times = buildScheduleTimeMap([
  { id: "s1", start_time: "09:30:00" },
  { id: "s2", start_time: null },
]);

const planned = toCalendarItem(visit({ id: "v1", schedule_id: "s1" }), times, "en", "—");
eq("T1: generated visit takes its planned time from the schedule", planned.time, "09:30");
eq("T1b: …and is marked as a planned time", planned.timeSource, "planned");

const actual = toCalendarItem(
  // 06:15 UTC = 09:15 Riyadh
  visit({ id: "v2", schedule_id: "s1", started_at: "2026-08-16T06:15:00Z", status: "inprogress" }),
  times, "en", "—"
);
eq("T2: a started visit uses its ACTUAL time, overriding the plan", actual.time, "09:15");
eq("T2b: …and is marked as actual", actual.timeSource, "actual");

const manual = toCalendarItem(visit({ id: "v3", schedule_id: null }), times, "en", "—");
eq("T3: a manual visit has NO time — never fabricated", manual.time, null);
eq("T3b: …and no minutes", manual.minutes, null);
eq("T3c: …and timeSource 'none'", manual.timeSource, "none");

const nullStart = toCalendarItem(visit({ id: "v4", schedule_id: "s2" }), times, "en", "—");
eq("T4: a schedule with a null start_time yields no time", nullStart.time, null);

const orphan = toCalendarItem(visit({ id: "v5", schedule_id: "missing" }), times, "en", "—");
eq("T5: unknown schedule id yields no time (no crash, no guess)", orphan.time, null);

eq("T6: riyadhClock converts UTC→Riyadh (+3)", riyadhClock("2026-08-16T21:30:00Z"), "00:30");
eq("T7: parseClock rejects nonsense", parseClock("99:99"), null);

// ─── Origin ───────────────────────────────────────────────────────────────────

console.log("\n── Origin ──");

eq("O1: schedule_id present → planned", planned.origin, "planned");
eq("O2: schedule_id null → unplanned", manual.origin, "unplanned");

// ─── Locale ───────────────────────────────────────────────────────────────────

console.log("\n── Locale ──");

eq("L1: Arabic uses branch_ar",
  toCalendarItem(visit({ id: "v6" }), times, "ar", "—").placeName, "بندة");
eq("L2: English uses branch_en",
  toCalendarItem(visit({ id: "v7" }), times, "en", "—").placeName, "Panda");

// ─── Grouping ─────────────────────────────────────────────────────────────────

console.log("\n── Grouping ──");

const items = [
  toCalendarItem(visit({ id: "a", merch_id: "m1", schedule_id: "s1" }), times, "en", "—"),
  toCalendarItem(visit({ id: "b", merch_id: "m1", schedule_id: null, status: "completed" }), times, "en", "—"),
  toCalendarItem(visit({ id: "c", merch_id: "m2", merch: { color: null, user: { full_name: "Bilal" } }, schedule_id: "s1" }), times, "en", "—"),
];

const lanes = groupByMerch(items);
eq("G1: one lane per merchandiser", lanes.length, 2);
eq("G2: lanes sorted by name", lanes.map((l) => l.merchName), ["Ahmed Ali", "Bilal"]);
eq("G3: timed vs untimed are separated", [lanes[0].timed.length, lanes[0].untimed.length], [1, 1]);
eq("G4: per-lane totals", [lanes[0].total, lanes[0].completed], [2, 1]);

const withIdle = groupByMerch(items, [
  { id: "m1", name: "Ahmed Ali", color: null },
  { id: "m3", name: "Zaid", color: null },
]);
check("G5: merchandisers with zero visits still get a lane (idle is visible)",
  withIdle.some((l) => l.merchId === "m3" && l.total === 0),
  `lanes=${withIdle.map((l) => l.merchName).join(",")}`);

// ─── Day axis ─────────────────────────────────────────────────────────────────

console.log("\n── Day axis ──");

eq("A1: default axis is 08:00–18:00", computeDayAxis([]).hours.length, 11);

const early = toCalendarItem(
  visit({ id: "e", schedule_id: "s3", started_at: "2026-08-16T03:00:00Z" }), times, "en", "—"
); // 06:00 Riyadh
const late = toCalendarItem(
  visit({ id: "l", schedule_id: "s3", started_at: "2026-08-16T18:30:00Z" }), times, "en", "—"
); // 21:30 Riyadh
const widened = computeDayAxis([early, late]);
check("A2: axis widens so nothing is clipped",
  widened.startHour <= 6 && widened.endHour >= 22,
  `${widened.startHour}→${widened.endHour}`);

check("A3: untimed items never widen the axis",
  computeDayAxis([manual]).startHour === 8, "still 08:00");

const axis = computeDayAxis([]);
eq("A4: axis start maps to 0%", positionPercent(8 * 60, axis), 0);
eq("A5: axis end maps to 100%", positionPercent(18 * 60, axis), 100);
check("A6: midpoint is ~50%",
  Math.abs(positionPercent(13 * 60, axis) - 50) < 0.01,
  `${positionPercent(13 * 60, axis)}%`);
check("A7: out-of-range values are clamped, never negative",
  positionPercent(0, axis) === 0 && positionPercent(23 * 60, axis) === 100, "clamped");

// ─── Ranges ───────────────────────────────────────────────────────────────────

console.log("\n── Ranges ──");

eq("R1: day range is a single date", rangeFor("day", "2026-08-16"), { from: "2026-08-16", to: "2026-08-16" });
eq("R2: week starts Sunday", startOfWeek("2026-08-19"), "2026-08-16");
eq("R3: week range spans 7 days", datesIn(rangeFor("week", "2026-08-19")).length, 7);
eq("R4: month boundaries", [startOfMonth("2026-08-19"), endOfMonth("2026-08-19")], ["2026-08-01", "2026-08-31"]);

const monthRange = rangeFor("month", "2026-08-19");
check("R5: month range is whole weeks (padded grid)",
  datesIn(monthRange).length % 7 === 0,
  `${datesIn(monthRange).length} days`);
check("R6: month range covers the whole month",
  monthRange.from <= "2026-08-01" && monthRange.to >= "2026-08-31",
  `${monthRange.from}→${monthRange.to}`);

eq("R7: day shift", shift("day", "2026-08-16", 1), "2026-08-17");
eq("R8: week shift", shift("week", "2026-08-16", -1), "2026-08-09");
eq("R9: month shift", shift("month", "2026-08-16", 1), "2026-09-16");
eq("R10: month shift clamps 31 Jan → 28 Feb (no overflow into March)",
  shift("month", "2027-01-31", 1), "2027-02-28");
check("R11: isSameMonth", isSameMonth("2026-08-01", "2026-08-31") && !isSameMonth("2026-09-01", "2026-08-31"), "ok");

// A day view must never fetch more than one day.
eq("R12: day view fetches exactly 1 date", datesIn(rangeFor("day", "2026-08-16")).length, 1);

// ─── Sub-lane packing ─────────────────────────────────────────────────────────

console.log("\n── Packing ──");

function timed(id: string, clock: string) {
  return toCalendarItem(
    visit({ id, schedule_id: `t-${id}` }),
    new Map([[`t-${id}`, clock]]),
    "en", "—"
  );
}

const spread = [timed("p1", "08:00"), timed("p2", "10:00"), timed("p3", "12:00")];
eq("K1: non-overlapping items share one row", packIntoRows(spread, 60).length, 1);

const collide = [timed("c1", "09:00"), timed("c2", "09:15"), timed("c3", "09:30")];
eq("K2: overlapping items stack into separate rows", packIntoRows(collide, 60).length, 3);

const mixed = [timed("m1", "09:00"), timed("m2", "09:15"), timed("m3", "11:00")];
const packedMixed = packIntoRows(mixed, 60);
check("K3: a later item reuses the first free row",
  packedMixed.length === 2 && packedMixed[0].length === 2,
  `rows=${packedMixed.map((r) => r.length).join(",")}`);

check("K4: untimed items are excluded from packing",
  packIntoRows([manual], 60).length === 0, "no rows");

check("K5: every packed item appears exactly once",
  (() => {
    const flat = packIntoRows(collide, 60).flat().map((i) => i.id).sort();
    return JSON.stringify(flat) === JSON.stringify(["c1", "c2", "c3"]);
  })(),
  "no loss, no duplication");

// ─── Buckets ──────────────────────────────────────────────────────────────────

console.log("\n── Buckets ──");

const week = datesIn(rangeFor("week", "2026-08-16"));
const buckets = bucketByDate(items, week);
eq("B1: one bucket per day in range", buckets.length, 7);
eq("B2: items land on their own date", buckets.find((b) => b.date === DATE)?.total, 3);
eq("B3: status tallies", buckets.find((b) => b.date === DATE)?.completed, 1);
check("B4: empty days are present, not omitted (calendar stays visible)",
  buckets.filter((b) => b.total === 0).length === 6, "6 empty days kept");
check("B5: items out of range are dropped, not misfiled",
  bucketByDate(items, ["2026-09-01"]).every((b) => b.total === 0), "none misfiled");

console.log(`\n${passed}/${passed + failed} checks passed`);
process.exit(failed > 0 ? 1 : 0);
