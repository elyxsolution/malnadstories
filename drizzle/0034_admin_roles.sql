-- ============================================================
-- Malnad Stories — 0034: Multi-Role RBAC (Phase 9G)
-- Run this in: Supabase Dashboard → SQL Editor → New query  (run BEFORE deploying the
-- matching app code — the access layer reads this table).
-- ============================================================
--
-- Additive RBAC. Maps an EXISTING admin (profiles.role='admin') to ONE fixed back-office
-- role. It does NOT change the admin boundary: the app still requires profiles.role='admin'
-- FIRST (locked against self-promotion by 0019), then resolves the finer role here.
--
-- MIGRATION SAFETY: an admin with NO admin_roles row is treated as SUPER_ADMIN in the app
-- (getAdminContext), so every current operator keeps full access on day one — no backfill,
-- no lockout. Scope teams later by assigning production / support / content.
--
-- Security:
--   • Writes are service-role only (no client write grant + restrictive deny). The only
--     writer is the requireCapability('role:manage')-gated assignRole action.
--   • SELECT is admin-only (is_admin()); the app reads via the Drizzle superuser regardless.
--   • No customer rows ever (one row per admin, keyed by user_id).
--
-- Role values are LOWERCASE to match the rest of the schema.

create table if not exists public.admin_roles (
  user_id     uuid primary key references public.profiles(id) on delete cascade,
  role        text not null check (role in ('super_admin','production','support','content')),
  assigned_by uuid references public.profiles(id) on delete set null,
  assigned_at timestamptz not null default now()
);

create index if not exists admin_roles_role_idx on public.admin_roles (role);

-- ── RLS + grants ──────────────────────────────────────────────────────────────
alter table public.admin_roles enable row level security;

-- SELECT: admins only (the app also reads via the superuser). No customer visibility.
drop policy if exists "admin_roles_select" on public.admin_roles;
create policy "admin_roles_select" on public.admin_roles for select to authenticated
  using (public.is_admin());

-- No client writes — role assignment is a service-role action gated by role:manage.
drop policy if exists "admin_roles_deny_insert" on public.admin_roles;
create policy "admin_roles_deny_insert" on public.admin_roles as restrictive for insert to authenticated, anon with check (false);
drop policy if exists "admin_roles_deny_update" on public.admin_roles;
create policy "admin_roles_deny_update" on public.admin_roles as restrictive for update to authenticated, anon using (false);
drop policy if exists "admin_roles_deny_delete" on public.admin_roles;
create policy "admin_roles_deny_delete" on public.admin_roles as restrictive for delete to authenticated, anon using (false);

grant select on table public.admin_roles to authenticated;
grant all    on table public.admin_roles to service_role;
revoke all   on table public.admin_roles from anon;
