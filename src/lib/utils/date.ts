/**
 * Calendar-date helpers for "what day is it?" questions.
 *
 * WHY THIS EXISTS
 * ───────────────
 * `new Date().toISOString().slice(0, 10)` returns the **UTC** calendar date.
 * Riyadh is UTC+3, so between 00:00 and 02:59 local time that expression
 * yields *yesterday* — which is why the dashboard could show 25 August while
 * the wall clock said 26 August, and why the Reports "to" default excluded
 * today's visits.
 *
 * ONE DEFINITION OF "TODAY"
 * ─────────────────────────
 * `visits.scheduled_date` is a timezone-less DATE representing a **Riyadh
 * business day**. So "today" is always `riyadhToday()` — on the client AND
 * on the server (Vercel functions run with a UTC clock). Deliberately there
 * is no second, device-local definition: two competing notions of "today" is
 * the exact bug class this module exists to remove.
 *
 * WHAT NOT TO CHANGE
 * ──────────────────
 * `toISOString().slice(0, 10)` is CORRECT when the Date was built as UTC
 * midnight on purpose (`Date.UTC(...)` or `"…T00:00:00Z"`) and is only being
 * used as an arithmetic carrier for date strings — see `src/lib/recurrence.ts`
 * and `src/ai/compare.ts`. Those are self-consistent; "fixing" them would
 * introduce off-by-one bugs. Use `shiftIsoDate()` for new date-string maths.
 */

/**
 * Today's business date (Asia/Riyadh) as "YYYY-MM-DD".
 *
 * Re-exported from the recurrence engine, which already owned this concept
 * for the calendar — so there is exactly ONE implementation, and server code
 * has an obvious import site.
 */
export { riyadhToday } from "@/lib/recurrence";

/**
 * Current hour (0–23) of the Riyadh business day. Use this instead of
 * `new Date().getHours()` for anything that renders, so a UTC server and an
 * AST browser cannot disagree. Same single-implementation rule as riyadhToday.
 */
export { riyadhHour } from "@/lib/recurrence";

/**
 * Shift a "YYYY-MM-DD" string by whole days and return "YYYY-MM-DD".
 * UTC-anchored internally so it can never drift across an offset boundary.
 */
export function shiftIsoDate(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const carrier = new Date(Date.UTC(y, m - 1, d));
  carrier.setUTCDate(carrier.getUTCDate() + days);
  return carrier.toISOString().slice(0, 10);
}

/** First day of the month containing `iso` ("2026-08-26" → "2026-08-01"). */
export function startOfMonthIso(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}
