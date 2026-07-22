-- ============================================================================
-- MALNAD STORIES — LIST ALL ADMINISTRATORS
-- ============================================================================
-- Location : drizzle/dev/list_all_admins.sql
-- Docs     : drizzle/dev/promote_user_to_admin_README.md
-- Family   : promote_user_to_admin.sql / demote_admin_to_user.sql / list_all_admins.sql
--
-- THIS IS NOT A MIGRATION. Reusable operational utility.
--
-- 100% READ-ONLY. No parameters, nothing to edit. Paste and run.
-- Safe in ANY environment including production.
--
-- WHAT IT SHOWS
--   Every account with back-office access, from BOTH sources of truth, plus
--   the disagreements between them:
--
--     public.profiles.role = 'admin'   the ACCESS gate      (0019, column-locked)
--     public.admin_roles               the CAPABILITY scope (0034)
--
--   Per 0034, getAdminContext() gates on profiles.role FIRST and only then
--   resolves the back-office role. The two can drift in both directions, and
--   the consequences are NOT symmetric:
--
--     role='admin' + NO admin_roles row  -> FULL ACCESS. An absent row is
--                                           treated as super_admin (deliberate
--                                           migration safety in 0034). This is
--                                           the state every admin was in before
--                                           roles were assigned.
--     role<>'admin' + admin_roles row    -> NO ACCESS. Harmless in itself, but
--                                           development_reset.sql PRESERVES such
--                                           accounts (its preservation rule is a
--                                           UNION), so a stale row silently
--                                           survives a full environment wipe.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- SUMMARY  (emitted as notices; the grid below is the roster)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_total    int;
  v_full     int;
  v_implicit int;
  v_orphan   int;
  v_never    int;
  r          record;
BEGIN
  SELECT count(*) INTO v_total FROM (
    SELECT id FROM public.profiles WHERE role = 'admin'
    UNION
    SELECT user_id FROM public.admin_roles
  ) a;

  SELECT count(*) INTO v_full
    FROM public.profiles p JOIN public.admin_roles r ON r.user_id = p.id
   WHERE p.role = 'admin';

  SELECT count(*) INTO v_implicit
    FROM public.profiles p LEFT JOIN public.admin_roles r ON r.user_id = p.id
   WHERE p.role = 'admin' AND r.user_id IS NULL;

  SELECT count(*) INTO v_orphan
    FROM public.admin_roles r JOIN public.profiles p ON p.id = r.user_id
   WHERE p.role <> 'admin';

  SELECT count(*) INTO v_never
    FROM public.profiles p JOIN auth.users u ON u.id = p.id
   WHERE p.role = 'admin' AND u.last_sign_in_at IS NULL;

  RAISE NOTICE '';
  RAISE NOTICE '===========================================================';
  RAISE NOTICE ' Malnad Stories - administrator roster';
  RAISE NOTICE ' Database: %   ·   %', current_database(), now()::timestamp(0);
  RAISE NOTICE '===========================================================';
  RAISE NOTICE ' Accounts with back-office access : %', v_total;
  RAISE NOTICE '   fully configured (role + scope): %', v_full;
  RAISE NOTICE '   implicit super_admin (no row)  : %', v_implicit;
  RAISE NOTICE '   stale admin_roles (NO access)  : %', v_orphan;
  RAISE NOTICE '   never signed in                : %', v_never;
  RAISE NOTICE '-----------------------------------------------------------';

  IF v_total = 0 THEN
    RAISE WARNING 'NO ADMINISTRATORS EXIST. /admin is unreachable by anyone.';
    RAISE WARNING 'Recover with drizzle/dev/promote_user_to_admin.sql (needs direct DB access).';
  ELSIF v_total = 1 THEN
    RAISE WARNING 'Only ONE administrator exists. Losing this account means losing /admin.';
  END IF;

  IF v_implicit > 0 THEN
    RAISE NOTICE ' NOTE: % account(s) have role=admin but no admin_roles row.', v_implicit;
    RAISE NOTICE '       They hold FULL super_admin access (0034 migration default).';
    RAISE NOTICE '       Assign an explicit role to scope them down.';
  END IF;

  IF v_orphan > 0 THEN
    RAISE WARNING '% account(s) hold an admin_roles row WITHOUT role=admin.', v_orphan;
    RAISE WARNING 'They have NO admin access, but development_reset.sql will PRESERVE them.';
  END IF;

  -- Role distribution.
  RAISE NOTICE '-----------------------------------------------------------';
  RAISE NOTICE ' Role distribution:';
  FOR r IN
    SELECT COALESCE(ar.role, 'implicit super_admin') AS role_name, count(*) AS n
      FROM public.profiles p
      LEFT JOIN public.admin_roles ar ON ar.user_id = p.id
     WHERE p.role = 'admin'
     GROUP BY 1 ORDER BY 2 DESC, 1
  LOOP
    RAISE NOTICE '   %  %', rpad(r.role_name, 24), r.n;
  END LOOP;
  RAISE NOTICE '===========================================================';
  RAISE NOTICE '';
END $$;


-- ---------------------------------------------------------------------------
-- ROSTER
-- ---------------------------------------------------------------------------
-- FULL OUTER JOIN between the two sources so an account appearing in EITHER is
-- listed. An inner join would hide exactly the drift this report exists to find.
-- ---------------------------------------------------------------------------
SELECT
  u.email                                    AS "email",
  COALESCE(p.name, '(no name set)')          AS "name",
  COALESCE(p.role, '(no profile)')           AS "role",
  COALESCE(ar.role, '(none)')                AS "admin_role",

  -- Effective access, resolved exactly as getAdminContext() would.
  CASE
    WHEN p.role = 'admin' AND ar.role IS NOT NULL THEN 'ACTIVE - ' || ar.role
    WHEN p.role = 'admin'                          THEN 'ACTIVE - super_admin (implicit)'
    WHEN ar.role IS NOT NULL                       THEN 'NO ACCESS - stale admin_roles row'
    ELSE 'NO ACCESS'
  END                                        AS "effective_access",

  -- Consistency between the two sources.
  CASE
    WHEN p.role = 'admin' AND ar.role IS NOT NULL THEN 'OK'
    WHEN p.role = 'admin' AND ar.role IS NULL     THEN 'IMPLICIT (no admin_roles row)'
    WHEN p.role IS NULL                            THEN 'BROKEN (no profile row)'
    ELSE 'DRIFT (admin_roles without role=admin)'
  END                                        AS "consistency",

  -- Account health, read defensively: to_jsonb lets us reference optional
  -- Supabase columns without assuming the project's auth schema version has them.
  CASE
    WHEN (to_jsonb(u)->>'deleted_at') IS NOT NULL                            THEN 'DELETED'
    WHEN (to_jsonb(u)->>'banned_until')::timestamptz > now()                 THEN 'BANNED'
    WHEN (to_jsonb(u)->>'email_confirmed_at') IS NULL                        THEN 'UNCONFIRMED'
    WHEN u.last_sign_in_at IS NULL                                           THEN 'NEVER SIGNED IN'
    ELSE 'OK'
  END                                        AS "account",

  to_char(u.last_sign_in_at, 'YYYY-MM-DD HH24:MI')  AS "last_sign_in",
  to_char(ar.assigned_at,    'YYYY-MM-DD HH24:MI')  AS "role_assigned",
  COALESCE(ab.name, CASE WHEN ar.user_id IS NOT NULL THEN '(system/script)' END) AS "assigned_by",
  to_char(p.created_at,      'YYYY-MM-DD')          AS "member_since",
  u.id                                       AS "user_id"

FROM      public.profiles    p
FULL JOIN public.admin_roles ar ON ar.user_id = p.id
LEFT JOIN auth.users         u  ON u.id  = COALESCE(p.id, ar.user_id)
LEFT JOIN public.profiles    ab ON ab.id = ar.assigned_by
WHERE p.role = 'admin' OR ar.user_id IS NOT NULL
ORDER BY
  -- Problems first: broken profiles, then drift, then implicit, then healthy.
  CASE
    WHEN p.role IS NULL                            THEN 0
    WHEN p.role <> 'admin' AND ar.role IS NOT NULL THEN 1
    WHEN p.role =  'admin' AND ar.role IS NULL     THEN 2
    ELSE 3
  END,
  u.email;


-- ============================================================================
-- CAPABILITY REFERENCE  (src/lib/auth/capabilities.ts)
--
--   super_admin  Everything, including role:manage (/admin/users).
--   production   Orders, albums, shipping, reviews, analytics, monitoring:view,
--                observability:view, security:view.
--   support      Support, refunds, reprints, customers, order:view, plus the
--                same *:view monitoring/observability/security capabilities.
--   content      CMS, templates, covers, stickers. NO monitoring, NO
--                observability, NO security, NO orders.
--
--   An account with role='admin' and NO admin_roles row resolves to
--   super_admin. That default is intentional (0034 migration safety) and
--   applies only AFTER the profiles.role gate, so it can never promote a
--   non-admin.
--
-- RELATED
--   drizzle/dev/promote_user_to_admin.sql   grant super_admin
--   drizzle/dev/demote_admin_to_user.sql    revoke all access
--   /admin/users                            in-app role assignment (super_admin only)
--
-- To change a role WITHOUT full promotion/demotion, prefer /admin/users -- it
-- is capability-gated, forbids self-edits, and audits via assignRole().
-- ============================================================================
