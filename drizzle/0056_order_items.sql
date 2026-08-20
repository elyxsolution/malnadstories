-- ============================================================
-- Malnad Stories — 0056: order_items (Phase 8 multi-album order foundation)
-- Run this in: Supabase Dashboard → SQL Editor → New query
-- ============================================================
--
-- ONE PURCHASE = ONE `orders` ROW. This migration does NOT change that: it adds the
-- child table that lets a single order name more than one album, so that a combined
-- checkout stays exactly one Razorpay order and exactly one payment.
--
-- WHY A CHILD TABLE AND NOT ONE ORDER PER ALBUM. The alternative (N orders sharing a
-- payment) would require dropping `orders_razorpay_order_id_key` and rewriting
-- `process_razorpay_event` — the atomic, money-critical function whose amount gate is
-- `round(p_amount,2) = orders.total_amount`. This shape leaves that function, the
-- payments table, the dedupe marker, the coupon consumption and every unique index
-- completely untouched, because the invariant they rest on is preserved:
--     one application order = one Razorpay order = one payment = one amount.
--
-- `orders.album_id` STAYS NOT NULL and is now a LEGACY/DISPLAY POINTER equal to the
-- FIRST item's album. `order_items` is the authoritative list of albums in an order.
-- The same applies to `orders.copies` / `product_id` / `product_name` /
-- `product_dimensions`: for a single-album order they remain exactly correct; for a
-- combined order they mirror the first item. (`orders.copies` deliberately does NOT
-- become a sum — `orders_copies_check` caps it at 10, and 3 albums × 4 copies would
-- violate it. Per-album copies live on `order_items.copies`.)
--
-- MONEY STAYS ORDER-LEVEL. `subtotal_amount` / `shipping_amount` / `discount_amount` /
-- `total_amount` on the order remain the single authority, and shipping is charged ONCE
-- per order (₹99/₹199/₹399 by tier — a product decision, unchanged by album count).
-- The per-line columns here are an immutable SNAPSHOT so a historical order stays
-- readable after titles, products, catalog prices or dimensions change. Deliberately
-- absent: shipping allocation, coupon allocation, tax, item status, item destination,
-- cover snapshot, R2 keys, payment or refund fields — each would create a second,
-- divergent money authority.

-- ── 1. order_items ───────────────────────────────────────────────────────────
create table if not exists public.order_items (
  id                 uuid primary key default gen_random_uuid(),
  order_id           uuid not null references public.orders(id) on delete cascade,
  -- NO ACTION, mirroring orders.album_id exactly: a purchased album must never be
  -- deletable out from under its order. (Unlike cart_items, which cascades — a cart row
  -- is an intention, an order item is a record of a sale.)
  album_id           uuid not null references public.albums(id),
  copies             integer not null default 1,
  -- Snapshot of priceFor(product, page_count) at purchase time.
  unit_price         numeric not null,
  -- Stored rather than derived so the receipt never has to recompute money.
  line_subtotal      numeric not null,
  product_id         uuid references public.album_products(id) on delete set null,
  product_name       text,
  product_dimensions jsonb,
  -- Titles are editable until payment; the printed book carries the title as purchased.
  album_title        text not null,
  created_at         timestamptz not null default now(),
  constraint order_items_copies_check check (copies >= 1 and copies <= 10)
);

-- An album appears at most ONCE per order; `copies` is the multiplier. Also the
-- ON CONFLICT target that makes the backfill below re-runnable.
create unique index if not exists order_items_order_album_key
  on public.order_items (order_id, album_id);

-- The order's own lines (receipt, admin panel, per-item side effects).
create index if not exists order_items_order_idx on public.order_items (order_id);

-- HOT: "is this album committed to a paid order?" — the album-lock authority now reads
-- order_items by album_id (src/lib/orders/album-lock.ts).
create index if not exists order_items_album_idx on public.order_items (album_id);

-- ── 2. RLS ───────────────────────────────────────────────────────────────────
-- Child-of-order ownership, copying the proven `payments` policy shape. A parent's RLS
-- does NOT protect a child table in Postgres, so order_items needs its own policy.
-- Items are money-bearing: customers may READ their own and never write any.
alter table public.order_items enable row level security;

drop policy if exists "users_view_own_order_items"      on public.order_items;
drop policy if exists "admins_read_all_order_items"     on public.order_items;
drop policy if exists "deny_client_insert_order_items"  on public.order_items;
drop policy if exists "deny_client_update_order_items"  on public.order_items;
drop policy if exists "deny_client_delete_order_items"  on public.order_items;

create policy "users_view_own_order_items"
  on public.order_items for select
  using (
    exists (
      select 1 from public.orders o
      where o.id = order_items.order_id and o.user_id = auth.uid()
    )
  );

create policy "admins_read_all_order_items"
  on public.order_items for select
  using (public.is_admin());

-- RESTRICTIVE write-deny (the 0012 shape): independent of the permissive policies above,
-- so no future policy can accidentally open a client write path.
create policy "deny_client_insert_order_items"
  on public.order_items as restrictive for insert to anon, authenticated with check (false);
create policy "deny_client_update_order_items"
  on public.order_items as restrictive for update to anon, authenticated using (false);
create policy "deny_client_delete_order_items"
  on public.order_items as restrictive for delete to anon, authenticated using (false);

-- ── 3. Grants ────────────────────────────────────────────────────────────────
-- GRANTs allow table access; the policies above filter rows. Both are required, and RLS
-- does NOT restrict TRUNCATE — so state the intended privileges explicitly (0055 lesson:
-- a new public table in this project comes out of `create table` with REFERENCES/TRIGGER/
-- TRUNCATE granted to anon, which no other table here carries).
revoke all on table public.order_items from anon;
revoke all on table public.order_items from authenticated;
grant select on table public.order_items to authenticated;
grant all on table public.order_items to service_role;

-- ── 4. Backfill the existing orders ──────────────────────────────────────────
-- Every existing order is single-album, so each becomes exactly one item. Loss-free:
-- copies is CHECK >= 1 (never zero), and product_id/name/dimensions are already
-- snapshotted on the order. `orders` / `albums` / `payments` are NOT touched.
insert into public.order_items
  (order_id, album_id, copies, unit_price, line_subtotal,
   product_id, product_name, product_dimensions, album_title)
select o.id,
       o.album_id,
       o.copies,
       round(o.subtotal_amount / o.copies, 2),
       o.subtotal_amount,
       o.product_id,
       o.product_name,
       o.product_dimensions,
       coalesce(a.title, 'Album')
  from public.orders o
  join public.albums a on a.id = o.album_id
on conflict (order_id, album_id) do nothing;

-- ── 5. create_order_with_items() — the atomic creation primitive ─────────────
-- WHY THIS EXISTS. PostgREST cannot span two statements, so inserting the order and its
-- items as separate calls could leave an order permanently without its items — and an
-- order whose items are missing is an order whose album list is wrong. One function, one
-- transaction, all-or-nothing.
--
-- ONE FUNCTION SERVES BOTH PATHS (single-album = one item, combined = N items). A second
-- near-identical single-album helper would be two places to keep correct.
--
-- SERVICE-ROLE ONLY. `authenticated` is deliberately NOT granted EXECUTE: this function
-- writes money columns, and the project's rule is that `orders` is never written by a
-- client (authenticated has no INSERT grant; a client attempt returns 42501). Only
-- trusted server code — which has already authenticated the caller with getUser() —
-- reaches the service role, so `p_user_id` cannot arrive from a browser. The function
-- still re-verifies that every album and the address belong to `p_user_id`, so even a
-- bug in the caller cannot create an order over someone else's album.
--
-- IT DOES NOT TOUCH PAYMENT STATE: no payments row, no coupon consumption, status is
-- always 'pending'. `process_razorpay_event` remains the only path to 'paid'.
--
-- It deliberately does NOT catch unique violations: `orders_one_pending_per_album`
-- (0011) must still surface 23505 so the caller's existing reuse-the-winner branch works.
create or replace function public.create_order_with_items(
  p_user_id           uuid,
  p_address_id        uuid,
  p_items             jsonb,     -- [{album_id, copies, unit_price, line_subtotal, product_id, product_name, product_dimensions, album_title}]
  p_subtotal          numeric,
  p_shipping          numeric,
  p_discount          numeric,
  p_total             numeric,
  p_shipping_method   text,
  p_coupon_id         uuid,
  p_razorpay_order_id text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order_id   uuid;
  v_item       jsonb;
  v_count      integer;
  v_sum        numeric := 0;
  v_first      jsonb;
  v_album_id   uuid;
  v_copies     integer;
  v_unit       numeric;
  v_line       numeric;
  v_owner      uuid;
  v_status     text;
  v_draft_of   uuid;
  v_paid_family constant text[] := array['paid','processing','printing','packed','shipped','delivered'];
begin
  if p_user_id is null then
    raise exception 'create_order_with_items: user is required';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'create_order_with_items: items must be a json array';
  end if;
  v_count := jsonb_array_length(p_items);
  if v_count < 1 then
    raise exception 'create_order_with_items: at least one item is required';
  end if;
  if v_count > 20 then
    raise exception 'create_order_with_items: too many items (%)', v_count;
  end if;

  -- Address must belong to this customer.
  if not exists (select 1 from public.addresses where id = p_address_id and user_id = p_user_id) then
    raise exception 'create_order_with_items: address does not belong to the customer';
  end if;

  -- Per-line validation: ownership, eligibility, arithmetic.
  for v_item in select value from jsonb_array_elements(p_items) loop
    v_album_id := (v_item->>'album_id')::uuid;
    v_copies   := (v_item->>'copies')::integer;
    v_unit     := (v_item->>'unit_price')::numeric;
    v_line     := (v_item->>'line_subtotal')::numeric;

    select user_id, status, blueprint_draft_of into v_owner, v_status, v_draft_of
      from public.albums where id = v_album_id;
    if v_owner is null then
      raise exception 'create_order_with_items: album % not found', v_album_id;
    end if;
    if v_owner <> p_user_id then
      raise exception 'create_order_with_items: album % does not belong to the customer', v_album_id;
    end if;
    if v_status <> 'submitted' then
      raise exception 'create_order_with_items: album % is not submitted', v_album_id;
    end if;
    if v_draft_of is not null then
      raise exception 'create_order_with_items: album % is a blueprint draft', v_album_id;
    end if;
    -- Already bought → never orderable again (the app checks this too; this is the floor).
    if exists (select 1 from public.order_items oi
                 join public.orders o on o.id = oi.order_id
                where oi.album_id = v_album_id and o.status = any (v_paid_family)) then
      raise exception 'create_order_with_items: album % has already been ordered', v_album_id;
    end if;
    if round(v_unit * v_copies, 2) is distinct from round(v_line, 2) then
      raise exception 'create_order_with_items: line total mismatch for album % (% x % <> %)',
        v_album_id, v_unit, v_copies, v_line;
    end if;
    v_sum := v_sum + round(v_line, 2);
  end loop;

  -- Order-level arithmetic must agree with the lines and with computeCombinedOrderAmount.
  if round(v_sum, 2) is distinct from round(p_subtotal, 2) then
    raise exception 'create_order_with_items: subtotal mismatch (lines % <> order %)', v_sum, p_subtotal;
  end if;
  if p_discount < 0 or round(p_discount, 2) > round(p_subtotal, 2) then
    raise exception 'create_order_with_items: discount out of range (%)', p_discount;
  end if;
  if round(p_total, 2) is distinct from greatest(round(p_subtotal + p_shipping - p_discount, 2), 1) then
    raise exception 'create_order_with_items: total mismatch (% <> % + % - %)',
      p_total, p_subtotal, p_shipping, p_discount;
  end if;

  -- The order row. `album_id` / `copies` / product snapshot mirror the FIRST item
  -- (legacy pointers — order_items is the authority).
  v_first := p_items->0;

  insert into public.orders (
    user_id, album_id, address_id, status, copies,
    subtotal_amount, shipping_amount, shipping_method, discount_amount, total_amount,
    coupon_id, razorpay_order_id, product_id, product_name, product_dimensions
  ) values (
    p_user_id,
    (v_first->>'album_id')::uuid,
    p_address_id,
    'pending',
    (v_first->>'copies')::integer,
    round(p_subtotal, 2), round(p_shipping, 2), p_shipping_method, round(p_discount, 2), round(p_total, 2),
    p_coupon_id, p_razorpay_order_id,
    nullif(v_first->>'product_id', '')::uuid,
    v_first->>'product_name',
    case when v_first ? 'product_dimensions' then v_first->'product_dimensions' else null end
  )
  returning id into v_order_id;

  insert into public.order_items (
    order_id, album_id, copies, unit_price, line_subtotal,
    product_id, product_name, product_dimensions, album_title
  )
  select v_order_id,
         (item->>'album_id')::uuid,
         (item->>'copies')::integer,
         round((item->>'unit_price')::numeric, 2),
         round((item->>'line_subtotal')::numeric, 2),
         nullif(item->>'product_id', '')::uuid,
         item->>'product_name',
         case when item ? 'product_dimensions' then item->'product_dimensions' else null end,
         item->>'album_title'
    from jsonb_array_elements(p_items) as t(item);

  return v_order_id;
end;
$$;

-- Postgres grants EXECUTE to PUBLIC by default — revoke, then grant deliberately.
-- NOT granted to `authenticated`: see the note above.
revoke all on function public.create_order_with_items(uuid, uuid, jsonb, numeric, numeric, numeric, numeric, text, uuid, text) from public;
grant execute on function public.create_order_with_items(uuid, uuid, jsonb, numeric, numeric, numeric, numeric, text, uuid, text) to service_role;

-- ── Verify ───────────────────────────────────────────────────────────────────
-- select count(*) from public.order_items;                       -- expect 4 after backfill
-- select conname, pg_get_constraintdef(oid) from pg_constraint
--   where conrelid = 'public.order_items'::regclass;
-- select policyname, cmd, permissive from pg_policies
--   where schemaname='public' and tablename='order_items';
-- select grantee, privilege_type from information_schema.role_table_grants
--   where table_name='order_items';
