// ─────────────────────────────────────────────────────────────────────────────
// Recurrence engine — the single source of truth for turning a recurring
// `schedules` row into concrete visit dates.
//
// Deliberately pure and dependency-free: every function here is deterministic,
// unit-tested (scripts/test-recurrence.ts) and safe to call repeatedly. The
// generator route holds the I/O; this module holds the maths.
//
// The logic is NOT mirrored in SQL. Migration 019 adds only the link, the
// anchor and the unique index that makes generation idempotent — so there is
// no second implementation that can drift from this one.
//
// ── Calendar-date discipline ────────────────────────────────────────────────
// `visits.scheduled_date` is a DATE, so everything here is a plain calendar
// date string ("YYYY-MM-DD"). Internally dates are handled as UTC-midnight
// Date objects purely as arithmetic carriers — never as instants — so no
// local-timezone or DST behaviour of the running server can shift a date.
//
// ── Business timezone ───────────────────────────────────────────────────────
// Malgoof operates in Saudi Arabia: Asia/Riyadh, UTC+3, no DST, ever. "Today"
// for generation is therefore the Riyadh calendar date, not the UTC one — the
// two differ between 00:00 and 03:00 Riyadh.
// ─────────────────────────────────────────────────────────────────────────────

/** Fixed Riyadh offset. Saudi Arabia has never observed DST. */
const RIYADH_OFFSET_MINUTES = 3 * 60;

export type Frequency = "weekly" | "biweekly" | "monthly";

/** 0 = Sunday … 6 = Saturday — matches the `day_of_week` enum and day labels. */
export type DayOfWeek = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** The subset of a schedule row the recurrence maths needs. */
export interface RecurrenceRule {
  /** "YYYY-MM-DD" — first occurrence; origin of biweekly parity + monthly ordinal. */
  anchorDate: string;
  dayOfWeek:  DayOfWeek;
  frequency:  Frequency;
}

// ─── Calendar-date primitives ─────────────────────────────────────────────────

const DAY_MS = 86_400_000;

/** Parse "YYYY-MM-DD" into a UTC-midnight Date (arithmetic carrier only). */
export function parseDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** Format a UTC-midnight Date back to "YYYY-MM-DD". */
export function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string {
  return formatDate(new Date(parseDate(iso).getTime() + days * DAY_MS));
}

/** Whole days between two calendar dates (b - a). Exact: both are UTC midnight. */
export function daysBetween(a: string, b: string): number {
  return Math.round((parseDate(b).getTime() - parseDate(a).getTime()) / DAY_MS);
}

/** 0 = Sunday … 6 = Saturday. */
export function dayOfWeek(iso: string): DayOfWeek {
  return parseDate(iso).getUTCDay() as DayOfWeek;
}

/**
 * Today's date in Asia/Riyadh. Between 00:00 and 03:00 Riyadh this is one day
 * ahead of the UTC date — which is exactly the point.
 */
export function riyadhToday(now: Date = new Date()): string {
  return new Date(now.getTime() + RIYADH_OFFSET_MINUTES * 60_000)
    .toISOString()
    .slice(0, 10);
}

/** First date on/after `iso` whose weekday is `dow`. Returns `iso` if it matches. */
export function alignForward(iso: string, dow: DayOfWeek): string {
  const diff = (dow - dayOfWeek(iso) + 7) % 7;
  return diff === 0 ? iso : addDays(iso, diff);
}

/**
 * Which occurrence of its own weekday a date is within its month.
 * 2026-06-14 (a Sunday, the 14th) → 2, i.e. "the 2nd Sunday".
 */
export function weekdayOrdinal(iso: string): number {
  return Math.floor((parseDate(iso).getUTCDate() - 1) / 7) + 1;
}

/**
 * The `ordinal`-th `dow` of the given month, or null when that month has no
 * such occurrence (e.g. a 5th Sunday). Never shifts to another week.
 */
export function nthWeekdayOfMonth(
  year:    number,
  month:   number,      // 0-indexed
  dow:     DayOfWeek,
  ordinal: number
): string | null {
  const first      = new Date(Date.UTC(year, month, 1));
  const firstMatch = 1 + ((dow - first.getUTCDay() + 7) % 7);
  const day        = firstMatch + (ordinal - 1) * 7;
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  if (day > daysInMonth) return null;   // month has no such ordinal
  return formatDate(new Date(Date.UTC(year, month, day)));
}

// ─── Occurrence generation ────────────────────────────────────────────────────

/**
 * Every occurrence of `rule` within the inclusive window [from, to].
 *
 * Guarantees:
 *  • never returns a date before `anchorDate` (no back-filling history)
 *  • never returns a date outside [from, to]
 *  • every returned date falls on `rule.dayOfWeek`
 *  • output is ascending, unique, and identical for identical inputs
 */
export function occurrencesFor(
  rule: RecurrenceRule,
  from: string,
  to:   string
): string[] {
  if (to < from) return [];

  // Occurrences can never precede the anchor.
  const start = from < rule.anchorDate ? rule.anchorDate : from;
  if (start > to) return [];

  switch (rule.frequency) {
    case "weekly":   return weeklyOccurrences(rule, start, to);
    case "biweekly": return biweeklyOccurrences(rule, start, to);
    case "monthly":  return monthlyOccurrences(rule, start, to);
    default:         return [];
  }
}

/** Every matching weekday in the window. */
function weeklyOccurrences(rule: RecurrenceRule, start: string, to: string): string[] {
  const out: string[] = [];
  for (let d = alignForward(start, rule.dayOfWeek); d <= to; d = addDays(d, 7)) {
    out.push(d);
  }
  return out;
}

/**
 * Every second matching weekday, with parity counted from the anchor — so the
 * sequence is stable no matter when the generator runs. (Counting "every other
 * one from today" would drift on each execution.)
 */
function biweeklyOccurrences(rule: RecurrenceRule, start: string, to: string): string[] {
  const out: string[] = [];
  let d = alignForward(start, rule.dayOfWeek);

  // Skip forward one week if this candidate lands on an odd week from the anchor.
  const weeksFromAnchor = Math.round(daysBetween(rule.anchorDate, d) / 7);
  if (weeksFromAnchor % 2 !== 0) d = addDays(d, 7);

  for (; d <= to; d = addDays(d, 14)) out.push(d);
  return out;
}

/**
 * The same weekday-ordinal each month as the anchor (anchor = 2nd Sunday →
 * every month's 2nd Sunday). Months lacking that ordinal are skipped, never
 * shifted — see migration 019 for why day-of-month semantics are impossible
 * with the current schema.
 */
function monthlyOccurrences(rule: RecurrenceRule, start: string, to: string): string[] {
  const ordinal = weekdayOrdinal(rule.anchorDate);
  const out: string[] = [];

  const startD = parseDate(start);
  const endD   = parseDate(to);

  let year  = startD.getUTCFullYear();
  let month = startD.getUTCMonth();

  // Walk months until past the window. Bounded by the caller's window size.
  while (year < endD.getUTCFullYear() ||
        (year === endD.getUTCFullYear() && month <= endD.getUTCMonth())) {
    const candidate = nthWeekdayOfMonth(year, month, rule.dayOfWeek, ordinal);
    if (candidate && candidate >= start && candidate <= to) out.push(candidate);

    month++;
    if (month > 11) { month = 0; year++; }
  }

  return out;
}

// ─── Generation window ────────────────────────────────────────────────────────

/** Rolling window length. 30 days ahead — never a year, never the past. */
export const GENERATION_WINDOW_DAYS = 30;

export interface GenerationWindow {
  from: string;
  to:   string;
}

/**
 * The rolling window to generate for: Riyadh today → +30 days, inclusive.
 * Starting at today (not tomorrow) means a schedule created this morning still
 * produces today's visit; nothing before today is ever generated.
 */
export function generationWindow(
  now: Date = new Date(),
  days: number = GENERATION_WINDOW_DAYS
): GenerationWindow {
  const from = riyadhToday(now);
  return { from, to: addDays(from, days) };
}
