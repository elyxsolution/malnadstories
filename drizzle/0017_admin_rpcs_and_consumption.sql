-- ============================================================
-- Malnad Stories — 0017: admin RPCs + coupon consumption in the webhook
-- Run this in: Supabase Dashboard → SQL Editor → New query
-- ============================================================
--
-- Depends on 0014 (orders columns), 0015 (coupons), 0016 (audit/notes + log_audit).
--
-- This migration:
--   1. Rewrites process_razorpay_event (SAME 8-arg signature → no webhook route
--      change) to (a) fix the no-downgrade guard to the FULL paid-family and
--      (b) consume the coupon atomically on the FIRST transition to paid + audit it.
--   2. Adds the admin mutation RPCs (status / tracking / notes / coupons), each
--      SECURITY DEFINER, EXECUTE granted to service_role only, writing an audit row
--      in the same transaction. The calling server action does requireAdmin() first.
--
-- All money/status writes remain server-side; clients can never call these (0012's
-- restrictive deny + EXECUTE grants). Admin authz is enforced in the server action,
-- not here — these run as service_role, which only the trusted server reaches.

-- ── 1. Webhook processor (rewrite — signature unchanged from 0013) ───────────
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
  v_order_id   uuid;
  v_status     text;
  v_total      numeric;
  v_user_id    uuid;
  v_album_id   uuid;
  v_coupon_id  uuid;
  v_discount   numeric;
  v_code       text;
  v_uses       integer;
  v_max_uses   integer;
  -- "paid family": once an order is here, a late/duplicate event must NOT change it.
  v_paid_family constant text[] := array['paid','processing','printing','packed','shipped','delivered'];
begin
  -- 1. Find + lock the order. Missing → don't write the marker, let Razorpay retry.
  select id, status, total_amount, user_id, album_id, coupon_id, coalesce(discount_amount, 0)
    into v_order_id, v_status, v_total, v_user_id, v_album_id, v_coupon_id, v_discount
  from public.orders
  where razorpay_order_id = p_razorpay_order_id
  for update;

  if v_order_id is null then
    return 'order_not_found';
  end if;

  -- 2. Dedupe marker. Already present → processed before.
  insert into public.webhook_events (id, event_type)
  values (p_event_id, p_event_type)
  on conflict (id) do nothing;

  if not found then
    return 'duplicate';
  end if;

  -- 3. State change.
  if p_outcome = 'captured' then
    -- Integrity gate (0013): currency must be INR and amount must equal the order
    -- total (which now includes copies + discount). On mismatch: record, do NOT fulfil.
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

    -- Transition + consume ONLY on the first entry into the paid family. A duplicate
    -- capture (or one arriving after admin advanced the order) sees a paid-family
    -- status and skips this block → no downgrade, no double consumption.
    if not (v_status = any (v_paid_family)) then
      update public.orders set status = 'paid' where id = v_order_id;

      perform public.log_audit(null, 'system', 'order.status_changed', 'order', v_order_id,
        jsonb_build_object('order_id', v_order_id, 'album_id', v_album_id,
                           'customer_id', v_user_id, 'from', v_status, 'to', 'paid'));

      -- Coupon consumption: only here, only once. Idempotent via redemptions.order_id.
      if v_coupon_id is not null then
        update public.coupons
           set current_uses = current_uses + 1
         where id = v_coupon_id
        returning current_uses, max_uses, code into v_uses, v_max_uses, v_code;

        insert into public.coupon_redemptions (coupon_id, order_id, user_id, amount_discounted)
        values (v_coupon_id, v_order_id, v_user_id, v_discount)
        on conflict (order_id) do nothing;

        perform public.log_audit(null, 'system', 'coupon.redeemed', 'coupon', v_coupon_id,
          jsonb_build_object('order_id', v_order_id, 'album_id', v_album_id,
                             'customer_id', v_user_id, 'coupon_id', v_coupon_id,
                             'code', v_code, 'amount_discounted', v_discount));

        -- Soft-cap oversell visibility (documented trade-off): payment already
        -- captured the discounted total, so we honour it, but surface the breach.
        if v_max_uses is not null and v_uses > v_max_uses then
          raise warning 'coupon % oversold: uses=% cap=% (order %)', v_code, v_uses, v_max_uses, v_order_id;
        end if;
      end if;
    end if;

    insert into public.payments (order_id, razorpay_payment_id, method, amount, status, captured_at)
    values (v_order_id, p_payment_id, p_method, p_amount, 'captured', now())
    on conflict (razorpay_payment_id) where razorpay_payment_id is not null
    do update set status = 'captured', method = excluded.method,
                  amount = excluded.amount, captured_at = now();

  elsif p_outcome = 'failed' then
    -- Never knock a paid-family order back to failed (a later capture may have won,
    -- or admin has already advanced fulfilment).
    if not (v_status = any (v_paid_family)) then
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

-- ── 2. admin_update_order_status ─────────────────────────────────────────────
-- Forward-only adjacency (Phase 1; no admin cancel/refund). 'shipped' requires
-- tracking + carrier and stamps shipped_at; 'delivered' stamps delivered_at.
create or replace function public.admin_update_order_status(
  p_order_id   uuid,
  p_new_status text,
  p_actor_id   uuid
) returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_status   text;
  v_user_id  uuid;
  v_album_id uuid;
  v_tracking text;
  v_carrier  text;
begin
  select status, user_id, album_id, tracking_number, carrier
    into v_status, v_user_id, v_album_id, v_tracking, v_carrier
  from public.orders
  where id = p_order_id
  for update;

  if v_status is null then
    return 'order_not_found';
  end if;

  if (v_status, p_new_status) not in (
        ('paid','processing'),
        ('processing','printing'),
        ('printing','packed'),
        ('packed','shipped'),
        ('shipped','delivered')
     ) then
    return 'invalid_transition';
  end if;

  if p_new_status = 'shipped' and (v_tracking is null or v_carrier is null) then
    return 'tracking_required';
  end if;

  update public.orders
     set status       = p_new_status,
         shipped_at   = case when p_new_status = 'shipped'   then now() else shipped_at   end,
         delivered_at = case when p_new_status = 'delivered' then now() else delivered_at end
   where id = p_order_id;

  perform public.log_audit(p_actor_id, 'admin', 'order.status_changed', 'order', p_order_id,
    jsonb_build_object('order_id', p_order_id, 'album_id', v_album_id,
                       'customer_id', v_user_id, 'from', v_status, 'to', p_new_status));
  return 'ok';
end;
$$;

-- ── 3. admin_set_tracking ────────────────────────────────────────────────────
create or replace function public.admin_set_tracking(
  p_order_id uuid,
  p_tracking text,
  p_carrier  text,
  p_actor_id uuid
) returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id  uuid;
  v_album_id uuid;
begin
  select user_id, album_id into v_user_id, v_album_id
  from public.orders where id = p_order_id for update;

  if v_user_id is null then
    return 'order_not_found';
  end if;

  update public.orders
     set tracking_number = p_tracking, carrier = p_carrier
   where id = p_order_id;

  perform public.log_audit(p_actor_id, 'admin', 'order.shipping_set', 'order', p_order_id,
    jsonb_build_object('order_id', p_order_id, 'album_id', v_album_id,
                       'customer_id', v_user_id, 'carrier', p_carrier,
                       'tracking_number', p_tracking));
  return 'ok';
exception
  when unique_violation then
    -- carrier-scoped unique tracking index (0014) tripped → friendly signal.
    return 'tracking_duplicate';
end;
$$;

-- ── 4. admin_add_order_note ──────────────────────────────────────────────────
create or replace function public.admin_add_order_note(
  p_order_id uuid,
  p_actor_id uuid,
  p_body     text
) returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id  uuid;
  v_album_id uuid;
  v_note_id  uuid;
begin
  select user_id, album_id into v_user_id, v_album_id
  from public.orders where id = p_order_id;

  if v_user_id is null then
    return 'order_not_found';
  end if;

  insert into public.order_notes (order_id, author_id, body)
  values (p_order_id, p_actor_id, p_body)
  returning id into v_note_id;

  perform public.log_audit(p_actor_id, 'admin', 'order.note_added', 'order', p_order_id,
    jsonb_build_object('order_id', p_order_id, 'album_id', v_album_id,
                       'customer_id', v_user_id, 'note_id', v_note_id));
  return 'ok';
end;
$$;

-- ── 5. admin_create_coupon ───────────────────────────────────────────────────
-- Code is generated server-side (TS) and passed in; a unique_violation on the code
-- propagates so the action can regenerate + retry.
create or replace function public.admin_create_coupon(
  p_code                 text,
  p_description          text,
  p_discount_type        text,
  p_discount_value       numeric,
  p_minimum_order_amount numeric,
  p_max_uses             integer,
  p_starts_at            timestamptz,
  p_expires_at           timestamptz,
  p_actor_id             uuid
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  insert into public.coupons (
    code, description, discount_type, discount_value, minimum_order_amount,
    max_uses, starts_at, expires_at, active, created_by
  ) values (
    upper(p_code), p_description, p_discount_type, p_discount_value, p_minimum_order_amount,
    p_max_uses, coalesce(p_starts_at, now()), p_expires_at, true, p_actor_id
  ) returning id into v_id;

  perform public.log_audit(p_actor_id, 'admin', 'coupon.created', 'coupon', v_id,
    jsonb_build_object('coupon_id', v_id, 'code', upper(p_code), 'discount_type', p_discount_type,
                       'discount_value', p_discount_value, 'minimum_order_amount', p_minimum_order_amount,
                       'max_uses', p_max_uses));
  return v_id;
end;
$$;

-- ── 6. admin_set_coupon_active ───────────────────────────────────────────────
create or replace function public.admin_set_coupon_active(
  p_coupon_id uuid,
  p_active    boolean,
  p_actor_id  uuid
) returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_code text;
begin
  update public.coupons set active = p_active
   where id = p_coupon_id
  returning code into v_code;

  if v_code is null then
    return 'coupon_not_found';
  end if;

  perform public.log_audit(p_actor_id, 'admin',
    case when p_active then 'coupon.enabled' else 'coupon.disabled' end,
    'coupon', p_coupon_id,
    jsonb_build_object('coupon_id', p_coupon_id, 'code', v_code, 'active', p_active));
  return 'ok';
end;
$$;

-- ── 7. Grants — admin RPCs are callable by service_role ONLY ─────────────────
revoke execute on function public.admin_update_order_status(uuid,text,uuid)            from public, anon, authenticated;
revoke execute on function public.admin_set_tracking(uuid,text,text,uuid)             from public, anon, authenticated;
revoke execute on function public.admin_add_order_note(uuid,uuid,text)                from public, anon, authenticated;
revoke execute on function public.admin_create_coupon(text,text,text,numeric,numeric,integer,timestamptz,timestamptz,uuid) from public, anon, authenticated;
revoke execute on function public.admin_set_coupon_active(uuid,boolean,uuid)          from public, anon, authenticated;

grant execute on function public.admin_update_order_status(uuid,text,uuid)            to service_role;
grant execute on function public.admin_set_tracking(uuid,text,text,uuid)             to service_role;
grant execute on function public.admin_add_order_note(uuid,uuid,text)                to service_role;
grant execute on function public.admin_create_coupon(text,text,text,numeric,numeric,integer,timestamptz,timestamptz,uuid) to service_role;
grant execute on function public.admin_set_coupon_active(uuid,boolean,uuid)          to service_role;

-- ============================================================
-- VERIFICATION (run manually in a scratch txn; DO NOT commit). Replace the UUIDs
-- with a real pending order that has a coupon to exercise consumption.
-- ============================================================
-- begin;
--   -- pick a pending order with a coupon
--   -- select id, status, total_amount, coupon_id, discount_amount from public.orders
--   --   where status='pending' and coupon_id is not null limit 1;
--
--   -- (A) first capture → 'processed', order paid, coupon used+1, 1 redemption, 2 audit rows
--   select public.process_razorpay_event('evt_test_1','payment.captured','<rzp_order_id>',
--          'pay_test_1','upi', <total_amount>, 'INR', 'captured');
--
--   -- (B) duplicate same event id → 'duplicate' (no second consume)
--   select public.process_razorpay_event('evt_test_1','payment.captured','<rzp_order_id>',
--          'pay_test_1','upi', <total_amount>, 'INR', 'captured');
--
--   -- (C) NEW event id, same order, now already paid → 'processed' but guard skips:
--   --     current_uses unchanged, still 1 redemption (order_id unique), no downgrade
--   select public.process_razorpay_event('evt_test_2','payment.captured','<rzp_order_id>',
--          'pay_test_2','upi', <total_amount>, 'INR', 'captured');
--
--   -- (D) wrong amount → 'amount_mismatch', order NOT paid, RAISE WARNING
--   select public.process_razorpay_event('evt_test_3','payment.captured','<rzp_order_id_2>',
--          'pay_test_3','upi', 1.00, 'INR', 'captured');
--
--   -- inspect
--   -- select status, current_uses from ... ; select * from public.audit_log order by created_at desc;
-- rollback;
