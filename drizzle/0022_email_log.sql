-- ============================================================
-- Malnad Stories — 0022: email_log (delivery audit + idempotency)
-- Run this in: Supabase Dashboard → SQL Editor → New query
-- ============================================================
--
-- Records every transactional email ATTEMPT (no body is ever stored) for
-- troubleshooting, and provides the idempotency anchor so a duplicate webhook /
-- status transition never sends a duplicate email:
--   * a 'sending' row is claimed BEFORE the send; the partial unique index makes a
--     concurrent/duplicate claim a no-op → the email is sent at most once.
--   * a 'failed' row releases the slot (not covered by the index) so a retry can
--     re-claim and resend.
--
-- (0020/0021 remain the pending column-lock backlog items; this is independent.)

create table public.email_log (
  id                  uuid primary key default gen_random_uuid(),
  event_type          text not null,   -- 'order.confirmation','order.shipped', ...
  recipient           text not null,   -- recipient address (NOT the body)
  order_id            uuid references public.orders(id) on delete set null,
  provider_message_id text,
  status              text not null check (status in ('sending','sent','failed','skipped')),
  error               text,            -- short provider error on failure (no body)
  created_at          timestamptz not null default now()
);

-- Idempotency: at most one in-flight/successful send per (order_id, event_type).
create unique index email_log_order_event_active_key
  on public.email_log (order_id, event_type)
  where order_id is not null and status in ('sending', 'sent');
create index email_log_order_idx on public.email_log (order_id, created_at);

-- ── RLS + grants (service writes; admins read; clients never touch it) ────────
alter table public.email_log enable row level security;

drop policy if exists "admins_select_email_log" on public.email_log;
create policy "admins_select_email_log"
  on public.email_log for select using (public.is_admin());

drop policy if exists "deny_client_insert_email_log" on public.email_log;
create policy "deny_client_insert_email_log"
  on public.email_log as restrictive for insert to authenticated, anon with check (false);
drop policy if exists "deny_client_update_email_log" on public.email_log;
create policy "deny_client_update_email_log"
  on public.email_log as restrictive for update to authenticated, anon using (false);
drop policy if exists "deny_client_delete_email_log" on public.email_log;
create policy "deny_client_delete_email_log"
  on public.email_log as restrictive for delete to authenticated, anon using (false);

grant select on table public.email_log to authenticated;             -- RLS → admins only
grant select, insert, update on table public.email_log to service_role; -- claim → send → mark
revoke all on table public.email_log from anon;
