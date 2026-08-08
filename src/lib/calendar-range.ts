// ─────────────────────────────────────────────────────────────────────────────
// Calendar range maths — pure, and the basis of the query scoping rule:
// the workspace NEVER fetches the whole visits table, only the visible range.
//
// Reuses the date primitives already proven by the recurrence engine so the
// calendar and the generator agree on what "today" and "a day" mean
// (Asia/Riyadh calendar dates, UTC-midnight arithmetic carriers).
// ─────────────────────────────────────────────────────────────────────────────

import { addDays, parseDate, formatDate, riyadhToday } from "./recurrence";

export type CalendarView = "day" | "week" | "month";

export interface DateRange {
  from: string;   // inclusive YYYY-MM-DD
  to:   string;   // inclusive YYYY-MM-DD
}

/** Week starts Sunday — matching `day_of_week` 0=Sunday and the day labels. */
const WEEK_START_DOW = 0;

export function startOfWeek(iso: string): string {
  const d = parseDate(iso);
  const diff = (d.getUTCDay() - WEEK_START_DOW + 7) % 7;
  return addDays(iso, -diff);
}

export function startOfMonth(iso: string): string {
  const d = parseDate(iso);
  return formatDate(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)));
}

export function endOfMonth(iso: string): string {
  const d = parseDate(iso);
  return formatDate(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)));
}

/** The inclusive date range a view needs to fetch. */
export function rangeFor(view: CalendarView, anchor: string): DateRange {
  switch (view) {
    case "day":
      return { from: anchor, to: anchor };
    case "week": {
      const from = startOfWeek(anchor);
      return { from, to: addDays(from, 6) };
    }
    case "month": {
      // Fetch the padded grid (whole weeks) so trailing/leading cells are
      // populated without a second query.
      const from = startOfWeek(startOfMonth(anchor));
      const last = endOfMonth(anchor);
      const to   = addDays(startOfWeek(last), 6);
      return { from, to };
    }
  }
}

/** Every date in an inclusive range, ascending. */
export function datesIn(range: DateRange): string[] {
  const out: string[] = [];
  for (let d = range.from; d <= range.to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Move the anchor one period in either direction. */
export function shift(view: CalendarView, anchor: string, direction: 1 | -1): string {
  switch (view) {
    case "day":
      return addDays(anchor, direction);
    case "week":
      return addDays(anchor, 7 * direction);
    case "month": {
      const d = parseDate(anchor);
      // Clamp to the last day of the target month so 31 Jan → 28/29 Feb.
      const targetFirst = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + direction, 1));
      const daysInTarget = new Date(Date.UTC(
        targetFirst.getUTCFullYear(), targetFirst.getUTCMonth() + 1, 0
      )).getUTCDate();
      return formatDate(new Date(Date.UTC(
        targetFirst.getUTCFullYear(),
        targetFirst.getUTCMonth(),
        Math.min(d.getUTCDate(), daysInTarget)
      )));
    }
  }
}

export function today(): string {
  return riyadhToday();
}

export function isToday(iso: string): boolean {
  return iso === riyadhToday();
}

export function isSameMonth(iso: string, anchor: string): boolean {
  return iso.slice(0, 7) === anchor.slice(0, 7);
}
