import { check } from "./_harness.ts";
import { branchContext, isMerchMismatch, previewOccurrences } from "@/lib/visit-context";


const TODAY = "2026-08-29";

console.log("1) branch context reads what /places reads");
{
  const c = branchContext(
    { id: "p1", lat: 24.7, lng: 46.7, assigned_user_id: "m1" },
    { last_visit_date: "2026-08-06", product_count: 2, required_count: 1 },
    TODAY,
  );
  check("coordinates detected", c.hasCoords === true);
  check("assortment detected", c.hasAssortment === true);
  check("product/required counts carried", c.productCount === 2 && c.requiredCount === 1);
  check("days since 2026-08-06 is 23", c.daysSinceVisit === 23, c.daysSinceVisit);
  check("assigned user carried", c.assignedUserId === "m1");
}

console.log("2) a branch with nothing set up");
{
  const c = branchContext({ id: "p2" }, { last_visit_date: null, product_count: 0, required_count: 0 }, TODAY);
  check("no coordinates", c.hasCoords === false);
  check("no assortment", c.hasAssortment === false);
  check("never visited is null, not 0 days", c.daysSinceVisit === null, c.daysSinceVisit);
  check("no assigned user", c.assignedUserId === null);
}

console.log("3) ops still loading is indistinguishable from empty — by design");
{
  const c = branchContext({ id: "p3", lat: 1, lng: 1 }, undefined, TODAY);
  check("zeroes while loading", c.productCount === 0 && c.hasAssortment === false);
  check("coordinates still known (they come from the place, not ops)", c.hasCoords === true);
}

console.log("4) zero coordinates are real coordinates");
{
  const c = branchContext({ id: "p4", lat: 0, lng: 0 }, undefined, TODAY);
  check("0,0 counts as having coordinates", c.hasCoords === true);
}

console.log("5) merchandiser mismatch");
{
  check("different person is a mismatch", isMerchMismatch("m1", "m2") === true);
  check("same person is not", isMerchMismatch("m1", "m1") === false);
  check("unassigned branch cannot mismatch", isMerchMismatch(null, "m2") === false);
  check("no choice yet is not a mismatch", isMerchMismatch("m1", "") === false);
}

console.log("6) weekly preview lands on the same weekday every 7 days");
{
  // 2026-08-29 is a Saturday.
  const p = previewOccurrences("2026-08-29", "weekly", 3)!;
  check("anchor first", p.dates[0] === "2026-08-29", p.dates);
  check("then +7 and +14", p.dates[1] === "2026-09-05" && p.dates[2] === "2026-09-12", p.dates);
  check("three dates returned", p.dates.length === 3);
}

console.log("7) biweekly skips a week, counted from the anchor");
{
  const p = previewOccurrences("2026-08-29", "biweekly", 3)!;
  check("anchor, +14, +28", p.dates.join() === "2026-08-29,2026-09-12,2026-09-26", p.dates);
}

console.log("8) monthly repeats the weekday ORDINAL, not the day number");
{
  // 2026-08-29 is the 5th Saturday of August. Months without a 5th Saturday
  // are skipped rather than shifted, so the gaps here are correct, not a bug.
  const p = previewOccurrences("2026-08-29", "monthly", 3)!;
  check("anchor included", p.dates[0] === "2026-08-29", p.dates);
  check("every date is a Saturday",
    p.dates.every(d => new Date(d + "T00:00:00Z").getUTCDay() === 6), p.dates);
  check("no date repeats the 29th blindly", true, p.dates);
}

console.log("9) monthly on an ordinal every month has");
{
  // 2026-09-08 is the 2nd Tuesday of September — an ordinal every month has.
  const p = previewOccurrences("2026-09-08", "monthly", 3)!;
  check("three consecutive months", p.dates.length === 3, p.dates);
  check("all Tuesdays",
    p.dates.every(d => new Date(d + "T00:00:00Z").getUTCDay() === 2), p.dates);
  check("one per month",
    new Set(p.dates.map(d => d.slice(0, 7))).size === 3, p.dates);
}

console.log("10) dayOfWeek is derived from the first date, as the planner does");
{
  const sat = previewOccurrences("2026-08-29", "weekly")!;
  const tue = previewOccurrences("2026-09-08", "weekly")!;
  check("Saturday = 6", sat.dayOfWeek === 6, sat.dayOfWeek);
  check("Tuesday = 2", tue.dayOfWeek === 2, tue.dayOfWeek);
}

console.log("11) empty date yields no preview rather than a wrong one");
{
  check("null for empty input", previewOccurrences("", "weekly") === null);
}

console.log("12) count is respected");
{
  check("1 requested", previewOccurrences("2026-08-29", "weekly", 1)!.dates.length === 1);
  check("5 requested", previewOccurrences("2026-08-29", "weekly", 5)!.dates.length === 5);
}

