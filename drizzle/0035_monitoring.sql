-- ============================================================
-- Malnad Stories — 0035: Monitoring & Alerting (Phase 10A)
-- Run this in: Supabase Dashboard → SQL Editor → New query  (run BEFORE deploying the
-- matching app code — the monitoring page reads these tables).
-- ============================================================
--
-- Additive OPERATIONS layer: per-service health snapshots + append-only alerts. It is
-- READ-ONLY over the existing tables (collectors are cheap count()/select 1 aggregates over
-- existing status columns) and writes ONLY here. Admin-only; RBAC-gated in the app
-- (monitoring:view / monitoring:manage). No customer/anon access. Touches nothing in
-- checkout/builder/orders/payments/uploads/PDF/reviews/refunds/reprints/CMS/shipping/RBAC.
--
-- Enum values are LOWERCASE to match the rest of the schema.

-- ── 1. health_checks (append-only per-run snapshots = the check history) ──────
create table if not exists public.health_checks (
  id         uuid primary key default gen_random_uuid(),
  service    text not null
               check (service in ('database','uploads','photo_processing','pdf_generation','payments','email','support','shipping')),
  status     text not null check (status in ('healthy','warning','critical')),
  message    text,
  checked_at timestamptz not null default now()
);

create index if not exists health_checks_service_idx on public.health_checks (service, checked_at desc);

-- ── 2. system_alerts (append-only; resolving MARKS, never overwrites/deletes) ─
create table if not exists public.system_alerts (
  id          uuid primary key default gen_random_uuid(),
  severity    text not null check (severity in ('info','warning','critical')),
  source      text not null,
  title       text not null,
  message     text,
  -- Stable key per condition (e.g. 'pdf:failed'). With the partial unique index below it
  -- guarantees AT MOST ONE open alert per condition → no alert fatigue / duplicate storms.
  dedupe_key  text not null,
  resolved    boolean not null default false,
  created_at  timestamptz not null default now(),
  resolved_at timestamptz
);

create index if not exists system_alerts_feed_idx on public.system_alerts (resolved, created_at desc);
create unique index if not exists system_alerts_one_open_per_key
  on public.system_alerts (dedupe_key) where resolved = false;

-- ── 3. RLS + grants (admin-only; service-role writes) ─────────────────────────
alter table public.health_checks enable row level security;
alter table public.system_alerts enable row level security;

drop policy if exists "health_checks_select" on public.health_checks;
create policy "health_checks_select" on public.health_checks for select to authenticated
  using (public.is_admin());
drop policy if exists "system_alerts_select" on public.system_alerts;
create policy "system_alerts_select" on public.system_alerts for select to authenticated
  using (public.is_admin());

-- No client writes — the monitoring engine writes via the service role only.
drop policy if exists "health_checks_deny_insert" on public.health_checks;
create policy "health_checks_deny_insert" on public.health_checks as restrictive for insert to authenticated, anon with check (false);
drop policy if exists "health_checks_deny_update" on public.health_checks;
create policy "health_checks_deny_update" on public.health_checks as restrictive for update to authenticated, anon using (false);
drop policy if exists "health_checks_deny_delete" on public.health_checks;
create policy "health_checks_deny_delete" on public.health_checks as restrictive for delete to authenticated, anon using (false);

drop policy if exists "system_alerts_deny_insert" on public.system_alerts;
create policy "system_alerts_deny_insert" on public.system_alerts as restrictive for insert to authenticated, anon with check (false);
drop policy if exists "system_alerts_deny_update" on public.system_alerts;
create policy "system_alerts_deny_update" on public.system_alerts as restrictive for update to authenticated, anon using (false);
drop policy if exists "system_alerts_deny_delete" on public.system_alerts;
create policy "system_alerts_deny_delete" on public.system_alerts as restrictive for delete to authenticated, anon using (false);

grant select on table public.health_checks to authenticated;
grant select on table public.system_alerts to authenticated;
grant all    on table public.health_checks to service_role;
grant all    on table public.system_alerts to service_role;
revoke all   on table public.health_checks from anon;
revoke all   on table public.system_alerts from anon;
