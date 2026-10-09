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
  shouldFocusSummaryAfterRetry,
  staleNoticeParts,
  summaryExportMeta,
  summaryLoadedAt,
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
eq("figures kept after a failed background refresh → stale",    flags(SUMMARY,   false, false, true),  "stale");
eq("figures kept, Retry of the refresh in flight → still stale", flags(SUMMARY,   true,  false, true),  "stale");
eq("figures on hand, refresh paused (not failed) → ready",      flags(SUMMARY,   false, true,  false), "ready");
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
  const meta = (s: ReturnType<typeof summaryStatus>, data: ReportSummary | undefined, dataUpdatedAt = Date.now()) =>
    summaryExportMeta(s, {
      t: tFor("en"), range: RANGE, merchLabel: "None", placeLabel: "None",
      statusText: "None", lastVisitLabel: "None",
    }, data, dataUpdatedAt);

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

    // Success → failed background refresh → Retry (fails) → Retry → recovery.
    // Each load returns a distinct total so "which figures are shown" is visible.
    let mode: "ok" | "fail" = "ok";
    let loads = 0;
    const r = observe("refresh", async () => {
      if (mode === "fail") throw new Error("rpc failed");
      loads++;
      return { ...SUMMARY, total_visits: 100 + loads };
    });
    await wait(10);
    const first = r.now();
    eq("loaded → ready, with the first figures", [r.state(), first.data?.total_visits], ["ready", 101]);
    const loadedAt = (first as unknown as { dataUpdatedAt: number }).dataUpdatedAt;

    mode = "fail";
    const refresh = r.o.refetch();
    eq("background refresh in flight (not failed yet) → still ready", r.state(), "ready");
    await refresh;
    await wait(40);
    const failed = r.now() as Result & { data?: ReportSummary; dataUpdatedAt: number };
    eq("refresh failed: the library keeps the previous figures and reports the error",
       [failed.status, failed.isError, failed.data?.total_visits], ["error", true, 101]);
    eq("refresh failed: dataUpdatedAt still marks the last successful load",
       failed.dataUpdatedAt, loadedAt);
    eq("refresh failed → stale (figures kept, never zeroed)", r.state(), "stale");

    const staleMeta = summaryExportMeta(r.state(), {
      t: tFor("en"), range: RANGE, merchLabel: "None", placeLabel: "None",
      statusText: "None", lastVisitLabel: "None",
    }, failed.data, failed.dataUpdatedAt);
    eq("stale: the export carries the previous figures, not 'unavailable' and not zeros",
       staleMeta?.rows.find((x) => x.Metric === "Total visits")?.Value, 101);
    eq("stale: and says when they were last loaded",
       staleMeta?.rows[5], { Metric: "Summary status",
         Value: `Not refreshed — figures from the last successful load at ${summaryLoadedAt(loadedAt)} (Riyadh time)` });

    const retry1 = r.o.refetch();
    const retrying = r.now();
    eq("Retry in flight with figures on hand: the library stays isError while fetching",
       [retrying.status, retrying.isError, retrying.isFetching], ["error", true, true]);
    eq("Retry in flight → still stale (the figures are still the old ones)", r.state(), "stale");
    await retry1;
    await wait(40);
    eq("Retry failed → stale, same figures", [r.state(), r.now().data?.total_visits], ["stale", 101]);

    mode = "ok";
    await r.o.refetch();
    const recovered = r.now() as Result & { data?: ReportSummary; dataUpdatedAt: number };
    eq("Retry succeeded → ready with the new figures", [r.state(), recovered.data?.total_visits], ["ready", 102]);
    ok("recovered: dataUpdatedAt moved forward", recovered.dataUpdatedAt > loadedAt);
    const freshMeta = summaryExportMeta(r.state(), {
      t: tFor("en"), range: RANGE, merchLabel: "None", placeLabel: "None",
      statusText: "None", lastVisitLabel: "None",
    }, recovered.data, recovered.dataUpdatedAt);
    ok("recovered: the export no longer carries the 'not refreshed' note",
       !freshMeta?.rows.some((x) => x.Metric === "Summary status"));
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
     summaryExportMeta("loading", input, undefined, Date.UTC(2026, 8, 29, 22, 1)), null);
  eq(`[${locale}] ready → the full summary sheet`,
     summaryExportMeta("ready", input, SUMMARY, Date.UTC(2026, 8, 29, 22, 1)), ok_);
  eq(`[${locale}] error → period/filters plus the "unavailable" row`,
     summaryExportMeta("error", input, undefined, Date.UTC(2026, 8, 29, 22, 1)), off);
  eq(`[${locale}] unavailable (no usable range) → the same explicit row`,
     summaryExportMeta("unavailable", input, undefined, Date.UTC(2026, 8, 29, 22, 1)), off);
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

// ── 7) Stale summary: previous figures kept, labelled, and exported with a note ──
console.log("7) stale summary (a refresh failed after a successful load)");
{
  // Riyadh clock (UTC+3), not the machine's: 22:01 UTC on the 29th is 01:01
  // on the 30th in Riyadh.
  eq("load time is the Riyadh date and clock",
     summaryLoadedAt(Date.UTC(2026, 8, 29, 22, 1, 7)), "2026-09-30 01:01");
  eq("load time before Riyadh midnight stays on the same day",
     summaryLoadedAt(Date.UTC(2026, 8, 29, 20, 59, 59)), "2026-09-29 23:59");

  const LOADED = Date.UTC(2026, 8, 29, 22, 1, 7);
  for (const locale of LOCALES) {
    const t = tFor(locale);
    const input = {
      t, range: RANGE, merchLabel: "Ahmed Nashed", placeLabel: "فرع ١",
      statusText: t("visits.status.completed"), lastVisitLabel: t("reports.filter.lvGt30"),
    };
    const fresh = summaryExportMeta("ready", input, SUMMARY, LOADED)!;
    const stale = summaryExportMeta("stale", input, SUMMARY, LOADED)!;
    const note = { [t("reports.exp.metric")]: t("reports.exp.summaryStatus"),
                   [t("reports.exp.value")]:  t("reports.exp.summaryStale", { time: "2026-09-30 01:01" }) };

    eq(`[${locale}] a fresh export is unchanged: no status row, exactly the old sheet`,
       fresh, buildExportMeta({ ...input, summary: SUMMARY }));
    eq(`[${locale}] stale: same sheet names`, [stale.sheetName, stale.dataSheet], [fresh.sheetName, fresh.dataSheet]);
    eq(`[${locale}] stale: period and filters exactly as on a fresh export`, stale.rows.slice(0, 5), fresh.rows.slice(0, 5));
    eq(`[${locale}] stale: then one "not refreshed" row with the Riyadh load time`, stale.rows[5], note);
    eq(`[${locale}] stale: then the previous figures, unchanged — never zeros or "unavailable"`,
       stale.rows.slice(6), fresh.rows.slice(5));
    eq(`[${locale}] stale: exactly one extra row`, stale.rows.length, fresh.rows.length + 1);
    ok(`[${locale}] the note names the time in both the value and the key's template`,
       String(stale.rows[5][t("reports.exp.value")]).includes("2026-09-30 01:01"));

    // Not "stale" unless there really are figures: without them it is the
    // ordinary failure sheet.
    eq(`[${locale}] "stale" without figures falls back to the unavailable sheet`,
       summaryExportMeta("stale", input, undefined, LOADED), buildExportMeta({ ...input, summary: null }));
    eq(`[${locale}] error and loading are unchanged`,
       [summaryExportMeta("error", input, undefined, LOADED), summaryExportMeta("loading", input, SUMMARY, LOADED)],
       [buildExportMeta({ ...input, summary: null }), null]);

    // The real workbook.
    const dataRows = [gpsExportRow(GPS_ROW, t)];
    const wb = roundTrip(stale, dataRows);
    eq(`[${locale}/stale xlsx] two sheets: summary first, then data`,
       wb.names, [t("reports.exp.sheetSummary"), t("reports.exp.sheetData")]);
    eq(`[${locale}/stale xlsx] summary sheet header is Metric, Value`,
       wb.summaryHdr, [t("reports.exp.metric"), t("reports.exp.value")]);
    eq(`[${locale}/stale xlsx] summary sheet holds exactly the stale rows`, wb.summary, stale.rows);
    eq(`[${locale}/stale xlsx] the note is the row after the filters`, wb.summary[5], note);
    eq(`[${locale}/stale xlsx] previous figures are still numbers`,
       wb.summary.slice(6).map((r) => typeof r[t("reports.exp.value")]),
       fresh.rows.slice(5).map((r) => typeof r[t("reports.exp.value")]));
    eq(`[${locale}/stale xlsx] data sheet unchanged`, wb.data, dataRows);
  }

  // Strings.
  const ar = translations.ar as Record<string, string>;
  const en = translations.en as Record<string, string>;
  for (const k of ["reports.sum.stale", "reports.sum.staleExportNote", "reports.sum.retrying",
                   "reports.exp.summaryStatus", "reports.exp.summaryStale"]) {
    check(`${k} is Arabic in ar`, /[\u0600-\u06FF]/.test(ar[k] ?? ""), ar[k]);
    check(`${k} is English in en`, !!en[k] && !/[\u0600-\u06FF]/.test(en[k]), en[k]);
  }
  for (const k of ["reports.sum.stale", "reports.exp.summaryStale"]) {
    ok(`${k} carries {time} in both languages`, ar[k].includes("{time}") && en[k].includes("{time}"));
    ok(`${k} says Riyadh time in both languages`, ar[k].includes("الرياض") && /Riyadh/.test(en[k]));
  }

  // Page wiring — source check (the JSX cannot be rendered here).
  const src = readFileSync(join(process.cwd(), "src", "app", "(dashboard)", "reports", "page.tsx"), "utf8");
  ok("the stale notice renders only in the stale state, above the kept cards",
     src.includes('{status === "stale" && (') && src.includes("const staleNotice = staleNoticeParts(t, loadedAt);"));
  ok("its Retry shows progress and cannot fire twice (aria-disabled + click guard)",
     src.includes("aria-disabled={isRefreshing}") && src.includes("if (!isRefreshing) { retryRequested.current = true; onRetry(); }") &&
     src.includes('isRefreshing ? t("reports.sum.retrying") : t("reports.sum.retry")'));
  ok("the cards get the refresh flag and the Riyadh load time",
     src.includes("isRefreshing={summary.isFetching}") && src.includes("loadedAt={summaryLoadedAt(summary.dataUpdatedAt)}"));
  ok("the export gets the load time too",
     /summaryExportMeta\([\s\S]*?summary\.data,\s*summary\.dataUpdatedAt,\s*\)/.test(src));
}

// ── 8) Review follow-ups: no 1970 stamp, no stale flash, paused Retry, a11y ──
console.log("8) missing load time, retry transitions, notice accessibility");
{
  // A missing or zero load time must never print as a date.
  for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, undefined, null]) {
    eq(`load time ${String(bad)} → null, not a 1970 date`, summaryLoadedAt(bad as number | null | undefined), null);
  }
  eq("a real load time still formats on the Riyadh clock",
     summaryLoadedAt(Date.UTC(2026, 8, 29, 22, 1, 7)), "2026-09-30 01:01");

  for (const locale of LOCALES) {
    const t = tFor(locale);
    const input = {
      t, range: RANGE, merchLabel: t("reports.exp.none"), placeLabel: t("reports.exp.none"),
      statusText: t("reports.exp.none"), lastVisitLabel: t("reports.exp.none"),
    };
    const fresh = summaryExportMeta("ready", input, SUMMARY, Date.UTC(2026, 8, 29, 22, 1));
    for (const missing of [0, undefined, null]) {
      const stale = summaryExportMeta("stale", input, SUMMARY, missing)!;
      eq(`[${locale}] stale, load time ${String(missing)}: the note stays, without a time`, stale.rows[5], {
        [t("reports.exp.metric")]: t("reports.exp.summaryStatus"),
        [t("reports.exp.value")]:  t("reports.sum.staleNoTime"),
      });
      ok(`[${locale}] stale, load time ${String(missing)}: no 1970 anywhere in the sheet`,
         !JSON.stringify(stale.rows).includes("1970"));
      eq(`[${locale}] stale, load time ${String(missing)}: period, filters and figures unchanged`,
         [stale.rows.slice(0, 5), stale.rows.slice(6)], [fresh!.rows.slice(0, 5), fresh!.rows.slice(5)]);
    }
    const wb = roundTrip(summaryExportMeta("stale", input, SUMMARY, 0)!, [gpsExportRow(GPS_ROW, t)]);
    eq(`[${locale}/xlsx] stale without a time: the no-time note is the row after the filters`,
       wb.summary[5][t("reports.exp.value")], t("reports.sum.staleNoTime"));
  }
  {
    const ar = translations.ar as Record<string, string>;
    const en = translations.en as Record<string, string>;
    check("reports.sum.staleNoTime is Arabic in ar", /[؀-ۿ]/.test(ar["reports.sum.staleNoTime"] ?? ""));
    check("reports.sum.staleNoTime is English in en",
          !!en["reports.sum.staleNoTime"] && !/[؀-ۿ]/.test(en["reports.sum.staleNoTime"]));
    ok("the no-time note carries no placeholder and no digit",
       !/[{}0-9٠-٩]/.test(ar["reports.sum.staleNoTime"] + en["reports.sum.staleNoTime"]));
  }

  // The installed TanStack Query, driven through the two transitions the review named.
  const { QueryClient, QueryObserver, onlineManager } = await import("@tanstack/react-query");
  type Obs = { status: string; isFetching: boolean; isPaused: boolean; isError: boolean;
               data?: ReportSummary; dataUpdatedAt: number };
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const client = new QueryClient({ defaultOptions: { queries: { retry: 1, retryDelay: 5 } } });
  client.mount();
  const input = {
    t: tFor("en"), range: RANGE, merchLabel: "None", placeLabel: "None",
    statusText: "None", lastVisitLabel: "None",
  };
  try {
    // (a) A refresh fails once, then the AUTOMATIC retry succeeds: every state
    //     the observer publishes must be ready — no stale flash, no skeleton.
    let failNext = false, loads = 0;
    const a = new QueryObserver<ReportSummary>(client, {
      queryKey: ["summary-review", "retry-ok"],
      queryFn: async () => {
        if (failNext) { failNext = false; throw new Error("transient"); }
        loads++;
        return { ...SUMMARY, total_visits: 200 + loads };
      },
    });
    const seen: string[] = [];
    const stopA = a.subscribe((res) => { seen.push(summaryStatus(res as unknown as Obs)); });
    await wait(10);
    const before = a.getCurrentResult() as unknown as Obs;
    eq("(a) first load → ready with the first figures", [summaryStatus(before), before.data?.total_visits], ["ready", 201]);
    seen.length = 0;
    failNext = true;
    await a.refetch();
    await wait(30);
    const after = a.getCurrentResult() as unknown as Obs;
    ok("(a) the refresh really failed once before succeeding", loads === 2 && !failNext);
    ok("(a) the observer published intermediate states", seen.length > 0);
    eq("(a) every published state during the refresh was ready — never stale, loading or error",
       [...new Set(seen)], ["ready"]);
    eq("(a) ends ready with the new figures and a later load time",
       [summaryStatus(after), after.data?.total_visits, after.dataUpdatedAt > before.dataUpdatedAt],
       ["ready", 202, true]);
    ok("(a) and its export carries no 'not refreshed' note",
       !summaryExportMeta("ready", input, after.data, after.dataUpdatedAt)!.rows.some((r) => r.Metric === "Summary status"));
    stopA();

    // (b) Stale, then the Retry is paused offline: still stale (figures kept,
    //     not a skeleton, not zeros), exports the note with the ORIGINAL load
    //     time, and recovers once back online.
    let mode: "ok" | "fail" = "ok";
    let n = 0;
    const b = new QueryObserver<ReportSummary>(client, {
      queryKey: ["summary-review", "paused-retry"],
      queryFn: async () => {
        if (mode === "fail") throw new Error("rpc failed");
        n++;
        return { ...SUMMARY, total_visits: 300 + n };
      },
    });
    const stopB = b.subscribe(() => {});
    await wait(10);
    const loaded = (b.getCurrentResult() as unknown as Obs).dataUpdatedAt;
    mode = "fail";
    await b.refetch();
    await wait(30);
    eq("(b) refresh failed → stale", summaryStatus(b.getCurrentResult() as unknown as Obs), "stale");

    onlineManager.setOnline(false);
    mode = "ok";
    const pausedRetry = b.refetch();
    const paused = b.getCurrentResult() as unknown as Obs;
    eq("(b) Retry offline: the library pauses it and keeps the error and the figures",
       [paused.isPaused, paused.isFetching, paused.isError, paused.data?.total_visits], [true, false, true, 301]);
    eq("(b) Retry offline → still stale (not loading, not ready)", summaryStatus(paused), "stale");
    const pausedMeta = summaryExportMeta(summaryStatus(paused), input, paused.data, paused.dataUpdatedAt)!;
    eq("(b) Retry offline: export keeps the note with the ORIGINAL load time",
       pausedMeta.rows[5].Value,
       `Not refreshed — figures from the last successful load at ${summaryLoadedAt(loaded)} (Riyadh time)`);
    eq("(b) Retry offline: and the previous figures, not zeros",
       pausedMeta.rows.find((r) => r.Metric === "Total visits")?.Value, 301);

    onlineManager.setOnline(true);
    await pausedRetry;
    const back = b.getCurrentResult() as unknown as Obs;
    eq("(b) back online: the paused Retry resumes and succeeds → ready with new figures",
       [summaryStatus(back), back.data?.total_visits, back.dataUpdatedAt > loaded], ["ready", 302, true]);
    stopB();
  } finally {
    onlineManager.setOnline(true);
    client.unmount();
    client.clear();
  }

  // Notice accessibility — source check (the JSX cannot be rendered here).
  const src = readFileSync(join(process.cwd(), "src", "app", "(dashboard)", "reports", "page.tsx"), "utf8");
  const start = src.indexOf('{status === "stale" && (');
  const notice = src.slice(start, src.indexOf("      )}", start));
  // Tag-level: which element carries the role matters, not just where it is.
  const outerTag = notice.slice(notice.indexOf("<div"), notice.indexOf(">", notice.indexOf("<div")) + 1);
  const liveTagStart = notice.lastIndexOf("<div", notice.indexOf('role="status"'));
  const liveTag = notice.slice(liveTagStart, notice.indexOf(">", liveTagStart) + 1);
  const live = notice.slice(liveTagStart, notice.indexOf("</div>", liveTagStart));
  ok("the notice container itself is not a live region", !/role=|aria-live/.test(outerTag));
  ok("the live region is the message column", liveTag.includes("flex-1 min-w-0") && liveTag.includes('role="status"'));
  ok("the live region holds the message", live.includes("reports.sum.staleExportNote"));
  ok("the Retry button comes after the live region, outside it",
     notice.indexOf("<button") > notice.indexOf("</div>", liveTagStart) && !live.includes("<button"));
  ok("the notice has exactly one live region", (notice.match(/role="status"|aria-live/g) ?? []).length === 1);
  ok("Retry keeps focus while retrying: aria-disabled, not disabled",
     notice.includes("aria-disabled={isRefreshing}") && !/\sdisabled=\{/.test(notice));
  ok("no aria-busy on the button", !notice.includes("aria-busy"));
  ok("decorative icons are hidden from screen readers",
     (notice.match(/aria-hidden="true"/g) ?? []).length === 2);
  ok("Retry is a plain button (keyboard: Enter/Space)", notice.includes('type="button"'));
}

// ── 9) Browser follow-ups: date order, focus after Retry, phone layout ───────
console.log("9) isolated load time, focus after a successful Retry, stacked phone layout");
{
  const TIME = "2026-10-09 14:57";

  // (1) The sentence is only split, never reworded: the three parts concatenate
  //     to exactly the translated sentence, and the time is the shared value.
  for (const locale of LOCALES) {
    const t = tFor(locale);
    const parts = staleNoticeParts(t, TIME);
    eq(`[${locale}] before + time + after is exactly the translated sentence`,
       parts.before + parts.time + parts.after, t("reports.sum.stale", { time: TIME }));
    eq(`[${locale}] the time part is the shared value, in YYYY-MM-DD HH:mm order`, parts.time, TIME);
    ok(`[${locale}] the time part matches YYYY-MM-DD HH:mm`, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(parts.time ?? ""));
    ok(`[${locale}] the time is not repeated in the surrounding text`,
       !parts.before.includes(TIME) && !parts.after.includes(TIME));
    ok(`[${locale}] no placeholder leaks into the rendered text`,
       !(parts.before + parts.after).includes("{time}"));
    ok(`[${locale}] no bidi control characters are added to the text`,
       !/[‎‏‪-‮⁦-⁩]/.test(parts.before + parts.time + parts.after));

    eq(`[${locale}] no load time → the no-time sentence, and no time element`,
       staleNoticeParts(t, null), { before: t("reports.sum.staleNoTime"), time: null, after: "" });

    // The Excel text is a plain string and is not touched by the on-screen split.
    const stale = summaryExportMeta("stale", {
      t, range: RANGE, merchLabel: t("reports.exp.none"), placeLabel: t("reports.exp.none"),
      statusText: t("reports.exp.none"), lastVisitLabel: t("reports.exp.none"),
    }, SUMMARY, Date.UTC(2026, 8, 29, 22, 1, 7))!;
    eq(`[${locale}] the Excel note is unchanged: the plain translated string`,
       stale.rows[5][t("reports.exp.value")], t("reports.exp.summaryStale", { time: "2026-09-30 01:01" }));
    ok(`[${locale}] the Excel note carries no markup or bidi controls`,
       !/[<>‎‏‪-‮⁦-⁩]/.test(String(stale.rows[5][t("reports.exp.value")])));
  }
  {
    const ar = staleNoticeParts(tFor("ar"), TIME);
    ok("[ar] the time sits inside the Arabic parentheses, followed by 'Riyadh time'",
       ar.before.endsWith("(") && ar.after.startsWith(" بتوقيت الرياض"));
    const en = staleNoticeParts(tFor("en"), TIME);
    ok("[en] the time follows 'last loaded at' and precedes '(Riyadh time)'",
       en.before.endsWith("last loaded at ") && en.after === " (Riyadh time)");
    // A translation that lost its placeholder still shows the whole sentence.
    const noPlaceholder = ((key: TranslationKey) =>
      key === "reports.sum.stale" ? "Figures were not refreshed" : key) as TranslationFn;
    eq("a sentence without {time} is shown whole, never dropped",
       staleNoticeParts(noPlaceholder, TIME), { before: "Figures were not refreshed", time: null, after: "" });
  }

  // (2) When focus may move to the summary title.
  const f = (previous: string, current: string, retryRequested: boolean, focusWasLost: boolean) =>
    shouldFocusSummaryAfterRetry({ previous, current, retryRequested, focusWasLost } as Parameters<typeof shouldFocusSummaryAfterRetry>[0]);
  eq("user's Retry succeeded and focus fell to <body> → move focus", f("stale", "ready", true, true), true);
  eq("Retry pending (still stale) → focus stays on the button", f("stale", "stale", true, false), false);
  eq("Retry failed (still stale) → focus stays on the button", f("stale", "stale", true, true), false);
  eq("recovered by an automatic refresh the user did not ask for → leave focus alone", f("stale", "ready", false, true), false);
  eq("Retry succeeded but the user already moved focus elsewhere → do not steal it", f("stale", "ready", true, false), false);
  eq("ordinary first load → never moves focus", f("loading", "ready", false, true), false);
  eq("first load after an initial error's Retry → not this path", f("loading", "ready", true, true), false);
  eq("going stale → never moves focus", f("ready", "stale", false, true), false);
  eq("staying ready → never moves focus", f("ready", "ready", true, true), false);

  // (3) Markup — source check (the JSX cannot be rendered here; the rendered
  //     result is verified separately in the browser).
  const src = readFileSync(join(process.cwd(), "src", "app", "(dashboard)", "reports", "page.tsx"), "utf8");
  const start = src.indexOf('{status === "stale" && (');
  const notice = src.slice(start, src.indexOf("      )}", start));
  ok("the load time renders in a direction-isolated LTR element",
     /<bdi dir="ltr"[^>]*>\{staleNotice\.time\}<\/bdi>/.test(notice));
  ok("the sentence is rendered as before / time / after",
     notice.indexOf("{staleNotice.before}") < notice.indexOf("<bdi") && notice.indexOf("<bdi") < notice.indexOf("{staleNotice.after}"));
  ok("the time is no longer substituted into the sentence by t()",
     !src.includes('t("reports.sum.stale", { time: loadedAt })'));
  ok("the isolated time is still inside the live region",
     notice.indexOf('role="status"') < notice.indexOf("<bdi") && notice.indexOf("<bdi") < notice.indexOf("<button"));

  const outerTag = notice.slice(notice.indexOf("<div"), notice.indexOf(">", notice.indexOf("<div")) + 1);
  ok("phones: the notice stacks (column), one row from sm up",
     outerTag.includes("flex-col") && outerTag.includes("sm:flex-row") && outerTag.includes("sm:items-center"));
  // The opening tag: everything from <button up to its first child.
  const buttonTag = notice.slice(notice.indexOf("<button"), notice.indexOf("<RotateCcw", notice.indexOf("<button")));
  ok("phones: Retry sits under the message, aligned with the text; unchanged from sm up",
     buttonTag.includes("self-start") && buttonTag.includes("ms-7") && buttonTag.includes("sm:ms-0") && buttonTag.includes("sm:self-auto"));

  const titleStart = src.lastIndexOf("<p", src.indexOf("ref={titleRef}"));
  const titleTag = src.slice(titleStart, src.indexOf(">", src.indexOf("ref={titleRef}")) + 1);
  ok("the summary title can take programmatic focus but is not a Tab stop",
     titleTag.includes("ref={titleRef}") && titleTag.includes("tabIndex={-1}"));
  ok("the title shows a focus indicator for keyboard users", titleTag.includes("focus-visible:ring-2"));
  ok("focus is moved only through the tested decision, without scrolling the page",
     src.includes("shouldFocusSummaryAfterRetry({") && src.includes("titleRef.current?.focus({ preventScroll: true })"));
  ok("only the user's own Retry arms the focus hand-off",
     (src.match(/retryRequested\.current = true/g) ?? []).length === 1 && buttonTag.length > 0 &&
     notice.includes("retryRequested.current = true; onRetry();"));
  ok("a failed retry disarms it", src.includes('if (!isRefreshing && status === "stale") retryRequested.current = false;'));
}
