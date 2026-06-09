-- ============================================================
-- Malnad Stories — 0015: coupons + redemptions
-- Run this in: Supabase Dashboard → SQL Editor → New query
-- ============================================================
--
-- Coupon model (see the Phase-1 design doc):
--   * code is stored UPPER, uniqueness via a functional unique index.
--   * minimum_order_amount (Refinement 1) + starts_at (Refinement 2) gate validity.
--   * NOT consumed at apply — consumed only when payment is confirmed (0017's webhook
--     rewrite). coupon_redemptions has a UNIQUE(order_id) so consumption is idempotent
--     and at most once per order.
--   * SOFT cap by design (reservation-free apply): documented trade-off in the design.
--
-- Security: no anon/authenticated WRITE (RESTRICTIVE deny, mirrors 0012). Admins may
-- SELECT (is_admin()); customer-facing validation reads via the service role only, so
-- codes can't be enumerated. Service-role writes happen through SECURITY DEFINER RPCs.

-- ── 1. coupons ───────────────────────────────────────────────────────────────
create table if not exists public.coupons (
  id                   uuid primary key default gen_random_uuid(),
  code                 text not null,
  description          text,
  discount_type        text not null check (discount_type in ('flat','percentage')),
  discount_value       numeric(10,2) not null check (discount_value > 0),
  minimum_order_amount numeric(10,2) check (minimum_order_amount is null or minimum_order_amount >= 0),
  max_uses             integer check (max_uses is null or max_uses > 0),
  current_uses         integer not null default 0,
  starts_at            timestamptz not null default now(),
  expires_at           timestamptz,
  active               boolean not null default true,
  created_by           uuid references public.profiles(id),
  created_at           timestamptz not null default now(),
  constraint coupons_pct_max check (discount_type <> 'percentage' or discount_value <= 100),
  constraint coupons_window  check (expires_at is null or expires_at > starts_at)
);

create unique index if not exists coupons_code_key
  on public.coupons (upper(code));
create index if not exists coupons_active_expires_idx
  on public.coupons (active, expires_at);

-- ── 2. coupon_redemptions (the consumption record) ───────────────────────────
create table if not exists public.coupon_redemptions (
  id                uuid primary key default gen_random_uuid(),
  coupon_id         uuid not null references public.coupons(id),
  order_id          uuid not null references public.orders(id) on delete cascade,
  user_id           uuid not null references public.profiles(id),
  amount_discounted numeric(10,2) not null,
  redeemed_at       timestamptz not null default now()
);

-- ≤1 redemption per order → webhook re-entry / concurrent captures can't double-count.
create unique index if not exists coupon_redemptions_order_key
  on public.coupon_redemptions (order_id);
create index if not exists coupon_redemptions_coupon_idx
  on public.coupon_redemptions (coupon_id);

-- ── 3. orders.coupon_id FK (column added in 0014) ────────────────────────────
alter table public.orders drop constraint if exists orders_coupon_id_fkey;
alter table public.orders
  add constraint orders_coupon_id_fkey
  foreign key (coupon_id) references public.coupons(id);

-- ── 4. RLS + grants ──────────────────────────────────────────────────────────
alter table public.coupons             enable row level security;
alter table public.coupon_redemptions  enable row level security;

-- Admins may read (authenticated client + is_admin()). No customer read.
drop policy if exists "admins_select_coupons" on public.coupons;
create policy "admins_select_coupons"
  on public.coupons for select
  using (public.is_admin());

drop policy if exists "admins_select_redemptions" on public.coupon_redemptions;
create policy "admins_select_redemptions"
  on public.coupon_redemptions for select
  using (public.is_admin());

-- RESTRICTIVE write-deny for client roles (writes go through service-role RPCs).
drop policy if exists "deny_client_insert_coupons" on public.coupons;
create policy "deny_client_insert_coupons"
  on public.coupons as restrictive for insert to authenticated, anon with check (false);
drop policy if exists "deny_client_update_coupons" on public.coupons;
create policy "deny_client_update_coupons"
  on public.coupons as restrictive for update to authenticated, anon using (false);
drop policy if exists "deny_client_delete_coupons" on public.coupons;
create policy "deny_client_delete_coupons"
  on public.coupons as restrictive for delete to authenticated, anon using (false);

drop policy if exists "deny_client_insert_redemptions" on public.coupon_redemptions;
create policy "deny_client_insert_redemptions"
  on public.coupon_redemptions as restrictive for insert to authenticated, anon with check (false);
drop policy if exists "deny_client_update_redemptions" on public.coupon_redemptions;
create policy "deny_client_update_redemptions"
  on public.coupon_redemptions as restrictive for update to authenticated, anon using (false);
drop policy if exists "deny_client_delete_redemptions" on public.coupon_redemptions;
create policy "deny_client_delete_redemptions"
  on public.coupon_redemptions as restrictive for delete to authenticated, anon using (false);

-- Table privileges: SELECT to authenticated (RLS limits to admins); service_role full.
grant select on table public.coupons            to authenticated;
grant select on table public.coupon_redemptions to authenticated;
grant all    on table public.coupons            to service_role;
grant all    on table public.coupon_redemptions to service_role;
revoke all   on table public.coupons            from anon;
revoke all   on table public.coupon_redemptions from anon;
