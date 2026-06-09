-- ============================================================
-- Malnad Stories — 0018: coupon "created reason" (admin provenance)
-- Run this in: Supabase Dashboard → SQL Editor → New query
-- ============================================================
--
-- Adds a free-text `created_reason` to coupons (the internal "why was this issued"
-- note, distinct from the customer-facing `description`) and extends admin_create_coupon
-- to record it + include it in the audit metadata. Signature changes (extra param), so
-- the 9-arg version is dropped and a 10-arg version created.

alter table public.coupons add column if not exists created_reason text;

drop function if exists public.admin_create_coupon(text,text,text,numeric,numeric,integer,timestamptz,timestamptz,uuid);

create or replace function public.admin_create_coupon(
  p_code                 text,
  p_description          text,
  p_created_reason       text,
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
    code, description, created_reason, discount_type, discount_value, minimum_order_amount,
    max_uses, starts_at, expires_at, active, created_by
  ) values (
    upper(p_code), p_description, p_created_reason, p_discount_type, p_discount_value, p_minimum_order_amount,
    p_max_uses, coalesce(p_starts_at, now()), p_expires_at, true, p_actor_id
  ) returning id into v_id;

  perform public.log_audit(p_actor_id, 'admin', 'coupon.created', 'coupon', v_id,
    jsonb_build_object('coupon_id', v_id, 'code', upper(p_code), 'discount_type', p_discount_type,
                       'discount_value', p_discount_value, 'minimum_order_amount', p_minimum_order_amount,
                       'max_uses', p_max_uses, 'created_reason', p_created_reason));
  return v_id;
end;
$$;

revoke execute on function public.admin_create_coupon(text,text,text,text,numeric,numeric,integer,timestamptz,timestamptz,uuid)
  from public, anon, authenticated;
grant execute on function public.admin_create_coupon(text,text,text,text,numeric,numeric,integer,timestamptz,timestamptz,uuid)
  to service_role;
