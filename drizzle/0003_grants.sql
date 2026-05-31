-- ============================================================
-- Malnad Stories — Migration 0003: table-level GRANTs
-- Run this in: Supabase Dashboard → SQL Editor → New query
-- ============================================================
--
-- Principle
-- ─────────
-- GRANT  = table access  (which roles may touch the table at all)
-- RLS    = row filter    (which rows within the table each role may see/write)
-- Both are required. GRANTs are deliberately broad at the table level;
-- RLS policies do all the row-scoping.
--
-- Roles in play
-- ─────────────
-- anon           → unauthenticated requests via the anon key
-- authenticated  → any request carrying a valid user JWT
-- service_role   → server-side service-role key; bypasses RLS by default;
--                  retains ALL privileges — no action needed here.
--
-- ── Products ────────────────────────────────────────────────────────────────
-- Active product pricing is shown on the landing page to logged-out visitors,
-- so anon needs SELECT too. RLS policy "public_read_active_products" still
-- restricts both roles to rows where is_active = true.

grant select on table public.products to anon;
grant select on table public.products to authenticated;

-- ── User-owned tables ────────────────────────────────────────────────────────
-- Full CRUD for authenticated. RLS policies restrict every operation to the
-- user's own rows (user_id = auth.uid()), so broad GRANTs are safe here.

grant select, insert, update, delete on table public.profiles    to authenticated;
grant select, insert, update, delete on table public.addresses   to authenticated;
grant select, insert, update, delete on table public.albums      to authenticated;
grant select, insert, update, delete on table public.album_pages to authenticated;
grant select, insert, update, delete on table public.photos      to authenticated;

-- ── Orders and payments ──────────────────────────────────────────────────────
-- Authenticated users may READ their own rows (RLS scopes to user_id = auth.uid()).
--
-- Writes are intentionally withheld from authenticated:
--   orders INSERT/UPDATE  — order creation runs via the service-role Supabase
--                           client in a server action so total_amount is always
--                           computed server-side and never accepted from user input.
--   payments ALL writes   — driven by the Razorpay webhook route handler
--                           (service-role client) which validates the signature
--                           before touching the DB.
--   Admin operations      — Drizzle db client or service-role Supabase client.
--
-- If an authenticated client accidentally tries to write orders/payments it will
-- get 42501 — which is the correct security behaviour.

grant select on table public.orders   to authenticated;
grant select on table public.payments to authenticated;

-- ── Confirm anon has NO access to user tables ────────────────────────────────
-- Explicit safety belt: revoke any accidental anon grants on sensitive tables.
-- (Supabase doesn't grant these by default, but this makes the intention clear.)

revoke all on table public.profiles    from anon;
revoke all on table public.addresses   from anon;
revoke all on table public.albums      from anon;
revoke all on table public.album_pages from anon;
revoke all on table public.photos      from anon;
revoke all on table public.orders      from anon;
revoke all on table public.payments    from anon;
