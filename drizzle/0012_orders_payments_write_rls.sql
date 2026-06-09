-- ============================================================
-- Malnad Stories — 0012: independent write-side RLS for orders + payments
-- Run this in: Supabase Dashboard → SQL Editor → New query
-- ============================================================
--
-- AUDIT FINDING (MEDIUM): orders' policy was `for all using (user_id = auth.uid())`
-- with no WITH CHECK, so the ONLY thing stopping an authenticated user from doing
-- `update orders set status='paid'` on their own row was the table GRANT (SELECT-only
-- in 0003). That makes the GRANT a single point of failure: a future migration that
-- grants INSERT/UPDATE to `authenticated` would instantly allow self-fulfilment.
--
-- This migration makes RLS an INDEPENDENT second layer that denies client writes even
-- if a write GRANT is ever (re)introduced:
--   1. User policy becomes SELECT-only (no permissive write policy = default deny).
--   2. Explicit RESTRICTIVE deny policies for INSERT/UPDATE/DELETE by anon +
--      authenticated. RESTRICTIVE policies are ANDed with every permissive policy, so
--      no future permissive write policy can re-enable client writes either.
--
-- The `service_role` (used for order creation + the webhook processor) has BYPASSRLS,
-- so none of these policies affect server-side fulfilment writes. Business logic is
-- unchanged — this only hardens the boundary.
--
-- SYNTAX NOTE: PostgreSQL requires the clause order
--   CREATE POLICY name ON table AS RESTRICTIVE FOR command TO roles ...
-- i.e. `ON <table>` comes directly after the name, BEFORE `AS RESTRICTIVE`.

-- ── orders ───────────────────────────────────────────────────────────────────
drop policy if exists "users_own_orders" on public.orders;

drop policy if exists "users_select_own_orders" on public.orders;
create policy "users_select_own_orders"
  on public.orders
  for select
  using (user_id = auth.uid());

drop policy if exists "deny_client_insert_orders" on public.orders;
create policy "deny_client_insert_orders"
  on public.orders
  as restrictive
  for insert
  to authenticated, anon
  with check (false);

drop policy if exists "deny_client_update_orders" on public.orders;
create policy "deny_client_update_orders"
  on public.orders
  as restrictive
  for update
  to authenticated, anon
  using (false);

drop policy if exists "deny_client_delete_orders" on public.orders;
create policy "deny_client_delete_orders"
  on public.orders
  as restrictive
  for delete
  to authenticated, anon
  using (false);

-- ── payments (already SELECT-only for users; add the same explicit write deny) ──
drop policy if exists "deny_client_insert_payments" on public.payments;
create policy "deny_client_insert_payments"
  on public.payments
  as restrictive
  for insert
  to authenticated, anon
  with check (false);

drop policy if exists "deny_client_update_payments" on public.payments;
create policy "deny_client_update_payments"
  on public.payments
  as restrictive
  for update
  to authenticated, anon
  using (false);

drop policy if exists "deny_client_delete_payments" on public.payments;
create policy "deny_client_delete_payments"
  on public.payments
  as restrictive
  for delete
  to authenticated, anon
  using (false);
