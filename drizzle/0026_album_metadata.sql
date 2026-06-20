-- ============================================================
-- Malnad Stories — 0026: album metadata (destination / travel_dates / description)
-- Run this in: Supabase Dashboard → SQL Editor → New query
-- DEPLOY ORDER: run THIS SQL FIRST, then deploy the matching app build.
--   (Opposite of 0021, which TIGHTENED grants. This is purely ADDITIVE — new columns
--    + new grants — so it is fully compatible with the OLD build, while the NEW build's
--    createAlbum WRITES these columns and therefore needs them to already exist.)
-- ============================================================
--
-- Additive only — three optional free-text columns the customer authors at album
-- creation (and may edit later). No pipeline, type, or ownership change.
--
-- GRANTS: 0021 narrowed `authenticated` writes on albums to column-scoped lists.
-- `grant <priv> (cols)` only ADDS privileges on the named columns; it does NOT revoke
-- the columns granted in 0021. RLS `users_own_albums` (user_id = auth.uid()) still
-- scopes the rows, and `status` remains server-only (never granted here).

alter table public.albums add column if not exists destination  text;
alter table public.albums add column if not exists travel_dates text;
alter table public.albums add column if not exists description  text;

-- INSERT at creation; UPDATE for later edits. (Lengths are enforced in Zod.)
grant insert (destination, travel_dates, description) on table public.albums to authenticated;
grant update (destination, travel_dates, description) on table public.albums to authenticated;

-- SELECT remains table-level (0003) → the new columns are readable automatically.
