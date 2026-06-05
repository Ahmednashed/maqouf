"use client";

import { useState, useCallback } from "react";
import { toast } from "sonner";
import {
  uploadVisitPhoto,
  deleteVisitPhoto,
  getVisitPhotoUrl,
  type PhotoMeta,
} from "@/services/storage";
import { useTranslation } from "@/hooks/use-translation";

// ─── Return shape ─────────────────────────────────────────────────────────────

export interface UsePhotoUploadReturn {
  /** True while an upload is in progress. */
  uploading: boolean;
  /**
   * Upload a file.  Returns PhotoMeta on success, null on failure.
   * Failure is already surfaced via a toast — callers just check for null.
   */
  upload:  (file: File) => Promise<PhotoMeta | null>;
  /**
   * Delete a photo from storage by its stored path.
   * Errors are surfaced via toast; callers need not handle them separately.
   */
  remove:  (path: string) => Promise<void>;
  /**
   * Fetch a short-lived signed URL for previewing a private photo.
   * Returns null on failure (preview simply won't show).
   */
  getUrl:  (path: string) => Promise<string | null>;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Provides photo upload / delete / preview helpers scoped to a specific
 * visit and template field.
 *
 * Uses the normal anon-key Supabase client — no service_role key.
 * The storage RLS policy (migration 008) enforces company-scoped access.
 */
export function usePhotoUpload(
  visitId: string,
  fieldId: string
): UsePhotoUploadReturn {
  const [uploading, setUploading] = useState(false);
  const { t } = useTranslation();

  // ── Upload ─────────────────────────────────────────────────────────────────
  const upload = useCallback(
    async (file: File): Promise<PhotoMeta | null> => {
      setUploading(true);
      try {
        const meta = await uploadVisitPhoto(file, visitId, fieldId);
        return meta;
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : t("visits.errorPhotoUpload")
        );
        return null;
      } finally {
        setUploading(false);
      }
    },
    [visitId, fieldId, t]
  );

  // ── Delete ─────────────────────────────────────────────────────────────────
  const remove = useCallback(
    async (path: string): Promise<void> => {
      try {
        await deleteVisitPhoto(path);
      } catch (err) {
        // Non-fatal: log the error but don't block the UI update.
        console.error("[usePhotoUpload] delete failed:", err);
      }
    },
    []
  );

  // ── Signed URL ─────────────────────────────────────────────────────────────
  const getUrl = useCallback(async (path: string): Promise<string | null> => {
    try {
      return await getVisitPhotoUrl(path);
    } catch {
      // Non-fatal: preview just won't show if this fails.
      return null;
    }
  }, []);

  return { uploading, upload, remove, getUrl };
}
