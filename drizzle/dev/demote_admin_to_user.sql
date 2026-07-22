-- ============================================================================
-- MALNAD STORIES — DEMOTE ADMINISTRATOR TO REGULAR USER
-- ============================================================================
-- Location : drizzle/dev/demote_admin_to_user.sql
-- Docs     : drizzle/dev/promote_user_to_admin_README.md
-- Family   : promote_user_to_admin.sql / demote_admin_to_user.sql / list_all_admins.sql
--
-- THIS IS NOT A MIGRATION. Reusable operational utility.
--
-- WHAT IT DOES
--   The exact inverse of promote_user_to_admin.sql, in one atomic transaction:
--     1. public.admin_roles  -> row DELETED     (capability scope removed)
--     2. public.profiles.role -> 'user'         (access gate closed)
--
--   Order matters. admin_roles is removed FIRST so that no window exists in
--   which profiles.role = 'user' while an admin_roles row survives -- that
--   combination is exactly the RBAC drift that verify_clean_database.sql warns
--   about, and it is what causes an account to be silently PRESERVED by
--   development_reset.sql (whose preservation rule is a UNION of both sources).
--
-- WHAT IT DOES NOT DO
--   Deletes no data. Albums, orders, support tickets, audit history and the
--   account itself are untouched. This removes ACCESS, nothing else.
--
-- IDEMPOTENT. Running against an already-demoted account is a reported no-op.
--
-- PRIVILEGES: run as `postgres` or with the service role. See the promote
-- script's header for why a normal client cannot do this.
-- ============================================================================


BEGIN;

-- ############################################################################
--
--   ██  CHANGE ONLY THIS LINE  ██
--
-- ############################################################################

SET LOCAL malnad.target_email = 'someone@example.com';

-- ############################################################################
--   Everything below is automatic. Do not edit.
-- ############################################################################


DO $$
DECLARE
  v_email        text;
  v_user         jsonb;
  v_user_count   int;
  v_user_id      uuid;
  v_prof_count   int;
  v_name         text;
  v_old_role     text;
  v_old_admin    text;
  v_total_admins int;
  v_remaining    int;
  v_others       text;
BEGIN
  -- =========================================================================
  -- STEP 0 — read and normalise the target
  -- =========================================================================
  v_email := lower(trim(COALESCE(current_setting('malnad.target_email', true), '')));

  IF v_email = '' THEN
    RAISE EXCEPTION 'No target email set. Edit the SET LOCAL line at the top of this script.';
  END IF;

  IF position('@' IN v_email) = 0 THEN
    RAISE EXCEPTION 'Target "%" does not look like an email address.', v_email;
  END IF;

  RAISE NOTICE '';
  RAISE NOTICE '===========================================================';
  RAISE NOTICE ' Malnad Stories - demote administrator to user';
  RAISE NOTICE '===========================================================';
  RAISE NOTICE ' Target email : %', v_email;
  RAISE NOTICE ' Database     : %', current_database();
  RAISE NOTICE ' Executed by  : %', current_user;
  RAISE NOTICE '-----------------------------------------------------------';


  -- =========================================================================
  -- STEP 1 — locate the auth user
  -- =========================================================================
  SELECT count(*) INTO v_user_count FROM auth.users u WHERE lower(u.email) = v_email;

  IF v_user_count = 0 THEN
    RAISE EXCEPTION 'No account found in auth.users for "%".', v_email;
  END IF;

  IF v_user_count > 1 THEN
    RAISE EXCEPTION
      'Ambiguous: % accounts in auth.users share the email "%".', v_user_count, v_email
      USING HINT = 'Resolve by id manually. Demoting the wrong row would leave a live admin in place.';
  END IF;

  SELECT to_jsonb(u) INTO v_user FROM auth.users u WHERE lower(u.email) = v_email;
  v_user_id := (v_user->>'id')::uuid;

  RAISE NOTICE ' [OK] User found      : %', v_user_id;

  -- A soft-deleted or banned account is NOT a blocker here. Removing access
  -- from a disabled account is always safe, and refusing would leave stale
  -- privileges attached to an account nobody is watching.


  -- =========================================================================
  -- STEP 2 — locate the profile, and lock it
  -- =========================================================================
  SELECT count(*) INTO v_prof_count FROM public.profiles p WHERE p.id = v_user_id;

  IF v_prof_count = 0 THEN
    RAISE EXCEPTION 'auth user % has no row in public.profiles - nothing to demote.', v_user_id;
  END IF;

  IF v_prof_count > 1 THEN
    RAISE EXCEPTION
      'INVARIANT VIOLATED: % profile rows for user %. profiles.id is a PRIMARY KEY.', v_prof_count, v_user_id;
  END IF;

  SELECT p.name, p.role INTO v_name, v_old_role
    FROM public.profiles p WHERE p.id = v_user_id FOR UPDATE;

  SELECT r.role INTO v_old_admin FROM public.admin_roles r WHERE r.user_id = v_user_id;

  RAISE NOTICE ' [OK] Profile found   : % (role = %, admin_role = %)',
    COALESCE(v_name, '(no name set)'), v_old_role, COALESCE(v_old_admin, '(none)');


  -- =========================================================================
  -- STEP 3 — idempotency: already fully demoted?
  -- =========================================================================
  IF v_old_role <> 'admin' AND v_old_admin IS NULL THEN
    RAISE NOTICE ' [--] Account is already a regular user - nothing to do';
    RAISE NOTICE '-----------------------------------------------------------';
    RAISE NOTICE ' COMPLETED (no change)';
    RAISE NOTICE '===========================================================';
    RETURN;
  END IF;


  -- =========================================================================
  -- STEP 4 — LAST-ADMIN GUARD
  -- =========================================================================
  -- The single most important check in this file. Demoting the final
  -- administrator locks EVERYONE out of /admin, and there is no in-app path
  -- back: profiles.role is removed from the authenticated column grant (0019),
  -- so no logged-in user can restore it. Recovery would require direct database
  -- access. Refuse.
  --
  -- "Administrator" is counted the same way development_reset.sql defines it --
  -- the UNION of profiles.role = 'admin' AND admin_roles membership -- so the
  -- two utilities cannot disagree about who counts.
  SELECT count(*) INTO v_total_admins FROM (
    SELECT id      FROM public.profiles WHERE role = 'admin'
    UNION
    SELECT user_id FROM public.admin_roles
  ) a;

  SELECT count(*) INTO v_remaining FROM (
    SELECT id      FROM public.profiles WHERE role = 'admin'
    UNION
    SELECT user_id FROM public.admin_roles
  ) a WHERE a.id <> v_user_id;

  RAISE NOTICE '      Admins total    : % (% would remain)', v_total_admins, v_remaining;

  IF v_remaining = 0 THEN
    RAISE EXCEPTION
      'REFUSING: "%" is the LAST administrator. Demoting would lock everyone out of /admin with no in-app recovery path.', v_email
      USING HINT = 'Promote a replacement first:  drizzle/dev/promote_user_to_admin.sql';
  END IF;

  -- Advisory, not blocking: dropping to a single admin is a real bus-factor
  -- risk in a shared environment, but a legitimate state in solo development.
  IF v_remaining = 1 THEN
    SELECT string_agg(COALESCE(p.name, u.email), ', ')
      INTO v_others
      FROM public.profiles p
      JOIN auth.users u ON u.id = p.id
     WHERE p.role = 'admin' AND p.id <> v_user_id;
    RAISE WARNING 'Only ONE administrator will remain after this: %', COALESCE(v_others, '(unnamed)');
  END IF;


  -- =========================================================================
  -- STEP 5 — remove the back-office role FIRST
  -- =========================================================================
  -- Ordering is deliberate (see the header): clearing admin_roles before
  -- profiles.role means the account never passes through the
  -- role='user' + admin_roles-present state that reads as RBAC drift and that
  -- development_reset.sql would treat as "preserve this account".
  IF v_old_admin IS NOT NULL THEN
    DELETE FROM public.admin_roles WHERE user_id = v_user_id;
    RAISE NOTICE ' [OK] Admin role removed: % -> (none)', v_old_admin;
  ELSE
    RAISE NOTICE ' [--] No admin_roles row to remove';
  END IF;


  -- =========================================================================
  -- STEP 6 — close the access gate
  -- =========================================================================
  IF v_old_role = 'admin' THEN
    UPDATE public.profiles SET role = 'user' WHERE id = v_user_id;
    RAISE NOTICE ' [OK] Profile demoted : admin -> user';
  ELSE
    RAISE NOTICE ' [--] Profile was already role = %', v_old_role;
  END IF;


  -- =========================================================================
  -- STEP 7 — audit
  -- =========================================================================
  BEGIN
    INSERT INTO public.audit_log (actor_id, actor_type, action, entity_type, entity_id, metadata)
    VALUES (
      NULL, 'system', 'role.revoked', 'admin_role', v_user_id,
      jsonb_build_object(
        'script',            'drizzle/dev/demote_admin_to_user.sql',
        'email',             v_email,
        'profile_role_from', v_old_role,
        'profile_role_to',   'user',
        'admin_role_from',   COALESCE(v_old_admin, '(none)'),
        'admin_role_to',     '(none)',
        'admins_remaining',  v_remaining,
        'executed_by',       current_user
      )
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Audit row could not be written (%). Demotion itself succeeded.', SQLERRM;
  END;


  RAISE NOTICE '-----------------------------------------------------------';
  RAISE NOTICE ' COMPLETED SUCCESSFULLY';
  RAISE NOTICE ' % is now a regular user. % administrator(s) remain.', v_email, v_remaining;
  RAISE NOTICE '===========================================================';
  RAISE NOTICE '';
END $$;


-- ---------------------------------------------------------------------------
-- VERIFICATION
-- ---------------------------------------------------------------------------
SELECT
  u.email                            AS "email",
  COALESCE(p.name, '(no name set)')  AS "name",
  p.role                             AS "role",
  COALESCE(r.role, '(none)')         AS "admin_role",
  CASE
    WHEN p.role <> 'admin' AND r.role IS NULL THEN 'DEMOTED - regular user'
    WHEN p.role =  'admin' AND r.role IS NULL THEN 'STILL ADMIN (profiles.role not cleared)'
    WHEN p.role <> 'admin' AND r.role IS NOT NULL THEN 'RBAC DRIFT (admin_roles row survives)'
    ELSE 'STILL FULLY ADMIN'
  END                                AS "status",
  (SELECT count(*) FROM (
     SELECT id FROM public.profiles WHERE role = 'admin'
     UNION
     SELECT user_id FROM public.admin_roles
   ) a)                              AS "admins_remaining"
FROM auth.users u
LEFT JOIN public.profiles    p ON p.id      = u.id
LEFT JOIN public.admin_roles r ON r.user_id = u.id
WHERE lower(u.email) = lower(trim(current_setting('malnad.target_email', true)));

COMMIT;
-- ROLLBACK;   <-- swap for COMMIT to abandon the demotion after reviewing the grid


-- ============================================================================
-- NOTES
--   • The demoted user keeps their account and all their data. Only access
--     changes. Their existing session may still render /admin until they sign
--     out -- but every server action independently calls requireCapability(),
--     so nothing privileged actually executes.
--   • To reverse:  drizzle/dev/promote_user_to_admin.sql
--   • To review :  drizzle/dev/list_all_admins.sql
-- ============================================================================
