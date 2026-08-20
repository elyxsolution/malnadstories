-- ============================================================
-- Malnad Stories — 0055: Cart foundation (cart_items)
-- Run this in: Supabase Dashboard → SQL Editor → New query
-- ============================================================
--
-- Phase 6. A pre-purchase staging area: which of MY albums do I intend to order,
-- and how many copies of each. Additive — nothing here touches orders, payments,
-- uploads, PDF, or their RLS.
--
-- ONE TABLE, NO PARENT `carts`. A `carts` row would carry no information beyond
-- `user_id`, which cart_items already has (one cart per user is implicit). Dropping it
-- removes the single most dangerous field a cart schema can have — a client-supplied
-- `cart_id` — rather than defending against it, and it lets RLS be the same direct
-- `user_id = auth.uid()` predicate used by albums / addresses / photos instead of a
-- subquery through a parent table.
--
-- NO PRICE, NO PRODUCT SNAPSHOT. `createOrder` already resolves the price server-side
-- via priceFor(product_id, size) and snapshots product_name / product_dimensions /
-- the pricing breakdown onto the order at order time. A price on the cart would be a
-- second, staler authority for money — exactly the manipulation surface to avoid. The
-- cart references the album and a quantity, nothing else.
--
-- QUANTITY 1..10 is NOT a new rule: it mirrors orders_copies_check (0014) and
-- CreateOrderSchema.copies, so a cart can never hold a quantity an order would reject.
--
-- BOTH FOREIGN KEYS CASCADE. Note this deliberately differs from 0054, which moved
-- photos.user_id / albums.user_id to ON DELETE RESTRICT: those rows name R2 objects, so
-- deleting them silently orphaned storage. A cart row names no storage at all, so
-- cascade is correct — deleting an album simply removes it from the cart, and
-- deleteAlbum needs no change whatsoever.

-- ── 1. cart_items ────────────────────────────────────────────────────────────
create table if not exists public.cart_items (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  album_id   uuid not null references public.albums(id)   on delete cascade,
  quantity   integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cart_items_quantity_check check (quantity >= 1 and quantity <= 10)
);

-- THE duplicate-handling invariant, and the ON CONFLICT target for the atomic upsert.
-- Adding the same album twice must increment one row, never create a second — including
-- when two tabs race, which a read-then-write could not guarantee.
create unique index if not exists cart_items_user_album_key
  on public.cart_items (user_id, album_id);

-- The only read the cart makes: this user's items, newest first.
create index if not exists cart_items_user_idx
  on public.cart_items (user_id, created_at desc);

-- ── 2. RLS ───────────────────────────────────────────────────────────────────
-- Customer-owned and client-writable, following albums / addresses / photos — NOT the
-- server-controlled shape used by orders / payments, because a cart holds no money and
-- no server-computed value. `with check` is stated explicitly (albums relies on `using`
-- alone for `for all`); it costs nothing and makes the INSERT rule unmistakable.
alter table public.cart_items enable row level security;

-- `create policy` has no IF NOT EXISTS, so drop first: everything else in this file is
-- idempotent (create-if-not-exists / create-or-replace / revoke / grant), and a migration an
-- operator may re-run should not fail halfway through on its fifth statement.
drop policy if exists "users_own_cart_items"       on public.cart_items;
drop policy if exists "admins_read_all_cart_items" on public.cart_items;

create policy "users_own_cart_items"
  on public.cart_items for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "admins_read_all_cart_items"
  on public.cart_items for select
  using (public.is_admin());

-- ── 3. Grants ────────────────────────────────────────────────────────────────
-- GRANTs allow table access; the RLS policies above filter rows. Both are required.
grant select, insert, update, delete on table public.cart_items to authenticated;
grant all on table public.cart_items to service_role;

-- REVOKE FROM anon. Supabase's default privileges hand a freshly created public table
-- REFERENCES/TRIGGER/TRUNCATE to anon, which NO other table in this project carries — albums,
-- orders, photos, addresses and support_tickets all give anon nothing. TRUNCATE is the one that
-- matters: it is reachable with the public anon key and RLS does not restrict it, so leaving it
-- would let an unauthenticated caller empty every customer's cart. (Found by verifying the LIVE
-- grants after this migration first ran, not by reading the file.)
revoke all on table public.cart_items from anon;

-- ── 4. The two write helpers ─────────────────────────────────────────────────
-- WHY THESE EXIST. PostgREST's upsert can only overwrite a column with the value you
-- supply; it cannot express `quantity = least(existing + new, 10)`. Doing that as
-- read-then-write in the app would lose an increment whenever two tabs race, so the
-- arithmetic happens inside ONE statement here.
--
-- NEITHER IS `security definer`, and neither takes a user id. Each reads `auth.uid()`
-- itself, so:
--   • the caller's RLS still applies (a plain function runs as the caller), and
--   • there is no `p_user_id` parameter for a client to forge.
-- The `set search_path` pin is standard hygiene for a function referenced by name.

-- MANUAL ADD: "put this many more copies in my cart." Increments, capped at 10.
create or replace function public.cart_add_or_increment(p_album_id uuid, p_quantity integer)
returns void
language sql
set search_path = public
as $$
  insert into public.cart_items (user_id, album_id, quantity)
  values (auth.uid(), p_album_id, greatest(least(p_quantity, 10), 1))
  on conflict (user_id, album_id) do update
    set quantity   = least(public.cart_items.quantity + excluded.quantity, 10),
        updated_at = now();
$$;

-- AUTO-ADD: "make sure this album is in my cart." Never increments — album submission can
-- run repeatedly (resubmission), and five resubmits must not mean five copies.
create or replace function public.cart_ensure_item(p_album_id uuid)
returns void
language sql
set search_path = public
as $$
  insert into public.cart_items (user_id, album_id, quantity)
  values (auth.uid(), p_album_id, 1)
  on conflict (user_id, album_id) do nothing;
$$;

-- Postgres grants EXECUTE on a new function to PUBLIC by default, so revoke first and then grant
-- deliberately — matching log_audit / submit_album_for_review, which anon cannot execute. An anon
-- caller could not actually insert anything (auth.uid() is null, so both NOT NULL and the RLS
-- WITH CHECK reject the row), but a cart mutation has no business being callable unauthenticated.
revoke all on function public.cart_add_or_increment(uuid, integer) from public;
revoke all on function public.cart_ensure_item(uuid)               from public;

grant execute on function public.cart_add_or_increment(uuid, integer) to authenticated;
grant execute on function public.cart_ensure_item(uuid)               to authenticated;
grant execute on function public.cart_add_or_increment(uuid, integer) to service_role;
grant execute on function public.cart_ensure_item(uuid)               to service_role;

-- ── 5. Album eligibility is NOT enforced here ────────────────────────────────
-- "You may only cart an album you own, and never a blueprint draft" is enforced in the
-- server action (src/lib/actions/cart.ts), which re-reads the album through the
-- RLS-scoped authenticated client — the same way createOrder proves ownership. Doing it
-- as a WITH CHECK subquery over albums would add a cross-table lookup to every cart
-- write; the policy above already makes a row unreachable unless it is yours.

-- ── Verify ───────────────────────────────────────────────────────────────────
-- select table_name from information_schema.tables where table_name = 'cart_items';
-- select conname, pg_get_constraintdef(oid) from pg_constraint
--   where conrelid = 'public.cart_items'::regclass;
-- select policyname, cmd, qual, with_check from pg_policies
--   where schemaname = 'public' and tablename = 'cart_items';
