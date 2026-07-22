# Admin Utilities

Operational runbook for the admin-management scripts in `drizzle/dev/`.

| File | Writes? | Purpose |
|---|---|---|
| `promote_user_to_admin.sql` | ✏️ Yes | Grant full back-office access (`super_admin`) |
| `demote_admin_to_user.sql` | ✏️ Yes | Revoke all back-office access |
| `list_all_admins.sql` | 👁️ Read-only | Roster of every admin + drift detection |

> **None of these are migrations.** They are operational utilities. Migration numbers
> (`0001`–`0051`) are schema history applied forward to every environment including
> production. A utility that mutates *data* must never enter that sequence, or a
> deployment will eventually replay it. This is the same reasoning that puts
> `development_reset.sql` in `drizzle/dev/`.

---

## Purpose

Back-office access in this codebase is **two independent records**, and both are
required:

| Layer | Table | Role |
|---|---|---|
| **Access gate** | `public.profiles.role = 'admin'` | Decides *whether* you reach `/admin` at all |
| **Capability scope** | `public.admin_roles.role` | Decides *what* you can do once inside |

`getAdminContext()` (`src/lib/auth/require-admin.ts`) checks `profiles.role` **first**,
and only then resolves the back-office role from `admin_roles`. Two consequences that
drive every design decision in these scripts:

- **An `admin_roles` row alone grants nothing.** It fails the first gate.
- **`profiles.role = 'admin'` alone grants everything.** An absent `admin_roles` row is
  deliberately treated as `super_admin` (`0034` migration safety), so admins who
  predate RBAC keep working.

Neither table is writable from the application by an ordinary client — `0019` removes
`role` from the `authenticated` column grant on `profiles`, and `0034` puts
`RESTRICTIVE` deny policies on `admin_roles`. That is intentional anti-self-promotion
hardening, and it is why these utilities need direct database access.

---

## When to use

| Situation | Use |
|---|---|
| First admin in a fresh or reset environment | `promote_user_to_admin.sql` |
| Onboarding a teammate to the back office | `promote_user_to_admin.sql` |
| Locked out after `development_reset.sql` | `promote_user_to_admin.sql` |
| Removing access when someone leaves | `demote_admin_to_user.sql` |
| Cleaning up a test admin | `demote_admin_to_user.sql` |
| Auditing who has access | `list_all_admins.sql` |
| Fixing RBAC drift found by `verify_clean_database.sql` | `list_all_admins.sql`, then promote or demote |

### When *not* to use them

**Changing an existing admin's scope** (`super_admin` → `support`, etc.) belongs in
**`/admin/users`**, not here. That path is capability-gated (`role:manage`), forbids
self-edits, rejects non-admin targets, and audits through `assignRole()`. These scripts
are the bootstrap and break-glass tools — reach for the app first.

---

## How to change the email

Exactly one line per script, marked with a block banner:

```sql
-- ############################################################################
--
--   ██  CHANGE ONLY THIS LINE  ██
--
-- ############################################################################

SET LOCAL malnad.target_email = 'khannawaz2004@gmail.com';
```

`list_all_admins.sql` takes no parameters at all.

### Why `SET LOCAL` and not `\set`

**`\set` is a psql client meta-command. It does not work in the Supabase SQL Editor**,
pgAdmin, DBeaver, or any driver-based client — the server never sees it, and
`:target_email` arrives as a literal syntax error.

`SET LOCAL` with a namespaced custom GUC is real SQL and works everywhere. It is also
strictly better here:

- **Transaction-scoped.** Discarded at `COMMIT` or `ROLLBACK`, so the value can never
  leak into a later query on a pooled connection.
- **Visible to every statement in the transaction**, including the verification `SELECT`
  after the `DO` block — which is precisely why a `DECLARE`d variable inside the block
  would not have been enough.
- **Survives connection pooling**, because everything happens inside one transaction.

---

## How to execute in the Supabase SQL Editor

1. **Supabase Dashboard → SQL Editor → New query**
2. Paste the **entire** script — all statements, `BEGIN` through `COMMIT`.
3. Edit the one `SET LOCAL` line.
4. **Run** (`Ctrl`/`Cmd` + `Enter`).
5. Read **Results** for the verification grid and **Messages/Logs** for the notices.

> **Paste the whole file.** Running the `DO` block alone leaves the transaction open
> and the verification `SELECT` cannot see the GUC. If you only ever select part of a
> script, you will get `unrecognized configuration parameter`.

The SQL Editor runs as `postgres`, which satisfies the privilege requirement. A
service-role connection also works. `anon` and `authenticated` cannot, by design.

---

## Expected output

### `promote_user_to_admin.sql` — first run

```
NOTICE:  ===========================================================
NOTICE:   Malnad Stories - promote user to administrator
NOTICE:  ===========================================================
NOTICE:   Target email : khannawaz2004@gmail.com
NOTICE:   Database     : postgres
NOTICE:   Executed by  : postgres
NOTICE:  -----------------------------------------------------------
NOTICE:   [OK] User found      : 3f9c1a2e-...-8d41
NOTICE:        Created         : 2026-07-14 09:22:11+00
NOTICE:        Last sign-in    : 2026-07-21 18:04:52+00
NOTICE:   [OK] Profile found   : Nawaz Khan (role = user)
NOTICE:   [OK] Profile promoted: user -> admin
NOTICE:   [OK] Admin role created: super_admin
NOTICE:  -----------------------------------------------------------
NOTICE:   COMPLETED SUCCESSFULLY
NOTICE:   khannawaz2004@gmail.com is now a super_admin.
NOTICE:  ===========================================================
```

| email | name | role | admin_role | status |
|---|---|---|---|---|
| khannawaz2004@gmail.com | Nawaz Khan | admin | super_admin | FULLY PROMOTED |

### Second run — idempotency

```
NOTICE:   [--] Profile already admin - no change needed
NOTICE:   [--] Admin role already super_admin - refreshed timestamp only
NOTICE:   COMPLETED SUCCESSFULLY
```

Same grid. No duplicate rows — `admin_roles.user_id` is the **PRIMARY KEY**, so a
second row is structurally impossible.

### Failure modes

| Message | Meaning | Fix |
|---|---|---|
| `No account found in auth.users` | Email never signed up | The user signs up first — this promotes existing accounts, never creates them |
| `Ambiguous: N accounts share the email` | Duplicate rows in `auth.users` | Inspect by id (hint is printed) and promote manually |
| `has NO row in public.profiles` | Auth user exists, profile missing | Have the user log in once so the `0002` trigger fires |
| `Account is soft-deleted` | `deleted_at` is set | Restore in Dashboard → Authentication → Users |
| `Account is banned until …` | Active ban | Lift the ban first |
| `is an ANONYMOUS Supabase user` | No durable credential | Never promotable |
| `WARNING: Email is NOT confirmed` | Not a failure | Normal in dev; promotion proceeds |

---

## Verification query

Both write scripts print their own grid. To check any account at any time:

```sql
SELECT
  u.email,
  COALESCE(p.name, '(no name set)')  AS name,
  p.role,
  COALESCE(r.role, '(none)')         AS admin_role,
  CASE
    WHEN p.role = 'admin' AND r.role IS NOT NULL THEN 'ACTIVE - ' || r.role
    WHEN p.role = 'admin'                        THEN 'ACTIVE - super_admin (implicit)'
    WHEN r.role IS NOT NULL                      THEN 'NO ACCESS - stale admin_roles row'
    ELSE 'NO ACCESS'
  END AS effective_access
FROM auth.users u
LEFT JOIN public.profiles    p ON p.id      = u.id
LEFT JOIN public.admin_roles r ON r.user_id = u.id
WHERE lower(u.email) = lower('khannawaz2004@gmail.com');
```

For the full roster plus drift detection, run **`list_all_admins.sql`** — no editing
required.

Audit trail:

```sql
SELECT created_at, action, entity_id, metadata
FROM public.audit_log
WHERE action IN ('role.assigned', 'role.revoked')
ORDER BY created_at DESC
LIMIT 20;
```

---

## Rollback instructions

### Before you commit

Both write scripts end with `COMMIT;` and a commented `ROLLBACK;`. The verification grid
renders **inside** the transaction, so you can inspect the outcome and then swap
`COMMIT` for `ROLLBACK` to abandon it entirely.

### After you commit

Run **`demote_admin_to_user.sql`** with the same email. It is the exact inverse and
refuses to demote the last remaining administrator.

### Manual rollback

```sql
BEGIN;

-- Order matters: clear admin_roles FIRST so the account never passes through
-- role='user' + admin_roles-present, which reads as RBAC drift and causes
-- development_reset.sql to preserve the account.
DELETE FROM public.admin_roles
 WHERE user_id = (SELECT id FROM auth.users WHERE lower(email) = lower('someone@example.com'));

UPDATE public.profiles SET role = 'user'
 WHERE id = (SELECT id FROM auth.users WHERE lower(email) = lower('someone@example.com'));

-- Confirm at least one admin remains BEFORE committing.
SELECT count(*) AS admins_remaining FROM (
  SELECT id FROM public.profiles WHERE role = 'admin'
  UNION
  SELECT user_id FROM public.admin_roles
) a;

COMMIT;
```

### 🔴 If you lock yourself out

Removing the last admin is unrecoverable from inside the app — `0019` prevents any
logged-in user from restoring `profiles.role`. Recovery **requires** direct database
access (SQL Editor or `psql` with `DIRECT_URL`):

```sql
UPDATE public.profiles SET role = 'admin'
 WHERE id = (SELECT id FROM auth.users WHERE lower(email) = lower('you@example.com'));

INSERT INTO public.admin_roles (user_id, role)
VALUES ((SELECT id FROM auth.users WHERE lower(email) = lower('you@example.com')), 'super_admin')
ON CONFLICT (user_id) DO UPDATE SET role = 'super_admin';
```

`demote_admin_to_user.sql` refuses to create this situation. Do not bypass that guard.

---

## Understanding RBAC drift

`list_all_admins.sql` and `verify_clean_database.sql` both report drift. The two
directions are **not** symmetric:

| State | Access | Why it matters |
|---|---|---|
| `role='admin'` + **no** `admin_roles` row | ✅ **Full** `super_admin` | Intentional `0034` default. Every pre-RBAC admin is in this state. Assign an explicit role to scope them down. |
| `role<>'admin'` + `admin_roles` row | ❌ **None** | Harmless for access — but `development_reset.sql` **preserves** such accounts, because its preservation rule is a UNION of both sources. A stale row silently survives a full environment wipe. |

The UNION is deliberate: an admin whose `profiles.role` was corrupted must not be
deleted, since lockout is worse than one extra surviving account. The reset script
raises a `WARNING` naming any drifted account before it deletes anything.

**To resolve drift**, pick a direction:

```sql
-- Make it a real admin
UPDATE public.profiles SET role = 'admin' WHERE id = '<uuid>';

-- Or remove the stale row
DELETE FROM public.admin_roles WHERE user_id = '<uuid>';
```

---

## After promoting

1. **The user must sign out and sign in again.** `getAdminContext()` is request-cached
   and the existing session carries the old state.
2. Confirm `/admin` loads and the nav shows every section. `super_admin` sees all;
   scoped roles see a filtered allow-list (`navHrefsForRole`).
3. Nav filtering is **never** the security boundary — every admin action independently
   calls `requireCapability()`. A stale session renders menus it cannot actually use.

---

## Capability reference

From `src/lib/auth/capabilities.ts`:

| Role | Scope |
|---|---|
| `super_admin` | Everything, including `role:manage` (`/admin/users`) |
| `production` | Orders, albums, shipping, reviews, analytics + `monitoring:view`, `observability:view`, `security:view` |
| `support` | Support, refunds, reprints, customers, `order:view` + the same `*:view` capabilities |
| `content` | CMS, templates, covers, stickers. **No** monitoring, observability, security, or orders |

Roles are **fixed** — there are no custom roles, and capabilities are never checked by
role string. `roleHasCapability()` is the only predicate.

The promote script always grants `super_admin`, because its job is bootstrapping and
break-glass access. Scope down afterwards in `/admin/users`.
