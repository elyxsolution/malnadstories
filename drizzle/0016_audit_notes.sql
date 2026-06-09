-- ============================================================
-- Malnad Stories — 0016: audit_log + order_notes
-- Run this in: Supabase Dashboard → SQL Editor → New query
-- ============================================================
--
-- Append-only audit trail (who / what / when) + an internal order-notes timeline.
-- Both are service-only writes via SECURITY DEFINER functions; admins read only.
--
-- Audit metadata for ALL order-related events embeds {order_id, album_id, customer_id}
-- (Refinement 3) so investigations need no joins. The writes are done by log_audit()
-- and the admin/webhook RPCs in 0017.
--
-- Immutability: NO UPDATE/DELETE grant to anyone (not even service_role) — rows can
-- only be inserted. order_notes is likewise insert-only (an immutable note timeline).

-- ── 1. audit_log ─────────────────────────────────────────────────────────────
create table if not exists public.audit_log (
  id          uuid primary key default gen_random_uuid(),
  actor_id    uuid references public.profiles(id),   -- null = system (webhook)
  actor_type  text not null check (actor_type in ('admin','system','customer')),
  action      text not null,                          -- 'order.status_changed', 'coupon.redeemed', ...
  entity_type text not null,                          -- 'order' | 'coupon'
  entity_id   uuid not null,
  metadata    jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists audit_log_entity_idx on public.audit_log (entity_type, entity_id, created_at);
create index if not exists audit_log_actor_idx  on public.audit_log (actor_id, created_at);

-- ── 2. order_notes ───────────────────────────────────────────────────────────
create table if not exists public.order_notes (
  id         uuid primary key default gen_random_uuid(),
  order_id   uuid not null references public.orders(id) on delete cascade,
  author_id  uuid references public.profiles(id),
  body       text not null,
  created_at timestamptz not null default now()
);

create index if not exists order_notes_order_idx on public.order_notes (order_id, created_at);

-- ── 3. log_audit() helper (used by 0017's RPCs + webhook) ────────────────────
create or replace function public.log_audit(
  p_actor_id    uuid,
  p_actor_type  text,
  p_action      text,
  p_entity_type text,
  p_entity_id   uuid,
  p_metadata    jsonb
) returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  insert into public.audit_log (actor_id, actor_type, action, entity_type, entity_id, metadata)
  values (p_actor_id, p_actor_type, p_action, p_entity_type, p_entity_id, p_metadata);
$$;

revoke execute on function public.log_audit(uuid,text,text,text,uuid,jsonb)
  from public, anon, authenticated;
grant execute on function public.log_audit(uuid,text,text,text,uuid,jsonb)
  to service_role;

-- ── 4. RLS + grants ──────────────────────────────────────────────────────────
alter table public.audit_log   enable row level security;
alter table public.order_notes enable row level security;

drop policy if exists "admins_select_audit" on public.audit_log;
create policy "admins_select_audit"
  on public.audit_log for select
  using (public.is_admin());

drop policy if exists "admins_select_order_notes" on public.order_notes;
create policy "admins_select_order_notes"
  on public.order_notes for select
  using (public.is_admin());

-- RESTRICTIVE write-deny for client roles.
drop policy if exists "deny_client_insert_audit" on public.audit_log;
create policy "deny_client_insert_audit"
  on public.audit_log as restrictive for insert to authenticated, anon with check (false);
drop policy if exists "deny_client_update_audit" on public.audit_log;
create policy "deny_client_update_audit"
  on public.audit_log as restrictive for update to authenticated, anon using (false);
drop policy if exists "deny_client_delete_audit" on public.audit_log;
create policy "deny_client_delete_audit"
  on public.audit_log as restrictive for delete to authenticated, anon using (false);

drop policy if exists "deny_client_insert_order_notes" on public.order_notes;
create policy "deny_client_insert_order_notes"
  on public.order_notes as restrictive for insert to authenticated, anon with check (false);
drop policy if exists "deny_client_update_order_notes" on public.order_notes;
create policy "deny_client_update_order_notes"
  on public.order_notes as restrictive for update to authenticated, anon using (false);
drop policy if exists "deny_client_delete_order_notes" on public.order_notes;
create policy "deny_client_delete_order_notes"
  on public.order_notes as restrictive for delete to authenticated, anon using (false);

-- Privileges: SELECT to authenticated (RLS → admins only). Append-only:
-- service_role gets SELECT + INSERT but NOT update/delete (immutability).
grant select          on table public.audit_log   to authenticated;
grant select, insert  on table public.audit_log   to service_role;
grant select          on table public.order_notes to authenticated;
grant select, insert  on table public.order_notes to service_role;
revoke all on table public.audit_log   from anon;
revoke all on table public.order_notes from anon;
