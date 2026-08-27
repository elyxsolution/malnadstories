-- ============================================================================
-- MALNAD STORIES — DEVELOPMENT ENVIRONMENT RESET
-- ============================================================================
-- Location : drizzle/dev/development_reset.sql
-- Verify   : drizzle/dev/verify_clean_database.sql   (run AFTER this)
-- Docs     : drizzle/dev/DEVELOPMENT_RESET_README.md
--
-- Purpose  : Return a DEVELOPMENT database to a clean slate — no customer or
--            transactional data — while preserving administrator accounts and
--            the product/catalog/CMS configuration the application needs to
--            function.
--
-- Schema   : Current as of migration 0058_album_pdf_kind.sql (58 migrations,
--            0001–0058; 38 tables in `public`, all with RLS enabled).
--            Reconciled against src/db/schema.ts and the live catalog.
--
-- THIS IS NOT A MIGRATION. It is an operational utility. It is deliberately
-- NOT numbered (0059, 0060, ...) and MUST NEVER be applied by a migration
-- runner or during a deployment.
--
-- Run as `postgres` (BYPASSRLS). Required: `album_pdfs` and `webhook_events`
-- have RLS enabled with NO policies at all (service-role-only), and a further
-- 12 tables are admin/service-write-only. A non-superuser role cannot clear
-- them. This script changes no grant and no policy.
--
-- ============================================================================
-- ██  DESTRUCTIVE AND IRREVERSIBLE.  DEVELOPMENT DATABASE ONLY.            ██
-- ██  NEVER RUN THIS AGAINST PRODUCTION.                                   ██
-- ============================================================================
--
-- ⚠ READ THIS BEFORE ANYTHING ELSE ⚠
--
-- This repository is currently configured to talk to exactly ONE database, and
-- that database is PRODUCTION:
--
--       Supabase project ref : erpniqgzolikgokklmkc
--       URL                  : https://erpniqgzolikgokklmkc.supabase.co
--       Region               : ap-northeast-1
--
-- `.env.local` (DATABASE_URL / DIRECT_URL) points there, CLAUDE.md records it
-- as the project id, and CLAUDE.md states plainly: "The only database this
-- repository can reach is production."
--
-- Therefore, by default, running this script WILL DESTROY LIVE CUSTOMER DATA:
-- real albums, uploaded photos, paid orders and payment records.
--
-- Before you continue you MUST be able to answer YES to all of these:
--
--   1. I have created a SEPARATE Supabase project (or branch) for development,
--      and my SQL Editor / connection string points at THAT project — not at
--      erpniqgzolikgokklmkc.
--   2. I have confirmed the project ref shown in the SQL Editor URL.
--   3. I accept that everything listed under "DELETED" below is unrecoverable.
--   4. The worker is STOPPED (otherwise it repopulates job + telemetry tables
--      while this runs).
--
-- If ANY answer is no: close this file.
--
-- ============================================================================
-- WORKFLOW  (the whole reset, in order)
-- ============================================================================
--   1. Confirm you are on a DEVELOPMENT database (see the block above).
--   2. Stop the worker.        (Ctrl-C the `pnpm start` / `pnpm dev` process)
--   3. Comment out the SAFETY GUARD in Section 0, then run PART 1.
--      Review the notices, then COMMIT (or ROLLBACK if anything looks wrong).
--   4. Run PART 2 separately (pg-boss queue cleanup).
--   5. Clean Cloudflare R2 by hand — PART 3 lists exactly what to delete.
--      SQL cannot see object storage and this script never pretends otherwise.
--   6. Run drizzle/dev/verify_clean_database.sql and read the verdict.
--   7. Only then start the worker and create your first fresh test user.
--
-- ============================================================================
-- WHAT THIS SCRIPT DOES
-- ============================================================================
-- Every one of the 38 tables in `public` is accounted for: 25 emptied,
-- 12 preserved whole, and `profiles` filtered down to administrators.
--
-- DELETED (25) — transactional / customer / test data
--   albums · album_pages · photos · album_pdfs
--   cart_items · order_items · orders · payments · order_notes · addresses
--   coupon_redemptions · email_log · webhook_events
--   support_tickets · support_messages
--   refund_requests · reprint_requests
--   album_reviews · revision_requests
--   shipments · shipment_events
--   audit_log · error_events · system_alerts · health_checks   (see Section 9)
--   ...plus every non-administrator account (auth.users + profiles).
--
-- PRESERVED (12 + admins) — configuration / catalog / CMS / identity
--   album_products · album_product_prices · album_product_previews
--   products (legacy) · coupons (DEFINITIONS only — redemptions are deleted)
--   cover_templates · cover_design_templates
--   layout_templates (presets AND album blueprints)
--   stickers · sticker_categories · content_pages
--   admin_roles · profiles + auth.users, administrators only
--
-- NOT TOUCHED — Cloudflare R2 object storage. See PART 3.
-- ============================================================================


-- ############################################################################
-- PART 1 OF 3 — MAIN RESET (transactional data + non-admin accounts)
-- ############################################################################

BEGIN;

-- ---------------------------------------------------------------------------
-- SECTION 0 — SAFETY GUARD
-- ---------------------------------------------------------------------------
-- Deliberately unconditional. There is no environment variable, no hostname
-- and no connection property this script can read that reliably distinguishes
-- "development" from "production" inside the Supabase SQL Editor — and a guard
-- that guesses is worse than one that insists on a human.
--
-- Removing this line IS the acknowledgement. Do it consciously, once, after
-- confirming the project ref.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  RAISE EXCEPTION
    'SAFETY GUARD ACTIVE. This deletes ALL customer data. Confirm your SQL Editor is NOT connected to production (project ref erpniqgzolikgokklmkc), stop the worker, then comment out this DO block and re-run.';
END $$;


-- ---------------------------------------------------------------------------
-- SECTION 1 — IDENTIFY ADMINISTRATORS
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE _keep_admins ON COMMIT DROP AS
SELECT id FROM public.profiles WHERE role = 'admin'
UNION
SELECT user_id FROM public.admin_roles;

CREATE UNIQUE INDEX ON _keep_admins (id);

DO $$
DECLARE
  v_admins   int;
  v_profiles int;
  v_drift    int;
  v_names    text;
BEGIN
  SELECT count(*) INTO v_admins   FROM _keep_admins;
  SELECT count(*) INTO v_profiles FROM public.profiles;

  IF v_admins = 0 THEN
    RAISE EXCEPTION
      'ABORT: zero administrators found. Running would delete EVERY account and lock you out. Verify profiles.role and admin_roles before proceeding.';
  END IF;

  RAISE NOTICE 'Administrators preserved : %', v_admins;
  RAISE NOTICE 'Accounts to be deleted   : %', v_profiles - v_admins;

  -- RBAC DRIFT NOTICE ------------------------------------------------------
  -- _keep_admins is deliberately a UNION of profiles.role='admin' AND
  -- admin_roles membership. The union is the safe direction: an admin whose
  -- profiles.role was corrupted must NOT be deleted, because lockout is worse
  -- than one extra surviving account.
  --
  -- The cost of that choice: an account holding a STALE admin_roles row but
  -- profiles.role <> 'admin' also survives. Per 0034 such an account has NO
  -- admin access (getAdminContext gates on profiles.role FIRST, then resolves
  -- the back-office role), so this is an inconsistency, not a privilege leak.
  --
  -- This is NOT hypothetical: the live catalog currently holds exactly such a
  -- row. Surfaced BEFORE the delete so the decision is yours, not the script's.
  SELECT count(*), string_agg(COALESCE(p.name, p.id::text), ', ')
    INTO v_drift, v_names
    FROM public.admin_roles r
    JOIN public.profiles p ON p.id = r.user_id
   WHERE p.role <> 'admin';

  IF v_drift > 0 THEN
    RAISE WARNING 'RBAC DRIFT: % account(s) hold an admin_roles row but profiles.role <> ''admin'': %', v_drift, v_names;
    RAISE WARNING 'These WILL BE PRESERVED by this script. To delete them instead, remove their admin_roles row first, then re-run.';
  END IF;
END $$;


-- ---------------------------------------------------------------------------
-- SECTION 2 — RELEASE RESTRICT REFERENCES HELD BY PRESERVED CONFIG
-- ---------------------------------------------------------------------------
-- Three PRESERVED configuration tables reference profiles(id) with NO
-- ON DELETE clause (NO ACTION, i.e. RESTRICT at delete time). If any preserved
-- row was authored by a non-admin account, the profile delete in Section 10
-- fails:
--
--   coupons.created_by         (0015)
--   cover_templates.created_by (0023)
--   stickers.created_by        (0039)
--
-- All three columns are nullable and are audit-attribution only — no
-- application logic reads them. Null them for non-admin authors.
--
-- NOTE: the other config tables that reference profiles (album_products,
-- cover_design_templates, layout_templates, content_pages — created_by AND
-- updated_by) are all ON DELETE SET NULL and need no help here. Verified
-- against the live constraint catalog, not assumed.
-- ---------------------------------------------------------------------------

UPDATE public.coupons
   SET created_by = NULL
 WHERE created_by IS NOT NULL
   AND created_by NOT IN (SELECT id FROM _keep_admins);

UPDATE public.cover_templates
   SET created_by = NULL
 WHERE created_by IS NOT NULL
   AND created_by NOT IN (SELECT id FROM _keep_admins);

UPDATE public.stickers
   SET created_by = NULL
 WHERE created_by IS NOT NULL
   AND created_by NOT IN (SELECT id FROM _keep_admins);


-- ---------------------------------------------------------------------------
-- SECTION 3 — RELEASE THE DEMO-ALBUM REFERENCE
-- ---------------------------------------------------------------------------
-- album_products.demo_album_id -> albums(id) ON DELETE SET NULL  (0048).
--
-- A PRESERVED table references a DELETED table. Two consequences:
--   1. This is why the whole script uses DELETE and never TRUNCATE.
--      TRUNCATE does not honour ON DELETE SET NULL: it would either fail, or
--      with CASCADE would truncate album_products itself.
--   2. Nulled explicitly rather than left to the cascade, so intent is visible
--      and Section 11 can assert on it.
--
-- WHY DEMO ALBUMS ARE NOT PRESERVED. A demo album is an ordinary row in
-- `albums`, owned by an ordinary account, carrying ordinary photos — it is
-- customer-shaped data that happens to be pointed at by a product. Preserving
-- it would mean preserving its owner, its photos and its R2 objects, which
-- defeats the reset. The link is advisory (nullable, SET NULL) and the catalog
-- functions without it; an admin re-attaches a fresh demo album afterwards via
-- /admin/dimensions -> product -> demo picker.
-- ---------------------------------------------------------------------------

UPDATE public.album_products
   SET demo_album_id = NULL
 WHERE demo_album_id IS NOT NULL;


-- ---------------------------------------------------------------------------
-- SECTION 4 — SUPPORT, RESOLUTIONS, REVIEWS
-- ---------------------------------------------------------------------------
-- Deepest children first.
--   revision_requests -> album_reviews (CASCADE) and albums (CASCADE)
--   refund_requests / reprint_requests -> orders (CASCADE) AND support_tickets
--                                         (SET NULL)
--   support_messages -> support_tickets (CASCADE)
--
-- Deleted explicitly rather than relying on those cascades so the order is
-- readable and Section 11 can assert each table independently.
-- ---------------------------------------------------------------------------

DELETE FROM public.revision_requests;
DELETE FROM public.album_reviews;

DELETE FROM public.refund_requests;
DELETE FROM public.reprint_requests;

DELETE FROM public.support_messages;
DELETE FROM public.support_tickets;


-- ---------------------------------------------------------------------------
-- SECTION 5 — SHIPPING
-- ---------------------------------------------------------------------------
-- shipment_events.shipment_id -> shipments  ON DELETE CASCADE
-- shipments.order_id          -> orders     ON DELETE CASCADE
--
-- Supplemental courier layer (0033) — independent of orders.status.
-- ---------------------------------------------------------------------------

DELETE FROM public.shipment_events;
DELETE FROM public.shipments;


-- ---------------------------------------------------------------------------
-- SECTION 6 — CART AND COMMERCE
-- ---------------------------------------------------------------------------
-- cart_items (0055) is PRE-purchase staging: one row per (user, album) with a
-- quantity. Both its FKs CASCADE, so it would disappear with albums in
-- Section 7 — it is cleared here explicitly because a cart is transactional
-- data in its own right and Section 11 asserts on it.
--
-- order_items (0056) is the AUTHORITATIVE list of albums in an order. Its FKs
-- are asymmetric and the asymmetry dictates the order of the next two
-- sections:
--
--   order_items.order_id  -> orders  ON DELETE CASCADE
--   order_items.album_id  -> albums  ON DELETE NO ACTION   <-- blocks albums!
--
-- Because album_id is NO ACTION, `DELETE FROM albums` (Section 7) FAILS while
-- any order line still exists. Orders must therefore be cleared BEFORE albums.
-- order_items is deleted explicitly first so the intent does not depend on
-- reading the cascade.
--
-- Must also precede orders:
--   payments.order_id           -> orders (CASCADE, done explicitly)
--   order_notes.order_id        -> orders (CASCADE)
--   coupon_redemptions.order_id -> orders (CASCADE)
--   email_log.order_id          -> orders (SET NULL — would orphan the row)
--
-- coupon_redemptions also holds a NO ACTION ref to profiles(user_id), and
-- order_notes one to profiles(author_id), so both must be cleared before
-- Section 10 regardless.
--
-- Coupon DEFINITIONS are preserved (admin catalog data). Deleting redemptions
-- resets every coupon's consumed count to zero.
-- ---------------------------------------------------------------------------

DELETE FROM public.cart_items;

DELETE FROM public.coupon_redemptions;
DELETE FROM public.order_notes;
DELETE FROM public.payments;
DELETE FROM public.email_log;
DELETE FROM public.order_items;

DELETE FROM public.orders;

-- Razorpay idempotency ledger. Must be cleared or replayed test webhooks are
-- silently swallowed as duplicates by process_razorpay_event().
--
-- NOTE (see CLAUDE.md, "webhook_events — a specific, permanent trap"): this
-- table has no provenance column, so a real delivery marker and a test fixture
-- are indistinguishable. That is precisely why this wipe belongs in a
-- DEVELOPMENT reset and nowhere else.
DELETE FROM public.webhook_events;


-- ---------------------------------------------------------------------------
-- SECTION 7 — ALBUM CONTENT (ALL ALBUMS, NO EXCEPTIONS)
-- ---------------------------------------------------------------------------
-- Customer albums, demo albums, blueprint-draft albums (0046), admin test
-- albums — all of them.
--
-- Child FKs do NOT behave uniformly:
--   album_pages.album_id -> albums  ON DELETE CASCADE
--   album_pdfs.album_id  -> albums  ON DELETE CASCADE
--   cart_items.album_id  -> albums  ON DELETE CASCADE   (cleared in Section 6)
--   photos.album_id      -> albums  ON DELETE SET NULL  <-- NOT a cascade
--
-- photos is therefore deleted explicitly. An orphaned photo row is not merely
-- untidy: the image-hardening processor builds its ownership prefix as
-- '{user_id}/albums/{album_id}/', so a still-'pending' orphan resolves to
-- '.../albums/null/', fails the prefix check, and is marked 'rejected'.
--
-- album_pdfs (0008) is keyed (album_id, kind) since 0058 and holds up to THREE
-- rows per album — 'preview', 'print_cover', 'print_content'. All three are
-- transactional render state (status/stage/token/attempts/r2_key) and all are
-- removed here. Leaving any behind would show an admin a "ready" print file
-- whose R2 object has been deleted, or strand a 'generating' row that the
-- worker's recovery sweep would then try to re-drive against a missing album.
--
-- ORDER MATTERS: albums.user_id -> profiles is ON DELETE RESTRICT (0054), so
-- albums MUST be gone before Section 10 can delete their owners.
-- ---------------------------------------------------------------------------

DELETE FROM public.album_pdfs;
DELETE FROM public.album_pages;
DELETE FROM public.photos;
DELETE FROM public.albums;


-- ---------------------------------------------------------------------------
-- SECTION 8 — ADDRESSES
-- ---------------------------------------------------------------------------
-- Must follow orders: orders.address_id -> addresses(id) is ON DELETE
-- NO ACTION. Running this first raises a foreign-key violation.
--
-- ALL addresses are removed, including any belonging to admin accounts, so the
-- environment starts genuinely clean. Admins re-add at first checkout.
-- ---------------------------------------------------------------------------

DELETE FROM public.addresses;


-- ---------------------------------------------------------------------------
-- SECTION 9 — OBSERVABILITY / OPERATIONAL DATA
-- ---------------------------------------------------------------------------
-- More than tidiness:
--   error_events dedupes on a partial UNIQUE (fingerprint) WHERE NOT resolved.
--   system_alerts dedupes on (dedupe_key) WHERE NOT resolved.
-- A stale unresolved row makes a NEW occurrence increment a counter instead of
-- surfacing as a fresh event.
--
-- audit_log.actor_id and error_events.resolved_by are NO ACTION refs to
-- profiles, so clearing them also unblocks Section 10.
--
-- audit_log is append-only by design in production. Wiping it here is intended
-- for a dev reset; be aware you are discarding history the schema is otherwise
-- built never to lose.
--
-- These four tables are SINKS: a running app or worker refills them within
-- seconds. That is why verify_clean_database.sql checks them against the
-- Section 10B marker timestamp rather than asserting "count = 0".
-- ---------------------------------------------------------------------------

DELETE FROM public.error_events;
DELETE FROM public.system_alerts;
DELETE FROM public.health_checks;
DELETE FROM public.audit_log;


-- ---------------------------------------------------------------------------
-- SECTION 10 — DELETE NON-ADMIN ACCOUNTS
-- ---------------------------------------------------------------------------
-- Deleting auth.users cascades to public.profiles (profiles.id -> auth.users
-- ON DELETE CASCADE) and onward through every remaining CASCADE child.
--
-- Deleting profiles alone would NOT remove the auth user, leaving a login that
-- can never rebuild a profile. auth.users is therefore the entry point.
--
-- FULL INVENTORY of blocking references to profiles(id) — every FK whose
-- delete rule is NO ACTION or RESTRICT. Verified against the live catalog:
--
--   coupons.created_by          NO ACTION  PRESERVED -> nulled    (Section 2)
--   cover_templates.created_by  NO ACTION  PRESERVED -> nulled    (Section 2)
--   stickers.created_by         NO ACTION  PRESERVED -> nulled    (Section 2)
--   coupon_redemptions.user_id  NO ACTION  DELETED               (Section 6)
--   order_notes.author_id       NO ACTION  DELETED               (Section 6)
--   audit_log.actor_id          NO ACTION  DELETED               (Section 9)
--   error_events.resolved_by    NO ACTION  DELETED               (Section 9)
--   albums.user_id              RESTRICT   DELETED               (Section 7)
--   photos.user_id              RESTRICT   DELETED               (Section 7)
--
-- The last two were introduced by 0054 (prevent orphaned user assets) — they
-- are why album content MUST be cleared before accounts, and why this script
-- can never be reordered to delete users first.
--
-- A pre-flight assertion re-verifies all of this rather than trusting the
-- analysis above.
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_blockers int := 0;
BEGIN
  SELECT
      (SELECT count(*) FROM public.coupons c
        WHERE c.created_by IS NOT NULL AND c.created_by NOT IN (SELECT id FROM _keep_admins))
    + (SELECT count(*) FROM public.cover_templates t
        WHERE t.created_by IS NOT NULL AND t.created_by NOT IN (SELECT id FROM _keep_admins))
    + (SELECT count(*) FROM public.stickers s
        WHERE s.created_by IS NOT NULL AND s.created_by NOT IN (SELECT id FROM _keep_admins))
    + (SELECT count(*) FROM public.coupon_redemptions)
    + (SELECT count(*) FROM public.order_notes  WHERE author_id  IS NOT NULL)
    + (SELECT count(*) FROM public.audit_log    WHERE actor_id   IS NOT NULL)
    + (SELECT count(*) FROM public.error_events WHERE resolved_by IS NOT NULL)
    -- 0054 RESTRICT refs: any surviving row blocks the account delete outright.
    + (SELECT count(*) FROM public.albums)
    + (SELECT count(*) FROM public.photos)
  INTO v_blockers;

  IF v_blockers > 0 THEN
    RAISE EXCEPTION
      'ABORT: % blocking reference(s) to profiles remain. Sections 2/6/7/9 did not fully clear. Investigate before proceeding.', v_blockers;
  END IF;
END $$;

DELETE FROM auth.users
 WHERE id NOT IN (SELECT id FROM _keep_admins);


-- ---------------------------------------------------------------------------
-- SECTION 10B — RESET MARKER
-- ---------------------------------------------------------------------------
-- Writes a single audit row recording that this reset completed, and WHEN.
--
-- WHY THIS EXISTS
--   audit_log, error_events, system_alerts and health_checks are observability
--   SINKS. Any running app or worker repopulates them within seconds — an admin
--   page load, a worker boot, a captured exception. A verification that asserts
--   "count = 0" against those tables therefore fails as soon as the system is
--   alive again, which says nothing about whether the reset worked.
--
--   This marker gives verify_clean_database.sql a precise reference timestamp
--   so it can distinguish the two cases that a raw count conflates:
--     rows OLDER than the marker -> the reset failed to clear history  (FAIL)
--     rows NEWER than the marker -> the system is running normally     (INFO/WARN)
--
--   That is a STRICTLY STRONGER check than "count = 0", not a relaxation.
--
-- Recording an environment reset is also correct on its own terms: audit_log is
-- the append-only record of consequential actions, and wiping the database is
-- one. actor_id is NULL ('system'), matching the webhook convention in 0016.
-- ---------------------------------------------------------------------------

INSERT INTO public.audit_log (actor_id, actor_type, action, entity_type, entity_id, metadata)
VALUES (
  NULL,
  'system',
  'dev.environment_reset',
  'system',
  '00000000-0000-0000-0000-000000000000'::uuid,
  jsonb_build_object(
    'script',            'drizzle/dev/development_reset.sql',
    'schema_version',    '0058_album_pdf_kind',
    'admins_preserved',  (SELECT count(*) FROM _keep_admins),
    'database',          current_database(),
    'executed_by',       current_user
  )
);


-- ---------------------------------------------------------------------------
-- SECTION 11 — IN-TRANSACTION VERIFICATION
-- ---------------------------------------------------------------------------
-- Emitted before COMMIT so you can ROLLBACK if anything looks wrong.
--
-- This is a fast smoke test, not the full report. Run
-- drizzle/dev/verify_clean_database.sql after COMMIT for the complete verdict.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  r        record;
  v_bad    int;
  v_admins int;
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '=== MUST BE ZERO ===';
  FOR r IN
              SELECT 'albums'             AS t, count(*) AS c FROM public.albums
    UNION ALL SELECT 'album_pages',           count(*) FROM public.album_pages
    UNION ALL SELECT 'photos',                count(*) FROM public.photos
    UNION ALL SELECT 'album_pdfs',            count(*) FROM public.album_pdfs
    UNION ALL SELECT 'cart_items',            count(*) FROM public.cart_items
    UNION ALL SELECT 'order_items',           count(*) FROM public.order_items
    UNION ALL SELECT 'orders',                count(*) FROM public.orders
    UNION ALL SELECT 'payments',              count(*) FROM public.payments
    UNION ALL SELECT 'order_notes',           count(*) FROM public.order_notes
    UNION ALL SELECT 'addresses',             count(*) FROM public.addresses
    UNION ALL SELECT 'coupon_redemptions',    count(*) FROM public.coupon_redemptions
    UNION ALL SELECT 'email_log',             count(*) FROM public.email_log
    UNION ALL SELECT 'webhook_events',        count(*) FROM public.webhook_events
    UNION ALL SELECT 'support_tickets',       count(*) FROM public.support_tickets
    UNION ALL SELECT 'support_messages',      count(*) FROM public.support_messages
    UNION ALL SELECT 'refund_requests',       count(*) FROM public.refund_requests
    UNION ALL SELECT 'reprint_requests',      count(*) FROM public.reprint_requests
    UNION ALL SELECT 'album_reviews',         count(*) FROM public.album_reviews
    UNION ALL SELECT 'revision_requests',     count(*) FROM public.revision_requests
    UNION ALL SELECT 'shipments',             count(*) FROM public.shipments
    UNION ALL SELECT 'shipment_events',       count(*) FROM public.shipment_events
    UNION ALL SELECT 'error_events',          count(*) FROM public.error_events
    UNION ALL SELECT 'system_alerts',         count(*) FROM public.system_alerts
    UNION ALL SELECT 'health_checks',         count(*) FROM public.health_checks
    ORDER BY 1
  LOOP
    RAISE NOTICE '  % %', rpad(r.t, 22), r.c;
  END LOOP;

  -- audit_log is reported separately: it legitimately holds exactly ONE row at
  -- this point — the Section 10B reset marker.
  SELECT count(*) INTO v_bad FROM public.audit_log;
  RAISE NOTICE '  % %  (expect 1 = reset marker)', rpad('audit_log', 22), v_bad;
  IF v_bad <> 1 THEN
    RAISE EXCEPTION 'ASSERTION FAILED: audit_log holds % row(s); expected exactly 1 (the reset marker).', v_bad;
  END IF;

  RAISE NOTICE '';
  RAISE NOTICE '=== MUST BE INTACT ===';
  FOR r IN
              SELECT 'album_products'        AS t, count(*) AS c FROM public.album_products
    UNION ALL SELECT 'album_product_prices',     count(*) FROM public.album_product_prices
    UNION ALL SELECT 'album_product_previews',   count(*) FROM public.album_product_previews
    UNION ALL SELECT 'products (legacy)',        count(*) FROM public.products
    UNION ALL SELECT 'cover_templates',          count(*) FROM public.cover_templates
    UNION ALL SELECT 'cover_design_templates',   count(*) FROM public.cover_design_templates
    UNION ALL SELECT 'layout_templates (all)',   count(*) FROM public.layout_templates
    UNION ALL SELECT 'layout_templates (bp)',    count(*) FROM public.layout_templates WHERE blueprint IS NOT NULL
    UNION ALL SELECT 'stickers',                 count(*) FROM public.stickers
    UNION ALL SELECT 'sticker_categories',       count(*) FROM public.sticker_categories
    UNION ALL SELECT 'content_pages',            count(*) FROM public.content_pages
    UNION ALL SELECT 'coupons',                  count(*) FROM public.coupons
    UNION ALL SELECT 'admin_roles',              count(*) FROM public.admin_roles
    UNION ALL SELECT 'profiles',                 count(*) FROM public.profiles
    UNION ALL SELECT 'auth.users',               count(*) FROM auth.users
    ORDER BY 1
  LOOP
    RAISE NOTICE '  % %', rpad(r.t, 26), r.c;
  END LOOP;

  -- Assertion 1: every surviving profile is an administrator.
  SELECT count(*) INTO v_bad
    FROM public.profiles p
   WHERE p.id NOT IN (SELECT id FROM _keep_admins);
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'ASSERTION FAILED: % non-admin profile(s) survived.', v_bad;
  END IF;

  -- Assertion 2: profiles and auth.users are in exact 1:1 agreement.
  SELECT count(*) INTO v_bad FROM (
    SELECT id FROM public.profiles EXCEPT SELECT id FROM auth.users
    UNION ALL
    SELECT id FROM auth.users EXCEPT SELECT id FROM public.profiles
  ) x;
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'ASSERTION FAILED: % row(s) mismatched between profiles and auth.users.', v_bad;
  END IF;

  -- Assertion 3: at least one administrator remains.
  SELECT count(*) INTO v_admins FROM public.profiles WHERE role = 'admin';
  IF v_admins = 0 THEN
    RAISE EXCEPTION 'ASSERTION FAILED: no administrator profile remains.';
  END IF;

  -- Assertion 4: no product still points at a deleted demo album.
  SELECT count(*) INTO v_bad FROM public.album_products WHERE demo_album_id IS NOT NULL;
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'ASSERTION FAILED: % product(s) retain a demo_album_id.', v_bad;
  END IF;

  -- Assertion 5: no preserved config row references a deleted account.
  SELECT
      (SELECT count(*) FROM public.coupons                WHERE created_by IS NOT NULL AND created_by NOT IN (SELECT id FROM public.profiles))
    + (SELECT count(*) FROM public.cover_templates        WHERE created_by IS NOT NULL AND created_by NOT IN (SELECT id FROM public.profiles))
    + (SELECT count(*) FROM public.stickers               WHERE created_by IS NOT NULL AND created_by NOT IN (SELECT id FROM public.profiles))
    + (SELECT count(*) FROM public.layout_templates       WHERE created_by IS NOT NULL AND created_by NOT IN (SELECT id FROM public.profiles))
    + (SELECT count(*) FROM public.content_pages          WHERE created_by IS NOT NULL AND created_by NOT IN (SELECT id FROM public.profiles))
    + (SELECT count(*) FROM public.album_products         WHERE created_by IS NOT NULL AND created_by NOT IN (SELECT id FROM public.profiles))
    + (SELECT count(*) FROM public.cover_design_templates WHERE created_by IS NOT NULL AND created_by NOT IN (SELECT id FROM public.profiles))
  INTO v_bad;
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'ASSERTION FAILED: % config row(s) reference a deleted account.', v_bad;
  END IF;

  -- Assertion 6: no ACTIVE product is left without a price row. Album creation
  -- reads album_product_prices to offer page counts; a product with none cannot
  -- be ordered, so a reset that lost them has broken the catalog.
  SELECT count(*) INTO v_bad
    FROM public.album_products p
   WHERE p.is_active
     AND NOT EXISTS (SELECT 1 FROM public.album_product_prices pr WHERE pr.product_id = p.id);
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'ASSERTION FAILED: % active product(s) have no price rows.', v_bad;
  END IF;

  -- Assertion 7: at least one ACTIVE product survives, or no album can be
  -- created at all (insertAlbumForUser refuses without one).
  SELECT count(*) INTO v_bad FROM public.album_products WHERE is_active;
  IF v_bad = 0 THEN
    RAISE EXCEPTION 'ASSERTION FAILED: no active album product remains; album creation is impossible.';
  END IF;

  RAISE NOTICE '';
  RAISE NOTICE 'All assertions passed. Review the counts above, then COMMIT.';
END $$;

-- Final catalog inspection (returned as a result set, not a notice).
SELECT
  p.name,
  p.slug,
  p.width_cm, p.height_cm,
  p.print_width_cm, p.print_height_cm,
  p.builder_aspect_ratio,
  p.is_default, p.is_active,
  p.demo_album_id,
  (SELECT count(*) FROM public.album_product_prices   pr WHERE pr.product_id = p.id) AS price_rows,
  (SELECT count(*) FROM public.album_product_previews pv WHERE pv.product_id = p.id) AS preview_rows
FROM public.album_products p
ORDER BY p.display_order;

COMMIT;
-- ROLLBACK;   <-- use instead of COMMIT if the output above looks wrong


-- ############################################################################
-- PART 2 OF 3 — PGBOSS QUEUE CLEANUP
-- ############################################################################
-- RUN SEPARATELY, AFTER PART 1 COMMITS. STOP THE WORKER FIRST.
--
-- Verified against pg-boss 10.4.2 (schema version 24). The `pgboss` schema
-- contains six objects:
--
--   CLEARED
--     pgboss.job          PARTITIONED BY LIST (name) — one child partition per
--                         queue, named j<sha>. TRUNCATE on the parent empties
--                         every child; the partitions themselves are retained,
--                         as is queue.partition_name that points at them.
--     pgboss.archive      CREATE TABLE archive (LIKE job) — not partitioned.
--
--   PRESERVED
--     pgboss.queue        Per-queue policy / retry_limit / retry_delay /
--                         retry_backoff / expire_seconds / retention_minutes /
--                         dead_letter / partition_name. Destroying this loses
--                         queue configuration.
--     pgboss.version      Schema version. Destroying it breaks pg-boss's own
--                         migration detection on next boot.
--     pgboss.schedule     Cron schedules (none defined by this project).
--     pgboss.subscription Pub/sub routing (unused by this project).
--
-- QUEUES. The APP creates five queues on first enqueue (src/lib/queue.ts):
--
--     image-hardening · album-pdf · r2-cleanup
--     cover-thumbnail · blueprint-thumbnail
--
-- and the WORKER subscribes to the same five (WORKER_QUEUES in
-- worker/apps/worker/src/infra/config.ts). pg-boss additionally maintains its
-- own internal `__pgboss__send-it` queue — that is normal and not ours.
--
-- Only THREE of the five have a processor: image-hardening, album-pdf and
-- r2-cleanup (registered in worker/apps/worker/src/main.ts). cover-thumbnail
-- and blueprint-thumbnail are declared but unimplemented, so their jobs
-- accumulate — the worker's own startup report flags this as a known
-- `queue-coverage` warning. Clearing the queue here also clears that backlog.
--
-- Clearing job/archive is not optional housekeeping. Stale rows reference photo
-- ids and album print tokens that no longer exist; on its next boot the worker
-- would pick them up, fail to resolve the album, and write failure rows into
-- the freshly-cleaned album_pdfs table.
-- ############################################################################

TRUNCATE TABLE pgboss.job;
TRUNCATE TABLE pgboss.archive;

-- Confirm queue configuration survived.
SELECT name, policy, retry_limit, retry_delay, retry_backoff,
       expire_seconds, retention_minutes, dead_letter, partition_name
FROM pgboss.queue
ORDER BY name;

-- Confirm both tables are empty.
SELECT 'job' AS tbl, count(*) FROM pgboss.job
UNION ALL
SELECT 'archive', count(*) FROM pgboss.archive;

-- If TRUNCATE is refused for ownership reasons, use instead:
--   DELETE FROM pgboss.job;
--   DELETE FROM pgboss.archive;
--
-- NUCLEAR OPTION — only if the queue schema itself is corrupt. pg-boss rebuilds
-- the schema on the worker's next boot, and the app's createQueue() calls in
-- src/lib/queue.ts recreate all five project queues on first enqueue. Any queue
-- configuration set outside those calls is lost.
--   DROP SCHEMA pgboss CASCADE;


-- ############################################################################
-- PART 3 OF 3 — CLOUDFLARE R2  (MANUAL — SQL CANNOT DO THIS)
-- ############################################################################
-- NOTHING IN THIS FILE TOUCHES OBJECT STORAGE.
--
-- Part 1 deleted the DATABASE ROWS that name R2 objects. The objects themselves
-- are still in the bucket, and now nothing in the database points at them: they
-- are unreachable by the app AND unreclaimable by the orphan tooling, because
-- that tooling proves ownership by asking the `photos` table — which is now
-- empty. Deleting the rows first is what makes this step mandatory rather than
-- optional tidying.
--
-- DELETE these prefixes from the private R2 bucket (Cloudflare dashboard ->
-- R2 -> your bucket, or `rclone`/`aws s3 rm --recursive`):
--
--   {userId}/                     EVERYTHING under every user id. One folder
--                                 per account; each contains, per album:
--
--     {userId}/albums/{albumId}/{uuid}.{jpg|png|heic|webp}   raw upload
--                                   src/app/api/photos/presign/route.ts
--     {userId}/albums/{albumId}/{uuid}_full.jpg              sanitized master
--     {userId}/albums/{albumId}/{uuid}_thumb.jpg             thumbnail
--                                   worker .../processors/image/keys.ts
--     {userId}/albums/{albumId}/preview.pdf                  customer preview
--     {userId}/albums/{albumId}/print-cover.pdf              printer-ready cover
--     {userId}/albums/{albumId}/print-content.pdf            printer-ready pages
--                                   worker .../processors/pdf/pdf-contract.ts
--                                   (one basename per PdfKind — 0058)
--
--   Keep the folders of any ADMIN account you preserved ONLY if you also want
--   their albums back — you do not; Part 1 deleted those albums. Delete all
--   user folders.
--
-- KEEP these prefixes — they are admin/catalog artwork referenced by the
-- configuration Part 1 deliberately preserved. Deleting them breaks the cover
-- picker, the product catalog and the sticker library:
--
--   cover-templates/{uuid}.{ext}   src/lib/actions/admin/covers.ts
--   album-products/{uuid}.{ext}    src/lib/actions/admin/product-uploads.ts
--   stickers/{uuid}.{ext}          src/lib/actions/admin/stickers.ts
--
-- VERIFY BY HAND. verify_clean_database.sql reports R2 as INFO / "manual" and
-- will never claim the bucket is clean — SQL has no visibility into it. A PASS
-- verdict from that script means the DATABASE is clean, nothing more.


-- ############################################################################
-- APPENDIX — SEQUENCES
-- ############################################################################
-- NOTHING TO DO.
--
-- Verified against the live catalog: this project owns ZERO sequences. Every
-- primary key is
--
--     uuid PRIMARY KEY DEFAULT gen_random_uuid()
--
-- so there is no counter to drift and nothing to reset. Confirm with:
--
--   SELECT sequence_schema, sequence_name
--   FROM information_schema.sequences
--   WHERE sequence_schema IN ('public', 'pgboss');
--
-- Expected: zero rows.
--
-- NOTE: do NOT run that query without the schema filter. Supabase's own
-- `auth.refresh_tokens_id_seq` will appear and is provider-managed — it is not
-- ours, must not be reset, and its presence is not a problem.
-- ############################################################################
