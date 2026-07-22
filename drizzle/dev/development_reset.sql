-- ============================================================================
-- MALNAD STORIES — DEVELOPMENT ENVIRONMENT RESET
-- ============================================================================
-- Location : drizzle/dev/development_reset.sql
-- Docs     : drizzle/dev/DEVELOPMENT_RESET_README.md
-- Purpose  : Full wipe of transactional + customer data ahead of the Worker V2
--            redesign. Leaves ONLY administrator accounts and application
--            configuration.
--
-- THIS IS NOT A MIGRATION. It is an operational utility. It is deliberately
-- NOT numbered (0052, 0053, ...) and MUST NEVER be applied by a migration
-- runner or during a deployment.
--
-- DESTRUCTIVE AND IRREVERSIBLE. READ THE README BEFORE RUNNING.
-- Production Supabase project id: erpniqgzolikgokklmkc
-- If your SQL Editor is connected to that project, STOP NOW.
--
-- Run as `postgres` (BYPASSRLS). Required: album_pdfs, webhook_events,
-- error_events, health_checks, system_alerts and admin_roles are
-- service-role-only tables with RLS enabled and no policies.
-- ============================================================================


-- ############################################################################
-- PART 1 OF 3 — MAIN RESET (transactional data + non-admin accounts)
-- ############################################################################

BEGIN;

-- ---------------------------------------------------------------------------
-- SECTION 0 — SAFETY GUARD
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  RAISE EXCEPTION
    'SAFETY GUARD ACTIVE. Complete the PRE-RUN CHECKLIST in DEVELOPMENT_RESET_README.md, confirm you are NOT on production, then comment out this DO block and re-run.';
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
  -- Surfaced BEFORE the delete so the decision is yours, not the script's.
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
-- ON DELETE clause (i.e. NO ACTION / RESTRICT). If any preserved row was
-- authored by a non-admin account, the profile delete in Section 10 fails:
--
--   coupons.created_by         (0015:31)
--   cover_templates.created_by (0023:34)
--   stickers.created_by        (0039:37)
--
-- All three columns are nullable and are audit-attribution only -- no
-- application logic reads them. Null them for non-admin authors.
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
-- album_products.demo_album_id -> albums(id) ON DELETE SET NULL.
--
-- A PRESERVED table references a DELETED table. Two consequences:
--   1. This is why the whole script uses DELETE and never TRUNCATE.
--      TRUNCATE does not honour ON DELETE SET NULL: it would either fail, or
--      with CASCADE would truncate album_products itself.
--   2. Nulled explicitly rather than left to the cascade, so intent is
--      visible and Section 11 can assert on it.
--
-- Worker V2 will generate replacement demo albums.
-- ---------------------------------------------------------------------------

UPDATE public.album_products
   SET demo_album_id = NULL
 WHERE demo_album_id IS NOT NULL;


-- ---------------------------------------------------------------------------
-- SECTION 4 — SUPPORT, RESOLUTIONS, REVIEWS
-- ---------------------------------------------------------------------------
-- Deepest children first.
--   revision_requests -> album_reviews
--   refund_requests / reprint_requests -> orders AND support_tickets
--   support_messages -> support_tickets
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
DELETE FROM public.shipment_events;
DELETE FROM public.shipments;


-- ---------------------------------------------------------------------------
-- SECTION 6 — COMMERCE
-- ---------------------------------------------------------------------------
-- Must precede orders:
--   payments.order_id           -> orders (CASCADE, done explicitly)
--   order_notes.order_id        -> orders (CASCADE)
--   coupon_redemptions.order_id -> orders (CASCADE)
--   email_log.order_id          -> orders (SET NULL -- would orphan)
--
-- coupon_redemptions also holds a RESTRICT ref to profiles(user_id), so it
-- must be cleared before Section 10 regardless.
--
-- Coupon DEFINITIONS are preserved (admin catalog data). Deleting redemptions
-- resets every coupon's consumed count to zero.
-- ---------------------------------------------------------------------------

DELETE FROM public.coupon_redemptions;
DELETE FROM public.order_notes;
DELETE FROM public.payments;
DELETE FROM public.email_log;

DELETE FROM public.orders;

-- Razorpay idempotency ledger. Must be cleared or replayed test webhooks are
-- silently swallowed as duplicates by process_razorpay_event().
DELETE FROM public.webhook_events;


-- ---------------------------------------------------------------------------
-- SECTION 7 — ALBUM CONTENT (ALL ALBUMS, NO EXCEPTIONS)
-- ---------------------------------------------------------------------------
-- Customer albums, demo albums, preview albums, admin test albums -- all.
--
-- Child FKs do NOT behave uniformly:
--   album_pages.album_id -> albums  ON DELETE CASCADE
--   album_pdfs.album_id  -> albums  ON DELETE CASCADE
--   photos.album_id      -> albums  ON DELETE SET NULL   <-- NOT a cascade
--
-- photos is therefore deleted explicitly. An orphaned photo row is not merely
-- untidy: the hardening worker builds its ownership prefix as
-- '{user_id}/albums/{album_id}/', so a still-'pending' orphan resolves to
-- '.../albums/null/', fails the prefix check, and is marked 'rejected'.
-- ---------------------------------------------------------------------------

DELETE FROM public.album_pdfs;
DELETE FROM public.album_pages;
DELETE FROM public.photos;
DELETE FROM public.albums;


-- ---------------------------------------------------------------------------
-- SECTION 8 — ADDRESSES
-- ---------------------------------------------------------------------------
-- Must follow orders: orders.address_id -> addresses(id) has NO ON DELETE
-- clause. Running this first raises a foreign-key violation.
--
-- ALL addresses are removed, including any belonging to admin accounts, so
-- the environment starts genuinely clean. Admins re-add at first checkout.
-- ---------------------------------------------------------------------------

DELETE FROM public.addresses;


-- ---------------------------------------------------------------------------
-- SECTION 9 — OBSERVABILITY / OPERATIONAL DATA
-- ---------------------------------------------------------------------------
-- More than tidiness:
--   error_events dedupes on a partial UNIQUE (fingerprint) WHERE NOT resolved.
--   system_alerts dedupes on (dedupe_key) WHERE NOT resolved.
-- A stale unresolved row makes a NEW occurrence increment a counter instead
-- of surfacing as a fresh event.
--
-- audit_log and error_events also hold RESTRICT refs to profiles
-- (actor_id / resolved_by), so clearing them unblocks Section 10.
--
-- audit_log is append-only by design in production. Wiping it here is
-- intended for a dev reset; be aware you are discarding history the schema is
-- otherwise built never to lose.
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
-- Deleting profiles alone would NOT remove the auth user, leaving a login
-- that can never rebuild a profile. auth.users is therefore the entry point.
--
-- Every RESTRICT reference to profiles has been released by Sections 2, 6
-- and 9. Full RESTRICT inventory (no ON DELETE clause):
--   coupons.created_by         PRESERVED  -> nulled     (Section 2)
--   cover_templates.created_by PRESERVED  -> nulled     (Section 2)
--   stickers.created_by        PRESERVED  -> nulled     (Section 2)
--   coupon_redemptions.user_id DELETED                  (Section 6)
--   order_notes.author_id      DELETED                  (Section 6)
--   audit_log.actor_id         DELETED                  (Section 9)
--   error_events.resolved_by   DELETED                  (Section 9)
--
-- A pre-flight assertion re-verifies this rather than trusting the analysis.
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
    + (SELECT count(*) FROM public.order_notes WHERE author_id IS NOT NULL)
    + (SELECT count(*) FROM public.audit_log   WHERE actor_id IS NOT NULL)
    + (SELECT count(*) FROM public.error_events WHERE resolved_by IS NOT NULL)
  INTO v_blockers;

  IF v_blockers > 0 THEN
    RAISE EXCEPTION
      'ABORT: % RESTRICT reference(s) to profiles remain. Sections 2/6/9 did not fully clear. Investigate before proceeding.', v_blockers;
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
--   SINKS. Any running app or worker repopulates them within seconds -- an admin
--   page load, a worker boot, a captured exception. A verification that asserts
--   "count = 0" against those tables therefore fails as soon as the system is
--   alive again, which says nothing about whether the reset worked.
--
--   This marker gives verify_clean_database.sql a precise reference timestamp so
--   it can distinguish the two cases that the raw count conflates:
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
    'purpose',           'Worker V2 redesign - clean development environment',
    'admins_preserved',  (SELECT count(*) FROM _keep_admins),
    'database',          current_database(),
    'executed_by',       current_user
  )
);


-- ---------------------------------------------------------------------------
-- SECTION 11 — IN-TRANSACTION VERIFICATION
-- ---------------------------------------------------------------------------
-- Emitted before COMMIT so you can ROLLBACK if anything looks wrong.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  r          record;
  v_bad      int;
  v_admins   int;
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '=== MUST BE ZERO ===';
  FOR r IN
              SELECT 'albums'             AS t, count(*) AS c FROM public.albums
    UNION ALL SELECT 'album_pages',           count(*) FROM public.album_pages
    UNION ALL SELECT 'photos',                count(*) FROM public.photos
    UNION ALL SELECT 'album_pdfs',            count(*) FROM public.album_pdfs
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
  -- this point -- the Section 10B reset marker.
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
      (SELECT count(*) FROM public.coupons          WHERE created_by IS NOT NULL AND created_by NOT IN (SELECT id FROM public.profiles))
    + (SELECT count(*) FROM public.cover_templates  WHERE created_by IS NOT NULL AND created_by NOT IN (SELECT id FROM public.profiles))
    + (SELECT count(*) FROM public.stickers         WHERE created_by IS NOT NULL AND created_by NOT IN (SELECT id FROM public.profiles))
    + (SELECT count(*) FROM public.layout_templates WHERE created_by IS NOT NULL AND created_by NOT IN (SELECT id FROM public.profiles))
    + (SELECT count(*) FROM public.content_pages    WHERE created_by IS NOT NULL AND created_by NOT IN (SELECT id FROM public.profiles))
    + (SELECT count(*) FROM public.album_products   WHERE created_by IS NOT NULL AND created_by NOT IN (SELECT id FROM public.profiles))
  INTO v_bad;
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'ASSERTION FAILED: % config row(s) reference a deleted account.', v_bad;
  END IF;

  -- Assertion 6: no product is left without a price row (catalog integrity).
  SELECT count(*) INTO v_bad
    FROM public.album_products p
   WHERE p.is_active
     AND NOT EXISTS (SELECT 1 FROM public.album_product_prices pr WHERE pr.product_id = p.id);
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'ASSERTION FAILED: % active product(s) have no price rows.', v_bad;
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
-- Verified against pg-boss 10.4.2 (worker/node_modules/pg-boss). The schema
-- contains exactly six tables:
--
--   CLEARED
--     pgboss.job          PARTITION BY LIST (name). TRUNCATE on the parent
--                         empties all child partitions; partitions themselves
--                         are retained, as is queue.partition_name.
--     pgboss.archive      CREATE TABLE archive (LIKE job) -- not partitioned.
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
-- Clearing job/archive is not optional housekeeping. Stale rows reference
-- photo ids and album print tokens that no longer exist, and would be picked
-- up by Worker V2 on first boot.
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
-- NUCLEAR OPTION -- only if the queue schema itself is corrupt. pg-boss
-- rebuilds the schema on the worker's next boot, and createQueue() in
-- worker/src/index.ts recreates all five queues. Queue configuration set
-- outside those calls is lost.
--   DROP SCHEMA pgboss CASCADE;


-- ############################################################################
-- PART 3 OF 3 — SEQUENCES
-- ############################################################################
-- NOTHING TO DO.
--
-- Verified across all 51 migrations plus the pgboss schema: there is not a
-- single SERIAL, BIGSERIAL, GENERATED ... AS IDENTITY, or CREATE SEQUENCE in
-- this database. Every primary key is:
--
--     uuid PRIMARY KEY DEFAULT gen_random_uuid()
--
-- There is no counter to drift and nothing to reset. Confirm with:
--
--   SELECT sequence_schema, sequence_name
--   FROM information_schema.sequences
--   WHERE sequence_schema NOT IN ('pg_catalog', 'information_schema');
--
-- Expected: zero rows.
-- ############################################################################
