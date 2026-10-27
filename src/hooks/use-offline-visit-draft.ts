"use client";

/**
 * use-offline-visit-draft
 *
 * Manages all offline-draft concerns for the visit detail page:
 *
 *   1. Online / offline detection (navigator.onLine + window events)
 *   2. Debounced auto-save to localStorage on every user edit
 *   3. Sync-status state machine (idle → unsaved → draft → saving → synced/failed)
 *   4. Draft-restore prompt — surfaced when a dirty draft exists on mount
 *
 * The hook is intentionally "dumb" about React Query / Supabase.
 * All server-side concerns stay in the page component.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import {
  readDraft,
  writeDraft,
  clearDraft,
  createDraftWriter,
  type VisitDraft,
  type DraftProducts,
  type DraftResponses,
} from "@/lib/offline-drafts";
import { classifyStoredDraft, noEditsSince } from "@/lib/visit-completion";

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Sync status state machine transitions:
 *
 *  idle
 *   │  user edits
 *   ▼
 *  unsaved  (debounce pending — localStorage write not yet fired)
 *   │  500 ms debounce fires
 *   ▼
 *  draft    (written to localStorage; server sync pending)
 *   │  user clicks Save (online)
 *   ▼
 *  saving   (server request in flight)
 *   ├─ success → synced → (3 s) → idle
 *   └─ error   → failed
 *
 * Offline path:
 *  unsaved → draft  (auto-save keeps going)
 *  draft stays until the user comes back online and presses Sync now /
 *  Save. Nothing uploads it automatically.
 */
export type SyncStatus =
  | "idle"     // nothing pending
  | "unsaved"  // user typed; debounce not yet fired
  | "draft"    // localStorage written; not yet on server
  | "saving"   // server request in flight
  | "synced"   // last server save succeeded
  | "failed";  // last server save failed (draft preserved)

export interface UseOfflineVisitDraftReturn {
  /** Current navigator.onLine state, updated via window events. */
  isOnline:        boolean;
  /** Current sync status for the sticky bar indicator. */
  syncStatus:      SyncStatus;
  /**
   * Non-null when a dirty draft was found on mount and the user hasn't
   * decided what to do yet.  The page renders a restore-prompt banner.
   */
  pendingDraft:    VisitDraft | null;
  /**
   * Non-null when unsaved work is stored for a visit that is already closed.
   * Shown read-only: it is never restored into, or written to, a closed visit,
   * and is only removed by discardStrandedDraft().
   */
  strandedDraft:   VisitDraft | null;
  /** Remove a stranded draft — only when the user asks. */
  discardStrandedDraft: () => void;
  /**
   * The device went offline since the last successful save. Cleared by a
   * successful save. Used to offer "Sync now" once the connection is back.
   */
  wasOffline:      boolean;
  /**
   * Call when the user confirms restore (AFTER updating page state with
   * pendingDraft.products / pendingDraft.responses).
   * Clears the prompt and sets status → "draft" (data is still unsynced).
   */
  confirmRestore:  () => void;
  /**
   * Call when the user discards the draft.
   * Clears localStorage and the prompt.
   */
  discardDraft:    () => void;
  /**
   * Debounced auto-save to localStorage.
   * Call this on every user edit (setEntries / setResponses).
   * The hook writes to localStorage after a 500 ms idle window.
   */
  updateDraft:     (products: DraftProducts, responses: DraftResponses) => void;
  /**
   * Call at the start of a server-save attempt. Returns the edit revision the
   * save is about to send; pass it back to markSynced.
   */
  markSaving:      () => number;
  /**
   * Call when the server save succeeds, with the revision markSaving returned.
   * Clears the dirty flag in localStorage — unless the user edited again while
   * the save was in flight, in which case those newer edits stay marked
   * unsaved.
   */
  markSynced:      (savedRevision?: number) => void;
  /** Bumped on every local edit (updateDraft). */
  editRevision:    () => number;
  /** Call when the server save fails (draft is preserved). */
  markFailed:      () => void;
  /** Call when the visit is completed — removes the draft from localStorage. */
  clearLocalDraft: () => void;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

const DEBOUNCE_MS    = 500;
const SYNCED_SHOW_MS = 3_000;   // how long to show "Synced" before reverting to idle

export function useOfflineVisitDraft(
  visitId:    string,
  isReadOnly: boolean,
): UseOfflineVisitDraftReturn {

  // ── Online / offline ──────────────────────────────────────────────────────
  const [isOnline, setIsOnline] = useState<boolean>(
    typeof navigator !== "undefined" ? navigator.onLine : true
  );

  useEffect(() => {
    const goOnline  = () => setIsOnline(true);
    const goOffline = () => { setIsOnline(false); setWasOffline(true); };
    window.addEventListener("online",  goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online",  goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  // ── Sync status ───────────────────────────────────────────────────────────
  const [syncStatus,   setSyncStatus]   = useState<SyncStatus>("idle");
  const [pendingDraft, setPendingDraft] = useState<VisitDraft | null>(null);
  const [strandedDraft, setStrandedDraft] = useState<VisitDraft | null>(null);
  const [wasOffline,   setWasOffline]   = useState<boolean>(
    typeof navigator !== "undefined" ? !navigator.onLine : false
  );

  // Debounced draft writes, plus the latest snapshot for the clean copy a
  // successful save writes.
  const writerRef     = useRef<ReturnType<typeof createDraftWriter> | null>(null);
  if (!writerRef.current) writerRef.current = createDraftWriter(DEBOUNCE_MS, () => setSyncStatus("draft"));
  const writer        = writerRef.current;
  const syncedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestDataRef = useRef<{ products: DraftProducts; responses: DraftResponses } | null>(null);
  // One more for every local edit. A save or a completion records the value it
  // started from, so it can tell whether the user edited again meanwhile.
  const editRevisionRef = useRef(0);
  const editRevision    = useCallback(() => editRevisionRef.current, []);

  // ── Load draft on mount ───────────────────────────────────────────────────
  // Re-run when the visit turns out to be closed: unsaved work for a closed
  // visit is not restorable, but it must not disappear either.
  useEffect(() => {
    if (!visitId) return;
    const draft = readDraft(visitId);
    const state = classifyStoredDraft(draft, isReadOnly);
    setPendingDraft(state === "restorable" ? draft : null);
    setStrandedDraft(state === "stranded" ? draft : null);
  }, [visitId, isReadOnly]);

  // ── Leaving the page ──────────────────────────────────────────────────────
  // An edit made less than DEBOUNCE_MS before leaving is written to the draft
  // now rather than dropped: on unmount (navigating inside the app), and when
  // the page is hidden or unloaded (another app, tab closed, reload), where
  // unmount never runs. Local only — nothing is sent to the server.
  useEffect(() => {
    const onHidden = () => { if (document.visibilityState === "hidden") writer.flush(); };
    const onPageHide = () => { writer.flush(); };
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("pagehide", onPageHide);
      writer.flush();
      if (syncedTimerRef.current) clearTimeout(syncedTimerRef.current);
    };
  }, [writer]);

  // ── Auto-save (debounced 500 ms) ──────────────────────────────────────────
  const updateDraft = useCallback(
    (products: DraftProducts, responses: DraftResponses) => {
      // Always keep the latest snapshot in a ref so the timeout closure
      // uses the most recent data even if multiple edits fire quickly.
      latestDataRef.current = { products, responses };
      editRevisionRef.current += 1;

      // Immediately signal "unsaved" so the UI dot appears right away.
      setSyncStatus("unsaved");

      writer.edit(visitId, products, responses);
    },
    [visitId, writer],
  );

  // ── Server-save status transitions ────────────────────────────────────────
  const markSaving = useCallback(() => {
    if (syncedTimerRef.current) clearTimeout(syncedTimerRef.current);
    setSyncStatus("saving");
    return editRevisionRef.current;
  }, []);

  const markSynced = useCallback((savedRevision?: number) => {
    // Edited again while the save was in flight: the server has the earlier
    // values, the draft has the newer ones. Do not write the draft as clean.
    if (savedRevision !== undefined && !noEditsSince(savedRevision, editRevisionRef.current)) {
      setSyncStatus("draft");
      return;
    }
    // Write a clean (non-dirty) copy to localStorage as a read-only backup.
    // It stays until the visit is completed. A pending dirty write of the same
    // edits is dropped — it would mark them unsaved again.
    writer.cancel();
    if (latestDataRef.current) {
      writeDraft({
        visit_id:              visitId,
        products:              latestDataRef.current.products,
        responses:             latestDataRef.current.responses,
        last_saved_locally_at: new Date().toISOString(),
        dirty:                 false,
      });
    }
    setSyncStatus("synced");
    setWasOffline(false);
    // Auto-revert to idle after SYNCED_SHOW_MS so the indicator doesn't
    // permanently clutter the bar.
    if (syncedTimerRef.current) clearTimeout(syncedTimerRef.current);
    syncedTimerRef.current = setTimeout(() => setSyncStatus("idle"), SYNCED_SHOW_MS);
  }, [visitId, writer]);

  const markFailed = useCallback(() => {
    // Draft is already in localStorage — no extra write needed.
    setSyncStatus("failed");
  }, []);

  // ── Restore prompt actions ────────────────────────────────────────────────
  const confirmRestore = useCallback(() => {
    setPendingDraft(null);
    // Data now in page state is from the draft → still dirty
    setSyncStatus("draft");
  }, []);

  const discardDraft = useCallback(() => {
    clearDraft(visitId);
    setPendingDraft(null);
    setSyncStatus("idle");
  }, [visitId]);

  const discardStrandedDraft = useCallback(() => {
    clearDraft(visitId);
    setStrandedDraft(null);
  }, [visitId]);

  // ── Clear on completion ───────────────────────────────────────────────────
  const clearLocalDraft = useCallback(() => {
    writer.cancel();
    clearDraft(visitId);
    setSyncStatus("idle");
  }, [visitId, writer]);

  return {
    isOnline,
    syncStatus,
    pendingDraft,
    strandedDraft,
    discardStrandedDraft,
    wasOffline,
    confirmRestore,
    discardDraft,
    updateDraft,
    markSaving,
    markSynced,
    editRevision,
    markFailed,
    clearLocalDraft,
  };
}
