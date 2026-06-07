-- ============================================================
-- Malnad Stories — 0010: checkout + payment (Razorpay)
-- Run this in: Supabase Dashboard → SQL Editor → New query
-- ============================================================
--
-- This slice handles real money, so the DB carries hard guarantees:
--   * orders/payments writes are service-role only (see 0003) — total_amount is
--     always computed server-side, and "paid" is only ever set by the verified,
--     idempotent webhook.
--   * a service-only webhook_events table provides the idempotency marker.
--   * process_razorpay_event() does dedupe + order update + payment upsert in ONE
--     transaction, so a duplicate webhook is a no-op and a failed state change can
--     never leave a dedupe marker behind (the retry reprocesses cleanly).

-- ── 1. Orders status — add 'failed' ─────────────────────────────────────────
-- A payment.failed webhook flips the order to 'failed'; the user re-checks out
-- (a fresh order). 'cancelled' already existed (self-cancel of a pending order).

alter table public.orders drop constraint if exists orders_status_check;
alter table public.orders
  add constraint orders_status_check
  check (status in ('pending','paid','failed','processing','shipped','delivered','cancelled'));

-- ── 2. Idempotency / dedupe indexes ─────────────────────────────────────────
-- One payment row per Razorpay payment id; one order per Razorpay order id. The
-- webhook processor upserts on these, so duplicate events can't create duplicates.

create unique index if not exists payments_razorpay_payment_id_key
  on public.payments (razorpay_payment_id)
  where razorpay_payment_id is not null;

create unique index if not exists orders_razorpay_order_id_key
  on public.orders (razorpay_order_id)
  where razorpay_order_id is not null;

-- ── 3. Webhook idempotency record (service-only) ────────────────────────────
-- Keyed by Razorpay's X-Razorpay-Event-Id, which is stable across delivery
-- retries. RLS is ON with NO policies → anon/authenticated are fully blocked;
-- only the service role (which bypasses RLS) touches it, via the function below.

create table if not exists public.webhook_events (
  id          text        primary key,   -- X-Razorpay-Event-Id
  event_type  text,
  received_at timestamptz not null default now()
);

alter table public.webhook_events enable row level security;

-- service_role inherits table privileges from 0009's default-privileges grant,
-- but make it explicit here and slam the door on anon/authenticated as a belt.
grant all on table public.webhook_events to service_role;
revoke all on table public.webhook_events from anon, authenticated;

-- ── 4. Atomic webhook processor ─────────────────────────────────────────────
-- Runs as a single transaction. Order of operations matters:
--   1. find + lock the order by razorpay_order_id. If it doesn't exist yet (a
--      webhook racing ahead of our orders INSERT), return 'order_not_found'
--      WITHOUT writing the dedupe marker, so a retry can reprocess.
--   2. insert the dedupe marker; if it already exists → 'duplicate' (no-op).
--   3. flip the order + upsert the payment row. Idempotent: an already-paid
--      order is left as-is; the payment upserts on its unique razorpay_payment_id.
-- Because (2) and (3) share this transaction, any failure rolls back the marker.
--
-- SECURITY DEFINER so it runs with the owner's rights regardless of caller, with
-- a pinned search_path; EXECUTE is granted to service_role only.

create or replace function public.process_razorpay_event(
  p_event_id          text,
  p_event_type        text,
  p_razorpay_order_id text,
  p_payment_id        text,
  p_method            text,
  p_amount            numeric,
  p_outcome           text   -- 'captured' | 'failed'
) returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order_id uuid;
  v_status   text;
begin
  -- 1. Find + lock the order. Missing → don't write the marker, let Razorpay retry.
  select id, status into v_order_id, v_status
  from public.orders
  where razorpay_order_id = p_razorpay_order_id
  for update;

  if v_order_id is null then
    return 'order_not_found';
  end if;

  -- 2. Dedupe marker. Already present → this event was processed before.
  insert into public.webhook_events (id, event_type)
  values (p_event_id, p_event_type)
  on conflict (id) do nothing;

  if not found then
    return 'duplicate';
  end if;

  -- 3. State change (idempotent regardless, but guarded so we never downgrade paid).
  if p_outcome = 'captured' then
    if v_status <> 'paid' then
      update public.orders set status = 'paid' where id = v_order_id;
    end if;

    insert into public.payments (order_id, razorpay_payment_id, method, amount, status, captured_at)
    values (v_order_id, p_payment_id, p_method, p_amount, 'captured', now())
    on conflict (razorpay_payment_id) where razorpay_payment_id is not null
    do update set status = 'captured', method = excluded.method,
                  amount = excluded.amount, captured_at = now();

  elsif p_outcome = 'failed' then
    -- Never knock a paid order back to failed (a later capture event may have won).
    if v_status not in ('paid') then
      update public.orders set status = 'failed' where id = v_order_id;
    end if;

    insert into public.payments (order_id, razorpay_payment_id, method, amount, status)
    values (v_order_id, p_payment_id, p_method, p_amount, 'failed')
    on conflict (razorpay_payment_id) where razorpay_payment_id is not null
    do update set status = 'failed', method = excluded.method, amount = excluded.amount;
  end if;

  return 'processed';
end;
$$;

revoke execute on function public.process_razorpay_event(text,text,text,text,text,numeric,text)
  from public, anon, authenticated;
grant execute on function public.process_razorpay_event(text,text,text,text,text,numeric,text)
  to service_role;
