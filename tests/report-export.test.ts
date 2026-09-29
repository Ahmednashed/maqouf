// Reports — summary failure handling and the Excel export invariant.
//
// Before this batch, a failed period summary left nine cards of "—" and made
// every tab export a bare data grid: no summary sheet, no record of the period
// or filters, nothing to say anything had gone wrong.
//
// These pin, in both locales:
//   • which state the summary is in (ready / loading / error / unavailable);
//   • that a successful export is byte-for-byte the old summary sheet — checked
//     against a verbatim copy of the construction the page used before;
//   • that without figures the sheet still carries the period and filters, plus
//     an explicit "unavailable" row, and never omits the sheet;
//   • the real workbook, round-tripped through the `xlsx` library.
//
// The page's JSX cannot be rendered here (no DOM, no React renderer in the test
// runner), so its wiring gets a short, clearly labelled source check at the end.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { check, eq, ok } from "./_harness.ts";
import * as XLSX from "xlsx";
import {
  buildExportMeta,
  buildReportWorkbook,
  durationLabel,
  summaryExportMeta,
  summaryStatus,
  type ExportMeta,
} from "@/lib/report-export";
import { gpsExportRow } from "@/lib/gps-report";
import { translations, type TranslationKey } from "@/lib/i18n/translations";
import type { TranslationFn } from "@/hooks/use-translation";
import type { DateRange, GpsReportRow, ReportSummary } from "@/services/reports";

type Locale = "ar" | "en";
const LOCALES: Locale[] = ["ar", "en"];

/** The same lookup useTranslation() performs, without the store. */
function tFor(locale: Locale): TranslationFn {
  const dict = translations[locale] as Record<string, string>;
  const fallback = translations.ar as Record<string, string>;
  return (key, vars) => {
    let str = dict[key] ?? fallback[key] ?? key;
    if (vars) {
      for (const [k, v] of Object.entries(vars)) {
        str = str.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
      }
    }
    return str;
  };
}

const RANGE: DateRange = { from: "2026-05-01", to: "2026-09-19" };

// The live owner figures for RANGE (as the app showed them after the RPC swap).
const SUMMARY: ReportSummary = {
  total_visits: 14, completed: 13, missed: 0, pending: 0, inprogress: 1,
  completion_rate: 100, active_merchandisers: 2, covered_branches: 1,
  scheduled_branches: 2, avg_duration: 7714,
  audited_products: 1, products_with_shortfall: 0,
};

// No audits, no durations: the two "not a number" renderings.
const SUMMARY_NO_AUDITS: ReportSummary = {
  ...SUMMARY, completed: 0, completion_rate: 0, avg_duration: 0,
  audited_products: null, products_with_shortfall: null,
};

/**
 * Verbatim copy of the summary-sheet construction the Reports page used at
 * 4bdcd28, before it moved into src/lib/report-export.ts. Kept here as the
 * reference the refactor must reproduce exactly.
 */
function legacyMeta(
  t: TranslationFn, range: DateRange, merchLabel: string, placeLabel: string,
  status: string, statusLabelText: string, lastVisitLabel: string, summaryData: ReportSummary,
): ExportMeta {
  return {
    sheetName: t("reports.exp.sheetSummary"),
    dataSheet: t("reports.exp.sheetData"),
    rows: [
      { [t("reports.exp.metric")]: t("reports.exp.range"),        [t("reports.exp.value")]: `${range.from} → ${range.to}` },
      { [t("reports.exp.metric")]: t("reports.exp.filterMerch"),  [t("reports.exp.value")]: merchLabel },
      { [t("reports.exp.metric")]: t("reports.exp.filterBranch"), [t("reports.exp.value")]: placeLabel },
      { [t("reports.exp.metric")]: t("reports.exp.filterStatus"), [t("reports.exp.value")]: status ? statusLabelText : t("reports.exp.none") },
      { [t("reports.exp.metric")]: t("reports.exp.filterLastVisit"), [t("reports.exp.value")]: lastVisitLabel },
      { [t("reports.exp.metric")]: t("reports.sum.totalVisits"),     [t("reports.exp.value")]: summaryData.total_visits },
      { [t("reports.exp.metric")]: t("reports.sum.completed"),       [t("reports.exp.value")]: summaryData.completed },
      { [t("reports.exp.metric")]: t("reports.sum.missed"),          [t("reports.exp.value")]: summaryData.missed },
      { [t("reports.exp.metric")]: t("reports.sum.pending"),         [t("reports.exp.value")]: summaryData.pending },
      { [t("reports.exp.metric")]: t("reports.sum.rate"),            [t("reports.exp.value")]: `${summaryData.completion_rate}%` },
      { [t("reports.exp.metric")]: t("reports.sum.activeMerch"),     [t("reports.exp.value")]: summaryData.active_merchandisers },
      { [t("reports.exp.metric")]: t("reports.sum.coveredBranches"), [t("reports.exp.value")]: `${summaryData.covered_branches} / ${summaryData.scheduled_branches}` },
      { [t("reports.exp.metric")]: t("reports.sum.avgDuration"),     [t("reports.exp.value")]: durationLabel(summaryData.avg_duration, t) },
      {
        [t("reports.exp.metric")]: t("reports.sum.productIssues"),
        [t("reports.exp.value")]: summaryData.products_with_shortfall == null
          ? t("reports.sum.noAudits")
          : summaryData.products_with_shortfall,
      },
    ],
  };
}

/** Write the workbook to bytes and read it back — what a user would open. */
function roundTrip(meta: ExportMeta, rows: Record<string, unknown>[]) {
  const bytes = XLSX.write(buildReportWorkbook(XLSX, rows, meta), { type: "array", bookType: "xlsx" });
  const wb = XLSX.read(bytes, { type: "array" });
  const sheet = (name: string) => wb.Sheets[name];
  return {
    names:      wb.SheetNames,
    summary:    XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet(wb.SheetNames[0])),
    summaryHdr: (XLSX.utils.sheet_to_json<unknown[]>(sheet(wb.SheetNames[0]), { header: 1 })[0] ?? []),
    data:       XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet(wb.SheetNames[1])),
    dataHdr:    (XLSX.utils.sheet_to_json<unknown[]>(sheet(wb.SheetNames[1]), { header: 1 })[0] ?? []),
  };
}

// ── 1) Summary state ─────────────────────────────────────────────────────────
console.log("1a) summary state — the flag combinations TanStack Query 5 produces");
const flags = (data: ReportSummary | undefined, isFetching: boolean, isPaused: boolean, isError: boolean) =>
  summaryStatus({ data, isFetching, isPaused, isError });

eq("figures on hand → ready",                                   flags(SUMMARY,   false, false, false), "ready");
eq("figures on hand while refreshing → ready (no flicker)",     flags(SUMMARY,   true,  false, false), "ready");
eq("figures kept after a failed background refresh → ready",    flags(SUMMARY,   false, false, true),  "ready");
eq("no figures, request in flight → loading",                   flags(undefined, true,  false, false), "loading");
eq("no figures, request paused (offline / hidden tab) → loading", flags(undefined, false, true, false), "loading");
eq("no figures, request failed → error",                        flags(undefined, false, false, true),  "error");
eq("no figures, query disabled (no usable range) → unavailable", flags(undefined, false, false, false), "unavailable");

// The same states produced by the real library rather than modelled by hand:
// a QueryObserver on a mounted QueryClient with the app's retry: 1, driven
// through offline, hidden-tab, failure, Retry, disabled and refresh-failure.
console.log("1b) summary state — real TanStack Query observer");
{
  const { QueryClient, QueryObserver, onlineManager, focusManager } = await import("@tanstack/react-query");
  type Result = { data?: unknown; isFetching: boolean; isPaused: boolean; isError: boolean; status: string };
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const client = new QueryClient({ defaultOptions: { queries: { retry: 1, retryDelay: 5 } } });
  client.mount();

  const observe = (key: string, queryFn: () => Promise<ReportSummary>, enabled = true) => {
    const o = new QueryObserver<ReportSummary>(client, { queryKey: ["summary-test", key], queryFn, enabled });
    const stop = o.subscribe(() => {});
    const now = () => o.getCurrentResult() as unknown as Result & { data?: ReportSummary };
    const state = () => summaryStatus(now());
    return { o, stop, now, state };
  };
  const meta = (s: ReturnType<typeof summaryStatus>, data: ReportSummary | undefined) =>
    summaryExportMeta(s, {
      t: tFor("en"), range: RANGE, merchLabel: "None", placeLabel: "None",
      statusText: "None", lastVisitLabel: "None",
    }, data);

  try {
    // Offline: the request is owed, not failed.
    onlineManager.setOnline(false);
    const off = observe("offline", async () => SUMMARY);
    const pausedResult = off.now();
    eq("offline: the library reports a paused request, not fetching and not an error",
       [pausedResult.status, pausedResult.isPaused, pausedResult.isFetching, pausedResult.isError],
       ["pending", true, false, false]);
    eq("offline: summary state is loading", off.state(), "loading");
    eq("offline: Export waits (no meta) — no 'unavailable' row before a failure",
       meta(off.state(), off.now().data), null);
    onlineManager.setOnline(true);
    await wait(30);
    eq("back online: the paused request resumes and the summary is ready", off.state(), "ready");
    eq("back online: the export carries the figures",
       meta(off.state(), off.now().data), buildExportMeta({
         t: tFor("en"), range: RANGE, merchLabel: "None", placeLabel: "None",
         statusText: "None", lastVisitLabel: "None", summary: SUMMARY,
       }));
    off.stop();

    // Failure, the automatic retry, then the user's Retry.
    let fail = true;
    const f = observe("failure", async () => { if (fail) throw new Error("rpc failed"); return SUMMARY; });
    eq("first attempt in flight → loading", f.state(), "loading");
    await wait(2);
    eq("waiting for the automatic retry → still loading", f.state(), "loading");
    await wait(40);
    eq("both attempts failed → error", f.state(), "error");
    const failedMeta = meta(f.state(), f.now().data);
    eq("after the failure the export carries the period/filters and the 'unavailable' row",
       failedMeta?.rows.slice(5), [{ Metric: "Summary figures", Value: "Unavailable — the period summary could not be loaded" }]);

    fail = false;
    const retry = f.o.refetch();
    const during = f.now();
    eq("Retry: the library resets to pending and clears the error while it runs",
       [during.status, during.isFetching, during.isError], ["pending", true, false]);
    eq("Retry in flight → loading, and Export waits", [f.state(), meta(f.state(), during.data)], ["loading", null]);
    await retry;
    eq("Retry succeeded → ready", f.state(), "ready");
    f.stop();

    // A retry held while the tab is hidden is paused, not failed.
    fail = true;
    focusManager.setFocused(false);
    const h = observe("hidden", async () => { if (fail) throw new Error("rpc failed"); return SUMMARY; });
    await wait(30);
    eq("hidden tab: the retry is paused by the library", [h.now().isPaused, h.now().isError], [true, false]);
    eq("hidden tab: summary state is loading, Export waits", [h.state(), meta(h.state(), h.now().data)], ["loading", null]);
    fail = false;
    focusManager.setFocused(true);
    await wait(30);
    eq("tab visible again: the retry resumes and succeeds → ready", h.state(), "ready");
    h.stop();

    // Disabled: nothing requested.
    const d = observe("disabled", async () => SUMMARY, false);
    eq("disabled query → unavailable (not loading forever)", d.state(), "unavailable");
    d.stop();

    // A background refresh that fails keeps the figures it already had.
    let failLater = false;
    const r = observe("refresh", async () => { if (failLater) throw new Error("rpc failed"); return SUMMARY; });
    await wait(10);
    failLater = true;
    await r.o.refetch();
    await wait(40);
    eq("refresh failed: the library keeps the data and reports the error",
       [r.now().isError, r.now().data === undefined], [true, false]);
    eq("refresh failed: summary state stays ready", r.state(), "ready");
    r.stop();
  } finally {
    // Global singletons — leave them as the rest of the suite expects.
    onlineManager.setOnline(true);
    focusManager.setFocused(undefined);
    client.unmount();
    client.clear();
  }
}

// ── 2) Successful export: identical to the old summary sheet ─────────────────
console.log("2) successful export reproduces the old summary sheet exactly");
for (const locale of LOCALES) {
  const t = tFor(locale);
  const none = t("reports.exp.none");
  const cases: Array<[string, ReportSummary, string, string, string, string]> = [
    // label, summary, merch, place, status, lastVisit
    ["no filters",           SUMMARY,           none,          none,     "",          none],
    ["filtered, no audits",  SUMMARY_NO_AUDITS, "Ahmed Nashed", "فرع ١", "completed", t("reports.filter.lvGt30")],
  ];
  for (const [label, s, merch, place, status, lastVisit] of cases) {
    const statusText = status ? t("visits.status.completed") : none;
    const now = buildExportMeta({
      t, range: RANGE, merchLabel: merch, placeLabel: place,
      statusText, lastVisitLabel: lastVisit, summary: s,
    });
    const then = legacyMeta(t, RANGE, merch, place, status, t("visits.status.completed"), lastVisit, s);
    eq(`[${locale}] ${label}: sheet names, headers, rows, order and values unchanged`, now, then);
  }
}

// The literal Arabic and English sheets, so a change to a label shows up here
// and not only as "both sides moved together".
{
  const ar = buildExportMeta({
    t: tFor("ar"), range: RANGE, merchLabel: "بدون", placeLabel: "بدون",
    statusText: "بدون", lastVisitLabel: "بدون", summary: SUMMARY,
  });
  eq("[ar] sheet names", [ar.sheetName, ar.dataSheet], ["ملخص", "البيانات"]);
  eq("[ar] the exact summary sheet", ar.rows, [
    { "المؤشر": "الفترة",                 "القيمة": "2026-05-01 → 2026-09-19" },
    { "المؤشر": "فلتر الملقوف",            "القيمة": "بدون" },
    { "المؤشر": "فلتر الفرع",              "القيمة": "بدون" },
    { "المؤشر": "فلتر الحالة",             "القيمة": "بدون" },
    { "المؤشر": "فلتر آخر زيارة",          "القيمة": "بدون" },
    { "المؤشر": "إجمالي الزيارات",         "القيمة": 14 },
    { "المؤشر": "مكتملة",                  "القيمة": 13 },
    { "المؤشر": "فائتة",                   "القيمة": 0 },
    { "المؤشر": "قيد الانتظار",            "القيمة": 0 },
    { "المؤشر": "معدل الإنجاز",            "القيمة": "100%" },
    { "المؤشر": "ملقوفون نشطون",           "القيمة": 2 },
    { "المؤشر": "فروع تمت تغطيتها",        "القيمة": "1 / 2" },
    { "المؤشر": "متوسط مدة الزيارة",       "القيمة": "7714 د" },
    { "المؤشر": "منتجات ناقصة على الرف",   "القيمة": 0 },
  ]);

  const en = buildExportMeta({
    t: tFor("en"), range: RANGE, merchLabel: "None", placeLabel: "None",
    statusText: "None", lastVisitLabel: "None", summary: SUMMARY_NO_AUDITS,
  });
  eq("[en] sheet names", [en.sheetName, en.dataSheet], ["Summary", "Data"]);
  eq("[en] the exact summary sheet (no audits, no durations)", en.rows, [
    { Metric: "Period",                 Value: "2026-05-01 → 2026-09-19" },
    { Metric: "Merchandiser filter",    Value: "None" },
    { Metric: "Branch filter",          Value: "None" },
    { Metric: "Status filter",          Value: "None" },
    { Metric: "Last-visit filter",      Value: "None" },
    { Metric: "Total visits",           Value: 14 },
    { Metric: "Completed",              Value: 0 },
    { Metric: "Missed",                 Value: 0 },
    { Metric: "Pending",                Value: 0 },
    { Metric: "Completion rate",        Value: "0%" },
    { Metric: "Active merchandisers",   Value: 2 },
    { Metric: "Branches covered",       Value: "1 / 2" },
    { Metric: "Average visit duration", Value: "—" },
    { Metric: "Products short on shelf", Value: "No audits" },
  ]);
}

// ── 3) Summary unavailable: the sheet stays, and says so ─────────────────────
console.log("3) summary unavailable: period and filters kept, figures marked");
for (const locale of LOCALES) {
  const t = tFor(locale);
  const input = {
    t, range: RANGE, merchLabel: "Ahmed Nashed", placeLabel: "فرع ١",
    statusText: t("visits.status.completed"), lastVisitLabel: t("reports.filter.lvGt30"),
  };
  const ok_ = buildExportMeta({ ...input, summary: SUMMARY });
  const off = buildExportMeta({ ...input, summary: null });

  eq(`[${locale}] same sheet names as a successful export`,
     [off.sheetName, off.dataSheet], [ok_.sheetName, ok_.dataSheet]);
  eq(`[${locale}] the period and all four filters are written exactly as on success`,
     off.rows.slice(0, 5), ok_.rows.slice(0, 5));
  eq(`[${locale}] followed by exactly one explicit "unavailable" row`, off.rows.slice(5), [
    { [t("reports.exp.metric")]: t("reports.exp.summaryFigures"),
      [t("reports.exp.value")]:  t("reports.exp.summaryUnavailable") },
  ]);

  const figureLabels = (["reports.sum.totalVisits", "reports.sum.completed", "reports.sum.missed",
    "reports.sum.pending", "reports.sum.rate", "reports.sum.activeMerch", "reports.sum.coveredBranches",
    "reports.sum.avgDuration", "reports.sum.productIssues"] as TranslationKey[]).map((k) => t(k));
  const metrics = off.rows.map((r) => r[t("reports.exp.metric")]);
  eq(`[${locale}] no figure row is written — nothing that could read as a zero`,
     metrics.filter((m) => figureLabels.includes(String(m))), []);
  ok(`[${locale}] and no figure value is a number`,
     off.rows.every((r) => typeof r[t("reports.exp.value")] !== "number"));

  // What the page actually hands to Export in each summary state.
  eq(`[${locale}] loading (in flight or paused) → no meta, Export waits`,
     summaryExportMeta("loading", input, undefined), null);
  eq(`[${locale}] ready → the full summary sheet`,
     summaryExportMeta("ready", input, SUMMARY), ok_);
  eq(`[${locale}] error → period/filters plus the "unavailable" row`,
     summaryExportMeta("error", input, undefined), off);
  eq(`[${locale}] unavailable (no usable range) → the same explicit row`,
     summaryExportMeta("unavailable", input, undefined), off);
}

// ── 4) The real workbook, both locales, success and unavailable ──────────────
console.log("4) the workbook round-trips through xlsx");
const GPS_ROW: GpsReportRow = {
  merch_id: "m1", full_name: "TEST Merch", total_started: 9, gps_verified: 6,
  gps_outside: 1, gps_not_recorded: 2, no_branch_coords: 1,
  verification_rate: 86, avg_distance: 42,
};

for (const locale of LOCALES) {
  const t = tFor(locale);
  // A GPS export row, so the per-tab export contract (headers, order, values)
  // is carried through the workbook unchanged.
  const dataRows = [gpsExportRow(GPS_ROW, t), gpsExportRow({ ...GPS_ROW, merch_id: "m2", verification_rate: null, avg_distance: null }, t)];
  const base = {
    t, range: RANGE, merchLabel: t("reports.exp.none"), placeLabel: t("reports.exp.none"),
    statusText: t("reports.exp.none"), lastVisitLabel: t("reports.exp.none"),
  };

  for (const [label, summary] of [["success", SUMMARY], ["unavailable", null]] as const) {
    const meta = buildExportMeta({ ...base, summary });
    const wb = roundTrip(meta, dataRows);

    eq(`[${locale}/${label}] two sheets: summary first, then data`,
       wb.names, [t("reports.exp.sheetSummary"), t("reports.exp.sheetData")]);
    eq(`[${locale}/${label}] summary sheet header is Metric, Value`,
       wb.summaryHdr, [t("reports.exp.metric"), t("reports.exp.value")]);
    eq(`[${locale}/${label}] summary sheet holds exactly the built rows`, wb.summary, meta.rows);
    check(`[${locale}/${label}] the period row is present`,
       wb.summary.some((r) => r[t("reports.exp.value")] === "2026-05-01 → 2026-09-19"), wb.summary[0]);
    eq(`[${locale}/${label}] data sheet header order is the tab's column order`,
       wb.dataHdr, Object.keys(dataRows[0]));
    // Including the "" the GPS export writes for an unmeasured rate/distance.
    eq(`[${locale}/${label}] data sheet values unchanged`, wb.data, dataRows);
  }
}

// ── 5) New strings exist in both dictionaries ────────────────────────────────
console.log("5) the new strings are translated");
{
  const keys: TranslationKey[] = [
    "reports.sum.error", "reports.sum.errorExportNote", "reports.sum.retry",
    "reports.exp.summaryFigures", "reports.exp.summaryUnavailable", "reports.exp.waitSummary",
  ];
  const ar = translations.ar as Record<string, string>;
  const en = translations.en as Record<string, string>;
  for (const k of keys) {
    check(`${k} is Arabic in ar`, /[؀-ۿ]/.test(ar[k] ?? ""), ar[k]);
    check(`${k} is English in en`, !!en[k] && !/[؀-ۿ]/.test(en[k]), en[k]);
  }

  // The banner's export note must say the figures failed to load — never words
  // that could be read as "the figures were zero".
  eq("[en] export note says the figures couldn't be loaded", en["reports.sum.errorExportNote"],
     "Excel exports still work and include the period and filters, with a note that the summary figures couldn't be loaded");
  ok("[en] and no longer says 'no summary figures'", !/no summary figures/i.test(en["reports.sum.errorExportNote"]));
  eq("[ar] export note unchanged: figures 'unavailable' (غير متوفرة), not zero", ar["reports.sum.errorExportNote"],
     "يظل تصدير Excel متاحاً، ويتضمن الفترة والفلاتر مع الإشارة إلى أن أرقام الملخص غير متوفرة");
  for (const locale of LOCALES) {
    const note = (translations[locale] as Record<string, string>)["reports.sum.errorExportNote"];
    ok(`[${locale}] export note contains no digit`, !/[0-9٠-٩]/.test(note));
  }
}

// ── 6) Page wiring — source check (the JSX cannot be rendered here) ──────────
console.log("6) page wiring (source check)");
{
  const src = readFileSync(join(process.cwd(), "src", "app", "(dashboard)", "reports", "page.tsx"), "utf8");
  ok("the page no longer has its own workbook writer", !src.includes("exportXlsx("));
  ok("no tab takes an optional meta any more", !src.includes("meta?: ExportMeta"));
  eq("five exports, each through the shared writer",
     (src.match(/await exportReportXlsx\(/g) ?? []).length, 5);
  eq("and each guarded by a meta check first",
     (src.match(/if \(!meta\) return;\s*await exportReportXlsx\(/g) ?? []).length, 5);
  eq("five tabs use the shared Export button", (src.match(/<ExportButton /g) ?? []).length, 5);
  ok("the Export button is disabled while there is no meta", src.includes("disabled={disabled || !meta}"));
  ok("and says why", src.includes('title={!meta ? t("reports.exp.waitSummary") : undefined}'));
  ok("the export meta comes from summaryExportMeta with the page's summary state",
     /summaryExportMeta\(\s*summaryState,/.test(src) && src.includes("const summaryState = summaryStatus(summary);"));
  ok("the cards receive the summary state and a retry",
     src.includes("status={summaryState}") && src.includes("summary.refetch()"));
  ok("an error replaces the cards with the translated message",
     src.includes('status === "error"') && src.includes('t("reports.sum.error")'));
}
