-- ============================================================
-- Malnad Stories — 0028: Support Center (tickets + messages)
-- Run this in: Supabase Dashboard → SQL Editor → New query
-- ============================================================
--
-- Additive feature. Introduces a customer ↔ admin support ticket system that
-- reuses the EXISTING security model end to end:
--   • Customer-owned data → authenticated client + RLS (customer_id = auth.uid()),
--     exactly like albums / addresses / photos.
--   • Admin mutations → SECURITY DEFINER RPCs called from requireAdmin-gated,
--     service-role server actions, mirroring admin_update_order_status (0017).
--   • Audit → log_audit() (0016), written only by SECURITY DEFINER functions.
--
-- Nothing here touches payments, uploads, PDF, orders, or their RLS. Linked
-- album_id / order_id are nullable + ON DELETE SET NULL, so deleting an album or
-- order never cascades into support history (no new ownership coupling).
--
-- Enum values are LOWERCASE to match the rest of the schema (order/album status).

-- ── 1. support_tickets ───────────────────────────────────────────────────────
create table if not exists public.support_tickets (
  id           uuid primary key default gen_random_uuid(),
  customer_id  uuid not null references public.profiles(id) on delete cascade,
  -- Optional links. SET NULL (not cascade) so retiring an album/order keeps the
  -- ticket + its history intact; the FK only proves the reference is real.
  album_id     uuid references public.albums(id) on delete set null,
  order_id     uuid references public.orders(id) on delete set null,
  category     text not null default 'other'
                 check (category in ('order','payment','upload','album','delivery','refund','technical','other')),
  priority     text not null default 'medium'
                 check (priority in ('low','medium','high','urgent')),
  status       text not null default 'open'
                 check (status in ('open','in_progress','waiting_for_customer','resolved','closed')),
  subject      text not null,
  description  text not null,                                  -- the opening message
  assigned_to  uuid references public.profiles(id) on delete set null,  -- admin owner (optional)
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  resolved_at  timestamptz
);

create index if not exists support_tickets_customer_idx on public.support_tickets (customer_id, updated_at desc);
create index if not exists support_tickets_status_idx   on public.support_tickets (status, priority, updated_at desc);
create index if not exists support_tickets_order_idx    on public.support_tickets (order_id);
create index if not exists support_tickets_album_idx    on public.support_tickets (album_id);

-- ── 2. support_messages ──────────────────────────────────────────────────────
create table if not exists public.support_messages (
  id          uuid primary key default gen_random_uuid(),
  ticket_id   uuid not null references public.support_tickets(id) on delete cascade,
  sender_type text not null check (sender_type in ('customer','admin')),
  sender_id   uuid references public.profiles(id) on delete set null,
  body        text not null,
  -- Internal notes (admin-only) live on the same timeline, hidden from customers
  -- by RLS. Customers can only ever insert is_internal = false (enforced below).
  is_internal boolean not null default false,
  created_at  timestamptz not null default now()
);

create index if not exists support_messages_ticket_idx on public.support_messages (ticket_id, created_at);

-- ── 3. Triggers (SECURITY DEFINER) ───────────────────────────────────────────
-- A new ticket → audit 'support.ticket_created' (actor = the customer).
create or replace function public.support_after_ticket_insert()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.log_audit(
    new.customer_id, 'customer', 'support.ticket_created', 'support_ticket', new.id,
    jsonb_build_object('category', new.category, 'priority', new.priority,
                       'order_id', new.order_id, 'album_id', new.album_id)
  );
  return new;
end;
$$;

drop trigger if exists trg_support_ticket_insert on public.support_tickets;
create trigger trg_support_ticket_insert
  after insert on public.support_tickets
  for each row execute function public.support_after_ticket_insert();

-- A new message → bump the ticket's activity, apply light auto-transitions, and audit.
-- Runs as definer so a customer reply (no UPDATE grant on tickets) can still bump the
-- parent row. This is the ONLY way the ticket row moves on a reply.
create or replace function public.support_after_message_insert()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_status text;
begin
  select status into v_status from public.support_tickets where id = new.ticket_id for update;

  if new.sender_type = 'customer' and v_status in ('waiting_for_customer','resolved') then
    -- Customer replied to a waiting/resolved ticket → reopen it.
    update public.support_tickets set status = 'open', updated_at = now() where id = new.ticket_id;
  elsif new.sender_type = 'admin' and new.is_internal = false and v_status = 'open' then
    -- First public admin reply on a fresh ticket → in progress.
    update public.support_tickets set status = 'in_progress', updated_at = now() where id = new.ticket_id;
  else
    update public.support_tickets set updated_at = now() where id = new.ticket_id;
  end if;

  perform public.log_audit(
    new.sender_id,
    new.sender_type,                                  -- 'customer' | 'admin' (both valid actor_types)
    case when new.is_internal then 'support.note_added' else 'support.replied' end,
    'support_ticket', new.ticket_id,
    jsonb_build_object('message_id', new.id, 'internal', new.is_internal)
  );
  return new;
end;
$$;

drop trigger if exists trg_support_message_insert on public.support_messages;
create trigger trg_support_message_insert
  after insert on public.support_messages
  for each row execute function public.support_after_message_insert();

-- ── 4. Admin RPCs (SECURITY DEFINER) — called only via service-role actions ───
-- Status change (forward + back is allowed; the surface is small and admin-only).
create or replace function public.admin_set_support_status(
  p_ticket_id uuid, p_actor_id uuid, p_status text
) returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_old text;
begin
  if p_status not in ('open','in_progress','waiting_for_customer','resolved','closed') then
    return 'invalid_status';
  end if;

  select status into v_old from public.support_tickets where id = p_ticket_id for update;
  if not found then return 'ticket_not_found'; end if;

  update public.support_tickets
     set status = p_status,
         resolved_at = case
           when p_status = 'resolved' then now()
           when p_status in ('open','in_progress','waiting_for_customer') then null
           else resolved_at            -- 'closed' keeps any existing resolved_at
         end,
         updated_at = now()
   where id = p_ticket_id;

  perform public.log_audit(p_actor_id, 'admin', 'support.status_changed', 'support_ticket', p_ticket_id,
    jsonb_build_object('from', v_old, 'to', p_status));
  return 'ok';
end;
$$;

-- Assign / unassign (p_assignee NULL = unassign).
create or replace function public.admin_assign_support_ticket(
  p_ticket_id uuid, p_actor_id uuid, p_assignee uuid
) returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.support_tickets set assigned_to = p_assignee, updated_at = now()
   where id = p_ticket_id;
  if not found then return 'ticket_not_found'; end if;

  perform public.log_audit(p_actor_id, 'admin', 'support.assigned', 'support_ticket', p_ticket_id,
    jsonb_build_object('assignee', p_assignee));
  return 'ok';
end;
$$;

revoke execute on function public.admin_set_support_status(uuid,uuid,text)    from public, anon, authenticated;
revoke execute on function public.admin_assign_support_ticket(uuid,uuid,uuid) from public, anon, authenticated;
grant  execute on function public.admin_set_support_status(uuid,uuid,text)    to service_role;
grant  execute on function public.admin_assign_support_ticket(uuid,uuid,uuid) to service_role;

-- ── 5. RLS + grants ──────────────────────────────────────────────────────────
alter table public.support_tickets  enable row level security;
alter table public.support_messages enable row level security;

-- support_tickets: a customer sees their own; admins see all.
drop policy if exists "support_tickets_select" on public.support_tickets;
create policy "support_tickets_select"
  on public.support_tickets for select to authenticated
  using (customer_id = auth.uid() or public.is_admin());

-- A customer may open a ticket only AS themselves, and may only link an album / order
-- they own (prevents linking someone else's record). status/priority columns are
-- constrained by CHECK; the server action sets status='open'.
drop policy if exists "support_tickets_insert" on public.support_tickets;
create policy "support_tickets_insert"
  on public.support_tickets for insert to authenticated
  with check (
    customer_id = auth.uid()
    and (album_id is null or exists (select 1 from public.albums a where a.id = album_id and a.user_id = auth.uid()))
    and (order_id is null or exists (select 1 from public.orders o where o.id = order_id and o.user_id = auth.uid()))
  );

-- Tickets are never mutated through the client (admins use the RPCs; the message
-- trigger bumps the row as definer). Deny client UPDATE/DELETE explicitly.
drop policy if exists "support_tickets_deny_update" on public.support_tickets;
create policy "support_tickets_deny_update"
  on public.support_tickets as restrictive for update to authenticated, anon using (false);
drop policy if exists "support_tickets_deny_delete" on public.support_tickets;
create policy "support_tickets_deny_delete"
  on public.support_tickets as restrictive for delete to authenticated, anon using (false);

-- support_messages: a customer sees non-internal messages on their own tickets;
-- admins see everything (including internal notes).
drop policy if exists "support_messages_select" on public.support_messages;
create policy "support_messages_select"
  on public.support_messages for select to authenticated
  using (
    public.is_admin()
    or (
      is_internal = false
      and exists (select 1 from public.support_tickets t
                  where t.id = ticket_id and t.customer_id = auth.uid())
    )
  );

-- A customer may post only a public customer-message, as themselves, on their own
-- still-open ticket. is_internal = false is mandatory; admins post via service role.
drop policy if exists "support_messages_insert" on public.support_messages;
create policy "support_messages_insert"
  on public.support_messages for insert to authenticated
  with check (
    sender_type = 'customer'
    and is_internal = false
    and sender_id = auth.uid()
    and exists (
      select 1 from public.support_tickets t
      where t.id = ticket_id and t.customer_id = auth.uid() and t.status <> 'closed'
    )
  );

drop policy if exists "support_messages_deny_update" on public.support_messages;
create policy "support_messages_deny_update"
  on public.support_messages as restrictive for update to authenticated, anon using (false);
drop policy if exists "support_messages_deny_delete" on public.support_messages;
create policy "support_messages_deny_delete"
  on public.support_messages as restrictive for delete to authenticated, anon using (false);

-- Privileges: authenticated SELECT + INSERT (RLS filters); service_role full access.
grant select, insert on table public.support_tickets  to authenticated;
grant select, insert on table public.support_messages to authenticated;
grant all          on table public.support_tickets  to service_role;
grant all          on table public.support_messages to service_role;
revoke all on table public.support_tickets  from anon;
revoke all on table public.support_messages from anon;
