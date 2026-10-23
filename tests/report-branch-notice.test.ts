// Branch Coverage — what the notice says when a branch read is refused.
//
// Branch Coverage makes two reads that are about branches rather than about the
// visits in the range: the list of active branches, and the one-row-per-branch
// last-visit view. When either is cut, uncounted or over the maximum, the
// report is refused like any other — but the notice used to describe the
// figures as "rows in this period" and suggest a narrower range, neither of
// which is true of those reads. These pin the corrected wording, in Arabic and
// English, for both reads and all three refusals; that the visits' own notices
// are unchanged; and that the refusal itself (no rows, no export, Retry) is
// untouched.

import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { check, eq, ok } from "./_harness.ts";
import { fetchBranchReport, type BranchReportRow } from "@/services/reports";
import {
  ReportIncompleteError, aboutSubject, canExportReport, reportTabMessage, reportTabState, type ReportTabState,
} from "@/lib/report-completeness";
import { REPORT_MAX_ROWS } from "@/lib/report-pages";
import { translations } from "@/lib/i18n/translations";
import type { TranslationFn } from "@/hooks/use-translation";
import { queueResultFor, resetStub } from "./stubs/supabase-client.ts";

const RANGE = { from: "2026-08-01", to: "2026-08-31" };
const LOCALES = ["ar", "en"] as const;
const dict = (locale: "ar" | "en") => translations[locale] as Record<string, string>;
function tFor(locale: "ar" | "en"): TranslationFn {
  return (key, vars) => {
    let s = dict(locale)[key] ?? key;
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
    return s;
  };
}
const fill = (locale: "ar" | "en", key: string, vars: Record<string, string | number> = {}) => tFor(locale)(key as never, vars);

// ── Fixture: a small, complete Branch report ─────────────────────────────────
const pid = (n: number) => `pl-${n}`;
const info = (n: number) => ({ branch_ar: `فرع ${n}`, branch_en: `Branch ${n}`, code: `BR-${n}`, chain: { name_ar: "سلسلة", name_en: "Chain" } });
const VISITS = [1, 2, 3].map((n) => ({ id: `v${n}`, status: "completed", duration_minutes: 10, place_id: pid(1), place: info(1) }));
const PLACES = [1, 2, 3].map((n) => ({ id: pid(n), ...info(n), is_active: true }));
const OPS = [1, 2, 3].map((n) => ({ place_id: pid(n), last_visit_date: n === 3 ? null : "2026-08-06" }));
type Page = { data: unknown; error: unknown; count?: number | null };
const whole = (rows: unknown[]): Page => ({ data: rows, error: null, count: rows.length });

function arrange(reads: { visits?: Page; places?: Page; ops?: Page } = {}) {
  resetStub();
  queueResultFor("visits", reads.visits ?? whole(VISITS));
  queueResultFor("places", reads.places ?? whole(PLACES));
  queueResultFor("v_branch_operations", reads.ops ?? whole(OPS));
}
async function refusedWith(reads: Parameters<typeof arrange>[0]) {
  arrange(reads);
  try { await fetchBranchReport(RANGE); return null; } catch (e) { return e; }
}
const failed = (error: unknown) => reportTabState<BranchReportRow>({ data: undefined, isFetching: false, isPaused: false, isError: true, error });

// ── Each branch read, each refusal ───────────────────────────────────────────
const BROKEN = {
  truncated:  (rows: unknown[]): Page => ({ data: rows.slice(0, 2), error: null, count: rows.length }),
  unverified: (rows: unknown[]): Page => ({ data: rows, error: null }),
  tooLarge:   (rows: unknown[]): Page => ({ data: rows, error: null, count: REPORT_MAX_ROWS + 1 }),
} as const;

console.log("branch notice: the branch list and the last-visit read");
for (const [source, label, rows] of [["places", "the branch list", PLACES], ["ops", "the last-visit read", OPS]] as const) {
  for (const reason of ["truncated", "unverified", "tooLarge"] as const) {
    const e = await refusedWith({ [source]: BROKEN[reason](rows) });
    const name = `${label} ${reason}`;
    ok(`${name}: the report is refused`, e instanceof ReportIncompleteError);
    const err = e as ReportIncompleteError;
    eq(`${name}: the refusal is marked as being about branches, with its own reason`, [err.report, err.reason, err.subject], ["branch", reason, "branches"]);

    const state = failed(e);
    eq(`${name}: the tab state carries the subject, and no rows`, [state.kind, (state as { subject?: string }).subject, state.rows.length], [reason, "branches", 0]);
    eq(`${name}: no export`, canExportReport(state), false);

    for (const locale of LOCALES) {
      const m = reportTabMessage(state, tFor(locale))!;
      const title =
        reason === "truncated" ? fill(locale, "reports.data.branchesTruncated", { total: 3, loaded: 2 })
        : reason === "tooLarge" ? fill(locale, "reports.data.branchesTooLarge", { total: "20,001", max: "20,000" })
        : fill(locale, "reports.data.branchesUnverified");
      const detail = reason === "tooLarge" ? fill(locale, "reports.data.branchesTooMany") : fill(locale, "reports.data.branchesRetry");
      eq(`[${locale}] ${name}: the notice is the branch sentence, filled in`, m, { title, detail });
      ok(`[${locale}] ${name}: it does not call them rows in this period`,
         !m.title.includes(locale === "ar" ? "عدد الصفوف في هذه الفترة" : "rows") && !m.title.includes(locale === "ar" ? "الصفوف" : "period"));
      ok(`[${locale}] ${name}: it does not suggest narrowing the date range`,
         m.detail !== fill(locale, "reports.data.narrow") && !(locale === "ar" ? m.detail.includes("ضيِّق") : /narrow/i.test(m.detail)));
      ok(`[${locale}] ${name}: it names branches`, locale === "ar" ? m.title.includes("الفروع") : /branch/i.test(m.title));
      ok(`[${locale}] ${name}: no placeholder is left unfilled`, !/[{}]/.test(m.title + m.detail));
      if (reason === "tooLarge") ok(`[${locale}] ${name}: it names the maximum, 20,000`, m.title.includes("20,000") && m.title.includes("20,001"));
      if (reason === "truncated") ok(`[${locale}] ${name}: it gives both figures`, m.title.includes("(3)") && m.title.includes("(2)"));
    }
  }
}

// ── The visits' own notices are exactly what they were ───────────────────────
console.log("branch notice: the visits read keeps its own notices");
for (const reason of ["truncated", "unverified", "tooLarge"] as const) {
  const e = await refusedWith({ visits: BROKEN[reason](VISITS) });
  const state = failed(e);
  eq(`visits ${reason}: about rows, so the state has no subject at all`, [(e as ReportIncompleteError).subject, "subject" in state], ["rows", false]);
  for (const locale of LOCALES) {
    const m = reportTabMessage(state, tFor(locale))!;
    const title =
      reason === "truncated" ? fill(locale, "reports.data.truncated", { total: 3, loaded: 2 })
      : reason === "tooLarge" ? fill(locale, "reports.data.tooLarge", { total: "20,001", max: "20,000" })
      : fill(locale, "reports.data.unverified");
    eq(`[${locale}] visits ${reason}: the period's notice, and the narrow-the-range line`, m, { title, detail: fill(locale, "reports.data.narrow") });
  }
}
{
  // When both are refused, the visits' refusal is reported first, as before — and with its own wording.
  const e = await refusedWith({ visits: BROKEN.truncated(VISITS), places: BROKEN.unverified(PLACES) });
  eq("visits cut and the branch list uncounted → the visits' notice", [(e as ReportIncompleteError).reason, (e as ReportIncompleteError).subject], ["truncated", "rows"]);
  // A query error is never relabelled.
  const boom = { code: "XX000", message: "places failed" };
  ok("a branch-list query error is thrown as the error itself", (await refusedWith({ places: { data: null, error: boom, count: null } })) === boom);
}

// ── The states of the other tabs are unchanged ───────────────────────────────
console.log("branch notice: everything else is as it was");
{
  const states: Array<[string, ReportTabState<unknown>, ReportTabState<unknown>]> = [
    ["truncated", failed(new ReportIncompleteError("merch", "truncated", 1000, 1500)), { kind: "truncated", rows: [], loaded: 1000, total: 1500 }],
    ["unverified", failed(new ReportIncompleteError("gps", "unverified", 4, null)), { kind: "unverified", rows: [] }],
    ["too large", failed(new ReportIncompleteError("visits", "tooLarge", 1000, 25_340, 20_000)), { kind: "tooLarge", rows: [], total: 25_340, max: 20_000 }],
  ];
  for (const [label, got, want] of states) eq(`a ${label} refusal of a range's rows has exactly the state it had`, got, want);

  const plain = new Error("not a refusal");
  ok("aboutSubject leaves anything that is not a refusal alone", aboutSubject(plain, "branches") === plain);
  const already = new ReportIncompleteError("branch", "unverified", 2, null, null, "branches");
  ok("…and a refusal already about that subject", aboutSubject(already, "branches") === already);
  const moved = aboutSubject(new ReportIncompleteError("branch", "tooLarge", 1000, 20_001, 20_000), "branches") as ReportIncompleteError;
  eq("…and otherwise keeps every figure", [moved.report, moved.reason, moved.loaded, moved.total, moved.max, moved.subject], ["branch", "tooLarge", 1000, 20_001, 20_000, "branches"]);
  ok("…including in its (developer-facing) error message", /20001/.test(moved.message) && /20000/.test(moved.message));
}

// ── Retry, hidden rows, disabled Export: on a real observer ──────────────────
console.log("branch notice: Retry");
for (const [source, rows] of [["places", PLACES], ["ops", OPS]] as const) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: 1, retryDelay: 5 } } });
  client.mount();
  arrange({ [source]: BROKEN.unverified(rows) });
  const observer = new QueryObserver<BranchReportRow[]>(client, {
    queryKey: ["branch-notice", source],
    queryFn: ({ signal }) => fetchBranchReport(RANGE, undefined, signal),
    retry: false,
  });
  const published: number[] = [];
  const unsubscribe = observer.subscribe((r) => { if (r.data) published.push(r.data.length); });
  const idle = async () => {
    for (let i = 0; i < 400 && observer.getCurrentResult().fetchStatus !== "idle"; i++) await new Promise((r) => setTimeout(r, 5));
    await new Promise((r) => setTimeout(r, 40));
  };
  await idle();
  const r = observer.getCurrentResult();
  const state = reportTabState<BranchReportRow>({ data: r.data, isFetching: r.isFetching, isPaused: r.isPaused, isError: r.isError, error: r.error });
  eq(`${source} refused: the branches notice, no rows, no export, nothing published`,
     [state.kind, (state as { subject?: string }).subject, state.rows.length, canExportReport(state), published.length], ["unverified", "branches", 0, false, 0]);
  check(`${source} refused: the English notice names branch details`, reportTabMessage(state, tFor("en"))!.title === fill("en", "reports.data.branchesUnverified"));

  arrange();
  await observer.refetch();
  await idle();
  const after = observer.getCurrentResult();
  const ready = reportTabState<BranchReportRow>({ data: after.data, isFetching: after.isFetching, isPaused: after.isPaused, isError: after.isError, error: after.error });
  eq(`${source}: Retry brings the rows and Export back`, [ready.kind, ready.rows.length, canExportReport(ready)], ["ready", 3, true]);
  unsubscribe();
  client.unmount();
  client.clear();
}

// ── The strings themselves ───────────────────────────────────────────────────
console.log("branch notice: the translations");
{
  const KEYS = ["reports.data.branchesTruncated", "reports.data.branchesTooLarge", "reports.data.branchesUnverified", "reports.data.branchesRetry", "reports.data.branchesTooMany"];
  const PLACEHOLDERS: Record<string, string[]> = {
    "reports.data.branchesTruncated": ["{loaded}", "{total}"], "reports.data.branchesTooLarge": ["{max}", "{total}"],
    "reports.data.branchesUnverified": [], "reports.data.branchesRetry": [], "reports.data.branchesTooMany": [],
  };
  for (const k of KEYS) {
    check(`${k} is Arabic in ar`, /[؀-ۿ]/.test(dict("ar")[k] ?? ""), dict("ar")[k]);
    check(`${k} is English in en`, !!dict("en")[k] && !/[؀-ۿ]/.test(dict("en")[k]), dict("en")[k]);
    for (const locale of LOCALES) {
      eq(`[${locale}] ${k} carries exactly its placeholders`, (dict(locale)[k].match(/\{[a-z]+\}/g) ?? []).sort(), PLACEHOLDERS[k]);
    }
  }
  ok("the second lines both say export is unavailable",
     LOCALES.every((l) => ["reports.data.branchesRetry", "reports.data.branchesTooMany"].every((k) => dict(l)[k].includes("Excel"))));
  ok("the second lines say the date range does not help",
     ["reports.data.branchesRetry", "reports.data.branchesTooMany"].every((k) => /date range/.test(dict("en")[k]) && dict("ar")[k].includes("الفترة")));
}
