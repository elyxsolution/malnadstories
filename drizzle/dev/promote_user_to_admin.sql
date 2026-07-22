-- ============================================================================
-- MALNAD STORIES — PROMOTE USER TO ADMINISTRATOR
-- ============================================================================
-- Location : drizzle/dev/promote_user_to_admin.sql
-- Docs     : drizzle/dev/promote_user_to_admin_README.md
-- Family   : promote_user_to_admin.sql / demote_admin_to_user.sql / list_all_admins.sql
--
-- THIS IS NOT A MIGRATION. It is a reusable operational utility and must never
-- be applied by a migration runner or during a deployment.
--
-- WHAT IT DOES
--   Grants full back-office access to an existing account, in one atomic
--   transaction:
--     1. public.profiles.role      -> 'admin'        (the ACCESS gate, 0019)
--     2. public.admin_roles.role   -> 'super_admin'  (the CAPABILITY scope, 0034)
--
--   Both are required. Per 0034, getAdminContext() gates on profiles.role
--   FIRST and only then resolves the back-office role, so an admin_roles row
--   alone grants NOTHING. Setting only profiles.role would work (an absent
--   admin_roles row is treated as super_admin for migration safety), but leaves
--   the two sources disagreeing -- the exact drift that
--   verify_clean_database.sql reports as a warning.
--
-- IDEMPOTENT. Safe to run any number of times. admin_roles.user_id is the
-- PRIMARY KEY, so a duplicate row is structurally impossible; the upsert below
-- converts a repeat run into a no-op.
--
-- PRIVILEGES
--   Run as `postgres` (the Supabase SQL Editor default) or with the service
--   role. admin_roles carries RESTRICTIVE deny policies for `authenticated` and
--   `anon` (0034), and profiles.role is removed from the authenticated column
--   grant (0019) -- so a normal client cannot perform this, by design. No table
--   in this database sets FORCE ROW LEVEL SECURITY, so the owner bypasses RLS.
-- ============================================================================


BEGIN;

-- ############################################################################
--
--   ██  CHANGE ONLY THIS LINE  ██
--
-- ############################################################################

SET LOCAL malnad.target_email = 'khannawaz2004@gmail.com';

-- ############################################################################
--
--   Everything below is automatic. Do not edit.
--
--   NOTE ON SYNTAX: psql's `\set` is a CLIENT meta-command and does NOT work
--   in the Supabase SQL Editor, pgAdmin, or any driver-based client. A
--   transaction-scoped custom GUC (`SET LOCAL`) is used instead: it is real
--   SQL, works in every client, and is automatically discarded at COMMIT or
--   ROLLBACK -- so the value can never leak into a later session on a pooled
--   connection.
--
-- ############################################################################


DO $$
DECLARE
  v_email       text;
  v_user        jsonb;
  v_user_count  int;
  v_user_id     uuid;
  v_prof_count  int;
  v_name        text;
  v_old_role    text;
  v_old_admin   text;
  v_action      text;
  v_deleted_at  text;
  v_banned      text;
  v_confirmed   text;
  v_anon        text;
BEGIN
  -- =========================================================================
  -- STEP 0 — read and normalise the target
  -- =========================================================================
  v_email := lower(trim(COALESCE(current_setting('malnad.target_email', true), '')));

  IF v_email = '' THEN
    RAISE EXCEPTION
      'No target email set. Edit the SET LOCAL line at the top of this script.';
  END IF;

  IF position('@' IN v_email) = 0 THEN
    RAISE EXCEPTION
      'Target "%" does not look like an email address.', v_email;
  END IF;

  RAISE NOTICE '';
  RAISE NOTICE '===========================================================';
  RAISE NOTICE ' Malnad Stories - promote user to administrator';
  RAISE NOTICE '===========================================================';
  RAISE NOTICE ' Target email : %', v_email;
  RAISE NOTICE ' Database     : %', current_database();
  RAISE NOTICE ' Executed by  : %', current_user;
  RAISE NOTICE '-----------------------------------------------------------';


  -- =========================================================================
  -- STEP 1 — locate the auth user
  -- =========================================================================
  -- Emails are compared case-insensitively. Supabase normally lowercases on
  -- signup, but OAuth providers and admin-API inserts do not always.
  SELECT count(*) INTO v_user_count
    FROM auth.users u
   WHERE lower(u.email) = v_email;

  IF v_user_count = 0 THEN
    RAISE EXCEPTION
      'No account found in auth.users for "%".', v_email
      USING HINT = 'The user must sign up first. This utility promotes an EXISTING account; it never creates one.';
  END IF;

  -- SAFETY: refuse on ambiguity. auth.users does NOT enforce a global unique
  -- constraint on email -- a soft-deleted account plus a fresh signup, or the
  -- same address across two identity providers, can both produce duplicates.
  -- Guessing which row to promote would be a security decision, so we stop.
  IF v_user_count > 1 THEN
    RAISE EXCEPTION
      'Ambiguous: % accounts in auth.users share the email "%".', v_user_count, v_email
      USING HINT = 'Inspect with:  SELECT id, email, created_at, deleted_at, is_sso_user FROM auth.users WHERE lower(email) = lower(''<email>'');  Then promote by id manually.';
  END IF;

  -- Capture the whole row as jsonb. This is deliberate: it lets us read
  -- OPTIONAL Supabase columns (deleted_at, banned_until, is_anonymous,
  -- email_confirmed_at) WITHOUT assuming they exist. Supabase has added these
  -- over time; a direct reference would raise "column does not exist" on an
  -- older project, while `->>` on a missing key simply returns NULL.
  SELECT to_jsonb(u) INTO v_user
    FROM auth.users u
   WHERE lower(u.email) = v_email;

  v_user_id    := (v_user->>'id')::uuid;
  v_deleted_at := v_user->>'deleted_at';
  v_banned     := v_user->>'banned_until';
  v_confirmed  := v_user->>'email_confirmed_at';
  v_anon       := v_user->>'is_anonymous';

  RAISE NOTICE ' [OK] User found      : %', v_user_id;
  RAISE NOTICE '      Created         : %', COALESCE(v_user->>'created_at', '(unknown)');
  RAISE NOTICE '      Last sign-in    : %', COALESCE(v_user->>'last_sign_in_at', 'never');


  -- =========================================================================
  -- STEP 2 — account-state safety gates
  -- =========================================================================

  -- SAFETY: soft-deleted account. Promoting one produces an admin that cannot
  -- log in, and would be silently resurrected if the address is reused.
  IF v_deleted_at IS NOT NULL THEN
    RAISE EXCEPTION
      'Account "%" is soft-deleted (deleted_at = %). Refusing to promote.', v_email, v_deleted_at
      USING HINT = 'Restore the account in Supabase Dashboard -> Authentication -> Users, or have the user sign up again.';
  END IF;

  -- SAFETY: banned account. banned_until in the FUTURE means an active ban;
  -- a past timestamp is an expired ban and is fine.
  IF v_banned IS NOT NULL AND v_banned::timestamptz > now() THEN
    RAISE EXCEPTION
      'Account "%" is banned until %. Refusing to promote.', v_email, v_banned
      USING HINT = 'Lift the ban in Supabase Dashboard -> Authentication -> Users before promoting.';
  END IF;

  -- SAFETY: anonymous accounts have no durable credential and must never hold
  -- back-office access.
  IF v_anon = 'true' THEN
    RAISE EXCEPTION
      'Account "%" is an ANONYMOUS Supabase user. Refusing to promote.', v_email;
  END IF;

  -- WARNING, not a failure: unconfirmed email is normal in development, where
  -- confirmation is often disabled. The account still works.
  IF v_confirmed IS NULL THEN
    RAISE WARNING 'Email is NOT confirmed for "%". Promoting anyway (normal in development).', v_email;
  END IF;


  -- =========================================================================
  -- STEP 3 — locate the profile, and lock it
  -- =========================================================================
  -- Structurally there can be at most one row (profiles.id is the PRIMARY KEY
  -- and also the FK to auth.users). The count is still taken so that a schema
  -- change which broke that invariant surfaces here rather than as a silently
  -- wrong "one of N" promotion.
  SELECT count(*) INTO v_prof_count
    FROM public.profiles p WHERE p.id = v_user_id;

  IF v_prof_count = 0 THEN
    RAISE EXCEPTION
      'auth user % exists but has NO row in public.profiles.', v_user_id
      USING HINT = 'The on_auth_user_created trigger (0002) or the /auth/callback upsert should create it. Have the user log in once, then re-run. Every album/photo/order FKs to profiles, so this account is non-functional until the row exists.';
  END IF;

  IF v_prof_count > 1 THEN
    RAISE EXCEPTION
      'INVARIANT VIOLATED: % profile rows for user %. profiles.id is a PRIMARY KEY; this should be impossible.', v_prof_count, v_user_id;
  END IF;

  -- Row lock held to COMMIT. Serialises concurrent promote/demote runs against
  -- the same account, so the read below cannot be stale by the time we write.
  SELECT p.name, p.role
    INTO v_name, v_old_role
    FROM public.profiles p
   WHERE p.id = v_user_id
     FOR UPDATE;

  RAISE NOTICE ' [OK] Profile found   : % (role = %)', COALESCE(v_name, '(no name set)'), v_old_role;


  -- =========================================================================
  -- STEP 4 — promote the profile  (the ACCESS gate)
  -- =========================================================================
  -- profiles.role CHECK allows only ('user','admin') -- 0001.
  IF v_old_role = 'admin' THEN
    RAISE NOTICE ' [--] Profile already admin - no change needed';
  ELSE
    UPDATE public.profiles SET role = 'admin' WHERE id = v_user_id;
    RAISE NOTICE ' [OK] Profile promoted: % -> admin', v_old_role;
  END IF;


  -- =========================================================================
  -- STEP 5 — assign the back-office role  (the CAPABILITY scope)
  -- =========================================================================
  SELECT r.role INTO v_old_admin FROM public.admin_roles r WHERE r.user_id = v_user_id;

  -- Atomic upsert. user_id is the PRIMARY KEY (0034), so ON CONFLICT is both
  -- the idempotency mechanism AND the concurrency guard: two simultaneous runs
  -- cannot produce two rows, and the loser updates instead of erroring.
  --
  -- assigned_by is left NULL. This script runs as postgres/service role with no
  -- JWT, so auth.uid() is NULL and inventing an actor would be dishonest. An
  -- EXISTING assigned_by is preserved on conflict rather than overwritten, so a
  -- re-run never erases who originally granted access.
  INSERT INTO public.admin_roles (user_id, role, assigned_by, assigned_at)
  VALUES (v_user_id, 'super_admin', NULL, now())
  ON CONFLICT (user_id) DO UPDATE
    SET role        = 'super_admin',
        assigned_at = now(),
        assigned_by = COALESCE(public.admin_roles.assigned_by, EXCLUDED.assigned_by);

  IF v_old_admin IS NULL THEN
    v_action := 'created';
    RAISE NOTICE ' [OK] Admin role created: super_admin';
  ELSIF v_old_admin = 'super_admin' THEN
    v_action := 'unchanged';
    RAISE NOTICE ' [--] Admin role already super_admin - refreshed timestamp only';
  ELSE
    v_action := 'upgraded';
    RAISE NOTICE ' [OK] Admin role upgraded: % -> super_admin', v_old_admin;
  END IF;


  -- =========================================================================
  -- STEP 6 — audit
  -- =========================================================================
  -- audit_log is the append-only record of consequential actions (0016).
  -- Granting back-office access qualifies. actor_type 'system' matches the
  -- webhook convention for an actor with no user context. Best-effort: an
  -- audit failure must never roll back a successful promotion.
  BEGIN
    INSERT INTO public.audit_log (actor_id, actor_type, action, entity_type, entity_id, metadata)
    VALUES (
      NULL, 'system', 'role.assigned', 'admin_role', v_user_id,
      jsonb_build_object(
        'script',            'drizzle/dev/promote_user_to_admin.sql',
        'email',             v_email,
        'profile_role_from', v_old_role,
        'profile_role_to',   'admin',
        'admin_role_from',   COALESCE(v_old_admin, '(none)'),
        'admin_role_to',     'super_admin',
        'admin_role_action', v_action,
        'executed_by',       current_user
      )
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Audit row could not be written (%). Promotion itself succeeded.', SQLERRM;
  END;


  RAISE NOTICE '-----------------------------------------------------------';
  RAISE NOTICE ' COMPLETED SUCCESSFULLY';
  RAISE NOTICE ' % is now a super_admin.', v_email;
  RAISE NOTICE '===========================================================';
  RAISE NOTICE '';
END $$;


-- ---------------------------------------------------------------------------
-- VERIFICATION — the result grid below is the confirmation
-- ---------------------------------------------------------------------------
-- Runs inside the same transaction, so it reflects the state that is about to
-- be committed. `status` must read 'FULLY PROMOTED'.
-- ---------------------------------------------------------------------------
SELECT
  u.email                                   AS "email",
  COALESCE(p.name, '(no name set)')         AS "name",
  p.role                                    AS "role",
  COALESCE(r.role, '(none)')                AS "admin_role",
  CASE
    WHEN p.role = 'admin' AND r.role = 'super_admin' THEN 'FULLY PROMOTED'
    WHEN p.role = 'admin' AND r.role IS NOT NULL     THEN 'ADMIN (scoped role: ' || r.role || ')'
    WHEN p.role = 'admin'                            THEN 'ADMIN (no admin_roles row -> treated as super_admin)'
    ELSE 'NOT AN ADMIN'
  END                                       AS "status",
  to_char(r.assigned_at, 'YYYY-MM-DD HH24:MI:SS TZ') AS "assigned_at",
  to_char(u.last_sign_in_at, 'YYYY-MM-DD HH24:MI:SS TZ') AS "last_sign_in",
  u.id                                      AS "user_id"
FROM auth.users u
LEFT JOIN public.profiles    p ON p.id      = u.id
LEFT JOIN public.admin_roles r ON r.user_id = u.id
WHERE lower(u.email) = lower(trim(current_setting('malnad.target_email', true)));

COMMIT;
-- ROLLBACK;   <-- swap for COMMIT to abandon the promotion after reviewing the grid


-- ============================================================================
-- NEXT STEPS
--   1. The user must SIGN OUT and SIGN IN AGAIN. getAdminContext() is request-
--      cached and the session carries the old state until re-authentication.
--   2. Confirm /admin loads and the nav shows every section (super_admin sees
--      all of them; scoped roles see a filtered set).
--   3. Audit trail:
--        SELECT * FROM public.audit_log
--         WHERE action = 'role.assigned' ORDER BY created_at DESC LIMIT 5;
--
-- TO REVERSE:  drizzle/dev/demote_admin_to_user.sql
-- TO REVIEW :  drizzle/dev/list_all_admins.sql
-- ============================================================================
