-- ============================================================
-- Malnad Stories — 0021: albums.status hardening (privilege hardening)
-- Run this in: Supabase Dashboard → SQL Editor → New query
-- DEPLOY ORDER (IMPORTANT): ship the matching app build FIRST, THEN run this.
--   The paired code change (this commit):
--     • createAlbum   — no longer inserts `status` (relies on the 'draft' default)
--     • submitAlbum   — writes status='submitted' via the SERVICE ROLE (after its
--                       existing RLS-scoped completeness validation)
--   Those changes work under BOTH the old and new grants, so deploying code first is
--   safe; running this SQL before the deploy WOULD break createAlbum/submitAlbum.
-- ============================================================
--
-- BEFORE: `authenticated` holds full CRUD on `albums`, including `status`. Since
-- createOrder only checks `status='submitted'`, a user could
-- `update albums set status='submitted'` on an INCOMPLETE album (bypassing
-- submitAlbum's validation) and pay for it → the business prints an incomplete book.
-- Integrity gap (no cross-user impact; amount is still server-computed).
--
-- AFTER: clients can write only their own editable fields; `status` is server-only.
--   INSERT (user_id, title, size, cover_template_id)   ← exactly createAlbum (status defaults 'draft')
--   UPDATE (title, cover_template_id, updated_at)       ← selectCover + future title edit
--   DELETE (row)                                        ← deleteAlbum
-- `status` is NOT in any client grant → the ONLY path to 'submitted' is submitAlbum
-- via the service role, after completeness validation. RLS `users_own_albums`
-- (user_id = auth.uid()) is preserved; service_role keeps full access.
--
-- ── CHECK constraint narrowing ──────────────────────────────────────────────
-- 0001 created an inline check allowing ('draft','submitted','printing','complete').
-- The app only ever sets 'draft'/'submitted' (fulfilment lives on `orders`, not here).
-- Narrowing is defense-in-depth. PRE-FLIGHT (run first; expect 0 rows):
--     select status, count(*) from public.albums
--       where status not in ('draft','submitted') group by status;
-- If any rows exist, reconcile them before adding the constraint (it will otherwise
-- abort the transaction — no data is lost, the migration just won't apply).
--
-- NO DATA LOSS: grants + one CHECK swap. No rows/columns/types dropped.

alter table public.albums drop constraint if exists albums_status_check;
alter table public.albums
  add constraint albums_status_check check (status in ('draft', 'submitted'));

revoke insert, update, delete on table public.albums from authenticated;

-- INSERT: exactly what createAlbum supplies (status omitted → 'draft' default).
grant insert (user_id, title, size, cover_template_id) on table public.albums to authenticated;

-- UPDATE: cover selection (cover_template_id) + bookkeeping (updated_at) + title edits.
-- `status` is deliberately EXCLUDED so a client can never self-promote to 'submitted'.
grant update (title, cover_template_id, updated_at) on table public.albums to authenticated;

-- DELETE: row-level; RLS restricts rows. deleteAlbum uses the authenticated client.
grant delete on table public.albums to authenticated;

-- SELECT remains from 0003; service_role retains ALL (submitAlbum's status write).
