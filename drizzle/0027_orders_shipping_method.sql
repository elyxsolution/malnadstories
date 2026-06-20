-- ============================================================
-- Malnad Stories — 0027: persist the delivery tier on the order
-- Run this in: Supabase Dashboard → SQL Editor → New query
-- DEPLOY ORDER: run THIS SQL FIRST, then deploy the matching app build.
--   Additive (new nullable-safe column with a default) → compatible with the OLD
--   build; the NEW build's createOrder WRITES shipping_method, so the column must
--   already exist when it deploys.
-- ============================================================
--
-- Additive only. `shipping_method` records which tier the customer chose; the
-- shipping AMOUNT is still computed server-side (lib/pricing + lib/shipping) and lives
-- in the existing `shipping_amount` column — this is just the label of the tier.
-- Nullable-safe via a NOT NULL DEFAULT 'standard', so existing rows backfill to the
-- current flat behaviour and the Razorpay/webhook pipeline is untouched. orders writes
-- go through the service role (full grant) → no client grant change.

alter table public.orders add column if not exists shipping_method text not null default 'standard';

alter table public.orders drop constraint if exists orders_shipping_method_check;
alter table public.orders
  add constraint orders_shipping_method_check
  check (shipping_method in ('standard', 'priority', 'express'));
