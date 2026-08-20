-- 0057_revoke_truncate_privilege.sql
--
-- PRIVILEGE HYGIENE — remove TRUNCATE from the two client-reachable roles.
--
-- WHY THIS EXISTS
-- ---------------
-- RLS IS A ROW FILTER, NOT A TABLE-LEVEL PERMISSION. Every policy in this schema constrains
-- which ROWS a statement may see or change; none of them can constrain TRUNCATE, because
-- TRUNCATE is not a row operation. Postgres gates it on the table-level GRANT alone. So for
-- any table where `anon` or `authenticated` holds TRUNCATE, the GRANT is the ONLY thing
-- standing between that role and an emptied table — every policy can read perfectly and the
-- table can still be erased in one statement.
--
-- This was proven against this database before writing this migration, on a throwaway table
-- inside a rolled-back transaction: with RLS enabled and NO policy granting access, `anon`
-- saw 0 rows via SELECT and deleted 0 rows via DELETE (RLS working exactly as intended), and
-- then TRUNCATE succeeded and emptied the table.
--
-- HOW THE PRIVILEGE GOT THERE (root cause, not guesswork)
-- -------------------------------------------------------
-- `pg_default_acl` carries an ALTER DEFAULT PRIVILEGES entry owned by `postgres` for schema
-- public granting `Dxtm` (TRUNCATE, REFERENCES, TRIGGER, MAINTAIN) to both `anon` and
-- `authenticated`. Migrations run as `postgres`, so EVERY table created by a migration has
-- silently inherited TRUNCATE from the moment it was created. That is why 0055 found anon
-- privileges it never granted, and why fixing only the existing tables would let the problem
-- return with the next `create table`. This migration therefore does both:
--   (1) revokes the privilege from every table that exists today, and
--   (2) changes the default so newly created tables never receive it again.
--
-- SCOPE — DELIBERATELY NARROW
-- ---------------------------
--   * TRUNCATE only. SELECT / INSERT / UPDATE / DELETE are untouched, so every existing
--     customer and admin code path behaves identically.
--   * `anon` and `authenticated` only. `service_role`, `postgres` and the migration owner keep
--     every privilege they have — the worker, the service-role client and admin tooling are
--     unaffected.
--   * No RLS policy is created, dropped or altered. No table structure changes. No function
--     permission changes. No row is read or written.
--
-- Nothing in the application or the worker issues SQL TRUNCATE (verified by search across
-- `src/` and `worker/` — the only matches are the Tailwind `truncate` class), so no code path
-- loses a capability it was using.
--
-- IDEMPOTENT: REVOKE of a privilege a role does not hold is a no-op, and the statements below
-- name the intended FINAL privilege state rather than assuming a starting point, per the
-- project's migration conventions. Safe to re-run.
--
-- The three tables that already lack it (album_pdfs, order_items, webhook_events) are listed
-- anyway so this file is a complete, auditable statement of intent for the whole schema.

-- ── 1. Existing tables ──────────────────────────────────────────────────────────────────────
revoke truncate on table
  public.addresses,
  public.admin_roles,
  public.album_pages,
  public.album_pdfs,
  public.album_product_previews,
  public.album_product_prices,
  public.album_products,
  public.album_reviews,
  public.albums,
  public.audit_log,
  public.cart_items,
  public.content_pages,
  public.coupon_redemptions,
  public.coupons,
  public.cover_design_templates,
  public.cover_templates,
  public.email_log,
  public.error_events,
  public.health_checks,
  public.layout_templates,
  public.order_items,
  public.order_notes,
  public.orders,
  public.payments,
  public.photos,
  public.products,
  public.profiles,
  public.refund_requests,
  public.reprint_requests,
  public.revision_requests,
  public.shipment_events,
  public.shipments,
  public.sticker_categories,
  public.stickers,
  public.support_messages,
  public.support_tickets,
  public.system_alerts,
  public.webhook_events
from anon, authenticated;

-- ── 2. Future tables ────────────────────────────────────────────────────────────────────────
-- Without this, the next `create table` in a migration re-inherits TRUNCATE and the fix decays.
-- Scoped to the `postgres` role's defaults because that is the role migrations run as; the
-- separate `supabase_admin` default ACL is platform-owned and intentionally left alone.
alter default privileges for role postgres in schema public
  revoke truncate on tables from anon, authenticated;

-- ── 3. Verification (run after executing; both must return zero rows) ───────────────────────
-- select table_name, grantee from information_schema.role_table_grants
--  where table_schema = 'public' and privilege_type = 'TRUNCATE'
--    and grantee in ('anon', 'authenticated');
--
-- select defaclacl::text from pg_default_acl d
--   join pg_namespace n on n.oid = d.defaclnamespace
--  where n.nspname = 'public' and d.defaclobjtype = 'r'
--    and pg_get_userbyid(d.defaclrole) = 'postgres'
--    and defaclacl::text like '%anon=%D%';
