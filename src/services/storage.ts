import { createClient } from "@/lib/supabase/client";
import { getMyCompanyId } from "@/lib/supabase/helpers";

// ─── Constants ────────────────────────────────────────────────────────────────

export const VISIT_PHOTOS_BUCKET = "visit-photos" as const;

/** 5 MB — enforced both here and by bucket policy. */
export const MAX_PHOTO_SIZE_BYTES = 5 * 1024 * 1024;

/** Signed URL lifetime in seconds (1 hour — enough for a viewing session). */
const SIGNED_URL_TTL_SECONDS = 3600;

// ─── Photo metadata (stored in visit_template_responses.value) ────────────────

/**
 * The JSONB shape stored in visit_template_responses.value for photo fields.
 *
 *   {
 *     "path":        "company_id/visit_id/field_id/1716100000000_photo.jpg",
 *     "file_name":   "photo.jpg",
 *     "mime_type":   "image/jpeg",
 *     "size":        204800,
 *     "uploaded_at": "2025-05-19T10:00:00.000Z"
 *   }
 */
export interface PhotoMeta {
  path:        string;
  file_name:   string;
  mime_type:   string;
  size:        number;
  uploaded_at: string;
}

// ─── Type guard ───────────────────────────────────────────────────────────────

/**
 * Safely determines whether an unknown JSONB value is a PhotoMeta object.
 * Returns false for old mock strings ("photo_12345.jpg") so callers can
 * treat them as "no photo yet" and allow a fresh upload.
 */
export function isPhotoMeta(v: unknown): v is PhotoMeta {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as PhotoMeta).path === "string" &&
    typeof (v as PhotoMeta).file_name === "string" &&
    typeof (v as PhotoMeta).mime_type === "string" &&
    typeof (v as PhotoMeta).size === "number"
  );
}

// ─── Filename sanitization ────────────────────────────────────────────────────

/**
 * Sanitizes a file name for safe storage in Supabase Storage.
 * - Strips the extension, replaces unsafe characters with underscores.
 * - Re-appends the lowercased extension.
 * - Truncates the base to 50 characters to stay within path limits.
 */
function sanitizeFilename(original: string): string {
  const dotIdx = original.lastIndexOf(".");
  const ext    = dotIdx >= 0 ? original.slice(dotIdx + 1).toLowerCase() : "jpg";
  const base   = original
    .slice(0, dotIdx >= 0 ? dotIdx : undefined)
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .slice(0, 50)
    .replace(/^_+|_+$/g, "") || "photo";

  return `${base}.${ext}`;
}

// ─── Upload ───────────────────────────────────────────────────────────────────

/**
 * Upload a photo for a template field and return its metadata.
 *
 * Path structure (enforced here, mirrored in storage RLS):
 *   {company_id}/{visit_id}/{field_id}/{timestamp}_{sanitized_filename}
 *
 * Validates MIME type (must start with "image/") and file size (≤ 5 MB)
 * before uploading. The anon key + authenticated session is forwarded
 * automatically; no service_role key is used.
 *
 * @throws Error with a user-friendly message on validation or upload failure.
 */
export async function uploadVisitPhoto(
  file:    File,
  visitId: string,
  fieldId: string
): Promise<PhotoMeta> {
  // ── Validate MIME ─────────────────────────────────────────────────────────
  if (!file.type.startsWith("image/")) {
    throw new Error("Only image files (JPEG, PNG, WebP, GIF) are allowed.");
  }

  // ── Validate size ─────────────────────────────────────────────────────────
  if (file.size > MAX_PHOTO_SIZE_BYTES) {
    const mb = (file.size / 1024 / 1024).toFixed(1);
    throw new Error(`Photo is ${mb} MB — maximum allowed size is 5 MB.`);
  }

  // ── Build storage path ────────────────────────────────────────────────────
  const companyId   = await getMyCompanyId();
  const timestamp   = Date.now();
  const safeName    = sanitizeFilename(file.name);
  const storagePath = `${companyId}/${visitId}/${fieldId}/${timestamp}_${safeName}`;

  // ── Upload ────────────────────────────────────────────────────────────────
  const supabase = createClient();
  const { error } = await supabase.storage
    .from(VISIT_PHOTOS_BUCKET)
    .upload(storagePath, file, {
      contentType: file.type,
      upsert:      false,  // unique timestamp paths — never collide
    });

  if (error) throw new Error(error.message);

  return {
    path:        storagePath,
    file_name:   file.name,
    mime_type:   file.type,
    size:        file.size,
    uploaded_at: new Date().toISOString(),
  };
}

// ─── Delete ───────────────────────────────────────────────────────────────────

/**
 * Delete a photo from storage (used when replacing or removing a photo).
 * Silently ignores "not found" so delete-on-replace is always safe.
 *
 * @throws Error on unexpected storage errors (network, permissions).
 */
export async function deleteVisitPhoto(path: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.storage
    .from(VISIT_PHOTOS_BUCKET)
    .remove([path]);

  // Treat "not found" as a no-op (photo may have been removed already).
  if (error && !error.message.toLowerCase().includes("not found")) {
    throw new Error(error.message);
  }
}

// ─── Signed URL (preview) ─────────────────────────────────────────────────────

/**
 * Create a short-lived signed URL for previewing a private photo.
 *
 * Default TTL is 1 hour — long enough for a field audit session.
 * The URL cannot be shared across companies because it's tied to the
 * storage path (which includes the company_id) and the signed token.
 *
 * @throws Error if the URL cannot be generated (e.g., path not found).
 */
export async function getVisitPhotoUrl(
  path:            string,
  expiresInSecs = SIGNED_URL_TTL_SECONDS
): Promise<string> {
  const supabase = createClient();
  const { data, error } = await supabase.storage
    .from(VISIT_PHOTOS_BUCKET)
    .createSignedUrl(path, expiresInSecs);

  if (error || !data?.signedUrl) {
    throw new Error(error?.message ?? "Failed to generate photo preview URL.");
  }

  return data.signedUrl;
}
