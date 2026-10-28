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
import { mock } from "node:test";
import { join } from "node:path";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider, MutationObserver, onlineManager } from "@tanstack/react-query";
import { eq, ok } from "./_harness.ts";
import {
  completionBlock, completionDialogView, saveThenComplete, classifyStoredDraft, syncPrompt, describeStrandedDraft,
  createCompletionGuard, noEditsSince, type CompletionCloseSource,
} from "@/lib/visit-completion";
import { readDraft, writeDraft, clearDraft, createDraftWriter, draftOverPending, draftResponseTimes, type VisitDraft } from "@/lib/offline-drafts";
import { responseSaveItems, restoreDraftResponses, initialResponses } from "@/lib/visit-dirty";
import { makeOutsideInert, KEEP_LIVE_ATTR, type InertNode } from "@/lib/inert-outside";
import { saveVisitResponses, ResponsesNotStoredError } from "@/services/visit-responses";
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
     ["async function handleSave(): Promise<boolean> {", "onClick={() => { if (!showComplete) handleSave(); }}", "onSaveNow={handleSave}", "onSync={() => { void handleSave(); }}"].sort().join(" | "));
  ok("the restore prompt is still only for an open visit", page.includes("{pendingDraft && !isReadOnly && editsReady && ("));
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
  const SOURCES: CompletionCloseSource[] = ["cancel", "dismiss"];

  // The guard on its own.
  {
    const g = createCompletionGuard();
    let closed = 0;
    eq("idle: every way of closing closes", SOURCES.map((src) => g.requestClose(src, () => { closed++; })), [true, true]);
    eq("…each once", closed, 2);
    closed = 0;
    eq("an operation starts", g.begin(), true);
    eq("a second press while it runs is refused", g.begin(), false);
    eq("running: Cancel, and Escape / backdrop / X, are all refused", SOURCES.map((src) => g.requestClose(src, () => { closed++; })), [false, false]);
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
    eq("…and every attempt to close is refused", SOURCES.map((src) => g.requestClose(src, () => { closed++; })), [false, false]);
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
  ok("no close path calls onClose directly any more",
     !/onClick=\{onClose\}/.test(modal) && !/onClose=\{onClose\}/.test(modal) && (modal.match(/\bonClose\b/g) ?? []).length === 4);
  ok("Escape, the backdrop and the header X (the Modal's onClose) and Cancel each go through the guarded handler",
     modal.includes(`onClose={() => requestClose("dismiss")}`) && modal.includes(`onClick={() => requestClose("cancel")}`));
  ok("the handler asks the guard, not the button state", /function requestClose\(source: CompletionCloseSource\) \{\s+guard\.requestClose\(source, onClose\);/.test(modal));
  ok("the dialog adds no keyboard close path of its own (Escape is the Modal's, through the guard)", !/Escape|onKeyDown|keydown/.test(modal));
  ok("Cancel, the notes and the acknowledgement are disabled while busy", (modal.match(/disabled=\{busy\}/g) ?? []).length === 3);
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

// ── 7) Clearing answers, the page behind the dialog, leaving after an edit ───
// A cleared answer must reach the server, and a save that leaves an older
// value there must stop the completion. The completion dialog is the shared
// Modal, which makes the page behind it inert. An edit made just before the
// page is left is written to the local draft — never to the server.
console.log("7) clearing answers, the page behind the dialog, leaving right after an edit");
{
  // Which answers a save sends (responseSaveItems, used by the page's save).
  eq("cleared answers are sent as null; answers the screen never held are left out",
     responseSaveItems(
       ["f-text", "f-num", "f-new", "f-touched", "f-server-only"],
       { "f-text": "kept", "f-num": null, "f-touched": null },
     ),
     [
       { field_id: "f-text", value: "kept" },
       { field_id: "f-num", value: null },        // loaded with a value, then cleared
       { field_id: "f-touched", value: null },    // typed, then cleared
       // f-new: never answered, never touched. f-server-only: a value that
       // reached the server after the screen loaded — newer, so not cleared.
     ]);
  eq("nothing touched: nothing sent", responseSaveItems(["a", "b"], {}), []);
  eq("a text field cleared to \"\" is sent as \"\" — as before", responseSaveItems(["a"], { a: "" }), [{ field_id: "a", value: "" }]);
  eq("undefined on screen, for a field it held, counts as cleared", responseSaveItems(["a"], { a: undefined }), [{ field_id: "a", value: null }]);

  // The service writes the null, and reads back what was stored.
  const TABLE = "visit_template_responses";
  const sent = [{ field_id: "f-text", value: "kept" }, { field_id: "f-num", value: null }];
  const caught = (p: Promise<unknown>) => p.then(() => null, (e: unknown) => e);

  resetStub();
  queueResultFor(TABLE, { data: [{ field_id: "f-num", value: null }, { field_id: "f-text", value: "kept" }], error: null });
  eq("stored as sent: the save resolves", await caught(saveVisitResponses("v-1", "t-1", sent)), null);
  const call = recordedCalls()[0];
  eq("the cleared answer is written as null, on the (visit, field) key", call?.upsert, {
    values: [
      { visit_id: "v-1", template_id: "t-1", field_id: "f-text", value: "kept" },
      { visit_id: "v-1", template_id: "t-1", field_id: "f-num", value: null },
    ],
    options: { onConflict: "visit_id,field_id" },
  });
  eq("…and the written rows come back from the same request", [recordedCalls().length, call?.table, call?.columns], [1, TABLE, "field_id, value"]);

  resetStub();
  queueResultFor(TABLE, { data: [{ field_id: "f-text", value: "kept" }, { field_id: "f-num", value: 5 }], error: null });
  const stale = await caught(saveVisitResponses("v-1", "t-1", sent));
  ok("the old value came back: the save fails, naming the field",
     stale instanceof ResponsesNotStoredError && JSON.stringify(stale.fieldIds) === '["f-num"]');

  resetStub();
  queueResultFor(TABLE, { data: [{ field_id: "f-text", value: "kept" }], error: null });
  const missing = await caught(saveVisitResponses("v-1", "t-1", sent));
  ok("a row that did not come back at all: the save fails too",
     missing instanceof ResponsesNotStoredError && JSON.stringify(missing.fieldIds) === '["f-num"]');

  resetStub();
  queueResultFor(TABLE, { data: [{ field_id: "gps", value: { lng: 46.7, lat: 24.7 } }], error: null });
  eq("an object answer stored with its keys reordered (jsonb) still matches",
     await caught(saveVisitResponses("v-1", "t-1", [{ field_id: "gps", value: { lat: 24.7, lng: 46.7 } }])), null);

  resetStub();
  const dbError = { message: "permission denied", code: "42501" };
  queueResultFor(TABLE, { data: null, error: dbError });
  eq("a database error is passed on", await caught(saveVisitResponses("v-1", "t-1", sent)), dbError);

  // Save, then complete — with the real save service in the save step.
  const completeAfter = async (stored: unknown[]) => {
    resetStub();
    queueResultFor(TABLE, { data: stored, error: null });
    const calls: string[] = [];
    const outcome = await saveThenComplete({
      dirty: true, isOnline: () => true, revision: () => 1,
      save: async () => {
        calls.push("save");
        try {
          await saveVisitResponses("v-1", "t-1", responseSaveItems(["f-num"], { "f-num": null }));
          calls.push("stored");
          return true;
        } catch (e) {
          calls.push(e instanceof ResponsesNotStoredError ? "notStored" : "error");
          return false;
        }
      },
      complete: async () => { calls.push("complete"); },
    });
    return { outcome, calls };
  };
  eq("a cleared answer stored as null: saved first, then completed",
     await completeAfter([{ field_id: "f-num", value: null }]),
     { outcome: { kind: "completed", savedFirst: true, revision: 1 }, calls: ["save", "stored", "complete"] });
  eq("the old value still on the server: NOT completed",
     await completeAfter([{ field_id: "f-num", value: 5 }]),
     { outcome: { kind: "saveFailed" }, calls: ["save", "notStored"] });
  ok("a clear is an update, never a delete (merchandisers may not delete answers)",
     recordedCalls().length === 1 && recordedCalls().every((c) => c.upsert !== undefined));

  // The page behind the dialog: everything outside it is inert.
  type Fake = InertNode & { name: string; attrs: Set<string>; kids: Fake[]; parent: Fake | null };
  const el = (name: string, tagName = "DIV", kids: Fake[] = []): Fake => {
    const n: Fake = {
      name, tagName, attrs: new Set(), kids, parent: null,
      get parentElement() { return n.parent; },
      get children() { return n.kids; },
      hasAttribute: (a) => n.attrs.has(a),
      setAttribute: (a) => { n.attrs.add(a); },
      removeAttribute: (a) => { n.attrs.delete(a); },
    };
    kids.forEach((k) => { k.parent = n; });
    return n;
  };
  const dialog = el("dialog"), content = el("content"), stickyBar = el("stickyBar"), sidebar = el("sidebar");
  const toastRegion = el("toastRegion", "SECTION"), toaster = el("toaster", "DIV", [toastRegion]);
  const pageStatus = el("pageStatus"), strayLive = el("strayLive");
  const alreadyInert = el("alreadyInert"), script = el("script", "SCRIPT");
  toaster.attrs.add(KEEP_LIVE_ATTR);        // the toast container, opted in (providers.tsx)
  toastRegion.attrs.add("aria-live");
  pageStatus.attrs.add("aria-live");        // a live region on the page behind
  strayLive.attrs.add("aria-live");         // a live region elsewhere, not opted in
  alreadyInert.attrs.add("inert");
  const main = el("main", "MAIN", [content, pageStatus, stickyBar, dialog]);
  const app  = el("app", "DIV", [sidebar, main]);
  el("body", "BODY", [app, toaster, strayLive, alreadyInert, script]);
  const all = [dialog, content, pageStatus, stickyBar, sidebar, main, app, toaster, toastRegion, strayLive, alreadyInert, script];
  const inert = () => all.filter((n) => n.attrs.has("inert")).map((n) => n.name).sort();

  const undo = makeOutsideInert(dialog);
  eq("open: the page content, the action bar (Mark missed, Save), the sidebar and the rest of the page are inert",
     inert(), ["alreadyInert", "content", "pageStatus", "sidebar", "stickyBar", "strayLive"]);
  ok("…the dialog and its own ancestors are not", ![dialog, main, app].some((n) => n.attrs.has("inert")));
  ok("…the toast container, opted in, is not: its toasts stay announced and closable",
     !toaster.attrs.has("inert") && !toastRegion.attrs.has("inert"));
  ok("…being a live region is not enough: the page's own and a stray one go inert",
     pageStatus.attrs.has("inert") && strayLive.attrs.has("inert"));
  undo();
  eq("closed: only what it marked is unmarked", inert(), ["alreadyInert"]);

  // Wiring of the dialog and the page.
  const src = join(import.meta.dirname, "..", "src");
  const modal     = readFileSync(join(src, "app", "(dashboard)", "visits", "_components", "CompleteModal.tsx"), "utf8");
  const shared    = readFileSync(join(src, "components", "ui", "Modal.tsx"), "utf8");
  const page      = readFileSync(join(src, "app", "(dashboard)", "visits", "[id]", "page.tsx"), "utf8");
  const draftHook = readFileSync(join(src, "hooks", "use-offline-visit-draft.ts"), "utf8");
  ok("the completion dialog is the shared Modal, told when it is busy, with no overlay of its own",
     /<Modal\s+onClose=\{\(\) => requestClose\("dismiss"\)\}[\s\S]{0,200}busy=\{busy\}/.test(modal) && !modal.includes("fixed inset-0"));
  ok("the Modal is a labelled modal dialog", /role="dialog"\s+aria-modal="true"\s+aria-labelledby=\{titleId\}/.test(shared));
  ok("the Modal makes the page behind inert, before it moves focus (so focus can go back on close)",
     shared.indexOf("return makeOutsideInert(root);") > 0 && shared.indexOf("return makeOutsideInert(root);") < shared.indexOf("(first ?? panel).focus();"));
  ok("focus that lands outside the Modal is brought back",
     shared.includes(`document.addEventListener("focusin", onFocusIn);`) &&
     /function onFocusIn\(e: FocusEvent\) \{\s+if \(panel && e\.target instanceof Node && !panel\.contains\(e\.target\)\) panel\.focus\(\);/.test(shared) &&
     /document\.removeEventListener\("focusin", onFocusIn\);\s+[\s\S]{0,200}opener\.focus\(\)/.test(shared));
  ok("going busy keeps focus on the Modal when the focused control is disabled",
     /if \(!busy \|\| !panel\) return;[\s\S]{0,200}if \(!active \|\| !panel\.contains\(active\) \|\| active\.disabled\) panel\.focus\(\);\s+\}, \[busy\]\);/.test(shared));
  ok("a press on the backdrop does not move focus out of the Modal",
     shared.includes("onMouseDown={(e) => { if (!panelRef.current?.contains(e.target as Node)) e.preventDefault(); }}"));
  ok("Tab with every control disabled stays on the Modal", /if \(items\.length === 0\) \{[\s\S]{0,80}e\.preventDefault\(\);\s+return;/.test(shared));
  ok("Escape is still ignored while busy — unchanged", shared.includes(`if (e.key !== "Escape" || busyRef.current) return;`));
  ok("Mark missed does nothing while the completion dialog is open",
     page.includes("onClick={() => { if (!showComplete) missedMutation.mutate(id); }}") && page.includes("disabled={showComplete || missedMutation.isPending}"));
  ok("…nor does the page's Save button",
     page.includes("onClick={() => { if (!showComplete) handleSave(); }}") && page.includes(`disabled={showComplete || isSaving || syncStatus === "saving"}`));
  ok("the page's save sends cleared answers (responseSaveItems over what the screen holds)",
     /function buildResponseItems\(\) \{[\s\S]{0,250}return responseSaveItems\(fieldIds, responses\);/.test(page) && !page.includes("responses[f.id] ?? null"));

  // Leaving right after an edit: the last edit reaches the draft, locally only.
  resetStub();
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    let clock = Date.parse("2026-10-28T09:00:00.000Z");
    const now = () => clock;
    let written = 0;
    const id = "v-leave";
    clearDraft(id);
    const w = createDraftWriter(500, () => { written++; }, now);
    const qtyIn = () => readDraft(id)?.products.p1?.qty_found;

    w.edit(id, { p1: { qty_found: "7", notes: "" } }, { f1: "a" });
    clock += 100; mock.timers.tick(100);
    eq("100 ms after an edit nothing is written yet", [readDraft(id), w.hasPending()], [null, true]);
    eq("leaving now writes it", w.flush(), true);
    eq("…the whole edit, marked unsaved", readDraft(id), {
      visit_id: id, products: { p1: { qty_found: "7", notes: "" } }, responses: { f1: "a" },
      last_saved_locally_at: new Date(clock).toISOString(), dirty: true,
    });
    clock += 1000; mock.timers.tick(1000);
    eq("…once: the timer no longer fires", [written, w.hasPending(), w.flush()], [1, false, false]);

    w.edit(id, { p1: { qty_found: "8", notes: "" } }, {});
    clock += 500; mock.timers.tick(500);
    eq("staying: written after the pause, as before", [qtyIn(), written], ["8", 2]);

    w.edit(id, { p1: { qty_found: "9", notes: "" } }, {});
    clock += 50;
    writeDraft({ visit_id: id, products: { p1: { qty_found: "99", notes: "" } }, responses: {}, last_saved_locally_at: new Date(clock).toISOString(), dirty: true });
    clock += 10;
    eq("a draft stored after the edit (another tab) is not overwritten on leaving", [w.flush(), qtyIn()], [false, "99"]);

    w.edit(id, { p1: { qty_found: "10", notes: "" } }, {});
    w.cancel();   // markSynced: the server has these edits
    clock += 600; mock.timers.tick(600);
    eq("a save that took the edit cancels the pending write", [w.flush(), qtyIn()], [false, "99"]);

    w.edit(id, { p1: { qty_found: "11", notes: "" } }, {});
    w.cancel(); clearDraft(id);   // clearLocalDraft after completion
    eq("a draft cleared after completion is not written back on leaving", [w.flush(), readDraft(id)], [false, null]);
  } finally {
    mock.timers.reset();
  }
  eq("nothing in any of that reached the server", recordedCalls().length, 0);

  ok("the hook writes a pending edit on unmount, on pagehide and when the page is hidden",
     /return \(\) => \{[\s\S]{0,200}window\.removeEventListener\("pagehide", onPageHide\);\s+writer\.flush\(\);/.test(draftHook) &&
     draftHook.includes('const onHidden = () => { if (document.visibilityState === "hidden") writer.flush(); };') &&
     draftHook.includes('window.addEventListener("pagehide", onPageHide);'));
  ok("every edit goes through the writer",
     /editRevisionRef\.current \+= 1;[\s\S]{0,700}writer\.edit\(visitId, products, responses, \{ responseTimes: responseTimesRef\.current \}\);[\s\S]{0,500}writer\.edit\(visitId, merged\.products, merged\.responses, \{ savedAt: merged\.savedAt, responseTimes: merged\.responseTimes \}\);/.test(draftHook));
  ok("a successful save and clearing the draft cancel the pending write",
     /else writer\.cancel\(\);\s+if \(latestDataRef\.current && !pendingRef\.current\) \{/.test(draftHook) &&
     /const clearLocalDraft = useCallback\(\(\) => \{\s+writer\.cancel\(\);[\s\S]{0,200}clearDraft\(visitId\);/.test(draftHook));
  ok("the draft hook talks to no server", !/@\/services|supabase|fetch\(/.test(draftHook));

  for (const locale of ["ar", "en"] as const) {
    ok(`[${locale}] visits.responsesNotStored exists${locale === "ar" ? " in Arabic" : " in English"}`,
       !!T(locale, "visits.responsesNotStored") &&
       (locale === "ar" ? /[؀-ۿ]/.test(T(locale, "visits.responsesNotStored")) : !/[؀-ۿ]/.test(T(locale, "visits.responsesNotStored"))));
  }
}

// ── 8) Toasts over an open dialog, a photo uploaded after the draft, and ─────
//       values compared as they travel
console.log("8) toasts over a dialog, a photo uploaded after the draft, values as sent");
{
  const src = join(import.meta.dirname, "..", "src");
  const read = (...p: string[]) => readFileSync(join(src, ...p), "utf8");
  const TABLE = "visit_template_responses";
  const caught = (p: Promise<unknown>) => p.then(() => null, (e: unknown) => e);

  // Toasts: the container is the only element opted out, and the completion
  // dialog says a failed completion itself as well.
  const providers = read("app", "(dashboard)", "providers.tsx");
  const modal     = read("app", "(dashboard)", "visits", "_components", "CompleteModal.tsx");
  ok("the toast container is opted out of the inert page, and nothing else is",
     /<div data-modal-keep-live="">\s+<Toaster[\s\S]{0,200}closeButton/.test(providers) &&
     KEEP_LIVE_ATTR === "data-modal-keep-live" &&
     (providers.match(/data-modal-keep-live/g) ?? []).length === 1);
  ok("the completion dialog states every stopped outcome itself, a failed completion included",
     /\/\/ must not depend on it\.\s+setStopped\(outcome\.kind\);/.test(modal) &&
     /stopped === "completeFailed" \? t\("visits\.unsaved\.completeFailed"\)/.test(modal) &&
     /\{stopped && \(\s+<p role="alert"/.test(modal));
  for (const locale of ["ar", "en"] as const) {
    ok(`[${locale}] visits.unsaved.completeFailed exists${locale === "ar" ? " in Arabic" : " in English"}`,
       !!T(locale, "visits.unsaved.completeFailed") &&
       (locale === "ar" ? /[؀-ۿ]/.test(T(locale, "visits.unsaved.completeFailed")) : !/[؀-ۿ]/.test(T(locale, "visits.unsaved.completeFailed"))));
  }

  // Why the photo sequence below is reachable today, from the code.
  const field = read("app", "(dashboard)", "visits", "_components", "TemplateFieldSection.tsx");
  const upload = read("hooks", "use-photo-upload.ts");
  const queue  = read("hooks", "use-offline-photo-queue.ts");
  const draftHook = read("hooks", "use-offline-visit-draft.ts");
  ok("reachable: removing the old photo never throws — offline its failure is only logged",
     /const remove = useCallback\(\s+async \(path: string\): Promise<void> => \{\s+try \{\s+await deleteVisitPhoto\(path\);\s+\} catch \(err\) \{\s+\/\/ Non-fatal/.test(upload));
  ok("reachable: replacing a photo sets the answer to null, then (offline) queues the new one",
     /if \(photoMeta\?\.path\) \{\s+await remove\(photoMeta\.path\);\s+onChange\(field\.id, null\);\s+\}\s+if \(!isOnline\) \{[\s\S]{0,200}await enqueue\(file\)/.test(field));
  ok("reachable: the queue writes the new photo to the server itself, then tells the screen",
     /await saveVisitResponses\(item\.visit_id, item\.template_id, \[\s+\{ field_id: item\.field_id, value: meta \},\s+\]\);[\s\S]{0,400}onUploaded\(item\.field_id, meta\);/.test(queue));
  ok("reachable: the draft keeps every answer, the photo's null included (no photo filtering)",
     draftHook.includes("writer.edit(visitId, products, responses, { responseTimes: responseTimesRef.current });") &&
     !/isPhotoMeta|type === "photo"|PhotoMeta/.test(draftHook));

  // The full sequence, with the real restore, save-items and save service.
  const PHOTO = "f-photo", TEXT = "f-text", FIELDS = [PHOTO, TEXT];
  const M1 = { path: "v/f/old.jpg", file_name: "old.jpg", mime_type: "image/jpeg", size: 10, uploaded_at: "2026-10-27T08:00:00.000Z" };
  const M2 = { path: "v/f/new.jpg", file_name: "new.jpg", mime_type: "image/jpeg", size: 12, uploaded_at: "2026-10-28T10:00:00.000Z" };
  // The server: its rows, and a save through the real service that the stub
  // answers by storing what was sent.
  const run = async (o: { uploadReachesScreen: boolean; removedAfterUpload?: boolean }) => {
    const server: Record<string, unknown> = { [PHOTO]: M1, [TEXT]: "before" };
    const save = async (items: Array<{ field_id: string; value: unknown }>) => {
      resetStub();
      const stored = items.map((i) => ({ field_id: i.field_id, value: i.value === undefined ? null : JSON.parse(JSON.stringify(i.value)) }));
      queueResultFor(TABLE, { data: stored, error: null });
      await saveVisitResponses("v-1", "t-1", items);
      stored.forEach((r) => { server[r.field_id] = r.value; });
    };
    // 1. Offline: the photo is replaced (old one removed, answer null, new one
    //    queued) and a text answer edited. The draft is written at 09:00.
    let screen: Record<string, unknown> = { ...server, [PHOTO]: null, [TEXT]: "offline edit" };
    let draft = { responses: { ...screen }, last_saved_locally_at: "2026-10-28T09:00:00.000Z" };
    // 2. Later, online, the page is opened again: the screen loads the server.
    screen = { ...server };
    const loaded = { ...server };
    // 3. Retry: the queue uploads the new photo (10:00) and writes it to the server.
    await save([{ field_id: PHOTO, value: M2 }]);
    if (o.uploadReachesScreen) screen = { ...screen, [PHOTO]: M2 };
    // (Variant: the user removed the new photo afterwards, offline, at 11:00.)
    if (o.removedAfterUpload) draft = { responses: { ...screen, [PHOTO]: null, [TEXT]: "offline edit" }, last_saved_locally_at: "2026-10-28T11:00:00.000Z" };
    // 4. The user restores the older draft. The saved answers the page knows
    //    are what it loaded, or a refetch made after the upload.
    const saved = o.uploadReachesScreen ? loaded : { ...server };
    screen = restoreDraftResponses({ draft: draft.responses, draftSavedAt: draft.last_saved_locally_at, current: screen, saved, photoFieldIds: [PHOTO] });
    // 5. Save.
    const items = responseSaveItems(FIELDS, screen);
    await save(items);
    return { screenPhoto: screen[PHOTO], sentPhoto: items.find((i) => i.field_id === PHOTO)?.value, server, wholesale: responseSaveItems(FIELDS, draft.responses).find((i) => i.field_id === PHOTO)?.value };
  };

  const a = await run({ uploadReachesScreen: true });
  eq("restoring a draft older than the upload keeps the new photo on screen", a.screenPhoto, M2);
  eq("…the save sends the new photo, not null", a.sentPhoto, M2);
  eq("…and the server ends with the new photo and the draft's text edit", a.server, { [PHOTO]: M2, [TEXT]: "offline edit" });
  eq("(restoring the draft as it was would have sent null for the photo)", a.wholesale, null);

  const b = await run({ uploadReachesScreen: false });
  eq("the upload never reached the screen, but a refetch has it: still kept", [b.screenPhoto, b.sentPhoto, b.server[PHOTO]], [M2, M2, M2]);

  const c = await run({ uploadReachesScreen: true, removedAfterUpload: true });
  eq("a photo removed AFTER the upload stays removed: the draft is newer", [c.screenPhoto, c.sentPhoto, c.server[PHOTO]], [null, null, null]);

  // A new photo on an empty field, offline: the draft has no key for it.
  eq("restoring a draft without the field keeps the photo that arrived since",
     restoreDraftResponses({ draft: { [TEXT]: "x" }, draftSavedAt: "2026-10-28T09:00:00.000Z", current: { [PHOTO]: M2 }, saved: {}, photoFieldIds: [PHOTO] }),
     { [PHOTO]: M2, [TEXT]: "x" });
  eq("…and if it never reached the screen, the save leaves the server's photo alone",
     responseSaveItems(FIELDS, { [TEXT]: "x" }), [{ field_id: TEXT, value: "x" }]);
  eq("a photo without an upload time never overrides the draft",
     restoreDraftResponses({ draft: { [PHOTO]: null }, draftSavedAt: "2026-10-28T09:00:00.000Z", current: { [PHOTO]: { path: "p", file_name: "f", mime_type: "image/jpeg", size: 1 } }, saved: {}, photoFieldIds: [PHOTO] }),
     { [PHOTO]: null });
  eq("answers the draft does not mention keep what the screen or the server has",
     restoreDraftResponses({ draft: { [TEXT]: "draft" }, draftSavedAt: "2026-10-28T09:00:00.000Z", current: { "f-later": "typed since" }, saved: { "f-other": "from another device" }, photoFieldIds: [PHOTO] }),
     { [TEXT]: "draft", "f-later": "typed since", "f-other": "from another device" });
  eq("non-photo fields: the draft wins, as before",
     restoreDraftResponses({ draft: { [TEXT]: "draft" }, draftSavedAt: "2026-10-28T09:00:00.000Z", current: { [TEXT]: "screen" }, saved: { [TEXT]: "server" }, photoFieldIds: [PHOTO] }),
     { [TEXT]: "draft" });
  const page = read("app", "(dashboard)", "visits", "[id]", "page.tsx");
  ok("the page restores through restoreDraftResponses, with its photo fields",
     /setResponses\(restoreDraftResponses\(\{[\s\S]{0,300}photoFieldIds: \(template\?\.fields \?\? \[\]\)\.filter\(\(f\) => f\.type === "photo"\)/.test(page) &&
     !page.includes("setResponses(pendingDraft.responses as FieldResponses)"));

  // Values compared in the form they travel in.
  resetStub();
  queueResultFor(TABLE, { data: [{ field_id: "gps", value: { latitude: 24.7, longitude: 46.7 } }], error: null });
  eq("an object with a key set to undefined: sent without it, and matched without it",
     [await caught(saveVisitResponses("v-1", "t-1", [{ field_id: "gps", value: { latitude: 24.7, longitude: 46.7, accuracy: undefined } }])), recordedCalls()[0]?.upsert?.values],
     [null, [{ visit_id: "v-1", template_id: "t-1", field_id: "gps", value: { latitude: 24.7, longitude: 46.7 } }]]);
  resetStub();
  queueResultFor(TABLE, { data: [{ field_id: "n", value: null }], error: null });
  eq("a non-finite number travels as null, as it always has, and is matched as null",
     await caught(saveVisitResponses("v-1", "t-1", [{ field_id: "n", value: Infinity }])), null);
  resetStub();
  queueResultFor(TABLE, { data: [{ field_id: "n", value: 4 }], error: null });
  ok("a real difference still fails the save",
     (await caught(saveVisitResponses("v-1", "t-1", [{ field_id: "n", value: 5 }]))) instanceof ResponsesNotStoredError);
}

// ── 9) The server's answers arriving after the screen is usable ─────────────
// The visit page copies the server's answers into its edit state once, when
// the template and the answers have both loaded (respInitialized). The restore
// prompt and the form can be on screen before that. Driven here with a server
// response held back by the test, through the page's own rules: the copy
// (initialResponses) and the restore (restoreDraftResponses), and the gate on
// the prompt (editsReady), checked in the page's source.
console.log("9) the server's answers arriving late");
{
  type Deferred<T> = { promise: Promise<T>; resolve: (v: T) => void };
  const deferred = <T,>(): Deferred<T> => { let resolve!: (v: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; };
  const FIELD = "f-count", OTHER = "f-note";

  // The page, reduced to its edit state and the effect that copies the
  // server's answers in. `copy` is the rule under test.
  const page = (copy: (server: Record<string, unknown>, onScreen: Record<string, unknown>) => Record<string, unknown>) => {
    let responses: Record<string, unknown> = {};
    let initialized = false;
    return {
      get responses() { return responses; },
      get editsReady() { return initialized; },
      type(id: string, v: unknown) { responses = { ...responses, [id]: v }; },
      restore(draft: Record<string, unknown>) { responses = restoreDraftResponses({ draft, draftSavedAt: "2026-10-28T09:00:00.000Z", current: responses, saved: {}, photoFieldIds: [] }); },
      async load(server: Promise<Record<string, unknown>>) { const rows = await server; responses = copy(rows, responses); initialized = true; },
    };
  };

  // Typing while the server's answers are still on their way.
  {
    const server = deferred<Record<string, unknown>>();
    const p = page(initialResponses);
    const loading = p.load(server.promise);
    await tick(5);
    p.type(FIELD, 7);                                         // the form is up; the answers are not
    server.resolve({ [FIELD]: 3, [OTHER]: "saved note" });   // they arrive late
    await loading;
    eq("typed before the server's answers arrived: the typed value is kept, the rest filled in",
       p.responses, { [FIELD]: 7, [OTHER]: "saved note" });

    const old = page((serverRows) => ({ ...serverRows }));   // the copy as it was
    const loadingOld = old.load(Promise.resolve({ [FIELD]: 3 }).then(async (r) => { await tick(5); return r; }));
    old.type(FIELD, 7);
    await loadingOld;
    eq("(the copy as it was replaced it with the server's value)", old.responses, { [FIELD]: 3 });
  }

  // Restoring while the server's answers are still on their way.
  {
    const server = deferred<Record<string, unknown>>();
    const p = page(initialResponses);
    const loading = p.load(server.promise);
    await tick(5);
    eq("before the server's answers arrive, the restore is not offered (editsReady is false)", p.editsReady, false);
    server.resolve({ [FIELD]: 3, [OTHER]: "saved note" });
    await loading;
    eq("once they have, it is", p.editsReady, true);
    p.restore({ [FIELD]: 12 });
    eq("…and restoring then keeps the draft's value, with nothing left to overwrite it", p.responses, { [FIELD]: 12, [OTHER]: "saved note" });

    const old = page((serverRows) => ({ ...serverRows }));
    const slow = deferred<Record<string, unknown>>();
    const loadingOld = old.load(slow.promise);
    old.restore({ [FIELD]: 12 });                            // what an ungated prompt allowed
    slow.resolve({ [FIELD]: 3 });
    await loadingOld;
    eq("(restored before they arrived, the draft's value used to be replaced)", old.responses, { [FIELD]: 3 });
  }

  eq("initialResponses: on-screen values win, server values fill the rest",
     initialResponses({ a: 1, b: 2 }, { b: 20, c: null }), { a: 1, b: 20, c: null });

  // The page's wiring.
  const src  = readFileSync(join(import.meta.dirname, "..", "src", "app", "(dashboard)", "visits", "[id]", "page.tsx"), "utf8");
  ok("the copy of the server's answers merges under what is on screen",
     src.includes("setResponses((onScreen) => initialResponses(initial, onScreen) as FieldResponses);") && !/\n\s+setResponses\(initial\);/.test(src));
  ok("the restore prompt is shown only once the server's values are on screen",
     src.includes("{pendingDraft && !isReadOnly && editsReady && ("));
  ok("…and the restore handler refuses earlier too",
     /function handleRestoreDraft\(\) \{[\s\S]{0,250}if \(!pendingDraft \|\| !editsReady\) return;/.test(src));
  ok("editsReady waits for the server's answers whenever the visit has a template",
     src.includes("const editsReady = prodInitialized.current && (!templateId || respInitialized.current);"));
  ok("products: rows (and so their inputs) render only after they load, and the copy runs on that load — nothing to type into before it",
     src.includes("{!productsLoading && visitProducts.length > 0 && (") &&
     src.includes("if (prodInitialized.current || productsLoading || !visit) return;"));
  ok("the form itself can show before the server's answers (it waits only for the template) — why the merge is needed",
     /\{templateId && template && template\.fields\.length > 0 && \(\s+<TemplateFieldSection/.test(src) && !/responsesLoading && \(\s+<TemplateFieldSection/.test(src));
}

// ── 10) Editing while an older draft waits (the template failed to load) ─────
// The visit page offers a stored draft only once the template and the
// server's answers are on screen (editsReady). If the template fails to load,
// that never happens, but product rows still load and can be edited. Each
// edit used to write the whole screen — answers {} because they were never
// copied in — over the waiting draft. Driven here through the real draft
// module (writer, storage, merge) the way the hook drives it; the hook's own
// wiring is checked in its source below.
console.log("10) editing while an older draft waits");
{
  const ID = "v-waiting";
  const OLD_AT = "2026-10-28T08:00:00.000Z";
  const oldDraft: VisitDraft = {
    visit_id: ID, products: { p1: { qty_found: "4", notes: "" }, p2: { qty_found: "1", notes: "shelf" } },
    responses: { f1: "answer typed offline", f2: 9 }, last_saved_locally_at: OLD_AT, dirty: true,
  };

  // One page session: the hook's state (pending draft, what was touched),
  // the screen's edit state, and its writes — as use-offline-visit-draft does.
  const session = (opts: { now: () => number }) => {
    const stored = readDraft(ID);
    let pending: VisitDraft | null = classifyStoredDraft(stored, false) === "restorable" ? stored : null;
    let touched = { products: new Set<string>(), responses: new Set<string>() };
    const writer = createDraftWriter(500, () => {}, opts.now);
    // Server values on screen: products loaded; answers only if the template did.
    const screen = { products: { p1: { qty_found: "", notes: "" }, p2: { qty_found: "", notes: "" } } as Record<string, { qty_found: string; notes: string }>, responses: {} as Record<string, unknown> };
    const s = {
      get pending() { return pending; },
      screen,
      editProduct(id: string, qty: string) {
        screen.products = { ...screen.products, [id]: { ...screen.products[id], qty_found: qty } };
        touched.products.add(id);
        if (!pending) { writer.edit(ID, screen.products, screen.responses); return; }
        const m = draftOverPending(pending, screen, touched);
        writer.edit(ID, m.products, m.responses, { savedAt: m.savedAt, responseTimes: m.responseTimes });
        pending = { ...pending, products: m.products, responses: m.responses, last_saved_locally_at: m.savedAt ?? new Date(opts.now()).toISOString() };
      },
      templateLoads(serverAnswers: Record<string, unknown>) { screen.responses = initialResponses(serverAnswers, screen.responses); },
      restore() {
        screen.products = pending!.products as typeof screen.products;
        screen.responses = restoreDraftResponses({ draft: pending!.responses, draftSavedAt: pending!.last_saved_locally_at, current: screen.responses, saved: {}, photoFieldIds: [] });
        pending = null; touched = { products: new Set(), responses: new Set() };
      },
      discard() {
        const editedHere = touched.products.size + touched.responses.size > 0;
        writer.cancel(); clearDraft(ID); pending = null; touched = { products: new Set(), responses: new Set() };
        if (editedHere) { writer.edit(ID, screen.products, screen.responses); writer.flush(); }
      },
      leave() { writer.flush(); },   // unmount / pagehide
    };
    return s;
  };
  let clock = Date.parse("2026-10-28T10:00:00.000Z");
  const now = () => clock;

  // A. An older draft with answers; the template fails; a product is edited; the user leaves.
  writeDraft(oldDraft);
  {
    const s = session({ now });
    s.editProduct("p1", "5");                 // template never loads in this session
    clock += 600; s.leave();
  }
  const afterA = readDraft(ID)!;
  eq("A. template failed, product edited, page left: the old answers are still in the draft", afterA.responses, oldDraft.responses);
  eq("…and so is the new product edit, next to the draft's other product", afterA.products, { p1: { qty_found: "5", notes: "" }, p2: { qty_found: "1", notes: "shelf" } });
  eq("…the draft keeps its time (its answers are still those of 08:00), and is still offered", [afterA.last_saved_locally_at, classifyStoredDraft(afterA, false)], [OLD_AT, "restorable"]);

  // C1. Reload; the template loads this time; the user restores.
  {
    const s = session({ now });
    s.templateLoads({ f1: "server value" });
    s.restore();
    eq("C. later the template loads and the user restores: old answers and the product edit are both on screen",
       [s.screen.responses, s.screen.products.p1.qty_found, s.screen.products.p2.notes], [{ f1: "answer typed offline", f2: 9 }, "5", "shelf"]);
    eq("…and the restored values went nowhere but the screen (nothing written by restoring)", readDraft(ID)!.responses, oldDraft.responses);
  }

  // C2. Same start, but the user discards the old draft after editing a product.
  writeDraft(oldDraft);
  {
    const s = session({ now });
    s.templateLoads({ f1: "server value" });
    s.editProduct("p2", "7");                 // edited while the prompt was up
    s.discard();
    const d = readDraft(ID)!;
    eq("C. discarding: the old answers go, the server's stay on screen", s.screen.responses, { f1: "server value" });
    eq("…but this session's product edit is kept in the draft, written at once", [d.products.p2.qty_found, d.responses, d.dirty], ["7", { f1: "server value" }, true]);
  }

  // B. No older draft: the template fails, a product is edited, the user leaves.
  clearDraft(ID);
  {
    const s = session({ now });
    eq("B. no older draft: nothing waits", s.pending, null);
    s.editProduct("p1", "3");
    clock += 600; s.leave();
  }
  const afterB = readDraft(ID)!;
  eq("B. the product edit is in the draft despite the template failing", [afterB.products.p1.qty_found, afterB.dirty], ["3", true]);
  {
    const s = session({ now });
    s.templateLoads({ f1: "server value" });
    s.restore();
    eq("…and restoring it later keeps the server's answers (the draft has none to impose)", [s.screen.products.p1.qty_found, s.screen.responses], ["3", { f1: "server value" }]);
  }

  // A late answer from the server never replaces what is on screen.
  eq("late server answers fill in, never overwrite", initialResponses({ f1: "server", f2: 1 }, { f1: "typed" }), { f1: "typed", f2: 1 });

  // The merge itself.
  const touchedNone = { products: new Set<string>(), responses: new Set<string>() };
  eq("draftOverPending: nothing touched → the waiting draft as it is, with its time",
     draftOverPending(oldDraft, { products: { p1: { qty_found: "", notes: "" } }, responses: {} }, touchedNone),
     { products: oldDraft.products, responses: oldDraft.responses, responseTimes: { f1: OLD_AT, f2: OLD_AT }, savedAt: OLD_AT });
  eq("draftOverPending: a touched answer goes on top with this session's time, and the draft time is then the write's",
     draftOverPending(oldDraft, { products: {}, responses: { f1: "typed now" } }, { products: new Set(), responses: new Set(["f1"]) }, { f1: "2026-10-28T10:30:00.000Z" }),
     { products: oldDraft.products, responses: { f1: "typed now", f2: 9 }, responseTimes: { f1: "2026-10-28T10:30:00.000Z", f2: OLD_AT } });
  eq("the writer writes a given time instead of its own",
     (() => { clearDraft(ID); const w = createDraftWriter(500, () => {}, () => Date.parse("2026-10-28T12:00:00.000Z")); w.edit(ID, {}, {}, { savedAt: OLD_AT }); w.flush(); return readDraft(ID)!.last_saved_locally_at; })(),
     OLD_AT);
  clearDraft(ID);

  // The hook's wiring.
  const hook = readFileSync(join(import.meta.dirname, "..", "src", "hooks", "use-offline-visit-draft.ts"), "utf8");
  const pageSrc = readFileSync(join(import.meta.dirname, "..", "src", "app", "(dashboard)", "visits", "[id]", "page.tsx"), "utf8");
  ok("edits while a draft waits are merged over it, and the prompt offers the merged draft",
     /const pending = pendingRef\.current;\s+if \(!pending\) \{\s+writer\.edit\(visitId, products, responses, \{ responseTimes: responseTimesRef\.current \}\);\s+return;\s+\}[\s\S]{0,200}const merged = draftOverPending\(pending, \{ products, responses \}, touchedRef\.current, responseTimesRef\.current\);\s+writer\.edit\(visitId, merged\.products, merged\.responses, \{ savedAt: merged\.savedAt, responseTimes: merged\.responseTimes \}\);\s+setPending\(\{/.test(hook));
  ok("what was touched is recorded from the page's edit handlers",
     pageSrc.includes("updateDraft(next as DraftProducts, draftDataRef.current.responses, { productId });") &&
     pageSrc.includes("updateDraft(draftDataRef.current.entries as DraftProducts, next, { fieldId });") &&
     hook.includes("if (touched?.productId) touchedRef.current.products.add(touched.productId);") &&
     /if \(touched\?\.fieldId\) \{\s+touchedRef\.current\.responses\.add\(touched\.fieldId\);/.test(hook));
  ok("the waiting draft is tracked in a ref kept in step with the prompt, and cleared with it",
     /const setPending = useCallback\(\(draft: VisitDraft \| null\) => \{\s+pendingRef\.current = draft;\s+setPendingDraft\(draft\);\s+if \(!draft\) touchedRef\.current = \{ products: new Set\(\), responses: new Set\(\) \};/.test(hook) &&
     !/\bsetPendingDraft\((?!draft\))/.test(hook));
  ok("discarding writes this session's edits back as the draft at once",
     /const discardDraft = useCallback\(\(\) => \{\s+const editedHere = [\s\S]{0,200}clearDraft\(visitId\);\s+setPending\(null\);\s+if \(editedHere && latestDataRef\.current\) \{\s+writer\.edit\(visitId, latestDataRef\.current\.products, latestDataRef\.current\.responses, \{ responseTimes: responseTimesRef\.current \}\);\s+writer\.flush\(\);/.test(hook));
  ok("a successful save does not replace a waiting draft with its clean copy, and writes the merged edits into it",
     /if \(pendingRef\.current\) writer\.flush\(\);\s+else writer\.cancel\(\);\s+if \(latestDataRef\.current && !pendingRef\.current\) \{/.test(hook));
  ok("completing does not delete a waiting draft — it is kept, to be shown read-only for the closed visit",
     /const clearLocalDraft = useCallback\(\(\) => \{\s+writer\.cancel\(\);\s+if \(pendingRef\.current\) \{\s+writeDraft\(\{ \.\.\.pendingRef\.current, dirty: true \}\);/.test(hook));
  eq("…which the closed visit then classifies as stranded", classifyStoredDraft({ ...oldDraft }, true), "stranded");
}

// ── 11) A photo answer's own time, not the draft's ──────────────────────────
// A draft's last_saved_locally_at moves with every edit. Restoring used it to
// decide whether the draft's photo answer is newer than a photo uploaded
// since — so editing a text answer made a stale photo answer (null from an
// offline replacement) look newer than the replacement photo, and restoring
// then saving cleared it. Each answer now carries its own time
// (response_times). Driven through the real draft module, restore, save items
// and save service, across page loads; the hook's wiring is checked below.
console.log("11) a photo answer's own time");
{
  const ID = "v-photo-times", TABLE = "visit_template_responses";
  const PHOTO = "f-photo", TEXT = "f-text", FIELDS = [PHOTO, TEXT];
  const M1 = { path: "v/f/old.jpg", file_name: "old.jpg", mime_type: "image/jpeg", size: 10, uploaded_at: "2026-10-28T07:00:00.000Z" };
  const M2 = { path: "v/f/new.jpg", file_name: "new.jpg", mime_type: "image/jpeg", size: 12, uploaded_at: "2026-10-28T09:00:00.000Z" };
  let clock = 0;
  const at = (iso: string) => { clock = Date.parse(iso); };
  const iso = () => new Date(clock).toISOString();
  const server: Record<string, unknown> = {};
  const saveToServer = async (items: Array<{ field_id: string; value: unknown }>) => {
    resetStub();
    const stored = items.map((i) => ({ field_id: i.field_id, value: i.value === undefined ? null : JSON.parse(JSON.stringify(i.value)) }));
    queueResultFor(TABLE, { data: stored, error: null });
    await saveVisitResponses(ID, "t-1", items);
    stored.forEach((r) => { server[r.field_id] = r.value; });
  };

  // One page load, as use-offline-visit-draft and the visit page run it.
  const page = () => {
    const stored = readDraft(ID);
    let pending: VisitDraft | null = classifyStoredDraft(stored, false) === "restorable" ? stored : null;
    let touched = { products: new Set<string>(), responses: new Set<string>() };
    let times: Record<string, string> = {};
    const writer = createDraftWriter(500, () => {}, () => clock);
    const loaded = { ...server };
    let screen: Record<string, unknown> = { ...loaded };          // the server's answers, copied in
    return {
      get screen() { return screen; },
      get pending() { return pending; },
      setAnswer(id: string, v: unknown) {                        // handleResponseChange → updateDraft
        screen = { ...screen, [id]: v };
        touched.responses.add(id);
        times = { ...times, [id]: iso() };
        if (!pending) { writer.edit(ID, {}, screen, { responseTimes: times }); return; }
        const m = draftOverPending(pending, { products: {}, responses: screen }, touched, times);
        writer.edit(ID, m.products, m.responses, { savedAt: m.savedAt, responseTimes: m.responseTimes });
        pending = { ...pending, products: m.products, responses: m.responses, response_times: m.responseTimes, last_saved_locally_at: m.savedAt ?? iso() };
      },
      restore() {                                                 // handleRestoreDraft + confirmRestore
        screen = restoreDraftResponses({ draft: pending!.responses, draftSavedAt: pending!.last_saved_locally_at, responseTimes: pending!.response_times, current: screen, saved: loaded, photoFieldIds: [PHOTO] });
        times = { ...draftResponseTimes(pending!), ...times };
        pending = null; touched = { products: new Set(), responses: new Set() };
      },
      async save() { await saveToServer(responseSaveItems(FIELDS, screen)); },
      leave() { writer.flush(); },
    };
  };
  const reset = (draft: VisitDraft | null, serverRows: Record<string, unknown>) => {
    clearDraft(ID);
    if (draft) writeDraft(draft);
    for (const k of Object.keys(server)) delete server[k];
    Object.assign(server, serverRows);
  };

  // The sequence: an older draft holds null for the photo (replaced offline at
  // 08:00); the replacement is uploaded at 09:00 and its reference saved; at
  // 10:00 the user edits a text answer while the draft still waits.
  for (const format of ["with response_times", "written before response_times"] as const) {
    const OLD: VisitDraft = format === "with response_times"
      ? { visit_id: ID, products: {}, responses: { [PHOTO]: null, [TEXT]: "offline" }, response_times: { [PHOTO]: "2026-10-28T08:00:00.000Z", [TEXT]: "2026-10-28T08:00:00.000Z" }, last_saved_locally_at: "2026-10-28T08:00:00.000Z", dirty: true }
      : { visit_id: ID, products: {}, responses: { [PHOTO]: null, [TEXT]: "offline" }, last_saved_locally_at: "2026-10-28T08:00:00.000Z", dirty: true };

    // In memory: restore in the same page load.
    reset(OLD, { [PHOTO]: M2, [TEXT]: "server" });
    at("2026-10-28T10:00:00.000Z");
    {
      const p = page();
      p.setAnswer(TEXT, "edited at 10:00");
      eq(`[${format}] the waiting draft's time moved to 10:00, its photo answer's did not`,
         [p.pending!.last_saved_locally_at, p.pending!.response_times![PHOTO]], ["2026-10-28T10:00:00.000Z", "2026-10-28T08:00:00.000Z"]);
      p.restore();
      eq(`[${format}] restoring keeps the photo uploaded at 09:00, and the text edit`, [p.screen[PHOTO], p.screen[TEXT]], [M2, "edited at 10:00"]);
      await p.save();
      eq(`[${format}] …and saving leaves it on the server`, server[PHOTO], M2);
      eq(`[${format}] (by the draft-wide time alone, the null would have won)`,
         restoreDraftResponses({ draft: { [PHOTO]: null }, draftSavedAt: "2026-10-28T10:00:00.000Z", current: { [PHOTO]: M2 }, saved: { [PHOTO]: M2 }, photoFieldIds: [PHOTO] })[PHOTO], null);
    }

    // After a reload: the edit is written, the page is loaded again, then restore and save.
    reset(OLD, { [PHOTO]: M2, [TEXT]: "server" });
    at("2026-10-28T10:00:00.000Z");
    { const p = page(); p.setAnswer(TEXT, "edited at 10:00"); clock += 600; p.leave(); }
    eq(`[${format}] after the reload the stored draft has the photo answer at 08:00 and the text at 10:00`,
       readDraft(ID)!.response_times, { [PHOTO]: "2026-10-28T08:00:00.000Z", [TEXT]: "2026-10-28T10:00:00.000Z" });
    at("2026-10-28T11:00:00.000Z");
    {
      const p = page();
      p.restore();
      await p.save();
      eq(`[${format}] reloaded, restored and saved: the photo from 09:00 is kept`, [p.screen[PHOTO], server[PHOTO], server[TEXT]], [M2, M2, "edited at 10:00"]);
    }
  }

  // The counterpart: the user removes the photo on purpose after it was uploaded.
  const WAITING: VisitDraft = { visit_id: ID, products: {}, responses: { [PHOTO]: null, [TEXT]: "offline" }, response_times: { [PHOTO]: "2026-10-28T08:00:00.000Z", [TEXT]: "2026-10-28T08:00:00.000Z" }, last_saved_locally_at: "2026-10-28T08:00:00.000Z", dirty: true };
  // …while a draft waits, in memory.
  reset(WAITING, { [PHOTO]: M2, [TEXT]: "server" });
  {
    const p = page();
    at("2026-10-28T10:00:00.000Z"); p.setAnswer(PHOTO, null);       // removed, on purpose
    at("2026-10-28T10:05:00.000Z"); p.setAnswer(TEXT, "later text");
    p.restore();
    await p.save();
    eq("removed on purpose after the upload (in memory): the removal is the newest, and is saved", [p.screen[PHOTO], server[PHOTO]], [null, null]);
  }
  // …while a draft waits, then a reload.
  reset(WAITING, { [PHOTO]: M2, [TEXT]: "server" });
  {
    const p = page();
    at("2026-10-28T10:00:00.000Z"); p.setAnswer(PHOTO, null);
    at("2026-10-28T10:05:00.000Z"); p.setAnswer(TEXT, "later text"); clock += 600; p.leave();
  }
  at("2026-10-28T11:00:00.000Z");
  {
    const p = page();
    p.restore();
    await p.save();
    eq("removed on purpose after the upload, then reloaded: still removed, and saved", [p.screen[PHOTO], server[PHOTO], server[TEXT]], [null, null, "later text"]);
  }
  // …with no waiting draft at all, then a reload.
  reset(null, { [PHOTO]: M2, [TEXT]: "server" });
  {
    const p = page();
    at("2026-10-28T10:00:00.000Z"); p.setAnswer(PHOTO, null); clock += 600; p.leave();
  }
  at("2026-10-28T11:00:00.000Z");
  {
    const p = page();
    p.restore();
    await p.save();
    eq("removed on purpose with no older draft, then reloaded: the removal wins over the uploaded photo", [p.screen[PHOTO], server[PHOTO]], [null, null]);
  }
  // A photo answer copied from the server (never set here) never beats a newer upload.
  eq("an answer without its own time is not treated as newer than any upload",
     restoreDraftResponses({ draft: { [PHOTO]: M1 }, draftSavedAt: "2026-10-28T12:00:00.000Z", responseTimes: {}, current: {}, saved: { [PHOTO]: M2 }, photoFieldIds: [PHOTO] })[PHOTO], M2);
  eq("draftResponseTimes: an older draft's answers all take its time",
     draftResponseTimes({ visit_id: ID, products: {}, responses: { a: 1, b: null }, last_saved_locally_at: "2026-10-28T08:00:00.000Z", dirty: true }),
     { a: "2026-10-28T08:00:00.000Z", b: "2026-10-28T08:00:00.000Z" });
  clearDraft(ID);

  // The hook's and the page's wiring.
  const hook = readFileSync(join(import.meta.dirname, "..", "src", "hooks", "use-offline-visit-draft.ts"), "utf8");
  const pageSrc = readFileSync(join(import.meta.dirname, "..", "src", "app", "(dashboard)", "visits", "[id]", "page.tsx"), "utf8");
  ok("every answer edit stamps that answer's time",
     /if \(touched\?\.fieldId\) \{\s+touchedRef\.current\.responses\.add\(touched\.fieldId\);\s+responseTimesRef\.current = \{ \.\.\.responseTimesRef\.current, \[touched\.fieldId\]: new Date\(\)\.toISOString\(\) \};/.test(hook));
  ok("every draft write carries the answer times",
     hook.includes("writer.edit(visitId, products, responses, { responseTimes: responseTimesRef.current });") &&
     hook.includes("draftOverPending(pending, { products, responses }, touchedRef.current, responseTimesRef.current);") &&
     hook.includes("writer.edit(visitId, merged.products, merged.responses, { savedAt: merged.savedAt, responseTimes: merged.responseTimes });") &&
     hook.includes("writer.edit(visitId, latestDataRef.current.products, latestDataRef.current.responses, { responseTimes: responseTimesRef.current });"));
  ok("restoring takes over the draft's answer times",
     /const confirmRestore = useCallback\(\(\) => \{[\s\S]{0,200}responseTimesRef\.current = \{ \.\.\.draftResponseTimes\(pendingRef\.current\), \.\.\.responseTimesRef\.current \};/.test(hook));
  ok("the page restores with the draft's answer times",
     /restoreDraftResponses\(\{[\s\S]{0,150}responseTimes: pendingDraft\.response_times,/.test(pageSrc));
}
