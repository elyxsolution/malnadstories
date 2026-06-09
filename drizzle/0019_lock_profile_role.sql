-- ============================================================
-- Malnad Stories — 0019: lock down profiles.role (privilege-escalation fix)
-- Run this in: Supabase Dashboard → SQL Editor → New query
-- ============================================================
--
-- CRITICAL FIX. 0003 granted `authenticated` table-wide INSERT/UPDATE/DELETE on
-- public.profiles, and the RLS policy `users_own_profile` (FOR ALL USING id=auth.uid())
-- has no column restriction. That let any logged-in user run
--     update public.profiles set role='admin' where id = auth.uid();
-- and self-promote to admin (requireAdmin()/is_admin() both trust profiles.role).
--
-- This replaces the broad write grants with COLUMN-SCOPED grants:
--   * authenticated may INSERT only (id, name, phone)  → role defaults to 'user',
--     created_at to now(); the auth-callback upsert (INSERT … ON CONFLICT DO NOTHING)
--     still works.
--   * authenticated may UPDATE only (name, phone)       → role / id / created_at are
--     not client-writable (a SET role=… is "permission denied for column role").
--   * authenticated may NOT DELETE                      → closes the
--     delete-then-reinsert-with-role='admin' vector.
--   * SELECT (from 0003) is left intact (own row via RLS).
--
-- RLS is PRESERVED unchanged: `users_own_profile` still scopes every operation to
-- id = auth.uid(). This migration narrows COLUMNS, not rows — the two layers
-- (column grant + row RLS) now both apply to any client write.
--
-- Unaffected (the only ways to set role): the SECURITY DEFINER on_auth_user_created
-- trigger (runs as superuser), the service role, and the SQL editor / Drizzle
-- superuser. Existing admin accounts keep role='admin' (no data is changed here).

revoke insert, update, delete on table public.profiles from authenticated;

grant insert (id, name, phone) on table public.profiles to authenticated;
grant update (name, phone)     on table public.profiles to authenticated;

-- anon already has NO access to profiles (revoked in 0003) — nothing to do.

-- ============================================================
-- ROLLBACK (restores the prior, UNSAFE grants from 0003 — re-introduces the
-- escalation vulnerability; only use to revert an incident). Run as superuser:
-- ============================================================
-- revoke insert (id, name, phone) on table public.profiles from authenticated;
-- revoke update (name, phone)     on table public.profiles from authenticated;
-- grant insert, update, delete on table public.profiles to authenticated;
--   (SELECT is already present; RLS users_own_profile is unchanged.)

-- ============================================================
-- VERIFICATION (run manually; replace <USER_UUID> with a real non-admin profile id).
-- The role/delete attempts MUST fail; name/phone MUST succeed.
-- ============================================================
-- -- (a) column privileges: authenticated has INSERT on id/name/phone, UPDATE on
-- --     name/phone only, and NOTHING on role/created_at.
-- select privilege_type, column_name
-- from information_schema.column_privileges
-- where table_schema='public' and table_name='profiles' and grantee='authenticated'
-- order by privilege_type, column_name;
--
-- -- (b) functional test as the authenticated role with a forged auth.uid():
-- begin;
--   set local role authenticated;
--   select set_config('request.jwt.claims', json_build_object('sub','<USER_UUID>')::text, true);
--   update public.profiles set role='admin' where id='<USER_UUID>';      -- EXPECT: ERROR permission denied for column role
--   update public.profiles set name='New Name' where id='<USER_UUID>';   -- EXPECT: UPDATE 1
--   update public.profiles set phone='9999999999' where id='<USER_UUID>';-- EXPECT: UPDATE 1
--   delete from public.profiles where id='<USER_UUID>';                  -- EXPECT: ERROR permission denied
--   insert into public.profiles (id,name) values ('<USER_UUID>','X')
--     on conflict (id) do nothing;                                       -- EXPECT: INSERT 0 1 (no error; callback path)
--   insert into public.profiles (id,name,role) values ('<USER_UUID>','X','admin'); -- EXPECT: ERROR permission denied for column role
-- rollback;
--
-- -- (c) admin promotion via SQL editor (superuser) still works:
-- --   update public.profiles set role='admin'
-- --   where id=(select id from auth.users where email='you@example.com');  -- EXPECT: UPDATE 1
