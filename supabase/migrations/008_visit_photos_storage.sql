-- ============================================================
-- Migration 008 — Visit Photos Storage
-- ============================================================
-- Sets up the "visit-photos" Supabase Storage bucket and
-- RLS policies so that:
--
--   • Any authenticated member of a company can upload photos
--     to their company's folder (INSERT).
--   • Any authenticated member of a company can view (SELECT)
--     and delete (DELETE) photos in their company's folder.
--     DELETE is needed for the "replace photo" flow.
--
-- Storage path structure enforced by the frontend service:
--   {company_id}/{visit_id}/{field_id}/{timestamp}_{filename}
--
-- The first folder segment is always the company_id (UUID).
-- RLS uses storage.foldername(name)[1] to extract it and
-- verifies membership via the existing get_my_company_ids()
-- helper function.
--
-- Bucket is PRIVATE — photos are served via short-lived
-- signed URLs generated on the frontend (no public access).
--
-- Safe to re-run: uses ON CONFLICT DO NOTHING / DROP IF EXISTS.
-- ============================================================


-- ── 1. Create the bucket ─────────────────────────────────────
--
-- file_size_limit is in bytes: 5 MB = 5 * 1024 * 1024 = 5242880
-- allowed_mime_types restricts uploads to common image formats.

INSERT INTO storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
VALUES (
  'visit-photos',
  'visit-photos',
  false,          -- private: access only via signed URLs
  5242880,        -- 5 MB
  ARRAY[
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/webp',
    'image/gif'
  ]
)
ON CONFLICT (id) DO NOTHING;


-- ── 2. Storage RLS policies on storage.objects ───────────────
--
-- storage.foldername(name) returns text[] of path segments
-- excluding the filename. For our path structure:
--   company_id/visit_id/field_id/timestamp_filename.jpg
-- (storage.foldername(name))[1] → company_id (as text)
--
-- get_my_company_ids() returns UUID[]. We convert UUID[] to
-- text[] for comparison rather than casting the path segment
-- to UUID (which would throw on a malformed path).

DROP POLICY IF EXISTS "visit_photos_insert" ON storage.objects;
DROP POLICY IF EXISTS "visit_photos_select" ON storage.objects;
DROP POLICY IF EXISTS "visit_photos_delete" ON storage.objects;


-- INSERT: any company member can upload to their company's folder.
CREATE POLICY "visit_photos_insert"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'visit-photos'
  AND (storage.foldername(name))[1] = ANY(
    SELECT cid::text
    FROM   unnest(get_my_company_ids()) AS cid
  )
);


-- SELECT: any company member can read (needed for signed URL creation).
CREATE POLICY "visit_photos_select"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'visit-photos'
  AND (storage.foldername(name))[1] = ANY(
    SELECT cid::text
    FROM   unnest(get_my_company_ids()) AS cid
  )
);


-- DELETE: any company member can delete (needed for replace/remove flow).
-- The frontend only deletes the old photo when explicitly replacing or
-- removing it; the company membership check prevents cross-company deletes.
CREATE POLICY "visit_photos_delete"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'visit-photos'
  AND (storage.foldername(name))[1] = ANY(
    SELECT cid::text
    FROM   unnest(get_my_company_ids()) AS cid
  )
);
