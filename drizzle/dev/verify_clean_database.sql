-- ============================================================================
-- MALNAD STORIES — CLEAN DATABASE VERIFICATION
-- ============================================================================
-- Location : drizzle/dev/verify_clean_database.sql
-- Docs     : drizzle/dev/DEVELOPMENT_RESET_README.md
-- Purpose  : Confirm development_reset.sql succeeded and the environment is
--            ready for fresh development/testing.
--
-- Schema   : Current as of migration 0058_album_pdf_kind.sql (58 migrations,
--            0001-0058; 38 tables in `public`, all with RLS enabled).
--            Reconciled against src/db/schema.ts and the live catalog.
--
-- 100% READ-ONLY. Runs no DELETE, UPDATE, INSERT or DDL against any
-- application table. Safe to run at any time, in any environment, including
-- production (it will simply report FAIL on the transactional checks there,
-- which is the correct answer for a live database).
--
-- WHEN TO RUN
--   Immediately after development_reset.sql PART 1 and PART 2, and after the
--   manual R2 cleanup (PART 3 of that script) — BEFORE creating your first
--   test user or test album.
--   Once you create test data the TRANSACTIONAL checks will legitimately turn
--   FAIL. That is expected and does not indicate a problem.
--
-- HOW TO RUN
--   Supabase Dashboard -> SQL Editor -> New query -> paste -> Run.
--   Select all three statements and run together; the final grid is the report.
--
-- OUTPUT
--   A single result grid. Row 1 is the overall verdict. Read the `status`
--   column: PASS / FAIL / WARN / INFO.
--
-- NOTE ON SCOPE
--   This script cannot inspect Cloudflare R2. Object storage verification is
--   manual — see the "Verify R2 cleaned" step in the README.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- STATEMENT 1 — result buffer (temp table; dropped with the session)
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS _verify_results;

CREATE TEMP TABLE _verify_results (
  seq        int,
  category   text,
  check_name text,
  expected   text,
  actual     text,
  status     text
);


-- ---------------------------------------------------------------------------
-- STATEMENT 2 — run every check
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_seq    int := 100;
  v_n      bigint;
  v_m      bigint;
  v_txt    text;
  v_marker timestamptz;
  t        text;

  -- STATE tables: hold customer/business records. A reset empties these and
  -- nothing legitimately recreates them until you seed test data, so "= 0" is
  -- a valid assertion.
  --
  -- The four OBSERVABILITY sinks (audit_log, error_events, system_alerts,
  -- health_checks) are deliberately NOT in this list. They are append-only
  -- telemetry that any running app or worker repopulates within seconds, so
  -- "= 0" tests whether the system is switched off, not whether the reset
  -- worked. They are checked against the reset marker in category G instead.
  --
  -- cart_items (0055) and order_items (0056) were added after the first
  -- version of this script and are BOTH transactional: a cart is pre-purchase
  -- staging, and order_items is the authoritative list of albums in an order.
  -- album_pdfs is keyed (album_id, kind) since 0058 and holds up to three rows
  -- per album — preview, print_cover, print_content — all of them render state.
  c_transactional text[] := ARRAY[
    'albums', 'album_pages', 'photos', 'album_pdfs',
    'cart_items', 'order_items',
    'orders', 'payments', 'order_notes', 'addresses',
    'coupon_redemptions', 'email_log', 'webhook_events',
    'support_tickets', 'support_messages',
    'refund_requests', 'reprint_requests',
    'album_reviews', 'revision_requests',
    'shipments', 'shipment_events'
  ];

  -- Configuration the RESET actively preserves and WITHOUT WHICH THE APP
  -- CANNOT FUNCTION AT ALL. Empty here means the reset destroyed something.
  --
  -- Deliberately only two. insertAlbumForUser refuses to create an album
  -- without an ACTIVE album_products row, and it reads album_product_prices to
  -- offer page counts — so those two are load-bearing. Everything else
  -- degrades gracefully:
  --   cover_templates    legacy uploaded-PNG artwork; resolveCoverImageKeys
  --                      falls back photo -> template -> design/default, and
  --                      the live catalog currently has ZERO rows while albums
  --                      create and print normally. Optional.
  --   layout_templates   auto-layout is byte-for-byte identical when none
  --                      exist (see CLAUDE.md, Phase 9E). Optional.
  --   stickers           purely decorative. Optional.
  -- Listing any of those as REQUIRED made an unseeded-but-healthy environment
  -- report a false reset failure.
  c_config_required text[] := ARRAY[
    'album_products', 'album_product_prices'
  ];

  -- Configuration that survives the reset but may legitimately be empty in a
  -- given environment. content_pages sits here because the reset NEVER touches
  -- it: an empty CMS reflects what was seeded, not whether the reset worked.
  -- Asserting >= 1 would test content authoring, which is out of scope.
  c_config_optional text[] := ARRAY[
    'content_pages',
    'album_product_previews', 'products',
    'cover_templates', 'cover_design_templates',
    'layout_templates', 'stickers', 'sticker_categories',
    'coupons', 'admin_roles'
  ];

  -- The five PROJECT queues. Created by the app on first enqueue
  -- (src/lib/queue.ts) and subscribed to by the worker (WORKER_QUEUES in
  -- worker/apps/worker/src/infra/config.ts). pg-boss also maintains its own
  -- internal '__pgboss__send-it' queue, which is reported separately as INFO.
  --
  -- Only three have a processor registered in
  -- worker/apps/worker/src/main.ts — image-hardening, album-pdf, r2-cleanup.
  -- cover-thumbnail and blueprint-thumbnail are declared but unimplemented;
  -- the worker's own startup report flags that as a queue-coverage warning.
  c_queues text[] := ARRAY[
    'image-hardening', 'album-pdf', 'r2-cleanup',
    'cover-thumbnail', 'blueprint-thumbnail'
  ];
BEGIN

  -- Locate the reset marker written by development_reset.sql Section 10B.
  -- Everything in category G is measured relative to this timestamp.
  SELECT max(created_at) INTO v_marker
    FROM public.audit_log WHERE action = 'dev.environment_reset';


  -- =========================================================================
  -- A. TRANSACTIONAL STATE — every one must be empty
  -- =========================================================================
  FOREACH t IN ARRAY c_transactional LOOP
    EXECUTE format('SELECT count(*) FROM public.%I', t) INTO v_n;
    INSERT INTO _verify_results VALUES (
      v_seq, 'A. TRANSACTIONAL', t, '0', v_n::text,
      CASE WHEN v_n = 0 THEN 'PASS' ELSE 'FAIL' END
    );
    v_seq := v_seq + 1;
  END LOOP;


  -- =========================================================================
  -- G. OBSERVABILITY SINKS — measured against the reset marker
  -- =========================================================================
  -- These four tables are append-only telemetry. A raw "= 0" assertion fails
  -- the moment the app or worker runs again, which is why they are separated
  -- from category A.
  --
  -- The marker splits them into the two cases a raw count conflates:
  --   rows BEFORE the marker -> the reset did not clear history  (FAIL)
  --   rows AFTER  the marker -> normal runtime activity          (INFO/WARN)
  --
  -- Note: record_error_event() writes an 'error.created' audit row for every
  -- NEW error_event (0036:129), so post-reset audit_log and error_events counts
  -- normally move together. That correlation is expected, not a symptom.
  -- =========================================================================
  v_seq := 150;

  IF v_marker IS NULL THEN
    INSERT INTO _verify_results VALUES (
      v_seq, 'G. OBSERVABILITY', 'reset marker', 'present', 'NOT FOUND', 'WARN'
    );
    v_seq := v_seq + 1;
    INSERT INTO _verify_results VALUES (
      v_seq, 'G. OBSERVABILITY', 'marker interpretation', '-',
      'No dev.environment_reset audit row. Either the reset predates Section 10B, or it was not run. Falling back to raw counts below.', 'INFO'
    );
    v_seq := v_seq + 1;

    -- Fallback: raw counts, reported without a verdict we cannot justify.
    FOREACH t IN ARRAY ARRAY['audit_log','error_events','system_alerts','health_checks'] LOOP
      EXECUTE format('SELECT count(*) FROM public.%I', t) INTO v_n;
      INSERT INTO _verify_results VALUES (
        v_seq, 'G. OBSERVABILITY', t || ' (unanchored)', 'cannot verify', v_n::text, 'WARN'
      );
      v_seq := v_seq + 1;
    END LOOP;
  ELSE
    INSERT INTO _verify_results VALUES (
      v_seq, 'G. OBSERVABILITY', 'reset marker', 'present',
      to_char(v_marker, 'YYYY-MM-DD HH24:MI:SS TZ'), 'PASS'
    );
    v_seq := v_seq + 1;

    -- G1: pre-reset audit residue. THIS is the real assertion -- did the reset
    -- actually clear history? Excludes the marker itself.
    SELECT count(*) INTO v_n
      FROM public.audit_log
     WHERE created_at < v_marker AND action <> 'dev.environment_reset';
    INSERT INTO _verify_results VALUES (
      v_seq, 'G. OBSERVABILITY', 'audit_log rows PRE-reset', '0', v_n::text,
      CASE WHEN v_n = 0 THEN 'PASS' ELSE 'FAIL' END
    );
    v_seq := v_seq + 1;

    -- G2: post-reset audit activity. Expected and healthy; reported for context.
    SELECT count(*) INTO v_n
      FROM public.audit_log
     WHERE created_at > v_marker;
    INSERT INTO _verify_results VALUES (
      v_seq, 'G. OBSERVABILITY', 'audit_log rows POST-reset', 'any', v_n::text, 'INFO'
    );
    v_seq := v_seq + 1;

    -- G3: pre-reset error residue.
    SELECT count(*) INTO v_n
      FROM public.error_events WHERE first_seen_at < v_marker;
    INSERT INTO _verify_results VALUES (
      v_seq, 'G. OBSERVABILITY', 'error_events PRE-reset', '0', v_n::text,
      CASE WHEN v_n = 0 THEN 'PASS' ELSE 'FAIL' END
    );
    v_seq := v_seq + 1;

    -- G4: post-reset errors. NOT a reset failure, but you are about to start
    -- the app or worker on this environment and something is already throwing. WARN is
    -- the correct level: non-blocking, but you should know what it is.
    SELECT count(*) INTO v_n
      FROM public.error_events WHERE first_seen_at >= v_marker;
    INSERT INTO _verify_results VALUES (
      v_seq, 'G. OBSERVABILITY', 'error_events POST-reset', '0 (ideally)', v_n::text,
      CASE WHEN v_n = 0 THEN 'PASS' ELSE 'WARN' END
    );
    v_seq := v_seq + 1;

    -- G5: name them, so a WARN above is immediately actionable rather than a
    -- number you have to go hunting for.
    IF v_n > 0 THEN
      SELECT string_agg(DISTINCT source || '/' || category || ':' || severity, ', ')
        INTO v_txt
        FROM public.error_events WHERE first_seen_at >= v_marker;
      INSERT INTO _verify_results VALUES (
        v_seq, 'G. OBSERVABILITY', 'post-reset error sources', 'investigate',
        COALESCE(v_txt, '(none)'), 'INFO'
      );
      v_seq := v_seq + 1;

      SELECT string_agg(msg, ' | ') INTO v_txt FROM (
        SELECT left(message, 90) AS msg
          FROM public.error_events
         WHERE first_seen_at >= v_marker
         ORDER BY last_seen_at DESC LIMIT 3
      ) s;
      INSERT INTO _verify_results VALUES (
        v_seq, 'G. OBSERVABILITY', 'post-reset error samples', 'investigate',
        COALESCE(v_txt, '(none)'), 'INFO'
      );
      v_seq := v_seq + 1;
    END IF;

    -- G6: pre-reset alert residue.
    SELECT count(*) INTO v_n
      FROM public.system_alerts WHERE created_at < v_marker;
    INSERT INTO _verify_results VALUES (
      v_seq, 'G. OBSERVABILITY', 'system_alerts PRE-reset', '0', v_n::text,
      CASE WHEN v_n = 0 THEN 'PASS' ELSE 'FAIL' END
    );
    v_seq := v_seq + 1;

    -- G7: pre-reset health-check residue.
    SELECT count(*) INTO v_n
      FROM public.health_checks WHERE checked_at < v_marker;
    INSERT INTO _verify_results VALUES (
      v_seq, 'G. OBSERVABILITY', 'health_checks PRE-reset', '0', v_n::text,
      CASE WHEN v_n = 0 THEN 'PASS' ELSE 'FAIL' END
    );
    v_seq := v_seq + 1;
  END IF;


  -- =========================================================================
  -- B. ACCOUNTS — only administrators may remain, and auth must be in sync
  -- =========================================================================
  v_seq := 200;

  -- B1: administrators exist at all (guards against total lockout).
  SELECT count(*) INTO v_n FROM public.profiles WHERE role = 'admin';
  INSERT INTO _verify_results VALUES (
    v_seq, 'B. ACCOUNTS', 'administrator profiles', '>= 1', v_n::text,
    CASE WHEN v_n >= 1 THEN 'PASS' ELSE 'FAIL' END
  );
  v_seq := v_seq + 1;

  -- B2: no profile survived OUTSIDE the reset's preservation rule. This is the
  -- assertion that the reset behaved as specified.
  SELECT count(*) INTO v_n
    FROM public.profiles p
   WHERE p.role <> 'admin'
     AND p.id NOT IN (SELECT user_id FROM public.admin_roles);
  INSERT INTO _verify_results VALUES (
    v_seq, 'B. ACCOUNTS', 'profiles outside preservation rule', '0', v_n::text,
    CASE WHEN v_n = 0 THEN 'PASS' ELSE 'FAIL' END
  );
  v_seq := v_seq + 1;

  -- B2b: profiles preserved ONLY because they hold an admin_roles row, despite
  -- profiles.role <> 'admin'.
  --
  -- Reported separately because B2 alone is misleading: it returns 0 while such
  -- an account exists, since the reset's _keep_admins is a UNION of both
  -- sources. Naming this explicitly is the difference between "the reset worked"
  -- and "the reset worked, AND here is the account it kept that you may not
  -- have expected".
  --
  -- Per 0034 these accounts have NO admin access -- getAdminContext() gates on
  -- profiles.role FIRST, then resolves the back-office role -- so this is an
  -- inconsistency, not a privilege escalation.
  SELECT count(*) INTO v_n
    FROM public.profiles p
   WHERE p.role <> 'admin'
     AND p.id IN (SELECT user_id FROM public.admin_roles);
  INSERT INTO _verify_results VALUES (
    v_seq, 'B. ACCOUNTS', 'preserved via admin_roles only', '0', v_n::text,
    CASE WHEN v_n = 0 THEN 'PASS' ELSE 'WARN' END
  );
  v_seq := v_seq + 1;

  -- B3/B4: auth.users <-> profiles synchronisation, checked in BOTH
  -- directions. profiles.id -> auth.users is a real FK, so a profile without
  -- an auth user is nearly impossible. The REVERSE has no FK at all, so an
  -- auth user with no profile is entirely possible and is the failure mode
  -- that silently breaks login (every album/photo/order FKs to profiles).
  SELECT count(*) INTO v_n
    FROM public.profiles p LEFT JOIN auth.users u ON u.id = p.id
   WHERE u.id IS NULL;
  INSERT INTO _verify_results VALUES (
    v_seq, 'B. ACCOUNTS', 'profiles without auth.users', '0', v_n::text,
    CASE WHEN v_n = 0 THEN 'PASS' ELSE 'FAIL' END
  );
  v_seq := v_seq + 1;

  SELECT count(*) INTO v_n
    FROM auth.users u LEFT JOIN public.profiles p ON p.id = u.id
   WHERE p.id IS NULL;
  INSERT INTO _verify_results VALUES (
    v_seq, 'B. ACCOUNTS', 'auth.users without profile', '0', v_n::text,
    CASE WHEN v_n = 0 THEN 'PASS' ELSE 'FAIL' END
  );
  v_seq := v_seq + 1;

  -- B5: exact 1:1 count agreement.
  SELECT count(*) INTO v_n FROM auth.users;
  SELECT count(*) INTO v_m FROM public.profiles;
  INSERT INTO _verify_results VALUES (
    v_seq, 'B. ACCOUNTS', 'auth.users = profiles (count)',
    v_m::text || ' profiles', v_n::text || ' auth users',
    CASE WHEN v_n = v_m THEN 'PASS' ELSE 'FAIL' END
  );
  v_seq := v_seq + 1;

  -- B6: RBAC drift — an admin_roles row pointing at a non-admin profile.
  -- 0034 treats an ABSENT row as super_admin, so the two sources can disagree
  -- without any FK complaining.
  SELECT count(*), string_agg(COALESCE(p.name, p.id::text) || ' [' || r.role || ']', ', ')
    INTO v_n, v_txt
    FROM public.admin_roles r
    JOIN public.profiles p ON p.id = r.user_id
   WHERE p.role <> 'admin';
  INSERT INTO _verify_results VALUES (
    v_seq, 'B. ACCOUNTS', 'RBAC drift (admin_roles vs role)', '0',
    CASE WHEN v_n = 0 THEN '0' ELSE v_n::text || ': ' || v_txt END,
    CASE WHEN v_n = 0 THEN 'PASS' ELSE 'WARN' END
  );
  v_seq := v_seq + 1;

  IF v_n > 0 THEN
    INSERT INTO _verify_results VALUES (
      v_seq, 'B. ACCOUNTS', 'drift resolution', '-',
      'Pre-existing data drift, not caused by the reset. To remove: DELETE FROM admin_roles WHERE user_id = ''<id>''; then re-run the reset. To keep as an admin: UPDATE profiles SET role = ''admin'' WHERE id = ''<id>'';',
      'INFO'
    );
    v_seq := v_seq + 1;
  END IF;

  -- B7: informational roster.
  SELECT string_agg(COALESCE(r.role, 'super_admin (default)'), ', ' ORDER BY 1)
    INTO v_txt
    FROM public.profiles p
    LEFT JOIN public.admin_roles r ON r.user_id = p.id
   WHERE p.role = 'admin';
  INSERT INTO _verify_results VALUES (
    v_seq, 'B. ACCOUNTS', 'back-office roles present', 'informational',
    COALESCE(v_txt, '(none)'), 'INFO'
  );
  v_seq := v_seq + 1;


  -- =========================================================================
  -- C. CONFIGURATION — must survive intact
  -- =========================================================================
  v_seq := 300;

  FOREACH t IN ARRAY c_config_required LOOP
    EXECUTE format('SELECT count(*) FROM public.%I', t) INTO v_n;
    INSERT INTO _verify_results VALUES (
      v_seq, 'C. CONFIG', t, '>= 1', v_n::text,
      CASE WHEN v_n >= 1 THEN 'PASS' ELSE 'FAIL' END
    );
    v_seq := v_seq + 1;
  END LOOP;

  FOREACH t IN ARRAY c_config_optional LOOP
    EXECUTE format('SELECT count(*) FROM public.%I', t) INTO v_n;
    INSERT INTO _verify_results VALUES (
      v_seq, 'C. CONFIG', t || ' (optional)', 'any', v_n::text, 'INFO'
    );
    v_seq := v_seq + 1;
  END LOOP;

  -- C-extra: preset vs blueprint split inside layout_templates. Both catalogs
  -- live in one table; a reset must not have disturbed either.
  SELECT count(*) INTO v_n FROM public.layout_templates WHERE blueprint IS NULL;
  INSERT INTO _verify_results VALUES (
    v_seq, 'C. CONFIG', 'layout_templates: single-spread presets', 'any', v_n::text, 'INFO'
  );
  v_seq := v_seq + 1;

  SELECT count(*) INTO v_n FROM public.layout_templates WHERE blueprint IS NOT NULL;
  INSERT INTO _verify_results VALUES (
    v_seq, 'C. CONFIG', 'layout_templates: album blueprints', 'any', v_n::text, 'INFO'
  );
  v_seq := v_seq + 1;

  -- C-extra: anything actually selectable by a customer?
  SELECT count(*) INTO v_n FROM public.album_products WHERE is_active;
  INSERT INTO _verify_results VALUES (
    v_seq, 'C. CONFIG', 'active album products', '>= 1', v_n::text,
    CASE WHEN v_n >= 1 THEN 'PASS' ELSE 'FAIL' END
  );
  v_seq := v_seq + 1;

  -- Non-blocking: resolveCoverImageKeys falls back photo -> template ->
  -- design/default, so with at least one cover_design_template an album can
  -- still complete and print. Zero active templates means the customer cover
  -- PICKER is empty, which you want to know before building test albums.
  SELECT count(*) INTO v_n FROM public.cover_templates WHERE active;
  INSERT INTO _verify_results VALUES (
    v_seq, 'C. CONFIG', 'active cover templates', '>= 1', v_n::text,
    CASE WHEN v_n >= 1 THEN 'PASS' ELSE 'WARN' END
  );
  v_seq := v_seq + 1;

  IF v_n = 0 THEN
    SELECT count(*) INTO v_m FROM public.cover_design_templates;
    INSERT INTO _verify_results VALUES (
      v_seq, 'C. CONFIG', 'cover fallback available', '>= 1', v_m::text,
      CASE WHEN v_m >= 1 THEN 'INFO' ELSE 'FAIL' END
    );
    v_seq := v_seq + 1;
  END IF;

  SELECT count(*) INTO v_n FROM public.stickers WHERE active;
  INSERT INTO _verify_results VALUES (
    v_seq, 'C. CONFIG', 'active stickers', '>= 1', v_n::text,
    CASE WHEN v_n >= 1 THEN 'PASS' ELSE 'WARN' END
  );
  v_seq := v_seq + 1;

  SELECT count(*) INTO v_n FROM public.layout_templates WHERE status = 'active';
  INSERT INTO _verify_results VALUES (
    v_seq, 'C. CONFIG', 'active layout templates', '>= 1', v_n::text,
    CASE WHEN v_n >= 1 THEN 'PASS' ELSE 'WARN' END
  );
  v_seq := v_seq + 1;

  -- INFO, not WARN: the reset never touches content_pages, so this count
  -- reflects what was authored in this environment, never reset success. The
  -- only consequence of zero is that /faq, /testimonials and /stories render
  -- their empty states -- a content gap, not an environment defect.
  SELECT count(*) INTO v_n FROM public.content_pages WHERE status = 'published';
  INSERT INTO _verify_results VALUES (
    v_seq, 'C. CONFIG', 'published CMS pages', 'any', v_n::text, 'INFO'
  );
  v_seq := v_seq + 1;


  -- =========================================================================
  -- D. REFERENTIAL INTEGRITY — orphans and dangling references
  -- =========================================================================
  v_seq := 400;

  -- D1: no product still points at a deleted demo album. The FK is
  -- ON DELETE SET NULL, so deleting the album does NOT raise an error — it
  -- silently nulls this column. This check confirms the intended end state.
  SELECT count(*) INTO v_n FROM public.album_products WHERE demo_album_id IS NOT NULL;
  INSERT INTO _verify_results VALUES (
    v_seq, 'D. INTEGRITY', 'products with demo_album_id', '0', v_n::text,
    CASE WHEN v_n = 0 THEN 'PASS' ELSE 'FAIL' END
  );
  v_seq := v_seq + 1;

  -- D2: logical photo orphans. photos.album_id is ON DELETE SET NULL, NOT
  -- cascade, so a deleted album leaves photo rows behind with album_id NULL.
  -- These are not FK violations but they break the hardening worker, which
  -- builds its ownership prefix as '{user_id}/albums/{album_id}/' and rejects
  -- anything resolving to '.../albums/null/'.
  SELECT count(*) INTO v_n FROM public.photos WHERE album_id IS NULL;
  INSERT INTO _verify_results VALUES (
    v_seq, 'D. INTEGRITY', 'photos orphaned (album_id NULL)', '0', v_n::text,
    CASE WHEN v_n = 0 THEN 'PASS' ELSE 'FAIL' END
  );
  v_seq := v_seq + 1;

  -- D3: configuration rows attributed to a deleted account. Six config tables
  -- carry created_by/updated_by. Three of them (coupons, cover_templates,
  -- stickers) use NO ACTION, so a live reference would have BLOCKED the reset;
  -- the rest use SET NULL and self-heal. Verified regardless.
  SELECT
      (SELECT count(*) FROM public.coupons          WHERE created_by IS NOT NULL AND created_by NOT IN (SELECT id FROM public.profiles))
    + (SELECT count(*) FROM public.cover_templates  WHERE created_by IS NOT NULL AND created_by NOT IN (SELECT id FROM public.profiles))
    + (SELECT count(*) FROM public.stickers         WHERE created_by IS NOT NULL AND created_by NOT IN (SELECT id FROM public.profiles))
    + (SELECT count(*) FROM public.layout_templates WHERE created_by IS NOT NULL AND created_by NOT IN (SELECT id FROM public.profiles))
    + (SELECT count(*) FROM public.content_pages    WHERE created_by IS NOT NULL AND created_by NOT IN (SELECT id FROM public.profiles))
    + (SELECT count(*) FROM public.album_products   WHERE created_by IS NOT NULL AND created_by NOT IN (SELECT id FROM public.profiles))
    + (SELECT count(*) FROM public.cover_design_templates WHERE created_by IS NOT NULL AND created_by NOT IN (SELECT id FROM public.profiles))
  INTO v_n;
  INSERT INTO _verify_results VALUES (
    v_seq, 'D. INTEGRITY', 'config rows -> deleted account', '0', v_n::text,
    CASE WHEN v_n = 0 THEN 'PASS' ELSE 'FAIL' END
  );
  v_seq := v_seq + 1;

  -- D4: catalog self-consistency — exactly one default product. Backed by a
  -- partial unique index, so a value other than 1 means the seed is missing.
  SELECT count(*) INTO v_n FROM public.album_products WHERE is_default;
  INSERT INTO _verify_results VALUES (
    v_seq, 'D. INTEGRITY', 'default album product', '1', v_n::text,
    CASE WHEN v_n = 1 THEN 'PASS' ELSE 'FAIL' END
  );
  v_seq := v_seq + 1;

  -- D4b: ORPHANED CHILDREN. Every one of these relationships is protected by
  -- a foreign key, so a non-zero count means genuine corruption (a constraint
  -- was dropped, or rows were inserted with the constraint disabled) rather
  -- than an ordinary reset miss. Cheap to check and unambiguous when hit.
  --
  -- Each pair below is (child table, the parent it must still resolve to):
  --   album_pages  -> albums          CASCADE
  --   album_pdfs   -> albums          CASCADE
  --   cart_items   -> albums, profiles  CASCADE      (0055)
  --   order_items  -> orders CASCADE, albums NO ACTION (0056)
  --   payments     -> orders          CASCADE
  --   order_notes  -> orders          CASCADE
  --   addresses    -> profiles        CASCADE
  --   shipments    -> orders          CASCADE
  --   shipment_events -> shipments    CASCADE
  --   album_reviews -> albums         CASCADE
  --   revision_requests -> album_reviews CASCADE
  --   support_messages -> support_tickets CASCADE
  SELECT
      (SELECT count(*) FROM public.album_pages x       WHERE NOT EXISTS (SELECT 1 FROM public.albums a WHERE a.id = x.album_id))
    + (SELECT count(*) FROM public.album_pdfs x        WHERE NOT EXISTS (SELECT 1 FROM public.albums a WHERE a.id = x.album_id))
    + (SELECT count(*) FROM public.cart_items x        WHERE NOT EXISTS (SELECT 1 FROM public.albums a WHERE a.id = x.album_id))
    + (SELECT count(*) FROM public.cart_items x        WHERE NOT EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.id = x.user_id))
    + (SELECT count(*) FROM public.order_items x       WHERE NOT EXISTS (SELECT 1 FROM public.orders o WHERE o.id = x.order_id))
    + (SELECT count(*) FROM public.order_items x       WHERE NOT EXISTS (SELECT 1 FROM public.albums a WHERE a.id = x.album_id))
    + (SELECT count(*) FROM public.payments x          WHERE NOT EXISTS (SELECT 1 FROM public.orders o WHERE o.id = x.order_id))
    + (SELECT count(*) FROM public.order_notes x       WHERE NOT EXISTS (SELECT 1 FROM public.orders o WHERE o.id = x.order_id))
    + (SELECT count(*) FROM public.addresses x         WHERE NOT EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.id = x.user_id))
    + (SELECT count(*) FROM public.shipments x         WHERE NOT EXISTS (SELECT 1 FROM public.orders o WHERE o.id = x.order_id))
    + (SELECT count(*) FROM public.shipment_events x   WHERE NOT EXISTS (SELECT 1 FROM public.shipments sh WHERE sh.id = x.shipment_id))
    + (SELECT count(*) FROM public.album_reviews x     WHERE NOT EXISTS (SELECT 1 FROM public.albums a WHERE a.id = x.album_id))
    + (SELECT count(*) FROM public.revision_requests x WHERE NOT EXISTS (SELECT 1 FROM public.album_reviews r WHERE r.id = x.album_review_id))
    + (SELECT count(*) FROM public.support_messages x  WHERE NOT EXISTS (SELECT 1 FROM public.support_tickets tk WHERE tk.id = x.ticket_id))
  INTO v_n;
  INSERT INTO _verify_results VALUES (
    v_seq, 'D. INTEGRITY', 'orphaned child rows (all FK pairs)', '0', v_n::text,
    CASE WHEN v_n = 0 THEN 'PASS' ELSE 'FAIL' END
  );
  v_seq := v_seq + 1;

  -- D4c: user-owned assets whose owner is gone. albums.user_id and
  -- photos.user_id are ON DELETE RESTRICT (0054, "prevent orphaned user
  -- assets") precisely so this can never happen — those columns name R2
  -- objects, and a row without an owner is an object nothing can reclaim.
  -- A non-zero count means 0054's protection was bypassed.
  SELECT
      (SELECT count(*) FROM public.albums x WHERE NOT EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.id = x.user_id))
    + (SELECT count(*) FROM public.photos x WHERE NOT EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.id = x.user_id))
  INTO v_n;
  INSERT INTO _verify_results VALUES (
    v_seq, 'D. INTEGRITY', 'user assets without an owner (0054)', '0', v_n::text,
    CASE WHEN v_n = 0 THEN 'PASS' ELSE 'FAIL' END
  );
  v_seq := v_seq + 1;

  -- D4d: duplicate configuration. Each of these is backed by a UNIQUE
  -- constraint, so a duplicate means the constraint is missing — schema drift
  -- that would let the catalog offer two prices for one page count.
  SELECT
      (SELECT count(*) FROM (SELECT product_id, page_count FROM public.album_product_prices GROUP BY 1,2 HAVING count(*) > 1) a)
    + (SELECT count(*) FROM (SELECT slug FROM public.album_products GROUP BY 1 HAVING count(*) > 1) b)
    + (SELECT count(*) FROM (SELECT user_id FROM public.admin_roles GROUP BY 1 HAVING count(*) > 1) c)
    + (SELECT count(*) FROM (SELECT code FROM public.coupons GROUP BY 1 HAVING count(*) > 1) d)
  INTO v_n;
  INSERT INTO _verify_results VALUES (
    v_seq, 'D. INTEGRITY', 'duplicate config rows', '0', v_n::text,
    CASE WHEN v_n = 0 THEN 'PASS' ELSE 'FAIL' END
  );
  v_seq := v_seq + 1;

  -- D5: every active product must be purchasable.
  SELECT count(*) INTO v_n
    FROM public.album_products p
   WHERE p.is_active
     AND NOT EXISTS (SELECT 1 FROM public.album_product_prices pr WHERE pr.product_id = p.id);
  INSERT INTO _verify_results VALUES (
    v_seq, 'D. INTEGRITY', 'active products without prices', '0', v_n::text,
    CASE WHEN v_n = 0 THEN 'PASS' ELSE 'FAIL' END
  );
  v_seq := v_seq + 1;

  -- D6: price rows whose product no longer exists (FK-protected; belt and braces).
  SELECT count(*) INTO v_n
    FROM public.album_product_prices pr
   WHERE NOT EXISTS (SELECT 1 FROM public.album_products p WHERE p.id = pr.product_id);
  INSERT INTO _verify_results VALUES (
    v_seq, 'D. INTEGRITY', 'orphaned product prices', '0', v_n::text,
    CASE WHEN v_n = 0 THEN 'PASS' ELSE 'FAIL' END
  );
  v_seq := v_seq + 1;

  -- D7: preview rows whose product no longer exists.
  SELECT count(*) INTO v_n
    FROM public.album_product_previews pv
   WHERE NOT EXISTS (SELECT 1 FROM public.album_products p WHERE p.id = pv.product_id);
  INSERT INTO _verify_results VALUES (
    v_seq, 'D. INTEGRITY', 'orphaned product previews', '0', v_n::text,
    CASE WHEN v_n = 0 THEN 'PASS' ELSE 'FAIL' END
  );
  v_seq := v_seq + 1;

  -- D8: active cover templates missing their R2 artwork key. image_key is NOT
  -- NULL at the schema level, so this catches empty strings only — a cheap
  -- guard against a partially-seeded catalog.
  SELECT count(*) INTO v_n
    FROM public.cover_templates WHERE active AND COALESCE(trim(image_key), '') = '';
  INSERT INTO _verify_results VALUES (
    v_seq, 'D. INTEGRITY', 'active covers missing image_key', '0', v_n::text,
    CASE WHEN v_n = 0 THEN 'PASS' ELSE 'FAIL' END
  );
  v_seq := v_seq + 1;

  -- D9: stickers pointing at a deleted category (FK is SET NULL, so this is a
  -- soft state rather than a violation).
  SELECT count(*) INTO v_n
    FROM public.stickers s
   WHERE s.category_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.sticker_categories c WHERE c.id = s.category_id);
  INSERT INTO _verify_results VALUES (
    v_seq, 'D. INTEGRITY', 'stickers -> deleted category', '0', v_n::text,
    CASE WHEN v_n = 0 THEN 'PASS' ELSE 'FAIL' END
  );
  v_seq := v_seq + 1;

  -- D10: global FK sanity. Counts every FK constraint still declared, so a
  -- dropped-and-not-restored constraint is visible rather than silent.
  SELECT count(*) INTO v_n
    FROM pg_constraint c
    JOIN pg_namespace n ON n.oid = c.connamespace
   WHERE c.contype = 'f' AND n.nspname = 'public';
  INSERT INTO _verify_results VALUES (
    v_seq, 'D. INTEGRITY', 'public FK constraints declared', '>= 65', v_n::text,
    CASE WHEN v_n >= 65 THEN 'PASS' ELSE 'WARN' END
  );
  v_seq := v_seq + 1;


  -- =========================================================================
  -- E. QUEUE (pg-boss) — dynamic, because the schema may legitimately be
  --    absent if DROP SCHEMA pgboss CASCADE was used and the worker has not
  --    yet rebooted to rebuild it.
  -- =========================================================================
  v_seq := 500;

  IF to_regnamespace('pgboss') IS NULL THEN
    INSERT INTO _verify_results VALUES (
      v_seq, 'E. QUEUE', 'pgboss schema', 'present', 'MISSING', 'WARN'
    );
    v_seq := v_seq + 1;
    INSERT INTO _verify_results VALUES (
      v_seq, 'E. QUEUE', 'action required', '-',
      'Restart the worker; pg-boss rebuilds the schema on boot.', 'INFO'
    );
  ELSE
    INSERT INTO _verify_results VALUES (
      v_seq, 'E. QUEUE', 'pgboss schema', 'present', 'present', 'PASS'
    );
    v_seq := v_seq + 1;

    -- E1: job table drained. Partitioned by LIST (name); count spans partitions.
    IF to_regclass('pgboss.job') IS NOT NULL THEN
      EXECUTE 'SELECT count(*) FROM pgboss.job' INTO v_n;
      INSERT INTO _verify_results VALUES (
        v_seq, 'E. QUEUE', 'pgboss.job rows', '0', v_n::text,
        CASE WHEN v_n = 0 THEN 'PASS' ELSE 'FAIL' END
      );
      v_seq := v_seq + 1;
    END IF;

    -- E2: archive drained.
    IF to_regclass('pgboss.archive') IS NOT NULL THEN
      EXECUTE 'SELECT count(*) FROM pgboss.archive' INTO v_n;
      INSERT INTO _verify_results VALUES (
        v_seq, 'E. QUEUE', 'pgboss.archive rows', '0', v_n::text,
        CASE WHEN v_n = 0 THEN 'PASS' ELSE 'FAIL' END
      );
      v_seq := v_seq + 1;
    END IF;

    -- E3: queue CONFIGURATION preserved. This is the inverse of the checks
    -- above: job/archive must be empty, but pgboss.queue must NOT be, or the
    -- reset destroyed policy/retry/expiry settings.
    IF to_regclass('pgboss.queue') IS NOT NULL THEN
      -- Count the FIVE application queues specifically. A raw count is
      -- misleading: pg-boss maintains internal queues of its own (e.g.
      -- '__pgboss__send-it', used for its own maintenance dispatch), so the
      -- total is legitimately higher than five and varies by pg-boss version.
      EXECUTE 'SELECT count(*) FROM pgboss.queue WHERE name = ANY($1)'
        INTO v_n USING c_queues;
      INSERT INTO _verify_results VALUES (
        v_seq, 'E. QUEUE', 'application queues configured', '5', v_n::text,
        CASE WHEN v_n = 5 THEN 'PASS' WHEN v_n > 0 THEN 'WARN' ELSE 'FAIL' END
      );
      v_seq := v_seq + 1;

      EXECUTE 'SELECT count(*), string_agg(name, '', '') FROM pgboss.queue WHERE name <> ALL($1)'
        INTO v_m, v_txt USING c_queues;
      INSERT INTO _verify_results VALUES (
        v_seq, 'E. QUEUE', 'pg-boss internal queues', 'informational',
        COALESCE(v_m::text || ': ' || v_txt, '0'), 'INFO'
      );
      v_seq := v_seq + 1;

      -- E4: each expected queue by name.
      FOREACH t IN ARRAY c_queues LOOP
        EXECUTE 'SELECT count(*) FROM pgboss.queue WHERE name = $1' INTO v_n USING t;
        INSERT INTO _verify_results VALUES (
          v_seq, 'E. QUEUE', 'queue: ' || t, 'present',
          CASE WHEN v_n > 0 THEN 'present' ELSE 'MISSING' END,
          CASE WHEN v_n > 0 THEN 'PASS' ELSE 'WARN' END
        );
        v_seq := v_seq + 1;
      END LOOP;

      -- E5: queue policy readout. Every queue is created with no options, so
      -- policy resolves to 'standard' — under which singletonKey does NOT
      -- deduplicate (pg-boss scopes its dedupe indexes to the short/singleton/
      -- stately policies). That is currently relied upon: enqueueAlbumPdf
      -- deliberately passes NO singletonKey so a newer print token is never
      -- dropped in favour of a stale queued job. Reported so the choice stays
      -- explicit rather than inherited.
      EXECUTE $q$
        SELECT string_agg(name || '=' || COALESCE(policy, 'null'), ', ' ORDER BY name)
        FROM pgboss.queue
      $q$ INTO v_txt;
      INSERT INTO _verify_results VALUES (
        v_seq, 'E. QUEUE', 'queue policies', 'informational',
        COALESCE(v_txt, '(none)'), 'INFO'
      );
      v_seq := v_seq + 1;
    END IF;

    -- E6: pg-boss schema version must survive; destroying it breaks pg-boss's
    -- own migration detection on next boot.
    IF to_regclass('pgboss.version') IS NOT NULL THEN
      EXECUTE 'SELECT count(*) FROM pgboss.version' INTO v_n;
      INSERT INTO _verify_results VALUES (
        v_seq, 'E. QUEUE', 'pgboss.version intact', '>= 1', v_n::text,
        CASE WHEN v_n >= 1 THEN 'PASS' ELSE 'FAIL' END
      );
      v_seq := v_seq + 1;
    END IF;
  END IF;


  -- =========================================================================
  -- F. SCHEMA SANITY
  -- =========================================================================
  v_seq := 600;

  -- F1: sequences in the schemas THIS PROJECT owns.
  --
  -- The original version of this check queried every schema except pg_catalog
  -- and information_schema, and flagged a sequence it does not own. That was a
  -- bug in this script, not a finding: the claim "every PK is uuid" was only
  -- ever about the APPLICATION schema. A Supabase project always ships
  -- provider-managed schemas (auth, storage, realtime, ...) that contain
  -- bigserial/IDENTITY columns of their own. Asserting on those means asserting
  -- on Supabase's internals, which this project does not control, cannot reset,
  -- and must not fail on.
  --
  -- Scoped to public + pgboss, a sequence IS a genuine finding: it means schema
  -- drift away from the all-uuid design, so this is FAIL (not WARN) when hit.
  -- pgboss is included because pg-boss also keys on uuid/text, never a counter.
  SELECT count(*) INTO v_n
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE c.relkind = 'S'
     AND n.nspname IN ('public', 'pgboss');
  INSERT INTO _verify_results VALUES (
    v_seq, 'F. SCHEMA', 'sequences in public + pgboss', '0', v_n::text,
    CASE WHEN v_n = 0 THEN 'PASS' ELSE 'FAIL' END
  );
  v_seq := v_seq + 1;

  -- F1b: name every sequence OUTSIDE those schemas, with its owning
  -- table.column, so a provider-managed sequence is identified rather than
  -- left as an unexplained number. pg_class is used instead of
  -- information_schema.sequences because the latter hides sequences the
  -- current role lacks privileges on -- which is why the earlier version saw
  -- only one of them.
  SELECT count(*), string_agg(x.label, ', ' ORDER BY x.label)
    INTO v_m, v_txt
    FROM (
      SELECT n.nspname || '.' || c.relname
             || COALESCE(' -> ' || tn.nspname || '.' || tc.relname || '.' || a.attname, ' (standalone)') AS label
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        LEFT JOIN pg_depend d
               ON d.objid = c.oid
              AND d.classid = 'pg_class'::regclass
              AND d.deptype IN ('a', 'i')          -- 'a' = SERIAL, 'i' = IDENTITY
        LEFT JOIN pg_class     tc ON tc.oid = d.refobjid
        LEFT JOIN pg_namespace tn ON tn.oid = tc.relnamespace
        LEFT JOIN pg_attribute a  ON a.attrelid = d.refobjid AND a.attnum = d.refobjsubid
       WHERE c.relkind = 'S'
         AND n.nspname NOT IN ('public', 'pgboss', 'pg_catalog', 'information_schema')
    ) x;
  INSERT INTO _verify_results VALUES (
    v_seq, 'F. SCHEMA', 'provider-managed sequences', 'not our concern',
    COALESCE(v_m::text || ': ' || v_txt, '0'), 'INFO'
  );
  v_seq := v_seq + 1;

  -- F2: RLS enabled on EVERY table in public. The reset runs as postgres
  -- (BYPASSRLS) and must not have disturbed this.
  --
  -- Checked as "tables without RLS = 0" rather than against a hand-maintained
  -- list of 13 names: the previous form silently stopped covering every table
  -- added after it was written, which is exactly the drift this script exists
  -- to catch. The live catalog has RLS on all 38 tables.
  SELECT count(*) INTO v_n
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity;
  SELECT string_agg(c.relname, ', ' ORDER BY c.relname) INTO v_txt
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity;
  INSERT INTO _verify_results VALUES (
    v_seq, 'F. SCHEMA', 'public tables WITHOUT RLS', '0',
    COALESCE(v_n::text || CASE WHEN v_n > 0 THEN ' (' || v_txt || ')' ELSE '' END, '0'),
    CASE WHEN v_n = 0 THEN 'PASS' ELSE 'FAIL' END
  );
  v_seq := v_seq + 1;

  -- F2b: the two SERVICE-ROLE-ONLY tables — RLS enabled with NO policies at
  -- all, so neither anon nor authenticated can reach them by any path. This is
  -- the privilege model 0008 and 0010 established; the reset must not have
  -- relaxed it. album_pdfs holds print tokens; webhook_events holds Razorpay
  -- idempotency markers.
  SELECT count(*) INTO v_n
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relname IN ('album_pdfs', 'webhook_events')
     AND c.relrowsecurity
     AND NOT EXISTS (
       SELECT 1 FROM pg_policies pp
        WHERE pp.schemaname = 'public' AND pp.tablename = c.relname
     );
  INSERT INTO _verify_results VALUES (
    v_seq, 'F. SCHEMA', 'service-role-only tables locked', '2', v_n::text,
    CASE WHEN v_n = 2 THEN 'PASS' ELSE 'FAIL' END
  );
  v_seq := v_seq + 1;

  -- F2c: album_pdfs must carry the 0058 print-PDF shape. Without it the app
  -- cannot generate ANY PDF: every read and write is scoped by kind, so a
  -- pre-0058 database throws "column kind does not exist" on the first
  -- generate, and the customer preview poll fails too.
  --
  -- Three things are checked because each fails differently:
  --   the column        -> queries error outright
  --   the CHECK         -> an invalid kind could be stored
  --   the composite PK  -> the three artifacts would collapse onto one row,
  --                        so a print export would overwrite the preview
  SELECT count(*) INTO v_n
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'album_pdfs' AND column_name = 'kind';
  INSERT INTO _verify_results VALUES (
    v_seq, 'F. SCHEMA', 'album_pdfs.kind column (0058)', '1', v_n::text,
    CASE WHEN v_n = 1 THEN 'PASS' ELSE 'FAIL' END
  );
  v_seq := v_seq + 1;

  SELECT count(*) INTO v_n
    FROM pg_constraint
   WHERE conrelid = 'public.album_pdfs'::regclass
     AND contype = 'c'
     AND pg_get_constraintdef(oid) ILIKE '%print_cover%'
     AND pg_get_constraintdef(oid) ILIKE '%print_content%';
  INSERT INTO _verify_results VALUES (
    v_seq, 'F. SCHEMA', 'album_pdfs kind CHECK (3 kinds)', '1', v_n::text,
    CASE WHEN v_n >= 1 THEN 'PASS' ELSE 'FAIL' END
  );
  v_seq := v_seq + 1;

  SELECT string_agg(a.attname, ',' ORDER BY k.ord) INTO v_txt
    FROM pg_constraint c
    JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord) ON true
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
   WHERE c.conrelid = 'public.album_pdfs'::regclass AND c.contype = 'p';
  INSERT INTO _verify_results VALUES (
    v_seq, 'F. SCHEMA', 'album_pdfs primary key', 'album_id,kind',
    COALESCE(v_txt, '(none)'),
    CASE WHEN v_txt = 'album_id,kind' THEN 'PASS' ELSE 'FAIL' END
  );
  v_seq := v_seq + 1;

  -- F2d: no PDF render state may survive the reset, in ANY kind. Reported
  -- per kind so a stale print-cover row is not hidden inside a total. This
  -- overlaps category A deliberately: A proves the table is empty, this proves
  -- the reset understood that "empty" now means all three artifacts.
  SELECT count(*) INTO v_n FROM public.album_pdfs;
  SELECT string_agg(kind || '=' || n::text, ', ' ORDER BY kind) INTO v_txt
    FROM (SELECT kind, count(*) AS n FROM public.album_pdfs GROUP BY kind) z;
  INSERT INTO _verify_results VALUES (
    v_seq, 'F. SCHEMA', 'album_pdfs rows by kind', '0',
    COALESCE(v_txt, '0'),
    CASE WHEN v_n = 0 THEN 'PASS' ELSE 'FAIL' END
  );
  v_seq := v_seq + 1;

  -- F3: the profile-creation trigger must exist, or the first test signup
  -- produces an auth user with no profile and every FK write fails.
  SELECT count(*) INTO v_n
    FROM pg_trigger WHERE tgname = 'on_auth_user_created' AND NOT tgisinternal;
  INSERT INTO _verify_results VALUES (
    v_seq, 'F. SCHEMA', 'on_auth_user_created trigger', '1', v_n::text,
    CASE WHEN v_n >= 1 THEN 'PASS' ELSE 'FAIL' END
  );
  v_seq := v_seq + 1;

  -- F4: key SECURITY DEFINER RPCs still present.
  SELECT count(*) INTO v_n
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN ('is_admin','log_audit','record_error_event','process_razorpay_event',
                       'create_order_with_items','cart_add_or_increment','cart_ensure_item',
                       'submit_album_for_review','handle_new_user');
  INSERT INTO _verify_results VALUES (
    v_seq, 'F. SCHEMA', 'core RPCs present', '>= 9', v_n::text,
    CASE WHEN v_n >= 9 THEN 'PASS' ELSE 'FAIL' END
  );
  v_seq := v_seq + 1;


  -- =========================================================================
  -- G. OVERALL VERDICT  (seq 0 -> sorts to the top of the grid)
  -- =========================================================================
  SELECT count(*) FILTER (WHERE status = 'FAIL'),
         count(*) FILTER (WHERE status = 'WARN')
    INTO v_n, v_m
    FROM _verify_results;

  INSERT INTO _verify_results VALUES (
    0, '>>> VERDICT', 'clean database check',
    '0 failures',
    v_n::text || ' failed, ' || v_m::text || ' warnings',
    CASE WHEN v_n = 0 AND v_m = 0 THEN 'PASS'
         WHEN v_n = 0             THEN 'PASS (with warnings)'
         ELSE 'FAIL' END
  );

  INSERT INTO _verify_results VALUES (
    1, '>>> VERDICT', 'next step', '-',
    CASE WHEN v_n = 0
         THEN 'Database is clean. Verify R2 manually (development_reset.sql PART 3), then start the worker and create the first test user.'
         ELSE 'Do NOT seed test data yet. Review every FAIL row below.' END,
    CASE WHEN v_n = 0 THEN 'INFO' ELSE 'FAIL' END
  );

  INSERT INTO _verify_results VALUES (
    2, '>>> VERDICT', 'R2 (not checkable in SQL)', 'manual',
    'rclone lsd r2:<bucket>  -> expect ONLY album-products/ cover-templates/ stickers/ (no {userId}/ folders)',
    'INFO'
  );

END $$;


-- ---------------------------------------------------------------------------
-- STATEMENT 3 — the report
-- ---------------------------------------------------------------------------
SELECT
  category   AS "category",
  check_name AS "check",
  expected   AS "expected",
  actual     AS "actual",
  status     AS "status"
FROM _verify_results
ORDER BY seq;


-- ============================================================================
-- INTERPRETING THE OUTPUT
-- ============================================================================
-- PASS  Check succeeded.
-- FAIL  Blocking. Do not seed test data. Investigate.
-- WARN  Non-blocking but worth understanding. Common legitimate causes:
--         - "active cover templates = 0"  -> catalog was never seeded
--         - "pgboss schema MISSING"       -> DROP SCHEMA was used; restart worker
--         - "queue: <name> MISSING"       -> worker has not booted since reset
-- INFO  Context only, never a failure.
--
-- EXPECTED STATE IMMEDIATELY AFTER A SUCCESSFUL RESET
--
--   TRANSACTIONAL DATA          -> empty      (category A, 21 tables)
--   ADMIN / BACK OFFICE         -> preserved  (category B)
--   PRODUCT / CATALOG CONFIG    -> preserved  (category C, required)
--   CMS / TEMPLATE / STICKERS   -> preserved  (category C, optional)
--   DEMO ALBUMS                 -> deleted, and demo_album_id nulled; an admin
--                                  re-attaches a fresh one from /admin/dimensions
--   WORKER / QUEUE              -> structurally ready (category E)
--   R2 OBJECT STORAGE           -> NOT verifiable here; manual (see below)
--
--   Per category:
--     A. TRANSACTIONAL   every row PASS (all counts 0)
--     G. OBSERVABILITY   all PRE-reset rows 0; POST-reset rows INFO/WARN
--     B. ACCOUNTS        every row PASS; auth.users = profiles = admin count
--     C. CONFIG          required tables PASS; optional tables INFO
--     D. INTEGRITY       every row PASS
--     E. QUEUE           job/archive 0; 5 project queues present
--     F. SCHEMA          every row PASS, including the 0058 album_pdfs shape
--
-- ACCEPTED WARNINGS (intentional, documented development states)
--   These do NOT indicate a failed reset and do NOT block development:
--
--   'preserved via admin_roles only' / 'RBAC drift'
--       An account holds an admin_roles row while profiles.role <> 'admin'.
--       Pre-existing data drift. The reset's preservation rule is a UNION of
--       both sources -- deliberately, because lockout is worse than one extra
--       surviving account. Per 0034 the account has NO admin access.
--       Resolution is printed alongside the warning.
--
--   'error_events POST-reset' > 0
--       Something threw after the reset. Not reset damage -- the app or worker
--       is running. The two INFO rows beneath it name the sources and show
--       sample messages so it is actionable.
--
--   'active cover templates' = 0
--       The cover picker is empty. Non-blocking: resolveCoverImageKeys falls
--       back to cover designs, so albums still complete and print. This is the
--       CURRENT state of the live catalog, which is why cover_templates is
--       classified OPTIONAL rather than required.
--
--   'queue: cover-thumbnail' / 'queue: blueprint-thumbnail' MISSING
--       Both queues are declared by the app but have NO processor in the
--       worker. They appear once the app first enqueues onto them. Their
--       absence right after a reset is normal.
--
--   'reset marker NOT FOUND'
--       Only when verifying a reset performed before Section 10B existed.
--       Re-run the current reset script to anchor future verifications.
--
-- KNOWN-GOOD DEVIATION
--   Running this AFTER creating test data will FAIL the A. TRANSACTIONAL
--   checks. That is correct behaviour, not a regression — this script
--   verifies a CLEAN database, so run it before seeding test data.
--
-- WHAT THIS SCRIPT CANNOT SEE — CLOUDFLARE R2
--   SQL has no visibility into object storage. A PASS verdict means THE
--   DATABASE is clean; it says nothing about the bucket, and this script never
--   claims otherwise. After the reset the R2 objects still exist and nothing in
--   the database points at them any more, so they are also unreachable by the
--   orphan tooling (which proves ownership via the now-empty `photos` table).
--
--   Delete by hand — see development_reset.sql PART 3 for the full contract:
--     DELETE  {userId}/albums/{albumId}/...  raw uploads, _full / _thumb
--                                            derivatives, and the three PDFs
--                                            preview.pdf / print-cover.pdf /
--                                            print-content.pdf   (0058)
--     KEEP    cover-templates/  album-products/  stickers/
--
-- WHAT IS DELIBERATELY *NOT* ASSERTED
--   content_pages / published CMS pages -- the reset never touches this table,
--     so its count measures content authoring, not reset correctness.
--   Sequences outside public + pgboss -- provider-managed Supabase schemas
--     (auth, storage, realtime, ...) legitimately contain bigserial/IDENTITY
--     columns. They are NAMED as INFO, never failed on.
--   Non-application pg-boss queues -- internal to pg-boss, version-dependent
--     ('__pgboss__send-it' is pg-boss's own and is reported as INFO).
--   Worker HEALTH -- the presence of a queue proves configuration exists, not
--     that a worker is running, reachable, or able to load the print route.
--     Use the worker's own startup report and
--     worker/apps/worker/scripts/verify-render-connectivity.ts for that.
--   R2 contents -- see above. Never inferred from database state.
-- ============================================================================
