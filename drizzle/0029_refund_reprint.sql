-- ============================================================
-- Malnad Stories — 0029: Refund & Reprint Management
-- Run this in: Supabase Dashboard → SQL Editor → New query
-- ============================================================
--
-- Additive feature. Customer-raised refund / reprint REQUESTS that admins review and
-- decide. This system RECORDS DECISIONS ONLY — it never calls Razorpay, never touches
-- payments / webhooks, and never changes orders.status. Financial execution stays manual.
--
-- Reuses the exact security model of the Support Center (0028):
--   • Customer-owned → authenticated client + RLS (customer_id = auth.uid()).
--   • Column-scoped GRANTs lock down what a customer may write/read (status defaults
--     to 'pending'; admin_notes / resolved_* are server-only and hidden on read).
--   • Admin mutations → SECURITY DEFINER RPCs from requireAdmin-gated service actions.
--   • Audit → log_audit() (0016). Creation is audited by a trigger.
--
-- Eligibility (enforced in the action AND in the RLS WITH CHECK):
--   • Refund  → order must be in a paid-family state (paid…delivered) — money captured.
--   • Reprint → order must be 'delivered'.
-- One ACTIVE request per order per kind is enforced by a partial unique index;
-- rejected/completed rows remain (history is never hidden).

-- ── 1. refund_requests ───────────────────────────────────────────────────────
create table if not exists public.refund_requests (
  id                uuid primary key default gen_random_uuid(),
  customer_id       uuid not null references public.profiles(id) on delete cascade,
  order_id          uuid not null references public.orders(id) on delete cascade,
  support_ticket_id uuid references public.support_tickets(id) on delete set null,
  reason            text not null
                      check (reason in ('damaged_product','wrong_product','late_delivery','quality_issue','duplicate_order','other')),
  description       text not null,
  status            text not null default 'pending'
                      check (status in ('pending','under_review','approved','rejected','completed')),
  admin_notes       text,                              -- server-only (column grants below)
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  resolved_at       timestamptz,
  resolved_by       uuid references public.profiles(id) on delete set null
);

create index if not exists refund_requests_customer_idx on public.refund_requests (customer_id, created_at desc);
create index if not exists refund_requests_status_idx   on public.refund_requests (status, created_at desc);
create index if not exists refund_requests_order_idx    on public.refund_requests (order_id);
-- One ACTIVE refund per order (rejected/completed excluded → history retained).
create unique index if not exists refund_requests_one_active_per_order
  on public.refund_requests (order_id)
  where status in ('pending','under_review','approved');

-- ── 2. reprint_requests ──────────────────────────────────────────────────────
create table if not exists public.reprint_requests (
  id                uuid primary key default gen_random_uuid(),
  customer_id       uuid not null references public.profiles(id) on delete cascade,
  order_id          uuid not null references public.orders(id) on delete cascade,
  support_ticket_id uuid references public.support_tickets(id) on delete set null,
  issue_type        text not null
                      check (issue_type in ('damaged_delivery','print_quality','wrong_album','missing_pages','binding_issue','other')),
  description       text not null,
  status            text not null default 'pending'
                      check (status in ('pending','under_review','approved','rejected','completed')),
  admin_notes       text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  resolved_at       timestamptz,
  resolved_by       uuid references public.profiles(id) on delete set null
);

create index if not exists reprint_requests_customer_idx on public.reprint_requests (customer_id, created_at desc);
create index if not exists reprint_requests_status_idx   on public.reprint_requests (status, created_at desc);
create index if not exists reprint_requests_order_idx    on public.reprint_requests (order_id);
create unique index if not exists reprint_requests_one_active_per_order
  on public.reprint_requests (order_id)
  where status in ('pending','under_review','approved');

-- ── 3. Creation-audit triggers (SECURITY DEFINER) ────────────────────────────
create or replace function public.refund_after_insert()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.log_audit(new.customer_id, 'customer', 'refund.request_created', 'refund_request', new.id,
    jsonb_build_object('order_id', new.order_id, 'reason', new.reason, 'support_ticket_id', new.support_ticket_id));
  return new;
end; $$;

drop trigger if exists trg_refund_insert on public.refund_requests;
create trigger trg_refund_insert after insert on public.refund_requests
  for each row execute function public.refund_after_insert();

create or replace function public.reprint_after_insert()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.log_audit(new.customer_id, 'customer', 'reprint.request_created', 'reprint_request', new.id,
    jsonb_build_object('order_id', new.order_id, 'issue_type', new.issue_type, 'support_ticket_id', new.support_ticket_id));
  return new;
end; $$;

drop trigger if exists trg_reprint_insert on public.reprint_requests;
create trigger trg_reprint_insert after insert on public.reprint_requests
  for each row execute function public.reprint_after_insert();

-- ── 4. Admin RPCs (SECURITY DEFINER) ─────────────────────────────────────────
-- Forward-only request state machine (NOT the order lifecycle — orders are untouched):
--   pending → under_review|approved|rejected ; under_review → approved|rejected ;
--   approved → completed ; rejected/completed terminal. resolved_* set on a decision.
create or replace function public.admin_set_refund_status(
  p_request_id uuid, p_actor_id uuid, p_status text, p_note text
) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_old text;
  v_allowed text[];
begin
  if p_status not in ('pending','under_review','approved','rejected','completed') then
    return 'invalid_status';
  end if;
  select status into v_old from public.refund_requests where id = p_request_id for update;
  if not found then return 'request_not_found'; end if;

  v_allowed := case v_old
    when 'pending'       then array['under_review','approved','rejected']
    when 'under_review'  then array['approved','rejected']
    when 'approved'      then array['completed']
    else array[]::text[] end;
  if not (p_status = any(v_allowed)) then return 'invalid_transition'; end if;

  update public.refund_requests
     set status      = p_status,
         admin_notes = coalesce(nullif(btrim(p_note), ''), admin_notes),
         resolved_at = case when p_status in ('approved','rejected','completed') then now() else resolved_at end,
         resolved_by = case when p_status in ('approved','rejected','completed') then p_actor_id else resolved_by end,
         updated_at  = now()
   where id = p_request_id;

  perform public.log_audit(p_actor_id, 'admin', 'refund.status_changed', 'refund_request', p_request_id,
    jsonb_build_object('from', v_old, 'to', p_status));
  if nullif(btrim(p_note), '') is not null then
    perform public.log_audit(p_actor_id, 'admin', 'refund.note_added', 'refund_request', p_request_id,
      jsonb_build_object('note', btrim(p_note)));
  end if;
  return 'ok';
end; $$;

create or replace function public.admin_add_refund_note(
  p_request_id uuid, p_actor_id uuid, p_note text
) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if nullif(btrim(p_note), '') is null then return 'invalid_note'; end if;
  update public.refund_requests set admin_notes = btrim(p_note), updated_at = now() where id = p_request_id;
  if not found then return 'request_not_found'; end if;
  perform public.log_audit(p_actor_id, 'admin', 'refund.note_added', 'refund_request', p_request_id,
    jsonb_build_object('note', btrim(p_note)));
  return 'ok';
end; $$;

create or replace function public.admin_set_reprint_status(
  p_request_id uuid, p_actor_id uuid, p_status text, p_note text
) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_old text;
  v_allowed text[];
begin
  if p_status not in ('pending','under_review','approved','rejected','completed') then
    return 'invalid_status';
  end if;
  select status into v_old from public.reprint_requests where id = p_request_id for update;
  if not found then return 'request_not_found'; end if;

  v_allowed := case v_old
    when 'pending'       then array['under_review','approved','rejected']
    when 'under_review'  then array['approved','rejected']
    when 'approved'      then array['completed']
    else array[]::text[] end;
  if not (p_status = any(v_allowed)) then return 'invalid_transition'; end if;

  update public.reprint_requests
     set status      = p_status,
         admin_notes = coalesce(nullif(btrim(p_note), ''), admin_notes),
         resolved_at = case when p_status in ('approved','rejected','completed') then now() else resolved_at end,
         resolved_by = case when p_status in ('approved','rejected','completed') then p_actor_id else resolved_by end,
         updated_at  = now()
   where id = p_request_id;

  perform public.log_audit(p_actor_id, 'admin', 'reprint.status_changed', 'reprint_request', p_request_id,
    jsonb_build_object('from', v_old, 'to', p_status));
  if nullif(btrim(p_note), '') is not null then
    perform public.log_audit(p_actor_id, 'admin', 'reprint.note_added', 'reprint_request', p_request_id,
      jsonb_build_object('note', btrim(p_note)));
  end if;
  return 'ok';
end; $$;

create or replace function public.admin_add_reprint_note(
  p_request_id uuid, p_actor_id uuid, p_note text
) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if nullif(btrim(p_note), '') is null then return 'invalid_note'; end if;
  update public.reprint_requests set admin_notes = btrim(p_note), updated_at = now() where id = p_request_id;
  if not found then return 'request_not_found'; end if;
  perform public.log_audit(p_actor_id, 'admin', 'reprint.note_added', 'reprint_request', p_request_id,
    jsonb_build_object('note', btrim(p_note)));
  return 'ok';
end; $$;

revoke execute on function public.admin_set_refund_status(uuid,uuid,text,text)  from public, anon, authenticated;
revoke execute on function public.admin_add_refund_note(uuid,uuid,text)         from public, anon, authenticated;
revoke execute on function public.admin_set_reprint_status(uuid,uuid,text,text) from public, anon, authenticated;
revoke execute on function public.admin_add_reprint_note(uuid,uuid,text)        from public, anon, authenticated;
grant  execute on function public.admin_set_refund_status(uuid,uuid,text,text)  to service_role;
grant  execute on function public.admin_add_refund_note(uuid,uuid,text)         to service_role;
grant  execute on function public.admin_set_reprint_status(uuid,uuid,text,text) to service_role;
grant  execute on function public.admin_add_reprint_note(uuid,uuid,text)        to service_role;

-- ── 5. RLS + grants ──────────────────────────────────────────────────────────
alter table public.refund_requests  enable row level security;
alter table public.reprint_requests enable row level security;

-- SELECT: a customer sees their own; admins (authenticated client) see all rows
-- (column grants still hide admin_notes/resolved_by from authenticated; admins read
-- the full row via Drizzle/service role).
drop policy if exists "refund_select" on public.refund_requests;
create policy "refund_select" on public.refund_requests for select to authenticated
  using (customer_id = auth.uid() or public.is_admin());
drop policy if exists "reprint_select" on public.reprint_requests;
create policy "reprint_select" on public.reprint_requests for select to authenticated
  using (customer_id = auth.uid() or public.is_admin());

-- INSERT: only as oneself, only for an OWNED + ELIGIBLE order, optional linked ticket
-- must also be owned. status/admin_notes/resolved_* are not column-granted, so the
-- DB default (status='pending') stands and the rest stay null.
drop policy if exists "refund_insert" on public.refund_requests;
create policy "refund_insert" on public.refund_requests for insert to authenticated
  with check (
    customer_id = auth.uid()
    and exists (
      select 1 from public.orders o
      where o.id = order_id and o.user_id = auth.uid()
        and o.status in ('paid','processing','printing','packed','shipped','delivered')
    )
    and (support_ticket_id is null or exists (
      select 1 from public.support_tickets t where t.id = support_ticket_id and t.customer_id = auth.uid()
    ))
  );
drop policy if exists "reprint_insert" on public.reprint_requests;
create policy "reprint_insert" on public.reprint_requests for insert to authenticated
  with check (
    customer_id = auth.uid()
    and exists (
      select 1 from public.orders o
      where o.id = order_id and o.user_id = auth.uid() and o.status = 'delivered'
    )
    and (support_ticket_id is null or exists (
      select 1 from public.support_tickets t where t.id = support_ticket_id and t.customer_id = auth.uid()
    ))
  );

-- Requests are immutable to the client after submission (admins decide via RPC).
drop policy if exists "refund_deny_update" on public.refund_requests;
create policy "refund_deny_update" on public.refund_requests as restrictive for update to authenticated, anon using (false);
drop policy if exists "refund_deny_delete" on public.refund_requests;
create policy "refund_deny_delete" on public.refund_requests as restrictive for delete to authenticated, anon using (false);
drop policy if exists "reprint_deny_update" on public.reprint_requests;
create policy "reprint_deny_update" on public.reprint_requests as restrictive for update to authenticated, anon using (false);
drop policy if exists "reprint_deny_delete" on public.reprint_requests;
create policy "reprint_deny_delete" on public.reprint_requests as restrictive for delete to authenticated, anon using (false);

-- Column-scoped privileges. Customer may INSERT only the request fields (status,
-- admin_notes, resolved_* are server-only). Customer may SELECT everything EXCEPT
-- admin_notes/resolved_by (internal). service_role gets full access.
grant select (id, customer_id, order_id, support_ticket_id, reason, description, status, created_at, updated_at, resolved_at)
  on public.refund_requests to authenticated;
grant insert (customer_id, order_id, support_ticket_id, reason, description)
  on public.refund_requests to authenticated;

grant select (id, customer_id, order_id, support_ticket_id, issue_type, description, status, created_at, updated_at, resolved_at)
  on public.reprint_requests to authenticated;
grant insert (customer_id, order_id, support_ticket_id, issue_type, description)
  on public.reprint_requests to authenticated;

grant all on table public.refund_requests  to service_role;
grant all on table public.reprint_requests to service_role;
revoke all on table public.refund_requests  from anon;
revoke all on table public.reprint_requests from anon;
