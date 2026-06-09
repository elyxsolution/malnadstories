-- ============================================================
-- Malnad Stories — 0013: webhook amount + currency validation
-- Run this in: Supabase Dashboard → SQL Editor → New query
-- ============================================================
--
-- AUDIT FINDING (LOW, defense-in-depth): process_razorpay_event recorded the captured
-- amount but never asserted it matched orders.total_amount, nor that currency = INR.
-- Underpayment is already blocked upstream (the Razorpay order binds the amount), so
-- this is a safety net: if a captured event EVER arrives with an amount/currency that
-- doesn't match what we charged, we record the payment for forensics but DO NOT mark
-- the order paid — and we RAISE WARNING so it surfaces in the Postgres logs.
--
-- Also adds a RAISE WARNING when an order is recovered to 'paid' from a non-pending
-- status (e.g. cancelled/failed → paid via a genuine late capture) so ops can review
-- (audit Finding 6 monitoring).
--
-- The function SIGNATURE changes (adds p_currency), so the 7-arg version is dropped
-- and the 8-arg version created. DEPLOY THE ROUTE CHANGE TOGETHER: the webhook route
-- must call the new 8-arg signature. (If the migration lands first, the route's RPC
-- 503s and Razorpay retries until the code deploy catches up — no data loss.)

drop function if exists public.process_razorpay_event(text,text,text,text,text,numeric,text);

create or replace function public.process_razorpay_event(
  p_event_id          text,
  p_event_type        text,
  p_razorpay_order_id text,
  p_payment_id        text,
  p_method            text,
  p_amount            numeric,
  p_currency          text,
  p_outcome           text   -- 'captured' | 'failed'
) returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order_id uuid;
  v_status   text;
  v_total    numeric;
begin
  -- 1. Find + lock the order. Missing → don't write the marker, let Razorpay retry.
  select id, status, total_amount into v_order_id, v_status, v_total
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

  -- 3. State change.
  if p_outcome = 'captured' then
    -- Integrity gate (Finding 4): the captured amount + currency MUST match what we
    -- charged. On mismatch, record the payment but refuse to fulfil, and log loudly.
    if p_currency is distinct from 'INR'
       or round(coalesce(p_amount, -1), 2) is distinct from v_total then
      insert into public.payments (order_id, razorpay_payment_id, method, amount, status, captured_at)
      values (v_order_id, p_payment_id, p_method, p_amount, 'captured', now())
      on conflict (razorpay_payment_id) where razorpay_payment_id is not null
      do update set status = 'captured', method = excluded.method,
                    amount = excluded.amount, captured_at = now();
      raise warning 'razorpay amount/currency mismatch (order NOT marked paid): order=% expected=% got_amount=% got_currency=% payment=%',
        v_order_id, v_total, p_amount, p_currency, p_payment_id;
      return 'amount_mismatch';
    end if;

    if v_status <> 'paid' then
      update public.orders set status = 'paid' where id = v_order_id;
      -- Monitoring (Finding 6): a recovery from a terminal/cancelled state to paid.
      if v_status <> 'pending' then
        raise warning 'order % recovered to paid from non-pending status % (genuine late capture %)',
          v_order_id, v_status, p_payment_id;
      end if;
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

revoke execute on function public.process_razorpay_event(text,text,text,text,text,numeric,text,text)
  from public, anon, authenticated;
grant execute on function public.process_razorpay_event(text,text,text,text,text,numeric,text,text)
  to service_role;
