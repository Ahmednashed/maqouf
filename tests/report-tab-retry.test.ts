// Reports tabs — who retries a failed read, and how often.
//
// Two layers can retry a tab read. The Supabase client (postgrest-js) retries a
// GET that fails with a 503, a 520 or a network error three times on its own.
// TanStack Query, by the app default, then ran the whole thing once more: eight
// requests and about fifteen seconds before the tab could say anything. The
// five tab hooks now turn the outer retry off.
//
// What this pins:
//   • the option really is on the five tab hooks and not on the summary, read
//     from the hooks themselves rather than from their source text;
//   • with those options, a read refused as incomplete and a failed read each
//     run the query function exactly once;
//   • the installed Supabase client still retries a 503 by itself — that is the
//     layer being relied on, so it is observed, not assumed;
//   • Retry starts a fresh attempt that can bring the rows and Export back.
//
// The hooks are rendered once on the server renderer purely to let the library
// build their queries; nothing is fetched by that. No request leaves the
// process anywhere in this file: tab reads go to the recording stub, and the
// real Supabase client is given a fake fetch.

import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider, QueryObserver, type QueryFunction } from "@tanstack/react-query";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { eq, ok } from "./_harness.ts";
import {
  useReportSummary, useVisitsReport, useMerchReport, useBranchReport, useProductReport, useGpsReport,
} from "@/hooks/use-reports";
import { canExportReport, reportTabState } from "@/lib/report-completeness";
import {
  recordedCalls, recordedRpcs, queueResult, queueResultFor, resetStub, type StubResult,
} from "./stubs/supabase-client.ts";

const RANGE = { from: "2026-08-01", to: "2026-08-31" };
const APP_DEFAULT_RETRY = 1;

/** The tab → the table whose read carries the count. */
const TABS = [
  ["visits", "visits"], ["merch", "visits"], ["branch", "visits"], ["product", "visit_products"], ["gps", "visits"],
] as const;
type Tab = (typeof TABS)[number][0];

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

// ── The options the hooks actually hand to TanStack Query ────────────────────
interface HookOptions { queryFn: QueryFunction<unknown>; retry: unknown; staleTime: unknown }

function hookOptions(defaultRetry: number): Map<string, HookOptions> {
  const client = new QueryClient({ defaultOptions: { queries: { retry: defaultRetry } } });
  function Probe() {
    useReportSummary(RANGE);
    useVisitsReport(RANGE);
    useMerchReport(RANGE);
    useBranchReport(RANGE);
    useProductReport(RANGE);
    useGpsReport(RANGE);
    return null;
  }
  renderToString(createElement(QueryClientProvider, { client }, createElement(Probe)));
  const out = new Map<string, HookOptions>();
  for (const q of client.getQueryCache().getAll()) {
    out.set(String(q.queryKey[1]), {
      queryFn:   q.options.queryFn as QueryFunction<unknown>,
      retry:     q.options.retry,
      staleTime: (q.options as { staleTime?: unknown }).staleTime,
    });
  }
  client.clear();
  return out;
}

console.log("1) the retry option on the hooks");
const HOOKS = hookOptions(APP_DEFAULT_RETRY);
{
  eq("rendering the hooks fetched nothing", [recordedCalls().length, recordedRpcs().length], [0, 0]);
  eq("six report queries were built", [...HOOKS.keys()].sort(), ["branch", "gps", "merch", "product", "summary", "visits"]);
  for (const [tab] of TABS) {
    eq(`${tab}: TanStack's retry is off`, HOOKS.get(tab)!.retry, false);
    eq(`${tab}: staleTime is unchanged`, HOOKS.get(tab)!.staleTime, 120_000);
  }
  eq("summary: keeps the app default", HOOKS.get("summary")!.retry, APP_DEFAULT_RETRY);
  eq("summary: staleTime is unchanged", HOOKS.get("summary")!.staleTime, 120_000);

  // "Inherits" rather than "happens to equal": a different default shows through
  // on the summary and not on the tabs.
  const other = hookOptions(7);
  eq("summary follows whatever the default is", other.get("summary")!.retry, 7);
  eq("the tabs do not", TABS.map(([tab]) => other.get(tab)!.retry), [false, false, false, false, false]);

  const providers = readFileSync(join(import.meta.dirname, "..", "src", "app", "(dashboard)", "providers.tsx"), "utf8");
  ok("the app-wide default is still one retry (source check)", /queries:\s*\{[\s\S]{0,200}retry:\s*1,/.test(providers));
}

// ── Driving the real hook options on a real observer ─────────────────────────
// The client's default is the app's, so anything the hook does not override
// would retry — which is what makes "one attempt" a statement about the hook.
function mountTab(client: QueryClient, tab: string, scenario: string) {
  const h = HOOKS.get(tab)!;
  const observer = new QueryObserver<unknown[]>(client, {
    queryKey: ["retry-policy", tab, scenario],
    queryFn:  h.queryFn as QueryFunction<unknown[]>,
    retry:    h.retry as false,
  });
  const unsubscribe = observer.subscribe(() => {});
  const now = () => observer.getCurrentResult();
  const state = () => {
    const r = now();
    return reportTabState<unknown>({ data: r.data, isFetching: r.isFetching, isPaused: r.isPaused, isError: r.isError, error: r.error });
  };
  const settled = async () => {
    for (let i = 0; i < 400 && now().fetchStatus !== "idle"; i++) await tick(5);
    // Long enough for an outer retry (delay 5 ms here) to have shown itself.
    await tick(60);
  };
  return { observer, now, state, settled, unsubscribe };
}

const reads = (table: string) => recordedCalls().filter((c) => c.table === table).length;

console.log("2) one attempt per load");
{
  const client = new QueryClient({ defaultOptions: { queries: { retry: APP_DEFAULT_RETRY, retryDelay: 5 } } });
  client.mount();
  const FAIL_500 = { code: "500", message: "simulated server error" };

  const CASES: Array<{ name: string; result: StubResult; kind: string; failureCount: number }> = [
    { name: "truncated (count above rows)",  result: { data: [], error: null, count: 5 },         kind: "truncated",  failureCount: 1 },
    { name: "unverified (no count)",         result: { data: [], error: null },                   kind: "unverified", failureCount: 1 },
    { name: "unverified (unusable count)",   result: { data: [], error: null, count: Number.NaN }, kind: "unverified", failureCount: 1 },
    { name: "a 500",                         result: { data: null, error: FAIL_500 },             kind: "error",      failureCount: 1 },
  ];

  for (const [tab, table] of TABS) {
    for (const c of CASES) {
      resetStub();
      // Enough for a retry to find the same answer, so a second attempt would
      // be counted rather than accidentally succeeding on the stub's default.
      for (let i = 0; i < 3; i++) queueResultFor(table, c.result);
      const t = mountTab(client, tab, c.name);
      await t.settled();
      eq(`${tab} / ${c.name}: the counted read ran once`, reads(table), 1);
      eq(`${tab} / ${c.name}: surfaced as ${c.kind}, after one failure`, [t.state().kind, t.now().failureCount], [c.kind, c.failureCount]);
      eq(`${tab} / ${c.name}: nothing to show or export`, [t.state().rows.length, canExportReport(t.state())], [0, false]);
      t.unsubscribe();
    }
  }

  // The same client, the summary's own options: the outer retry is still there.
  {
    resetStub();
    for (let i = 0; i < 3; i++) queueResult({ data: null, error: FAIL_500 });
    const s = HOOKS.get("summary")!;
    const observer = new QueryObserver(client, { queryKey: ["retry-policy", "summary"], queryFn: s.queryFn, retry: s.retry as number });
    const unsubscribe = observer.subscribe(() => {});
    for (let i = 0; i < 400 && observer.getCurrentResult().fetchStatus !== "idle"; i++) await tick(5);
    await tick(60);
    eq("summary / a failed RPC: still attempted twice", [recordedRpcs().length, observer.getCurrentResult().failureCount], [2, 2]);
    unsubscribe();
  }

  console.log("3) Retry is a fresh attempt");
  const VISIT = { id: "v1", scheduled_date: "2026-08-06", status: "completed", duration_minutes: 10, merch_id: "m", place_id: "p", place: null, merch: null };
  for (const c of CASES) {
    resetStub();
    queueResultFor("visits", c.result);
    const t = mountTab(client, "visits", `retry after ${c.name}`);
    await t.settled();
    eq(`after ${c.name}: refused, one read`, [t.state().kind, reads("visits")], [c.kind, 1]);

    // The user's Retry fails the same way: one more read, not two.
    queueResultFor("visits", c.result);
    queueResultFor("visits", c.result);
    await t.observer.refetch();
    await t.settled();
    eq(`after ${c.name}: a Retry that fails again is one more read`, [t.state().kind, reads("visits")], [c.kind, 2]);

    // And one that succeeds brings back the rows and Export.
    resetStub();
    queueResultFor("visits", { data: [VISIT], error: null, count: 1 });
    await t.observer.refetch();
    await t.settled();
    const s = t.state();
    eq(`after ${c.name}: a Retry that succeeds is one read`, reads("visits"), 1);
    eq(`after ${c.name}: rows and Export are back`,
       [s.kind, s.rows.length, (s.rows[0] as { id: string } | undefined)?.id, canExportReport(s)], ["ready", 1, "v1", true]);
    t.unsubscribe();
  }

  client.unmount();
  client.clear();
}

// ── The layer underneath: the installed Supabase client ──────────────────────
// A fake fetch stands in for the network. `Retry-After: 0` asks the client to
// retry at once, so its three retries are observed without its 1 s / 2 s / 4 s
// backoff; the header changes the wait, not whether it retries.
function fakeApi(status: number) {
  const requests: Array<{ method: string; retryCount: string | null }> = [];
  const fetch: typeof globalThis.fetch = async (_input, init) => {
    requests.push({ method: String(init?.method), retryCount: new Headers(init?.headers).get("X-Retry-Count") });
    const body = status === 200 ? "[]" : JSON.stringify({ message: `fake ${status}` });
    return new Response(body, {
      status,
      headers: { "content-type": "application/json", "content-range": "*/0", "retry-after": "0" },
    });
  };
  const supabase = createSupabaseClient("http://supabase.invalid", "test-anon-key", {
    global: { fetch },
    auth:   { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return { requests, supabase };
}

console.log("4) the Supabase client's own retries");
{
  const tabRead = (api: ReturnType<typeof fakeApi>) =>
    api.supabase.from("visits").select("id", { count: "exact" }).order("id", { ascending: true });

  const s503 = fakeApi(503);
  const r503 = await tabRead(s503);
  eq("a 503 on a read: four requests, the last three marked as retries",
     s503.requests.map((r) => [r.method, r.retryCount]), [["GET", null], ["GET", "1"], ["GET", "2"], ["GET", "3"]]);
  eq("…and then the error is returned", [r503.status, r503.error?.message], [503, "fake 503"]);

  const s500 = fakeApi(500);
  const r500 = await tabRead(s500);
  eq("a 500 on a read: one request, no retry", [s500.requests.length, r500.status, r500.error?.message], [1, 500, "fake 500"]);

  const s200 = fakeApi(200);
  const r200 = await tabRead(s200);
  eq("a success: one request, and the count is read", [s200.requests.length, r200.error, r200.count], [1, null, 0]);

  const rpc503 = fakeApi(503);
  await rpc503.supabase.rpc("report_summary", {});
  eq("a 503 on an RPC (POST) is not retried by the client", rpc503.requests.map((r) => r.method), ["POST"]);

  // Both layers together, as a tab read meets them.
  const through = async (retry: false | number, status: number) => {
    const api = fakeApi(status);
    const client = new QueryClient({ defaultOptions: { queries: { retry: APP_DEFAULT_RETRY, retryDelay: 5 } } });
    client.mount();
    const observer = new QueryObserver(client, {
      queryKey: ["layers", status, String(retry)],
      queryFn: async () => {
        const { data, error } = await tabRead(api);
        if (error) throw error;
        return data;
      },
      retry,
    });
    const unsubscribe = observer.subscribe(() => {});
    for (let i = 0; i < 400 && observer.getCurrentResult().fetchStatus !== "idle"; i++) await tick(5);
    await tick(60);
    const r = observer.getCurrentResult();
    unsubscribe();
    client.unmount();
    client.clear();
    return [api.requests.length, r.status, r.failureCount];
  };
  const tabRetry = HOOKS.get("visits")!.retry as false;
  eq("503 with the tab hooks' option: the client's four requests, then the error", await through(tabRetry, 503), [4, "error", 1]);
  eq("503 with the app default instead: eight — what the tabs did before", await through(APP_DEFAULT_RETRY, 503), [8, "error", 2]);
  eq("500 with the tab hooks' option: one request, then the error", await through(tabRetry, 500), [1, "error", 1]);
  eq("500 with the app default instead: two", await through(APP_DEFAULT_RETRY, 500), [2, "error", 2]);
}
