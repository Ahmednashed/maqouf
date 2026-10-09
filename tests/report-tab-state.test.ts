// Reports tabs — what a tab may show, and when it may export.
//
// A tab must never show or export rows whose completeness or currency is in
// doubt: a read cut by the row cap, a read whose count could not be confirmed,
// a failed load, or a failed REFRESH (TanStack Query keeps the earlier rows —
// they must not be presented as current).
//
// The state logic is pure and is exercised directly, then against a real
// TanStack Query observer so the flag combinations are the library's own. The
// tab components themselves cannot be rendered here (no DOM in the runner), so
// their wiring gets a short, clearly labelled source check at the end.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { check, eq, ok } from "./_harness.ts";
import {
  ReportIncompleteError,
  assertReportComplete,
  canExportReport,
  emptyNoticeMemory,
  reportNotice,
  reportTabMessage,
  reportTabState,
  requestReportRetry,
  settleReportNotice,
  type ReportTabState,
} from "@/lib/report-completeness";
import { translations } from "@/lib/i18n/translations";
import type { TranslationFn } from "@/hooks/use-translation";

type Row = { id: number };
const ROWS: Row[] = [{ id: 1 }, { id: 2 }];
const LOCALES = ["ar", "en"] as const;

function tFor(locale: "ar" | "en"): TranslationFn {
  const dict = translations[locale] as Record<string, string>;
  const fallback = translations.ar as Record<string, string>;
  return (key, vars) => {
    let str = dict[key] ?? fallback[key] ?? key;
    if (vars) for (const [k, v] of Object.entries(vars)) str = str.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
    return str;
  };
}

const truncated  = new ReportIncompleteError("merch", "truncated", 1000, 1500);
const unverified = new ReportIncompleteError("gps", "unverified", 4, null);
const failure    = { code: "500", message: "boom" };

const st = (data: Row[] | undefined, isFetching: boolean, isPaused: boolean, isError: boolean, error: unknown = null) =>
  reportTabState<Row>({ data, isFetching, isPaused, isError, error });

// ── 1) The completeness check itself ─────────────────────────────────────────
console.log("1) assertReportComplete");
{
  const thrown = (rows: unknown[], count: number | null | undefined) => {
    try { assertReportComplete("visits", rows, count); return null; } catch (e) { return e as ReportIncompleteError; }
  };
  eq("count equals rows → complete", thrown(ROWS, 2), null);
  eq("no rows and a zero count → complete", thrown([], 0), null);
  eq("count above rows → truncated, with both figures",
     [thrown(ROWS, 9)?.reason, thrown(ROWS, 9)?.loaded, thrown(ROWS, 9)?.total], ["truncated", 2, 9]);
  for (const [label, c] of [["undefined", undefined], ["null", null], ["NaN", Number.NaN], ["Infinity", Number.POSITIVE_INFINITY],
                            ["negative", -1], ["fractional", 2.5], ["below the row count", 1]] as const) {
    eq(`count ${label} → unverified`, thrown(ROWS, c as number | null | undefined)?.reason, "unverified");
  }
  ok("the error is a real Error, identifiable by class and name",
     truncated instanceof Error && truncated instanceof ReportIncompleteError && truncated.name === "ReportIncompleteError");
  ok("its message states both figures, for logs", truncated.message.includes("1000") && truncated.message.includes("1500"));
}

// ── 2) Tab state ─────────────────────────────────────────────────────────────
console.log("2) reportTabState");
eq("complete rows, no error → ready with the rows",              st(ROWS, false, false, false), { kind: "ready", rows: ROWS });
eq("complete rows while a refresh runs → still ready",           st(ROWS, true, false, false),  { kind: "ready", rows: ROWS });
eq("complete rows, refresh paused offline (not failed) → ready", st(ROWS, false, true, false),  { kind: "ready", rows: ROWS });
eq("an empty complete result → ready, no rows",                  st([], false, false, false),   { kind: "ready", rows: [] });
eq("no rows yet, request in flight → loading",                   st(undefined, true, false, false),  { kind: "loading", rows: [] });
eq("no rows yet, request paused offline → loading, not 'no data'", st(undefined, false, true, false), { kind: "loading", rows: [] });
eq("nothing requested (no usable range) → an ordinary empty table", st(undefined, false, false, false), { kind: "ready", rows: [] });

eq("initial load truncated → truncated with both figures, no rows",
   st(undefined, false, false, true, truncated), { kind: "truncated", rows: [], loaded: 1000, total: 1500 });
eq("initial load uncountable → unverified, no rows",
   st(undefined, false, false, true, unverified), { kind: "unverified", rows: [] });
eq("initial load failed → error, no earlier rows",
   st(undefined, false, false, true, failure), { kind: "error", rows: [], hadRows: false });

// The failed-refresh cases: earlier rows exist and are withheld.
eq("refresh failed with rows cached → error, rows WITHHELD",
   st(ROWS, false, false, true, failure), { kind: "error", rows: [], hadRows: true });
eq("refresh found the range now over the cap → truncated, cached rows withheld",
   st(ROWS, false, false, true, truncated), { kind: "truncated", rows: [], loaded: 1000, total: 1500 });
eq("refresh could not be counted → unverified, cached rows withheld",
   st(ROWS, false, false, true, unverified), { kind: "unverified", rows: [] });
eq("a Retry in flight after a failed refresh stays in the error state (no stale rows flash)",
   st(ROWS, true, false, true, failure), { kind: "error", rows: [], hadRows: true });

for (const s of [st(undefined, true, false, false), st(undefined, false, false, true, truncated), st(undefined, false, false, true, unverified),
                 st(undefined, false, false, true, failure), st(ROWS, false, false, true, failure), st(ROWS, false, false, true, truncated)]) {
  eq(`state ${s.kind}: carries no rows at all`, s.rows, []);
}

// ── 3) Export ────────────────────────────────────────────────────────────────
console.log("3) canExportReport");
eq("ready with rows → export allowed",            canExportReport(st(ROWS, false, false, false)), true);
eq("ready but empty → nothing to export",         canExportReport(st([], false, false, false)), false);
eq("loading → no export",                         canExportReport(st(undefined, true, false, false)), false);
eq("paused offline → no export",                  canExportReport(st(undefined, false, true, false)), false);
eq("truncated → no export",                       canExportReport(st(undefined, false, false, true, truncated)), false);
eq("unverified → no export",                      canExportReport(st(undefined, false, false, true, unverified)), false);
eq("failed load → no export",                     canExportReport(st(undefined, false, false, true, failure)), false);
eq("failed refresh with rows cached → no export", canExportReport(st(ROWS, false, false, true, failure)), false);
eq("truncated refresh with rows cached → no export", canExportReport(st(ROWS, false, false, true, truncated)), false);

// ── 4) Messages, both languages ──────────────────────────────────────────────
console.log("4) reportTabMessage");
for (const locale of LOCALES) {
  const t = tFor(locale);
  const dict = translations[locale] as Record<string, string>;
  eq(`[${locale}] loading has no message`, reportTabMessage(st(undefined, true, false, false), t), null);
  eq(`[${locale}] ready has no message`,   reportTabMessage(st(ROWS, false, false, false), t), null);

  const tr = reportTabMessage(st(undefined, false, false, true, truncated), t)!;
  ok(`[${locale}] truncated: states the total and the loaded count`, tr.title.includes("1500") && tr.title.includes("1000"));
  ok(`[${locale}] truncated: no placeholder left unfilled`, !/[{}]/.test(tr.title + tr.detail));
  eq(`[${locale}] truncated: tells the user what to do and that export is off`, tr.detail, dict["reports.data.narrow"]);

  const un = reportTabMessage(st(undefined, false, false, true, unverified), t)!;
  eq(`[${locale}] unverified: says completeness could not be confirmed`, un.title, dict["reports.data.unverified"]);
  ok(`[${locale}] unverified: shows no figure that could be read as a total`, !/[0-9٠-٩]/.test(un.title));

  const first = reportTabMessage(st(undefined, false, false, true, failure), t)!;
  const again = reportTabMessage(st(ROWS, false, false, true, failure), t)!;
  eq(`[${locale}] failed load: the load message`, first.title, dict["reports.data.loadError"]);
  eq(`[${locale}] failed refresh: says the earlier rows are no longer shown`, again.title, dict["reports.data.refreshError"]);
  ok(`[${locale}] the two failure messages differ`, first.title !== again.title);
  eq(`[${locale}] both say export is unavailable`, [first.detail, again.detail], [dict["reports.data.noExport"], dict["reports.data.noExport"]]);
  ok(`[${locale}] the raw database error is never shown to the user`,
     ![tr, un, first, again].some((m) => (m.title + m.detail).includes("boom")));
}
{
  const ar = translations.ar as Record<string, string>;
  const en = translations.en as Record<string, string>;
  for (const k of ["reports.data.truncated", "reports.data.unverified", "reports.data.narrow",
                   "reports.data.loadError", "reports.data.refreshError", "reports.data.noExport"]) {
    check(`${k} is Arabic in ar`, /[؀-ۿ]/.test(ar[k] ?? ""), ar[k]);
    check(`${k} is English in en`, !!en[k] && !/[؀-ۿ]/.test(en[k]), en[k]);
  }
  ok("the truncation sentence carries {total} and {loaded} in both languages",
     ["{total}", "{loaded}"].every((p) => ar["reports.data.truncated"].includes(p) && en["reports.data.truncated"].includes(p)));
  // Counts in parentheses, not attached to a noun: no plural forms needed, so
  // these must not be counted labels in the plural ratchet's sense.
  ok("no new string uses the {n}/{count} counted-label tokens",
     !/\{n\}|\{count\}/.test(Object.keys(ar).filter((k) => k.startsWith("reports.data.")).map((k) => ar[k] + en[k]).join(" ")));
}

// ── 5) The same states from a real TanStack Query observer ───────────────────
console.log("5) real TanStack Query observer");
{
  const { QueryClient, QueryObserver } = await import("@tanstack/react-query");
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const client = new QueryClient({ defaultOptions: { queries: { retry: 1, retryDelay: 5 } } });
  client.mount();
  const state = (o: { getCurrentResult(): unknown }) =>
    reportTabState<Row>(o.getCurrentResult() as Parameters<typeof reportTabState<Row>>[0]);
  try {
    // (a) The very first load is over the cap.
    const a = new QueryObserver<Row[]>(client, { queryKey: ["tab", "over-cap"], queryFn: async () => { throw truncated; } });
    const stopA = a.subscribe(() => {});
    eq("(a) first load in flight → loading", state(a).kind, "loading");
    await wait(40);
    eq("(a) over the cap → truncated, no rows, no export",
       [state(a), canExportReport(state(a))], [{ kind: "truncated", rows: [], loaded: 1000, total: 1500 }, false]);
    stopA();

    // (b) Loaded fine, then a refresh fails; Retry; recovery.
    let mode: "ok" | "fail" | "truncated" = "ok";
    let n = 0;
    const b = new QueryObserver<Row[]>(client, {
      queryKey: ["tab", "refresh"],
      queryFn: async () => {
        if (mode === "fail") throw new Error("network");
        if (mode === "truncated") throw truncated;
        n++;
        return [{ id: n }];
      },
    });
    const seen: string[] = [];
    const stopB = b.subscribe((r) => { seen.push(reportTabState<Row>(r as Parameters<typeof reportTabState<Row>>[0]).kind); });
    await wait(15);
    eq("(b) loaded → ready with rows, export allowed", [state(b), canExportReport(state(b))], [{ kind: "ready", rows: [{ id: 1 }] }, true]);

    mode = "fail";
    seen.length = 0;
    const refresh = b.refetch();
    eq("(b) refresh in flight, not failed yet → still ready", state(b).kind, "ready");
    await refresh; await wait(40);
    const raw = b.getCurrentResult();
    ok("(b) refresh failed: the library still holds the earlier rows", raw.isError && Array.isArray(raw.data) && raw.data.length === 1);
    seen.length = 0; // from here until the successful Retry, nothing may be shown
    eq("(b) …but the tab withholds them and blocks export",
       [state(b), canExportReport(state(b))], [{ kind: "error", rows: [], hadRows: true }, false]);

    const retry = b.refetch();
    eq("(b) Retry in flight → still withheld, never a flash of the old rows", state(b), { kind: "error", rows: [], hadRows: true });
    await retry; await wait(40);
    eq("(b) Retry failed → still error", state(b).kind, "error");

    // The data grew past the cap between loads.
    mode = "truncated";
    await b.refetch(); await wait(40);
    eq("(b) a refresh that finds the range over the cap → truncated, cached rows withheld",
       state(b), { kind: "truncated", rows: [], loaded: 1000, total: 1500 });

    const whileFailing = [...seen];
    mode = "ok";
    await b.refetch();
    eq("(b) a successful Retry → ready with the NEW rows, export allowed again",
       [state(b), canExportReport(state(b))], [{ kind: "ready", rows: [{ id: 2 }] }, true]);
    ok("(b) states were published throughout the failed attempts", whileFailing.length > 0);
    eq("(b) …and none of them was ready: the earlier rows never reappeared",
       whileFailing.filter((k) => k === "ready"), []);
    stopB();
  } finally {
    client.unmount();
    client.clear();
  }
}

// ── 6) The notice through a Retry — pure rules ───────────────────────────────
console.log("6) reportNotice / settleReportNotice");
{
  const problemT = st(undefined, false, false, true, truncated);
  const problemU = st(undefined, false, false, true, unverified);
  const problemE = st(undefined, false, false, true, failure);
  const problemR = st(ROWS, false, false, true, failure);          // failed refresh, rows cached
  const loading  = st(undefined, true, false, false);
  const ready    = st(ROWS, false, false, false);
  const K = "2026-08-01|2026-08-31||||";
  const fresh = () => emptyNoticeMemory<Row>(K);

  for (const [label, p] of [["truncated", problemT], ["unverified", problemU], ["failed load", problemE], ["failed refresh", problemR]] as const) {
    const shown = reportNotice(fresh(), { key: K, state: p, isFetching: false });
    eq(`${label}: the problem is shown, not retrying`, shown.notice, { problem: p, retrying: false });
    ok(`${label}: and remembered`, shown.memory.lastProblem === p);

    // Retry pending. With no cached rows TanStack reports `loading`; with cached
    // rows it keeps the error and reports isFetching.
    const armed = requestReportRetry(shown.memory);
    const duringState = p === problemR ? problemR : loading;
    const during = reportNotice(armed, { key: K, state: duringState, isFetching: true });
    eq(`${label}: Retry pending → the SAME problem stays on screen, as retrying`, during.notice, { problem: p, retrying: true });
    eq(`${label}: Retry pending → rows hidden, export off`, [duringState.rows, canExportReport(duringState)], [[], false]);
  }

  // Without a user Retry, loading shows no notice — first loads and filter changes.
  eq("an ordinary first load shows no notice", reportNotice(fresh(), { key: K, state: loading, isFetching: true }).notice, null);
  {
    const seen = reportNotice(fresh(), { key: K, state: problemT, isFetching: false }).memory;
    eq("an automatic refetch (no Retry pressed) does not keep the notice up",
       reportNotice(seen, { key: K, state: loading, isFetching: true }).notice, null);
    const armed = requestReportRetry(seen);
    const other = reportNotice(armed, { key: "2026-09-01|2026-09-30||||", state: loading, isFetching: true });
    eq("changing range/filters mid-retry does not carry the old problem over", other.notice, null);
    eq("…and starts a clean memory for the new key",
       other.memory, { key: "2026-09-01|2026-09-30||||", lastProblem: null, retryRequested: false, noticeShown: false });
  }
  eq("ready shows no notice", reportNotice(fresh(), { key: K, state: ready, isFetching: false }).notice, null);

  // When focus may move to the results.
  // Built through the real render step, so `lastProblem` is a genuine problem state.
  const seenProblem = reportNotice(fresh(), { key: K, state: problemT, isFetching: false }).memory;
  const mem = (retryRequested: boolean, noticeShown: boolean) => ({ ...seenProblem, retryRequested, noticeShown });
  const settle = (m: ReturnType<typeof mem>, state: ReportTabState<Row>, isFetching: boolean, noticeShown: boolean, focusWasLost: boolean) =>
    settleReportNotice(m, { state, isFetching, noticeShown, focusWasLost });
  eq("user Retry succeeded, notice gone, focus on <body> → move focus to the results",
     settle(mem(true, true), ready, false, false, true).focusResults, true);
  eq("Retry pending → focus is not moved", settle(mem(true, true), loading, true, true, false).focusResults, false);
  eq("Retry failed → focus is not moved", settle(mem(true, true), problemT, false, true, false).focusResults, false);
  eq("recovery nobody asked for → focus is not moved", settle(mem(false, true), ready, false, false, true).focusResults, false);
  eq("Retry succeeded but the user moved focus elsewhere → not stolen", settle(mem(true, true), ready, false, false, false).focusResults, false);
  eq("no notice was showing → nothing to hand off", settle(mem(true, false), ready, false, false, true).focusResults, false);

  eq("a pending Retry stays armed", settle(mem(true, true), loading, true, true, false).memory.retryRequested, true);
  eq("a pending Retry over cached rows stays armed", settle(mem(true, true), problemR, true, true, false).memory.retryRequested, true);
  eq("a failed Retry is disarmed", settle(mem(true, true), problemT, false, true, false).memory.retryRequested, false);
  eq("a successful Retry is disarmed", settle(mem(true, true), ready, false, false, true).memory.retryRequested, false);
}

// ── 7) The same, driven by a real TanStack Query observer ────────────────────
// A tiny stand-in for the tab: on every state the observer publishes it runs
// the render step, then the after-render step, and tracks where keyboard focus
// would be — on the Retry button while the notice is mounted, on <body> if the
// notice unmounts under it, on the results if the hand-off fires.
console.log("7) Retry focus, real TanStack Query observer");
{
  const { QueryClient, QueryObserver } = await import("@tanstack/react-query");
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const client = new QueryClient({ defaultOptions: { queries: { retry: 1, retryDelay: 5 } } });
  client.mount();
  type Q = Parameters<typeof reportTabState<Row>>[0];

  function mountTab(queryKey: string, queryFn: () => Promise<Row[]>, key = "k") {
    const observer = new QueryObserver<Row[]>(client, { queryKey: ["retry-focus", queryKey], queryFn });
    let memory = emptyNoticeMemory<Row>(key);
    let focus: "elsewhere" | "retry-button" | "body" | "results" = "elsewhere";
    const frames: Array<{ state: string; notice: string | null; retrying: boolean | null; focus: string; rows: number; exportable: boolean }> = [];
    const render = () => {
      const q = observer.getCurrentResult() as unknown as Q;
      const state = reportTabState<Row>(q);
      const step = reportNotice(memory, { key, state, isFetching: q.isFetching });
      memory = step.memory;
      const shown = step.notice !== null;
      // The DOM: a focused button that unmounts drops focus to <body>.
      if (!shown && focus === "retry-button") focus = "body";
      const settled = settleReportNotice(memory, { state, isFetching: q.isFetching, noticeShown: shown, focusWasLost: focus === "body" });
      memory = settled.memory;
      if (settled.focusResults) focus = "results";
      frames.push({ state: state.kind, notice: step.notice?.problem.kind ?? null, retrying: step.notice?.retrying ?? null,
                    focus, rows: state.rows.length, exportable: canExportReport(state) });
      return frames[frames.length - 1];
    };
    const stop = observer.subscribe(() => { render(); });
    return {
      frames, render, stop,
      now: () => frames[frames.length - 1],
      /** The user tabs to Retry and activates it. */
      pressRetry: () => { focus = "retry-button"; memory = requestReportRetry(memory); frames.length = 0; return observer.refetch(); },
      moveFocusAway: () => { focus = "elsewhere"; },
      refetchSilently: () => { frames.length = 0; return observer.refetch(); },
    };
  }

  try {
    // One scenario per no-cached-rows problem: initial failure, truncated, unverified.
    for (const [label, problem, kind] of [
      ["initial load failure", new Error("network"), "error"],
      ["truncated result", truncated, "truncated"],
      ["missing/unusable count", unverified, "unverified"],
    ] as const) {
      let mode: "bad" | "ok" = "bad";
      const tab = mountTab(label, async () => { if (mode === "bad") throw problem; return ROWS; });
      await wait(40);
      tab.render();
      eq(`[${label}] the problem is shown with a Retry that is not yet retrying`,
         [tab.now().notice, tab.now().retrying, tab.now().rows, tab.now().exportable], [kind, false, 0, false]);

      // Retry, which fails.
      const failing = tab.pressRetry();
      tab.render();
      eq(`[${label}] Retry pending: the library has gone back to loading`, tab.now().state, "loading");
      eq(`[${label}] Retry pending: the notice is STILL mounted, showing "Retrying…"`, [tab.now().notice, tab.now().retrying], [kind, true]);
      eq(`[${label}] Retry pending: focus is still on the Retry button`, tab.now().focus, "retry-button");
      await failing; await wait(40);
      tab.render();
      ok(`[${label}] the notice never unmounted during the failed Retry`, tab.frames.every((f) => f.notice === kind));
      ok(`[${label}] focus never left the Retry button during the failed Retry`, tab.frames.every((f) => f.focus === "retry-button"));
      ok(`[${label}] no rows and no export at any point`, tab.frames.every((f) => f.rows === 0 && !f.exportable));
      eq(`[${label}] Retry failed: the label is back to "Retry", focus unchanged`,
         [tab.now().notice, tab.now().retrying, tab.now().focus], [kind, false, "retry-button"]);
      ok(`[${label}] the "Retrying…" state was actually reached`, tab.frames.some((f) => f.retrying === true));

      // Retry again, which succeeds.
      mode = "ok";
      const succeeding = tab.pressRetry();
      tab.render();
      eq(`[${label}] second Retry pending: notice mounted, retrying, focus kept`,
         [tab.now().notice, tab.now().retrying, tab.now().focus], [kind, true, "retry-button"]);
      await succeeding; await wait(10);
      tab.render();
      eq(`[${label}] Retry succeeded: notice gone, rows shown, export allowed`,
         [tab.now().state, tab.now().notice, tab.now().rows, tab.now().exportable], ["ready", null, ROWS.length, true]);
      eq(`[${label}] Retry succeeded: focus moved to the results, not left on <body>`, tab.now().focus, "results");
      ok(`[${label}] focus was never left on <body> at the end of any frame`, tab.frames.every((f) => f.focus !== "body"));
      tab.stop();
    }

    // Failed refresh with rows cached: the notice was already stable; the hand-off on success is new.
    {
      let mode: "ok" | "bad" = "ok";
      const tab = mountTab("failed refresh", async () => { if (mode === "bad") throw new Error("network"); return ROWS; });
      await wait(15);
      mode = "bad";
      await tab.refetchSilently(); await wait(40);
      tab.render();
      eq("[failed refresh] rows withheld, problem shown", [tab.now().notice, tab.now().rows, tab.now().exportable], ["error", 0, false]);
      mode = "ok";
      const retry = tab.pressRetry();
      tab.render();
      eq("[failed refresh] Retry pending: notice mounted and retrying, focus kept, rows still withheld",
         [tab.now().notice, tab.now().retrying, tab.now().focus, tab.now().rows], ["error", true, "retry-button", 0]);
      await retry; await wait(10);
      tab.render();
      eq("[failed refresh] Retry succeeded: rows back, focus on the results", [tab.now().state, tab.now().rows, tab.now().focus], ["ready", ROWS.length, "results"]);
      tab.stop();
    }

    // Recovery the user did not ask for must not move their focus.
    {
      let mode: "bad" | "ok" = "bad";
      const tab = mountTab("silent recovery", async () => { if (mode === "bad") throw truncated; return ROWS; });
      await wait(40);
      tab.render();
      mode = "ok";
      await tab.refetchSilently(); await wait(10);
      tab.render();
      eq("[automatic recovery] rows appear, focus is left where it was", [tab.now().state, tab.now().focus], ["ready", "elsewhere"]);
      tab.stop();
    }

    // The user moves on while the Retry runs: focus is not pulled back.
    {
      let mode: "bad" | "ok" = "bad";
      const tab = mountTab("moved away", async () => { if (mode === "bad") throw truncated; await wait(15); return ROWS; });
      await wait(40);
      tab.render();
      mode = "ok";
      const retry = tab.pressRetry();
      tab.moveFocusAway();
      await retry; await wait(10);
      tab.render();
      eq("[focus moved during Retry] success does not steal focus", [tab.now().state, tab.now().focus], ["ready", "elsewhere"]);
      tab.stop();
    }
  } finally {
    client.unmount();
    client.clear();
  }
}

// ── 8) Tab wiring — source check (the JSX cannot be rendered here) ───────────
console.log("8) tab wiring (source check)");
{
  const src = readFileSync(join(process.cwd(), "src", "app", "(dashboard)", "reports", "page.tsx"), "utf8");
  const TABS = [["useVisitsReport", "visits"], ["useMerchReport", "merch"], ["useBranchReport", "branch"], ["useProductReport", "product"], ["useGpsReport", "gps"]];
  for (const [hook] of TABS) {
    const at = src.indexOf(`const query = ${hook}(range, filters);`);
    const head = src.slice(at, at + 360);
    ok(`${hook}: rows, notice and Retry all come from useReportTab`,
       at > 0 && head.includes("const { tabState, data, isLoading, notice, retry, resultsRef } = useReportTab(query, range, filters);"));
  }
  ok("no tab reads rows straight off the query", !/const \{ data = \[\], isLoading \}/.test(src));

  const hookStart = src.indexOf("function useReportTab<T>(");
  const hook = src.slice(hookStart, src.indexOf("\nfunction ", hookStart + 10));
  ok("the hook's rows are reportTabState's rows — empty unless complete and current",
     hook.includes("const tabState = reportTabState<T>(query);") && hook.includes("data: tabState.rows"));
  ok("the hook renders the notice through the tested rule",
     hook.includes("reportNotice(memory.current, { key, state: tabState, isFetching: query.isFetching })"));
  ok("the memory is keyed by range and every filter",
     ["range.from", "range.to", "filters.merchId", "filters.placeId", "filters.status", "filters.lastVisit"].every((p) => hook.includes(p)));
  ok("focus is moved only by the tested rule, without scrolling the page",
     hook.includes("settleReportNotice(memory.current, {") && hook.includes("if (settled.focusResults) resultsRef.current?.focus({ preventScroll: true });"));
  ok("focus counts as lost only when it is on <body>", hook.includes("focusWasLost: !active || active === document.body"));
  ok("Retry arms the memory before refetching",
     hook.indexOf("memory.current = requestReportRetry(memory.current);") < hook.indexOf("void query.refetch();") &&
     hook.indexOf("memory.current = requestReportRetry(memory.current);") > 0);

  eq("five tabs render the shared notice with the hook's notice and Retry",
     (src.match(/<ReportProblem notice=\{notice\} onRetry=\{retry\} t=\{t\} \/>/g) ?? []).length, 5);
  ok("no notice is rendered inside a table body", !/<tbody>[\s\S]{0,200}<ReportProblem/.test(src) && !src.includes("ReportProblemRow"));
  for (const [, tab] of TABS) {
    const re = new RegExp(
      "<ReportProblem notice=\\{notice\\} onRetry=\\{retry\\} t=\\{t\\} />[\\s\\S]{0,160}<div\\s+ref=\\{resultsRef\\}\\s+tabIndex=\\{-1\\}\\s+" +
      'role="region"\\s+aria-label=\\{t\\("reports\\.tab\\.' + tab + '"\\)\\}\\s+className="overflow-x-auto[^"]*"');
    ok(`${tab}: the notice sits above a labelled, script-focusable results region that scrolls sideways`, re.test(src));
  }
  eq("five results regions, none of them a Tab stop", (src.match(/ref=\{resultsRef\}\s+tabIndex=\{-1\}/g) ?? []).length, 5);
  ok("the results region shows a focus indicator for keyboard users",
     (src.match(/className="overflow-x-auto focus:outline-none focus-visible:ring-2/g) ?? []).length === 5);

  eq("five Export buttons are gated on a complete result",
     (src.match(/<ExportButton onClick=\{doExport\} disabled=\{!canExportReport\(tabState\)\}/g) ?? []).length, 5);
  ok("no Export button is gated only on row count and loading", !src.includes("disabled={data.length === 0 || isLoading}"));
  eq("'no data' is shown only for a complete, empty result",
     (src.match(/\{tabState\.kind === "ready" && sorted\.length === 0 && <EmptyRow/g) ?? []).length, 5);

  const start = src.indexOf("function ReportProblem<T>(");
  const comp = src.slice(start, src.indexOf("\nfunction ", start + 10));
  ok("the notice renders nothing unless there is a notice with a message", comp.includes("if (!notice || !message) return null;"));
  ok("the notice is a block, not table markup", !comp.includes("<tr") && !comp.includes("<td") && !comp.includes("colSpan"));
  ok("the Retry state comes from the notice, so it is reachable in every problem state",
     comp.includes("const retrying = notice.retrying;") && comp.includes('retrying ? t("reports.sum.retrying") : t("reports.sum.retry")'));
  ok("the message is announced; Retry sits outside the announced region",
     comp.indexOf('role="alert"') > 0 && comp.indexOf("<button") > comp.indexOf("</div>", comp.indexOf('role="alert"')));
  ok("Retry keeps keyboard focus while retrying (aria-disabled, not disabled)",
     comp.includes("aria-disabled={retrying}") && !/\sdisabled=\{/.test(comp) && comp.includes("if (!retrying) onRetry();"));
  ok("on phones Retry sits under the message; one row from sm up",
     comp.includes("flex-col") && comp.includes("sm:flex-row") && comp.includes("self-start") && comp.includes("sm:self-auto"));
}
