-- ============================================================
-- Malnad Stories — 0020: photos column lockdown (privilege hardening)
-- Run this in: Supabase Dashboard → SQL Editor → New query
-- DEPLOY ORDER: ship the matching app build FIRST (it already only writes the
-- columns granted below), THEN run this. No app change is required for 0020 — the
-- current code already conforms; this migration only removes the *latent* privilege.
-- ============================================================
--
-- BEFORE: `authenticated` holds table-wide INSERT/UPDATE/DELETE on ALL `photos`
-- columns (0003). That lets a user write worker-owned columns on their OWN row —
-- `update photos set status='ready', sanitized_key=…` — bypassing server-side image
-- hardening (serving an un-sanitized original) and making the presign path sign an
-- arbitrary key they set. (MEDIUM: keys are unguessable UUIDs and RLS hides other
-- users' ids, so cross-user reads are theoretical — but the trust pattern is wrong.)
--
-- AFTER: `authenticated` may write ONLY the columns the app legitimately writes:
--   INSERT (user_id, album_id, r2_key, original_filename)  ← exactly /api/photos/confirm
--   UPDATE (edit_config)                                   ← exactly savePhotoEdit
--   DELETE (row)                                           ← /api/photos/[id] + deleteAlbum
-- Worker-owned columns (status, sanitized_key, thumb_key, r2_key, width, height,
-- taken_at) are NO LONGER client-writable; the worker writes them via the service
-- role (0009), which is unaffected. SELECT (0003) and RLS `users_own_photos`
-- (user_id = auth.uid()) are preserved.
--
-- Verified against the codebase at authoring time:
--   confirm route insert cols  = {user_id, album_id, r2_key, original_filename}  ✓
--   savePhotoEdit update cols   = {edit_config}                                  ✓
--   delete paths (single route + deleteAlbum) use the authenticated client       ✓
--   only the WORKER writes status/sanitized_key/… (service role)                 ✓
--
-- NO DATA LOSS: grants only. No rows, columns, types, or constraints are dropped.

revoke insert, update, delete on table public.photos from authenticated;

-- INSERT: only the four columns /api/photos/confirm supplies. status defaults to
-- 'pending'; sanitized/thumb/width/height/taken_at stay null until the worker fills them.
grant insert (user_id, album_id, r2_key, original_filename) on table public.photos to authenticated;

-- UPDATE: only the non-destructive edit config (savePhotoEdit). Worker columns excluded.
grant update (edit_config) on table public.photos to authenticated;

-- DELETE: row-level (not column-scoped) — RLS still restricts WHICH rows. Both the
-- single-photo route and deleteAlbum remove rows via the authenticated client.
grant delete on table public.photos to authenticated;

-- SELECT remains from 0003; service_role retains ALL from 0009 (worker unaffected).
