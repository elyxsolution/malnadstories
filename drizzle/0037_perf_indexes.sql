-- ============================================================
-- Malnad Stories — 0037: Performance indexes (Phase 10D)
-- Run this in: Supabase Dashboard → SQL Editor → New query
-- ============================================================
--
-- PURELY ADDITIVE, behavior-preserving. No table/column/constraint/RLS/grant change —
-- only new B-tree indexes on the hottest read predicates that the base tables (0001)
-- never got an index for. Every customer read is RLS-scoped by `user_id = auth.uid()`,
-- and the order-lock helpers + build page hit `orders` by `album_id`, yet those columns
-- had no supporting index → sequential scans that grow with the table.
--
-- `if not exists` makes this idempotent. These are small/medium tables today, so a plain
-- (non-CONCURRENT) build is instant; on a large production table prefer
-- `CREATE INDEX CONCURRENTLY ...` run OUTSIDE a transaction instead.

-- albums: dashboard lists the owner's albums newest-first (user_id = auth.uid() ORDER BY updated_at).
create index if not exists albums_user_updated_idx
  on public.albums (user_id, updated_at desc);

-- orders: dashboard reads the owner's paid orders newest-first (RLS user_id + ORDER BY placed_at).
create index if not exists orders_user_placed_idx
  on public.orders (user_id, placed_at desc);

-- orders: the order-commit locks (hasPaidOrder / hasActiveOrder / getPaidOrder) + the build page,
-- presign, confirm, and delete all probe orders by album_id + status. VERY hot path.
create index if not exists orders_album_status_idx
  on public.orders (album_id, status);

-- addresses: account / checkout / orders / order-email reads filter by user_id.
create index if not exists addresses_user_idx
  on public.addresses (user_id);

-- payments: child of orders, always accessed by order_id (RLS subquery, webhook upsert,
-- and the FK's own cascade) — an unindexed FK is a known scan/cascade cost.
create index if not exists payments_order_idx
  on public.payments (order_id);
