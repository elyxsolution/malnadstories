-- ============================================================
-- Malnad Stories — 0011: one pending order per album (idempotency backstop)
-- Run this in: Supabase Dashboard → SQL Editor → New query
-- ============================================================
--
-- createOrder() guards double-submits with a read-then-insert ("find a pending
-- order, else create one"). That guard is TOCTOU: two concurrent calls (a rapid
-- Pay/Retry double-click, or a network retry that the client re-fires) can BOTH
-- read "no pending order" before either inserts, and then both insert — leaving
-- two live pending orders (each with its own Razorpay order) for the same album.
--
-- This partial unique index is the DB-level backstop: at most ONE 'pending' order
-- per album can exist at any instant. The loser of a concurrent insert gets a
-- 23505 unique_violation, which createOrder catches and turns into a reuse of the
-- winning pending order — so the operation is idempotent under concurrency.
--
-- Only 'pending' rows are constrained. failed / cancelled / paid (and the post-paid
-- states) are EXCLUDED, so a retry AFTER a payment.failed can still create a fresh
-- pending order, and an album's history can hold many terminal orders.

-- ── 1. Collapse any pre-existing duplicate pending orders ────────────────────
-- The unique index can't be created while duplicates exist. Keep the NEWEST
-- pending order per album (the one the user is most likely still paying); demote
-- older pending duplicates to 'cancelled'. No-op on a clean table.

update public.orders o
set status = 'cancelled'
where o.status = 'pending'
  and exists (
    select 1
    from public.orders n
    where n.album_id = o.album_id
      and n.status = 'pending'
      and (n.placed_at > o.placed_at
           or (n.placed_at = o.placed_at and n.id > o.id))
  );

-- ── 2. The constraint ────────────────────────────────────────────────────────
create unique index if not exists orders_one_pending_per_album
  on public.orders (album_id)
  where status = 'pending';
