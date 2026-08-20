-- ============================================================
-- Malnad Stories — 0054: stop profile deletion from silently orphaning R2 assets
-- Run this in: Supabase Dashboard → SQL Editor → New query
-- DEPLOY ORDER: safe in EITHER order. This changes only constraint behaviour on FUTURE
--   deletes; it rewrites no rows and no application code depends on the old behaviour
--   (there is no profile-deletion path anywhere in the codebase — see WHY below).
-- ============================================================
--
-- WHY THIS EXISTS
--
--   The Phase 6 Prompt 5 forensic investigation found 1,302 unreferenced derivative objects
--   (651 complete master/thumbnail pairs, ~124 MB) in R2, every one of them belonging to an
--   album that no longer exists. The mechanism was identified precisely:
--
--       auth.users  --ON DELETE CASCADE-->  profiles
--       profiles    --ON DELETE CASCADE-->  photos      (r2_key, sanitized_key, thumb_key)
--       profiles    --ON DELETE CASCADE-->  albums --CASCADE--> album_pdfs (r2_key)
--
--   Deleting a profile therefore DESTROYED the only records that named those R2 objects,
--   while deleting nothing from R2. The objects became permanently unreachable in the same
--   statement that erased the evidence of who owned them. Nothing logged it and nothing
--   could recover it: after the cascade there is no row left to derive a key from.
--
--   Every LEGITIMATE deletion path already cleans R2 correctly and is untouched by this
--   migration:
--     · deleteAlbum (src/lib/actions/albums.ts)   — enqueues r2-cleanup for every key, then
--                                                    deletes the rows; aborts if enqueue fails
--     · DELETE /api/photos/:id                     — deletes the objects, then the row
--     · purgeAlbumAssets (admin storage)           — enqueues cleanup and nulls the keys
--
--   The cascade was the ONLY path that destroyed ownership without cleanup.
--
-- WHY A DATABASE-LEVEL FIX, AND NOT AN APPLICATION ONE
--
--   There is no profile/account deletion anywhere in the application — no server action, no
--   API route, no admin control, no UI. The historical deletions were performed directly
--   against the database (Supabase dashboard / SQL). An application-layer "safe account
--   deletion" would therefore have prevented exactly zero of them: the deletions never pass
--   through application code. The database is the only enforcement point every path shares.
--
-- WHAT THIS CHANGES
--
--   `photos.user_id` and `albums.user_id` move from ON DELETE CASCADE to ON DELETE RESTRICT.
--   A profile that still owns albums or photos can no longer be deleted at all. The delete
--   fails loudly with a foreign-key violation instead of silently stranding storage.
--
--   This is deliberately FAIL-CLOSED. The recovery procedure is ordinary and already exists:
--   remove the customer's albums through the application (which enqueues exact-key R2
--   cleanup via the existing worker job), then delete the profile. See worker/ops/RUNBOOK.md.
--
-- WHAT THIS DOES NOT CHANGE
--
--   · No rows are read, written, or deleted. Constraint metadata only.
--   · Deleting an ALBUM is unaffected — only deleting a PROFILE that still owns one is blocked.
--   · Deleting a PHOTO is unaffected.
--   · `photos.album_id ON DELETE SET NULL` is unchanged, so album deletion still leaves photo
--     rows (and their keys) intact rather than orphaning their objects.
--   · Every other profile cascade (addresses, orders, support tickets, refund/reprint requests,
--     album reviews, revision requests, admin roles) is UNTOUCHED: none of them owns an R2
--     object, so none of them can orphan storage.
--   · RLS, grants, and column permissions are untouched.
--
-- SAFETY AGAINST EXISTING DATA
--
--   ALTER ... DROP CONSTRAINT / ADD CONSTRAINT re-validates the existing rows. Every current
--   photos.user_id and albums.user_id already references a live profile (the old CASCADE
--   guaranteed referential integrity), so the re-validation cannot fail. Measured before
--   writing this migration: 8 profiles, 18 albums, 189 photos, 0 dangling references.

begin;

-- ── photos.user_id : CASCADE → RESTRICT ──────────────────────────────────────────
-- Destroying a photo row destroys r2_key / sanitized_key / thumb_key — the ONLY record of
-- three R2 objects. That must never happen as a side effect of deleting something else.
alter table public.photos
  drop constraint if exists photos_user_id_fkey;

alter table public.photos
  add constraint photos_user_id_fkey
  foreign key (user_id) references public.profiles (id)
  on delete restrict;

-- ── albums.user_id : CASCADE → RESTRICT ──────────────────────────────────────────
-- Albums cascade to `album_pdfs`, whose `r2_key` names the rendered preview PDF. Restricting
-- here protects that object by the same argument, and keeps a customer's albums from
-- disappearing as a side effect of a profile delete.
alter table public.albums
  drop constraint if exists albums_user_id_fkey;

alter table public.albums
  add constraint albums_user_id_fkey
  foreign key (user_id) references public.profiles (id)
  on delete restrict;

commit;

-- ── VERIFY (expect both rows to read RESTRICT) ───────────────────────────────────
--
--   select tc.table_name, kcu.column_name, rc.delete_rule
--     from information_schema.table_constraints tc
--     join information_schema.key_column_usage kcu       on kcu.constraint_name = tc.constraint_name
--     join information_schema.referential_constraints rc on rc.constraint_name  = tc.constraint_name
--     join information_schema.constraint_column_usage ccu on ccu.constraint_name = tc.constraint_name
--    where tc.constraint_type = 'FOREIGN KEY'
--      and ccu.table_name = 'profiles'
--      and tc.table_name in ('photos', 'albums');
--
-- ── ROLLBACK (restores the previous, orphan-producing behaviour) ─────────────────
--
--   alter table public.photos drop constraint photos_user_id_fkey;
--   alter table public.photos add constraint photos_user_id_fkey
--     foreign key (user_id) references public.profiles (id) on delete cascade;
--   alter table public.albums drop constraint albums_user_id_fkey;
--   alter table public.albums add constraint albums_user_id_fkey
--     foreign key (user_id) references public.profiles (id) on delete cascade;
