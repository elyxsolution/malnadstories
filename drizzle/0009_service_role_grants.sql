-- ============================================================
-- Malnad Stories — 0009: service_role table grants (worker fix)
-- Run this in: Supabase Dashboard → SQL Editor → New query
-- ============================================================
--
-- 0003 granted anon/authenticated but assumed "service_role retains ALL privileges
-- — no action needed". That was wrong for this project: service_role was never
-- granted on the tables, so the trusted backend (worker via the service-role key,
-- and the server-side service client) hit `42501 permission denied for table photos`.
--
-- service_role is the trusted backend role and bypasses RLS, so the row-scoping that
-- protects user data does not apply to it — table GRANTs are the access layer here.
-- The service-role key is server/worker-only and never exposed to the browser.

grant usage on schema public to service_role;

grant all privileges on all tables    in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;

-- Future tables/sequences created by the migration role inherit the grant, so new
-- migrations don't reintroduce this gap.
alter default privileges in schema public grant all on tables    to service_role;
alter default privileges in schema public grant all on sequences to service_role;
