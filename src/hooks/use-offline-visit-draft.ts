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
  type VisitDraft,
  type DraftProducts,
  type DraftResponses,
} from "@/lib/offline-drafts";

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
 *  draft stays until user comes back online and syncs.
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
  /** Call at the start of a server-save attempt. */
  markSaving:      () => void;
  /** Call when the server save succeeds. Clears the dirty flag in localStorage. */
  markSynced:      () => void;
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
    const goOffline = () => setIsOnline(false);
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

  // Refs for debounce + latest draft snapshot
  const debounceRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const syncedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestDataRef = useRef<{ products: DraftProducts; responses: DraftResponses } | null>(null);

  // ── Load draft on mount ───────────────────────────────────────────────────
  useEffect(() => {
    if (!visitId || isReadOnly) return;
    const draft = readDraft(visitId);
    if (draft?.dirty) {
      setPendingDraft(draft);
    }
  }, [visitId, isReadOnly]);

  // ── Cleanup timers on unmount ─────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (debounceRef.current)    clearTimeout(debounceRef.current);
      if (syncedTimerRef.current) clearTimeout(syncedTimerRef.current);
    };
  }, []);

  // ── Auto-save (debounced 500 ms) ──────────────────────────────────────────
  const updateDraft = useCallback(
    (products: DraftProducts, responses: DraftResponses) => {
      // Always keep the latest snapshot in a ref so the timeout closure
      // uses the most recent data even if multiple edits fire quickly.
      latestDataRef.current = { products, responses };

      // Immediately signal "unsaved" so the UI dot appears right away.
      setSyncStatus("unsaved");

      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        if (!latestDataRef.current) return;
        writeDraft({
          visit_id:              visitId,
          products:              latestDataRef.current.products,
          responses:             latestDataRef.current.responses,
          last_saved_locally_at: new Date().toISOString(),
          dirty:                 true,
        });
        setSyncStatus("draft");
      }, DEBOUNCE_MS);
    },
    [visitId],
  );

  // ── Server-save status transitions ────────────────────────────────────────
  const markSaving = useCallback(() => {
    if (syncedTimerRef.current) clearTimeout(syncedTimerRef.current);
    setSyncStatus("saving");
  }, []);

  const markSynced = useCallback(() => {
    // Write a clean (non-dirty) copy to localStorage as a read-only backup.
    // It stays until the visit is completed.
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
    // Auto-revert to idle after SYNCED_SHOW_MS so the indicator doesn't
    // permanently clutter the bar.
    if (syncedTimerRef.current) clearTimeout(syncedTimerRef.current);
    syncedTimerRef.current = setTimeout(() => setSyncStatus("idle"), SYNCED_SHOW_MS);
  }, [visitId]);

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

  // ── Clear on completion ───────────────────────────────────────────────────
  const clearLocalDraft = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    clearDraft(visitId);
    setSyncStatus("idle");
  }, [visitId]);

  return {
    isOnline,
    syncStatus,
    pendingDraft,
    confirmRestore,
    discardDraft,
    updateDraft,
    markSaving,
    markSynced,
    markFailed,
    clearLocalDraft,
  };
}
