-- ============================================================
-- Malnad Stories — 0014: order fulfillment + copies + pricing breakdown
-- Run this in: Supabase Dashboard → SQL Editor → New query
-- ============================================================
--
-- Phase 1 (Admin/Fulfillment). This migration only touches `orders`:
--   * adds the fulfillment lifecycle states 'printing' and 'packed'
--   * adds `copies` (1..10) and the server-computed pricing breakdown
--     (subtotal/shipping/discount) so the amount is reconstructable + auditable
--   * adds the coupon link (FK added in 0015, once coupons exists)
--   * adds shipping fields (tracking/carrier/shipped_at/delivered_at)
--   * adds indexes for the admin orders list + a carrier-scoped unique tracking guard
--
-- The coupon-consumption + paid-family guard live in 0017 (after coupons exist).

-- ── 1. New columns ───────────────────────────────────────────────────────────
alter table public.orders
  add column if not exists copies          integer       not null default 1,
  add column if not exists subtotal_amount numeric(10,2),
  add column if not exists shipping_amount numeric(10,2) not null default 99,
  add column if not exists discount_amount numeric(10,2) not null default 0,
  add column if not exists coupon_id       uuid,
  add column if not exists tracking_number text,
  add column if not exists carrier         text,
  add column if not exists shipped_at      timestamptz,
  add column if not exists delivered_at    timestamptz;

-- copies must be 1..10 (Zod enforces the same on the way in).
alter table public.orders drop constraint if exists orders_copies_check;
alter table public.orders
  add constraint orders_copies_check check (copies between 1 and 10);

-- Backfill the breakdown for pre-existing orders: total = base + flat 99 shipping,
-- so subtotal = total - shipping. discount defaults to 0; copies defaults to 1.
update public.orders
   set subtotal_amount = total_amount - shipping_amount
 where subtotal_amount is null;

alter table public.orders alter column subtotal_amount set not null;

-- ── 2. Lifecycle states — add 'printing' and 'packed' ────────────────────────
alter table public.orders drop constraint if exists orders_status_check;
alter table public.orders
  add constraint orders_status_check
  check (status in (
    'pending','paid','processing','printing','packed','shipped','delivered',
    'cancelled','failed'
  ));

-- ── 3. Indexes for the admin orders list + tracking guard ────────────────────
create index if not exists orders_status_idx            on public.orders (status);
create index if not exists orders_placed_at_idx         on public.orders (placed_at desc);
create index if not exists orders_status_placed_at_idx  on public.orders (status, placed_at desc);
create index if not exists orders_coupon_id_idx         on public.orders (coupon_id);

-- Carrier-scoped uniqueness: catches the realistic admin fat-finger (same tracking
-- pasted onto two orders for one carrier) while allowing different carriers to reuse
-- a tracking string. NOT globally unique (two couriers may issue the same number).
create unique index if not exists orders_carrier_tracking_key
  on public.orders (carrier, tracking_number)
  where tracking_number is not null;
