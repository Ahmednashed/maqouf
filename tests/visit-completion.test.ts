// Completing a field visit without losing its audit work.
//
// The rules (src/lib/visit-completion.ts):
//   • no completion offline, and no completion request queued for later;
//   • online with unsaved edits: save first, complete only if the save worked;
//   • a failed save leaves the visit open and the draft in place;
//   • no automatic upload on reconnect — "Sync now" is offered instead;
//   • unsaved work kept for a closed visit is shown read-only, never written
//     to it and never removed unasked;
//   • starting a visit refreshes its product list.
//
// Part 1 drives the pure rules. Part 2 settles, against the installed TanStack
// Query, the claim that a completion used to be queued while offline and sent
// on reconnect — and that it no longer is. Part 3 runs the real hooks on a real
// QueryClient (the Supabase client is the recording stub, so nothing reaches a
// database). Part 4 renders the completion dialog. Part 5 checks the wiring in
// the visit page, which cannot be rendered in this runner.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider, MutationObserver, onlineManager } from "@tanstack/react-query";
import { eq, ok } from "./_harness.ts";
import {
  completionBlock, completionDialogView, saveThenComplete, classifyStoredDraft, syncPrompt, describeStrandedDraft,
  createCompletionGuard, noEditsSince, type CompletionCloseSource,
} from "@/lib/visit-completion";
import { readDraft, writeDraft, type VisitDraft } from "@/lib/offline-drafts";
import { useCompleteVisit, useStartVisit } from "@/hooks/use-visits";
import { VISIT_PRODUCTS_KEY } from "@/hooks/use-visit-products";
import { translations } from "@/lib/i18n/translations";
import { recordedCalls, queueResultFor, resetStub } from "./stubs/supabase-client.ts";

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const T = (locale: "ar" | "en", key: string) => (translations[locale] as Record<string, string>)[key];

// A minimal localStorage, so the real draft functions can be exercised.
{
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, String(v)); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => store.clear(),
  };
}

// ── 1) The rules ─────────────────────────────────────────────────────────────
console.log("1) the completion and draft rules");
{
  eq("offline: completion is blocked, whatever else holds", completionBlock({ isOnline: false, needsAck: false, acked: true }), "offline");
  eq("offline with outstanding work acknowledged: still blocked", completionBlock({ isOnline: false, needsAck: true, acked: true }), "offline");
  eq("online, acknowledgement outstanding: blocked until ticked", completionBlock({ isOnline: true, needsAck: true, acked: false }), "ack");
  eq("online and acknowledged: allowed", completionBlock({ isOnline: true, needsAck: true, acked: true }), null);
  eq("online, nothing to acknowledge: allowed", completionBlock({ isOnline: true, needsAck: false, acked: false }), null);

  const run = async (o: { dirty: boolean; online?: boolean[]; save?: () => Promise<boolean>; complete?: () => Promise<unknown> }) => {
    const calls: string[] = [];
    const online = [...(o.online ?? [true, true, true])];
    const outcome = await saveThenComplete({
      dirty:    o.dirty,
      isOnline: () => { calls.push("online?"); return online.length ? online.shift()! : true; },
      save:     async () => { calls.push("save"); return o.save ? o.save() : true; },
      complete: async () => { calls.push("complete"); return o.complete ? o.complete() : undefined; },
    });
    return { outcome, calls: calls.filter((c) => c !== "online?") };
  };

  eq("unsaved edits, online: save, then complete — in that order",
     await run({ dirty: true }), { outcome: { kind: "completed", savedFirst: true, revision: null }, calls: ["save", "complete"] });
  eq("no unsaved edits: complete only", await run({ dirty: false }), { outcome: { kind: "completed", savedFirst: false, revision: null }, calls: ["complete"] });
  eq("the save fails: no completion request at all",
     await run({ dirty: true, save: async () => false }), { outcome: { kind: "saveFailed" }, calls: ["save"] });
  eq("the save throws: treated as failed, no completion",
     await run({ dirty: true, save: async () => { throw new Error("network"); } }), { outcome: { kind: "saveFailed" }, calls: ["save"] });
  eq("offline from the start: neither request",
     await run({ dirty: true, online: [false] }), { outcome: { kind: "offline" }, calls: [] });
  eq("the connection drops during the save: no completion request",
     await run({ dirty: true, online: [true, false] }), { outcome: { kind: "offline" }, calls: ["save"] });
  const boom = new Error("completion failed");
  eq("saved, but completing fails: reported as such, after the save",
     await run({ dirty: true, complete: async () => { throw boom; } }), { outcome: { kind: "completeFailed", error: boom }, calls: ["save", "complete"] });

  const draft = (dirty: boolean): VisitDraft => ({ visit_id: "v1", products: { p1: { qty_found: "4", notes: "" } }, responses: {}, last_saved_locally_at: "2026-10-23T10:00:00.000Z", dirty });
  eq("no draft → nothing to show", classifyStoredDraft(null, false), "none");
  eq("a clean backup → nothing to show, open or closed", [classifyStoredDraft(draft(false), false), classifyStoredDraft(draft(false), true)], ["none", "none"]);
  eq("unsaved work, visit open → restorable", classifyStoredDraft(draft(true), false), "restorable");
  eq("unsaved work, visit closed → stranded (read-only), not restorable", classifyStoredDraft(draft(true), true), "stranded");

  eq("offline: no Sync now prompt (nothing could be uploaded)", syncPrompt({ isOnline: false, dirty: true, wasOffline: true, saveFailed: true }), null);
  eq("online, nothing unsaved: no prompt", syncPrompt({ isOnline: true, dirty: false, wasOffline: true, saveFailed: true }), null);
  eq("back online with unsaved edits: the back-online prompt", syncPrompt({ isOnline: true, dirty: true, wasOffline: true, saveFailed: false }), "backOnline");
  eq("a failed save with unsaved edits: the failed prompt", syncPrompt({ isOnline: true, dirty: true, wasOffline: false, saveFailed: true }), "failed");
  eq("ordinary typing online: no prompt (the draft is just the safety copy)", syncPrompt({ isOnline: true, dirty: true, wasOffline: false, saveFailed: false }), null);

  const stranded: VisitDraft = {
    visit_id: "v1", last_saved_locally_at: "2026-10-23T10:00:00.000Z", dirty: true,
    products: { p1: { qty_found: "4", notes: "" }, p2: { qty_found: "7", notes: "back shelf" }, gone: { qty_found: "1", notes: "" } },
    responses: { f1: "yes", f2: ["a", "b"], f3: "same" },
  };
  eq("a stranded draft lists only what differs from the saved visit — nothing it holds is hidden",
     describeStrandedDraft(stranded, {
       products:  [{ product_id: "p1", qty_found: 4, notes: null, name_ar: "أ", name_en: "A" }, { product_id: "p2", qty_found: 5, notes: null, name_ar: "ب", name_en: "B" }],
       fields:    [{ id: "f1", label_ar: "س١", label_en: "Q1" }, { id: "f2", label_ar: "س٢", label_en: "Q2" }, { id: "f3", label_ar: "س٣", label_en: "Q3" }],
       responses: { f1: "no", f3: "same" },
     }),
     {
       products: [
         { product_id: "p2", name_ar: "ب", name_en: "B", qty_found: "7", notes: "back shelf" },
         { product_id: "gone", name_ar: "gone", name_en: "gone", qty_found: "1", notes: "" },
       ],
       responses: [
         { field_id: "f1", label_ar: "س١", label_en: "Q1", value: "yes" },
         { field_id: "f2", label_ar: "س٢", label_en: "Q2", value: "a, b" },
       ],
     });
}

// ── The draft survives a failed save, and stays recoverable ──────────────────
console.log("1b) the draft through a failed save");
{
  const draft: VisitDraft = { visit_id: "v-save-fails", products: { p1: { qty_found: "9", notes: "" } }, responses: {}, last_saved_locally_at: "2026-10-23T11:00:00.000Z", dirty: true };
  writeDraft(draft);
  const outcome = await saveThenComplete({ dirty: true, isOnline: () => true, save: async () => false, complete: async () => { throw new Error("must not run"); } });
  eq("the save fails → the visit is not completed", outcome, { kind: "saveFailed" });
  eq("…and the draft is still there, unsaved, exactly as it was", readDraft("v-save-fails"), draft);
  eq("…and, the visit being open, it is offered for restore", classifyStoredDraft(readDraft("v-save-fails"), false), "restorable");
  eq("if the visit were closed meanwhile, it would be shown read-only instead", classifyStoredDraft(readDraft("v-save-fails"), true), "stranded");
}

// ── 2) What TanStack Query does with a completion while offline ──────────────
console.log("2) a completion while offline: queued before, refused now");
{
  const client = new QueryClient();
  client.mount();   // subscribes to onlineManager, so paused mutations resume on reconnect
  try {
    // The previous useCompleteVisit options: no networkMode, i.e. the default.
    let sent = 0;
    onlineManager.setOnline(false);
    const before = new MutationObserver(client, { mutationFn: async () => { sent++; return "closed"; } });
    const pending = before.mutate(undefined).catch(() => "rejected");
    await tick(30);
    eq("default networkMode, offline: the request is not sent — it waits", [sent, before.getCurrentResult().isPaused], [0, true]);
    onlineManager.setOnline(true);
    await tick(30);
    eq("…and is sent by itself once the connection returns, with nobody asking", [sent, await pending], [1, "closed"]);

    // The same with networkMode "always": attempted at once, never queued.
    let tried = 0;
    onlineManager.setOnline(false);
    const now = new MutationObserver(client, { networkMode: "always", mutationFn: async () => { tried++; throw new TypeError("Failed to fetch"); } });
    const result = await now.mutate(undefined).then(() => "completed", (e: Error) => e.message);
    eq("networkMode \"always\", offline: tried once, fails, nothing left waiting", [tried, result, now.getCurrentResult().isPaused], [1, "Failed to fetch", false]);
    onlineManager.setOnline(true);
    await tick(30);
    eq("…and nothing is sent when the connection returns", tried, 1);
  } finally {
    onlineManager.setOnline(true);
    client.unmount();
    client.clear();
  }
}

// ── 3) The real hooks ────────────────────────────────────────────────────────
type Api = { mutateAsync: (v: unknown) => Promise<unknown> };
function hookApi(client: QueryClient, useHook: () => unknown): Api {
  let api: Api | undefined;
  function Probe() { api = useHook() as Api; return null; }
  renderToString(createElement(QueryClientProvider, { client }, createElement(Probe)));
  return api!;
}
const VISIT = { id: "v-1", status: "inprogress", place: { id: "pl-1", lat: null, lng: null } };

console.log("3) the hooks");
{
  // useCompleteVisit: offline, the completion is attempted at once — not queued.
  const client = new QueryClient();
  client.mount();
  try {
    resetStub();
    onlineManager.setOnline(false);
    queueResultFor("visits", { data: { started_at: "2026-10-23T09:00:00.000Z" }, error: null });
    queueResultFor("visits", { data: { ...VISIT, status: "completed" }, error: null });
    const api = hookApi(client, useCompleteVisit);
    const outcome = await api.mutateAsync({ id: "v-1" }).then(() => "ran", (e: Error) => `failed: ${e.message}`);
    eq("useCompleteVisit runs while the device reports offline instead of waiting for the connection",
       [outcome, recordedCalls().filter((c) => c.table === "visits").length], ["ran", 2]);
  } finally {
    onlineManager.setOnline(true);
    client.unmount();
    client.clear();
  }

  // useStartVisit: the product list is refreshed after starting.
  const c2 = new QueryClient();
  c2.mount();
  try {
    resetStub();
    c2.setQueryData(VISIT_PRODUCTS_KEY("v-1"), []);
    c2.setQueryData(["visit", "v-1"], { ...VISIT, status: "pending" });
    c2.setQueryData(VISIT_PRODUCTS_KEY("v-other"), []);
    queueResultFor("visits", { data: VISIT, error: null });
    queueResultFor("place_products", { data: [], error: null });
    const api = hookApi(c2, useStartVisit);
    await api.mutateAsync({ visitId: "v-1" });
    await tick(10);
    eq("after starting a visit, its product list is marked stale and will be refetched",
       c2.getQueryState(VISIT_PRODUCTS_KEY("v-1"))?.isInvalidated, true);
    eq("…as is the visit itself", c2.getQueryState(["visit", "v-1"])?.isInvalidated, true);
    eq("…but not another visit's products", c2.getQueryState(VISIT_PRODUCTS_KEY("v-other"))?.isInvalidated, false);
  } finally {
    c2.unmount();
    c2.clear();
  }
}

// ── 4) What the completion dialog shows ──────────────────────────────────────
// The dialog takes these decisions from completionDialogView (checked in part
// 5); the component itself is .tsx, which this runner cannot load.
console.log("4) the completion dialog's choices");
{
  const view = (o: { isOnline: boolean; dirty: boolean; needsAck?: boolean; acked?: boolean; busy?: boolean }) =>
    completionDialogView({ needsAck: false, acked: false, busy: false, ...o });

  const offlineDirty = view({ isOnline: false, dirty: true });
  eq("offline with unsaved edits: disabled, says completion waits for the save, no bypass",
     [offlineDirty.block, offlineDirty.confirmDisabled, offlineDirty.unsavedMessage, offlineDirty.confirmTitle],
     ["offline", true, "visits.unsaved.offlineBlocked", "offline.completeOfflineDisabled"]);
  eq("…even with the acknowledgement ticked", view({ isOnline: false, dirty: true, needsAck: true, acked: true }).confirmDisabled, true);

  const onlineDirty = view({ isOnline: true, dirty: true });
  eq("online with unsaved edits: enabled, labelled Save and complete, says the edits are saved first",
     [onlineDirty.block, onlineDirty.confirmDisabled, onlineDirty.confirmLabel, onlineDirty.unsavedMessage],
     [null, false, "visits.saveAndComplete", "visits.unsaved.willSave"]);

  const offlineClean = view({ isOnline: false, dirty: false });
  eq("offline with nothing unsaved: disabled, with the reason",
     [offlineClean.confirmDisabled, offlineClean.offlineNotice, offlineClean.unsavedMessage], [true, "offline.completeOfflineDisabled", null]);

  const onlineClean = view({ isOnline: true, dirty: false });
  eq("online with nothing unsaved: plain Complete, enabled",
     [onlineClean.confirmDisabled, onlineClean.confirmLabel, onlineClean.offlineNotice], [false, "visits.complete", null]);
  eq("online, outstanding work not yet acknowledged: disabled, with that reason",
     [view({ isOnline: true, dirty: true, needsAck: true }).confirmDisabled, view({ isOnline: true, dirty: true, needsAck: true }).confirmTitle],
     [true, "visits.ready.ackRequired"]);
  eq("while saving or completing: disabled, so a second press cannot send a second request",
     view({ isOnline: true, dirty: true, busy: true }).confirmDisabled, true);

  for (const locale of ["ar", "en"] as const) {
    for (const k of ["visits.saveAndComplete", "visits.unsaved.willSave", "visits.unsaved.offlineBlocked", "visits.unsaved.saveFailed",
                     "offline.syncNow", "offline.backOnlineTitle", "offline.backOnlineDesc", "offline.syncFailedTitle", "offline.syncFailedDesc",
                     "offline.strandedTitle", "offline.strandedDesc", "offline.strandedDiscard", "offline.strandedDiscardConfirm"]) {
      ok(`[${locale}] ${k} exists${locale === "ar" ? " in Arabic" : " in English"}`,
         !!T(locale, k) && (locale === "ar" ? /[\u0600-\u06FF]/.test(T(locale, k)) : !/[\u0600-\u06FF]/.test(T(locale, k))));
    }
  }
}

// ── 5) Wiring (source checks — the page cannot be rendered in this runner) ───
console.log("5) wiring");
{
  const root = join(import.meta.dirname, "..", "src");
  const modal = readFileSync(join(root, "app", "(dashboard)", "visits", "_components", "CompleteModal.tsx"), "utf8");
  const page  = readFileSync(join(root, "app", "(dashboard)", "visits", "[id]", "page.tsx"), "utf8");
  const hooks = readFileSync(join(root, "hooks", "use-visits.ts"), "utf8");
  const draft = readFileSync(join(root, "hooks", "use-offline-visit-draft.ts"), "utf8");

  ok("the dialog completes only through saveThenComplete, saving with the page's handleSave",
     /saveThenComplete\(\{[\s\S]*save:\s+onSaveNow,[\s\S]*complete: \(\) => complete\.mutateAsync/.test(modal) && (modal.match(/complete\.mutateAsync/g) ?? []).length === 1);
  ok("the dialog reports a failed save in an announced message and stays open",
     /role="alert"[\s\S]{0,300}visits\.unsaved\.saveFailed/.test(modal) &&
     /if \(outcome\.kind === "completed"\) \{\s+guard\.end\(\);\s+onDone\(outcome\.revision\);\s+return;\s+\}/.test(modal));
  ok("the dialog has no offline acknowledgement path left", !/dirty\.dirty && !isOnline/.test(modal));
  ok("the dialog takes its button state, label and messages from completionDialogView",
     modal.includes("completionDialogView({ isOnline, dirty: dirty.dirty, needsAck, acked, busy })") &&
     modal.includes("disabled={view.confirmDisabled}") && modal.includes("t(view.confirmLabel)") &&
     modal.includes("t(view.unsavedMessage)") && modal.includes("t(view.offlineNotice)"));
  ok("handleSave reports success or failure, and tells the draft which revision it saved",
     /async function handleSave\(\): Promise<boolean>/.test(page) && page.includes("const savingRevision = markSaving();") &&
     /markSynced\(savingRevision\);\s+return true;/.test(page) && /markFailed\(\);\s+return false;/.test(page));
  ok("the local draft is cleared only if nothing was edited since the completed revision",
     /onDone=\{\(completedRevision\) => \{[\s\S]{0,500}if \(noEditsSince\(completedRevision, editRevision\(\)\)\) clearLocalDraft\(\);/.test(page) &&
     !/if \(allSaved\) clearLocalDraft/.test(page) && page.includes("editRevision={editRevision}"));
  ok("the stranded draft is shown only on a closed visit, and the banner never saves",
     page.includes("{isReadOnly && strandedDraft && strandedRows && (") &&
     !(/function StrandedDraftBanner[\s\S]*?\r?\n\}\r?\n/.exec(page)?.[0] ?? "handleSave").match(/handleSave|mutate|writeDraft|onSave/));
  ok("Sync now is a button the user presses — nothing calls handleSave on reconnect",
     (page.match(/^(?!\s*(\/\*|\*|\/\/)).*handleSave.*$/gm) ?? []).map((l) => l.trim()).sort().join(" | ") ===
     ["async function handleSave(): Promise<boolean> {", "onClick={handleSave}", "onSaveNow={handleSave}", "onSync={() => { void handleSave(); }}"].sort().join(" | "));
  ok("the restore prompt is still only for an open visit", page.includes("{pendingDraft && !isReadOnly && ("));
  ok("edits are tracked once the product rows have loaded, even when there are none",
     page.includes("if (prodInitialized.current || productsLoading || !visit) return;") &&
     !page.includes("if (visitProducts.length > 0 && !prodInitialized.current)") &&
     page.includes("}, [visitProducts, productsLoading, visit]);"));
  ok("starting a visit re-arms that initialisation, so the seeded rows are picked up",
     /async function handleStart[\s\S]{0,200}prodInitialized\.current = false;/.test(page));
  ok("the draft hook classifies a stored draft instead of skipping closed visits",
     draft.includes("classifyStoredDraft(draft, isReadOnly)") && !/if \(!visitId \|\| isReadOnly\) return;/.test(draft));
  ok("the draft hook only removes a stranded draft when asked", /const discardStrandedDraft = useCallback\(\(\) => \{\s+clearDraft\(visitId\);/.test(draft) &&
     (draft.match(/clearDraft\(/g) ?? []).length === 3);
  ok("useCompleteVisit never queues: networkMode \"always\"", /export function useCompleteVisit[\s\S]{0,700}networkMode: "always"/.test(hooks));
  ok("the offline toast no longer promises an automatic sync",
     !/ستتم المزامنة عند الاتصال/.test(T("ar", "offline.savedLocallyToast")) && !/Sync when back online/.test(T("en", "offline.savedLocallyToast")) &&
     T("en", "offline.savedLocallyToast").includes(T("en", "offline.syncNow")) && T("ar", "offline.savedLocallyToast").includes(T("ar", "offline.syncNow")));
}

// ── 6) Closing the dialog while it works, and edits made meanwhile ───────────
// The dialog's close handler asks createCompletionGuard; "Save and complete"
// runs saveThenComplete with the page's edit revision. Driven here with a save
// that takes as long as the test likes.
console.log("6) closing while it works, and edits made meanwhile");
{
  type Deferred<T> = { promise: Promise<T>; resolve: (v: T) => void };
  const deferred = <T,>(): Deferred<T> => { let resolve!: (v: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; };
  const SOURCES: CompletionCloseSource[] = ["backdrop", "closeButton", "cancel", "escape"];

  // The guard on its own.
  {
    const g = createCompletionGuard();
    let closed = 0;
    eq("idle: every way of closing closes", SOURCES.map((src) => g.requestClose(src, () => { closed++; })), [true, true, true, true]);
    eq("…each once", closed, 4);
    closed = 0;
    eq("an operation starts", g.begin(), true);
    eq("a second press while it runs is refused", g.begin(), false);
    eq("running: backdrop, X, Cancel and Escape are all refused", SOURCES.map((src) => g.requestClose(src, () => { closed++; })), [false, false, false, false]);
    eq("…and the dialog's close callback is never called", closed, 0);
    g.end();
    eq("finished: closing works again", [g.requestClose("cancel", () => { closed++; }), closed], [true, 1]);
  }

  // A slow save: the dialog cannot be closed until it is over, and completion follows the save.
  {
    const g = createCompletionGuard();
    const save = deferred<boolean>();
    const calls: string[] = [];
    let revision = 7;
    let closed = 0;
    g.begin();
    const run = saveThenComplete({
      dirty: true, isOnline: () => true, revision: () => revision,
      save: async () => { calls.push("save:start"); const ok = await save.promise; calls.push("save:end"); return ok; },
      complete: async () => { calls.push("complete"); },
    }).finally(() => g.end());
    await tick(5);
    eq("while the save is pending, nothing has been completed", calls, ["save:start"]);
    eq("…and every attempt to close is refused", SOURCES.map((src) => g.requestClose(src, () => { closed++; })), [false, false, false, false]);
    save.resolve(true);
    const outcome = await run;
    eq("completion is sent only after the save has finished", calls, ["save:start", "save:end", "complete"]);
    eq("…and reports the revision that was saved", outcome, { kind: "completed", savedFirst: true, revision: 7 });
    eq("…so the draft may be cleared — nothing was edited since", noEditsSince((outcome as { revision: number }).revision, revision), true);
    eq("the dialog can close once it is over", g.requestClose("cancel", () => { closed++; }), true);
    eq("…and not before", closed, 1);
  }

  // An edit lands while the save is in flight: no completion, the draft stays.
  {
    const id = "v-edited-during-save";
    const draft: VisitDraft = { visit_id: id, products: { p1: { qty_found: "3", notes: "" } }, responses: {}, last_saved_locally_at: "2026-10-24T08:00:00.000Z", dirty: true };
    writeDraft(draft);
    const save = deferred<boolean>();
    const calls: string[] = [];
    let revision = 12;
    const run = saveThenComplete({
      dirty: true, isOnline: () => true, revision: () => revision,
      save: async () => { calls.push("save"); return save.promise; },
      complete: async () => { calls.push("complete"); },
    });
    await tick(5);
    revision += 1;   // the user edits again
    writeDraft({ ...draft, products: { p1: { qty_found: "30", notes: "" } } });
    save.resolve(true);
    eq("edited during the save: the visit is NOT completed", [await run, calls], [{ kind: "changedDuringSave" }, ["save"]]);
    eq("…and the newer edit is still in the draft, still unsaved", readDraft(id), { ...draft, products: { p1: { qty_found: "30", notes: "" } } });
    eq("the save's 'synced' mark would not vouch for it either", noEditsSince(12, revision), false);
  }

  // An edit lands after the save but the completion went through: the draft is not cleared.
  {
    const save = deferred<boolean>();
    let revision = 4;
    const run = saveThenComplete({ dirty: true, isOnline: () => true, revision: () => revision, save: () => save.promise, complete: async () => { revision += 1; } });
    save.resolve(true);
    const outcome = await run;
    eq("completed at revision 4, then an edit arrived (revision 5)", [outcome, revision], [{ kind: "completed", savedFirst: true, revision: 4 }, 5]);
    eq("…so the page does not clear the newer draft", noEditsSince((outcome as { revision: number }).revision, revision), false);
  }

  // The draft through a failure and through a refused close.
  {
    const id = "v-cancel-or-fail";
    const draft: VisitDraft = { visit_id: id, products: {}, responses: { f1: "typed" }, last_saved_locally_at: "2026-10-24T08:30:00.000Z", dirty: true };
    writeDraft(draft);
    const g = createCompletionGuard();
    g.begin();
    let closed = 0;
    const failing = saveThenComplete({ dirty: true, isOnline: () => true, revision: () => 1, save: async () => { await tick(5); return false; }, complete: async () => { throw new Error("must not run"); } })
      .finally(() => g.end());
    g.requestClose("cancel", () => { closed++; });
    eq("a slow save that fails: no completion", await failing, { kind: "saveFailed" });
    eq("…the Cancel pressed during it did nothing", closed, 0);
    eq("…and the draft is exactly as it was", readDraft(id), draft);
    eq("Cancel after the failure closes the dialog — and closing touches no draft", [g.requestClose("cancel", () => { closed++; }), closed, readDraft(id)], [true, 1, draft]);
  }

  eq("noEditsSince: same revision", noEditsSince(3, 3), true);
  eq("noEditsSince: edited since", noEditsSince(3, 4), false);
  eq("noEditsSince: nothing recorded never vouches", [noEditsSince(null, 0), noEditsSince(undefined, 0)], [false, false]);

  // Wiring.
  const root = join(import.meta.dirname, "..", "src");
  const modal = readFileSync(join(root, "app", "(dashboard)", "visits", "_components", "CompleteModal.tsx"), "utf8");
  const draftHook = readFileSync(join(root, "hooks", "use-offline-visit-draft.ts"), "utf8");
  ok("no close path calls onClose directly any more", !/onClick=\{onClose\}/.test(modal) && (modal.match(/\bonClose\b/g) ?? []).filter(Boolean).length === 3);
  eq("backdrop, X and Cancel each go through the guarded handler",
     ["backdrop", "closeButton", "cancel"].map((src) => modal.includes(`onClick={() => requestClose("${src}")}`)), [true, true, true]);
  ok("the handler asks the guard, not the button state", /function requestClose\(source: CompletionCloseSource\) \{\s+guard\.requestClose\(source, onClose\);/.test(modal));
  ok("the dialog has no Escape or other keyboard close path", !/Escape|onKeyDown|keydown/.test(modal));
  ok("X and Cancel are also disabled while busy (the visible half)", (modal.match(/disabled=\{busy\}/g) ?? []).length === 2);
  ok("the operation takes the guard before anything else, and releases it at the end",
     /if \(blocked \|\| busy \|\| !guard\.begin\(\)\) return;/.test(modal) && /\} finally \{\s+guard\.end\(\);/.test(modal));
  ok("the busy state is shown and announced", /\{busy && \([\s\S]{0,120}role="status"[\s\S]{0,300}visits\.completing\.saving/.test(modal) && modal.includes("aria-busy={busy}"));
  ok("the revision is passed to saveThenComplete", modal.includes("revision: editRevision,"));
  ok("every edit bumps the revision", /latestDataRef\.current = \{ products, responses \};\s+editRevisionRef\.current \+= 1;/.test(draftHook));
  ok("markSynced does not write newer edits as clean",
     /const markSynced = useCallback\(\(savedRevision\?: number\) => \{\s+[\s\S]{0,200}if \(savedRevision !== undefined && !noEditsSince\(savedRevision, editRevisionRef\.current\)\) \{\s+setSyncStatus\("draft"\);\s+return;/.test(draftHook));
  for (const locale of ["ar", "en"] as const) {
    for (const k of ["visits.unsaved.changedDuringSave", "visits.completing.saving", "visits.completing.completing"]) {
      ok(`[${locale}] ${k} exists${locale === "ar" ? " in Arabic" : " in English"}`,
         !!T(locale, k) && (locale === "ar" ? /[\u0600-\u06FF]/.test(T(locale, k)) : !/[\u0600-\u06FF]/.test(T(locale, k))));
    }
  }
}
