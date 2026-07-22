# Development Environment Reset

Operational runbook for the `drizzle/dev/` reset toolkit.

| File | Purpose |
|---|---|
| `development_reset.sql` | **Destructive.** The reset itself, in 3 parts. |
| `verify_clean_database.sql` | **Read-only.** Confirms the reset succeeded. PASS/FAIL report. |
| `DEVELOPMENT_RESET_README.md` | This runbook. |

---

## Overview

This script returns a **development** database to a clean pre-launch state ahead of
the **Worker V2** redesign. After it runs, the environment contains **only
administrator accounts and application configuration**. Every album, photo, order,
customer account and piece of operational history is gone.

### Why this lives in `drizzle/dev/`, not `drizzle/0052_*.sql`

**A reset is not a migration.** Numbered migrations (`0001`–`0051`) are schema history
that is applied forward, in order, to every environment including production. A reset
script is a destructive operational utility that must **never** be picked up by a
migration runner or executed during a deploy.

Keeping it in `drizzle/dev/` — alongside the existing `drizzle/scripts/` convention —
makes the distinction structural rather than a matter of remembering. If you take one
rule from this document: **never renumber this file into the migration sequence.**

### Scope

| | |
|---|---|
| **Target** | Development / staging Supabase projects only |
| **Production project id** | `erpniqgzolikgokklmkc` — **never run against this** |
| **Required role** | `postgres` (BYPASSRLS) |
| **Where to run** | Supabase Dashboard → SQL Editor |
| **Reversible?** | **No.** Recovery requires a restore. See [Recovery](#recovery). |
| **Parts** | 3 — run Part 1, then Part 2 separately, Part 3 is documentation only |

---

## What Is Deleted

### Album content — all of it, no exceptions

| Table | Notes |
|---|---|
| `albums` | Customer, demo, preview and admin test albums alike |
| `album_pages` | |
| `photos` | Deleted explicitly — `album_id` is `SET NULL`, **not** cascade |
| `album_pdfs` | All generated PDF state and print tokens |

> **Demo albums are no longer preserved.** This is a change from the previous
> revision of this script. `album_products.demo_album_id` is explicitly set to `NULL`
> for every product. Worker V2 will generate replacement demo albums.

### Commerce

`orders` · `payments` · `order_notes` · `coupon_redemptions` · `addresses` ·
`email_log` · `webhook_events`

Coupon **definitions** survive; **redemptions** do not, so every coupon's consumed
count resets to zero.

`webhook_events` must be cleared — `process_razorpay_event()` dedupes on
`X-Razorpay-Event-Id`, so a stale marker makes replayed test webhooks silent no-ops.

### Customer relations

`support_tickets` · `support_messages` · `refund_requests` · `reprint_requests` ·
`album_reviews` · `revision_requests` · `shipments` · `shipment_events`

### Accounts

**Every non-administrator account**, in both `auth.users` and `public.profiles`.
Deletion is driven from `auth.users`; `profiles.id → auth.users ON DELETE CASCADE`
removes the profile automatically.

### Observability

`audit_log` · `error_events` · `system_alerts` · `health_checks`

Clearing these is functional, not cosmetic. `error_events` dedupes on a partial
`UNIQUE (fingerprint) WHERE NOT resolved`, and `system_alerts` on
`(dedupe_key) WHERE NOT resolved`. A stale unresolved row makes a **new** occurrence
increment a counter instead of surfacing as a fresh event — meaning Worker V2's first
real failure could be invisible.

### Queue

`pgboss.job` (all partitions) · `pgboss.archive`

---

## What Is Preserved

### Product catalog and dimensions

| Table | Contents |
|---|---|
| `album_products` | Standard / Premium / Signature + all physical dimensions |
| `album_product_prices` | Price per (product, page count) |
| `album_product_previews` | Gallery image references |
| `products` | **Legacy** page-count table — still read as a pricing fallback per `0047`. Preserved deliberately. |

### Design assets

| Table | Contents |
|---|---|
| `layout_templates` | **Both** single-spread presets (`blueprint IS NULL`) and whole-album blueprints (`blueprint IS NOT NULL`) |
| `cover_templates` | Cover artwork catalog |
| `cover_design_templates` | Cover design presets |
| `stickers` | Sticker catalog |
| `sticker_categories` | |

### Content and access

| Table | Contents |
|---|---|
| `content_pages` | Full CMS — blog, FAQ, testimonials, legacy stories, homepage sections, announcements |
| `coupons` | Definitions only (redemptions cleared) |
| `admin_roles` | RBAC assignments (`0034`) |
| `profiles` | **Administrators only** |
| `auth.users` | **Administrators only** |

### Queue configuration

`pgboss.queue` · `pgboss.version` · `pgboss.schedule` · `pgboss.subscription`

### A note on "Settings"

There is **no settings table**. `/admin/settings` is a read-only view over
environment variables and source constants (`SHIPPING_TIERS` in `src/lib/shipping.ts`,
company/payment metadata inline in the page). Nothing to preserve, nothing to verify
beyond the page rendering.

---

## Pre-Run Checklist

Complete **every** item. The script's Section 0 guard exists to stop you if you have not.

- [ ] **✓ Create Git tag `worker-v1-final`**
  ```bash
  git tag -a worker-v1-final -m "Final state of Worker V1 before V2 redesign"
  git push origin worker-v1-final
  ```
  This is your only reference point for the V1 worker implementation once the redesign
  begins. Push it — a local-only tag is not a backup.

- [ ] **✓ Backup the database**
  Supabase Dashboard → Database → Backups → confirm a recent backup exists, or take a
  manual dump:
  ```bash
  pg_dump "$DIRECT_URL" --no-owner --no-acl -f backup_pre_worker_v2.sql
  ```
  Verify the file is non-empty and the dump exited 0 **before** continuing.

- [ ] **✓ Backup R2**
  Mirror the bucket locally or to a second bucket. See
  [R2 Cleanup](#r2-cleanup-instructions).
  ```bash
  rclone sync r2:<bucket> ./r2_backup_pre_worker_v2 --progress
  ```

- [ ] **✓ Stop the worker**
  Render Dashboard → worker service → **Suspend**. Do not merely scale to zero if the
  service can auto-wake — an inbound `/health` probe from the app will restart it.

- [ ] **✓ Verify you are NOT connected to production**
  Check the project name in the Supabase Dashboard header. Then confirm in SQL:
  ```sql
  SELECT current_database(), inet_server_addr(), version();
  ```

- [ ] **✓ Verify the Supabase project id**
  The project ref appears in your dashboard URL: `https://supabase.com/dashboard/project/<ref>`.
  **If `<ref>` is `erpniqgzolikgokklmkc`, STOP — that is production.**

- [ ] **✓ Verify the worker is actually stopped**
  ```bash
  curl -sS -m 5 "$WORKER_URL/health" ; echo "exit=$?"
  ```
  You want a connection failure or timeout. A `200 {"status":"ok"}` means it is still
  running and will re-enqueue jobs mid-reset.

- [ ] **✓ Confirm at least one admin exists**
  ```sql
  SELECT p.id, p.name, p.role, r.role AS back_office_role
  FROM public.profiles p
  LEFT JOIN public.admin_roles r ON r.user_id = p.id
  WHERE p.role = 'admin';
  ```
  The script aborts if this returns zero rows, but check first — discovering it after
  a failed transaction wastes a cycle.

---

## Execution Order

Follow exactly. Steps 4 → 8 are the window in which the system is inconsistent.

| # | Step | Where |
|---|---|---|
| 1 | Create Git tag `worker-v1-final` | Local + remote |
| 2 | Backup database | Supabase / `pg_dump` |
| 3 | Backup R2 | `rclone` / Cloudflare |
| 4 | **Stop the worker** | Render Dashboard |
| 5 | **Run SQL reset — Part 1** | Supabase SQL Editor |
| 6 | **Clear pgBoss — Part 2** | Supabase SQL Editor |
| 7 | **Delete R2 user folders** | Cloudflare / `rclone` |
| 8 | **Run `verify_clean_database.sql`** | Supabase SQL Editor |
| 9 | **Restart the worker** | Render Dashboard |
| 10 | Verify configuration | Admin console |
| 11 | Begin Worker V2 development | — |

> **Step 8 runs before step 9 deliberately.** Verifying against a stopped worker
> gives a stable snapshot. If you restart first, the boot-time `sweepPending` and
> `sweepPdfs` passes may enqueue jobs and repopulate `pgboss.job` between the reset
> and the check, producing a confusing `E. QUEUE` failure.
>
> The trade-off: `pgboss.queue` rows are only recreated when the worker boots and
> calls `createQueue()`. If the nuclear `DROP SCHEMA pgboss CASCADE` was used, the
> queue checks will report `WARN` at step 8. That is expected — re-run the
> verification after step 9 and they should turn `PASS`.

### Ordering constraints that matter

**Stop the worker before step 5.** A running worker's sweeps re-enqueue jobs against
rows the reset is deleting. `sweepPending` runs every 60s and `sweepPdfs` alongside it.

**Database before R2 (steps 5–6 before 7).** The database is the index of what exists
in R2. Delete the objects first and you have no way to enumerate what remains.

**R2 before restarting the worker (step 7 before 8).** A worker booting against a
half-cleaned bucket will attempt to process objects whose rows are gone.

---

## Post-Run Checklist

- [ ] **✓ Run the automated verification — do this first**
  ```
  Supabase SQL Editor -> paste drizzle/dev/verify_clean_database.sql -> Run
  ```
  Read row 1 of the result grid. **Every check must be `PASS`** before you continue.
  A single `FAIL` means the reset did not fully succeed — stop and investigate rather
  than starting Worker V2 on a dirty database.

  The script is 100% read-only and safe to re-run at any point. It covers: all 23
  transactional tables, `auth.users` ↔ `profiles` synchronisation in both directions,
  every configuration table, referential integrity and orphan detection, pgBoss queue
  state, and schema sanity (RLS, triggers, RPCs, sequences). See
  [Verification](#verification) for what each category means.

  The manual checks below overlap it deliberately — they confirm the *application*
  renders correctly, which SQL cannot tell you.

- [ ] **✓ Verify remaining admin users**
  ```sql
  SELECT p.id, p.name, p.role, r.role AS back_office_role, u.email
  FROM public.profiles p
  LEFT JOIN public.admin_roles r ON r.user_id = p.id
  LEFT JOIN auth.users u ON u.id = p.id
  ORDER BY p.name;
  ```
  Every row must be an administrator. Row count must equal `auth.users` count.
  **Log in as an admin now** — confirm you are not locked out before proceeding.

- [ ] **✓ Verify products** — `/admin/dimensions`
  All three products present with correct cm dimensions, aspect ratios, prices for
  24/36/48, and exactly one default.
  ```sql
  SELECT name, slug, width_cm, height_cm, print_width_cm, print_height_cm,
         builder_aspect_ratio, is_default, is_active, demo_album_id
  FROM public.album_products ORDER BY display_order;
  ```
  `demo_album_id` must be `NULL` on every row — Worker V2 will repopulate.

- [ ] **✓ Verify templates** — `/admin/templates`
  Both catalogs intact:
  ```sql
  SELECT
    count(*) FILTER (WHERE blueprint IS NULL)     AS presets,
    count(*) FILTER (WHERE blueprint IS NOT NULL) AS blueprints,
    count(*) FILTER (WHERE status = 'active')     AS active
  FROM public.layout_templates;
  ```

- [ ] **✓ Verify stickers** — `/admin/stickers`
  Catalog renders, thumbnails load, categories intact.
  ```sql
  SELECT count(*) AS stickers,
         (SELECT count(*) FROM public.sticker_categories) AS categories
  FROM public.stickers;
  ```

- [ ] **✓ Verify CMS** — `/admin/cms/content`, plus public `/faq`, `/testimonials`, `/stories`
  Public pages are ISR-cached (`revalidate = 300`) and tagged `cms-public`; allow up
  to 5 minutes or trigger a publish to bust the tag.

- [ ] **✓ Verify dimensions** — covered by the products check above, plus confirm
  `/admin/covers` and `/admin/cover-templates` render artwork.

- [ ] **✓ Verify R2 cleaned**
  ```bash
  rclone lsd r2:<bucket>
  ```
  Expect only `album-products/`, `cover-templates/`, `stickers/`, `blueprints/`.
  **No bare-UUID top-level folders.**

- [ ] **✓ Restart the worker** — Render Dashboard → **Resume**. Then confirm boot:
  ```
  [worker] health server listening on :<PORT> (GET /health)
  [worker] image-hardening + album-pdf + r2-cleanup + cover-thumbnail + blueprint-thumbnail workers started
  ```
  Both sweeps should report nothing to do. `curl "$WORKER_URL/health"` → `200`.

- [ ] **✓ Create the first test user** — sign up through the normal flow. Confirm the
  `profiles` row is created (the `on_auth_user_created` trigger plus the
  `auth/callback` upsert are both in play).

- [ ] **✓ Create the first test album** — pick a product, upload 2–3 photos, and
  confirm end to end:
  - photos reach `status='ready'` (not stuck `pending`)
  - `sanitized_key` and `thumb_key` are populated
  - thumbnails render in the tray
  - a layout saves and reloads
  ```sql
  SELECT id, status, sanitized_key IS NOT NULL AS has_full,
         thumb_key IS NOT NULL AS has_thumb, width, height, taken_at
  FROM public.photos ORDER BY created_at DESC LIMIT 10;
  ```

---

## Verification

`verify_clean_database.sql` is the single command that confirms the reset succeeded.

**It is strictly read-only** — no `DELETE`, `UPDATE`, `INSERT` or DDL against any
application table. It creates one temp table for its own results. Safe to run at any
time in any environment, including production (where it will correctly report `FAIL`
on the transactional checks, because production is not supposed to be empty).

### What it checks

| Category | Checks | Fails when |
|---|---|---|
| **A. TRANSACTIONAL** | All 19 business-state tables counted | Any count ≠ 0 |
| **G. OBSERVABILITY** | `audit_log` · `error_events` · `system_alerts` · `health_checks`, split **pre-** vs **post-** reset marker | Any row predates the marker |
| **B. ACCOUNTS** | Admin exists · profiles outside the preservation rule · preserved-via-`admin_roles`-only · `profiles` ↔ `auth.users` in **both** directions · count parity · RBAC drift · role roster | Any orphan or unexpected survivor |
| **C. CONFIG** | 5 required + 7 optional config tables · active products / covers / stickers / templates · cover fallback · preset vs blueprint split | A required config table is empty |
| **D. INTEGRITY** | `demo_album_id` cleared · orphaned photos · config rows → deleted accounts · exactly one default product · products without prices · orphaned prices/previews · covers missing artwork · stickers → deleted category · FK constraint count | Any dangling reference |
| **E. QUEUE** | `pgboss.job` and `.archive` empty · **5 application queues** present · internal queues listed separately · policy readout · `pgboss.version` intact | Jobs remain, or config was destroyed |
| **F. SCHEMA** | No sequences **in `public` + `pgboss`** · provider sequences named as INFO · RLS on 13 core tables · `on_auth_user_created` trigger · 4 core RPCs | Schema drifted from the all-uuid design |

### Why observability tables are checked against a marker

`audit_log`, `error_events`, `system_alerts` and `health_checks` are **append-only
sinks**. Any running app or worker repopulates them within seconds — an admin page
load, a worker boot, a captured exception. Asserting `count = 0` against them tests
whether the system is switched off, not whether the reset worked.

Section 10B of the reset therefore writes one `dev.environment_reset` audit row. The
verification anchors to its timestamp and splits the two cases a raw count conflates:

| Rows | Meaning | Level |
|---|---|---|
| **Before** the marker | The reset failed to clear history | **FAIL** |
| **After** the marker | Normal runtime activity | INFO / WARN |

This is **stronger** than `count = 0`, not a relaxation: it still catches a failed
reset, no longer produces a false failure from the system simply being alive, and adds
a signal the old check could not express — *post-reset errors*, surfaced with their
sources and sample messages.

> One correlation worth knowing: `record_error_event()` writes an `error.created`
> audit row for every new error event (`0036:129`). Post-reset `audit_log` and
> `error_events` counts therefore move together. Identical counts are expected, not a
> symptom.

### Reading the output

Row 1 is the verdict. Then:

| Status | Meaning |
|---|---|
| `PASS` | Check succeeded |
| `FAIL` | **Blocking.** Do not start Worker V2. |
| `WARN` | Non-blocking, but understand why before proceeding |
| `INFO` | Context only, never a failure |

### Accepted warnings — intentional, documented development states

These do **not** indicate a failed reset and do **not** block Worker V2.

| Warning | Cause | Action |
|---|---|---|
| `preserved via admin_roles only` / `RBAC drift` | An account holds an `admin_roles` row while `profiles.role <> 'admin'`. The reset's preservation rule is a **UNION** of both sources, deliberately — lockout is worse than one extra survivor. Per `0034` the account has **no** admin access, since `getAdminContext()` gates on `profiles.role` first. | Either `DELETE FROM admin_roles WHERE user_id='<id>'` then re-run the reset, or `UPDATE profiles SET role='admin'` to make it a real admin. The verification prints both. |
| `error_events POST-reset > 0` | Something threw after the reset — the app or worker is running. Not reset damage. | Read the two INFO rows beneath it: they name the sources and show sample messages. |
| `active cover templates = 0` | All cover templates are inactive, or none were seeded. Non-blocking: `resolveCoverImageKeys` falls back photo → template → design/default, so albums still complete and print. | Activate a cover in `/admin/covers` if you want a populated picker. |
| `pgboss schema MISSING` | `DROP SCHEMA pgboss CASCADE` was used. | Restart the worker; pg-boss rebuilds on boot. Re-run verification. |
| `queue: <name> MISSING` | Worker has not booted since the reset. | Restart and re-run. |
| `reset marker NOT FOUND` | Verifying a reset performed before Section 10B existed. | Re-run the current reset script to anchor future verifications. |

### Findings that are NOT warnings, and why

Three checks were deliberately reclassified after their first real run. None was
weakened to make a red light go green:

| Check | Was | Now | Reason |
|---|---|---|---|
| `content_pages` | FAIL if 0 | INFO | The reset never touches this table. Its count measures **content authoring**, not reset correctness — the wrong thing to assert in a reset verification. |
| `published CMS pages` | WARN if 0 | INFO | Same. Zero means `/faq`, `/testimonials`, `/stories` render empty states — a content gap, not an environment defect. |
| `sequences` | WARN if any exist anywhere | **FAIL** if any exist in `public`/`pgboss`; INFO elsewhere | The original query spanned every non-system schema and flagged a Supabase-managed sequence. The "all PKs are uuid" claim was only ever about the application schema. Scoped correctly, this check became **stricter**. |

### Two things it deliberately reports as `INFO`, not `PASS`

**Queue policies.** Every queue is created with no options, so `policy` resolves to
`standard`. Under `standard`, pg-boss's dedupe indexes do not apply, which means
`singletonKey` **does not deduplicate** — a documented invariant in the current
codebase that does not actually hold. Surfaced here so Worker V2 makes this an
explicit decision rather than inheriting it silently.

**R2.** SQL cannot see object storage. The verdict includes a reminder; the actual
check is manual — see below.

### Limitations

- **Cannot verify R2.** Object storage is a separate system with no transactional link
  to Postgres.
- **Cannot verify the application renders.** Keep the manual admin-console checks in
  the post-run checklist.
- **Assumes a clean-state target.** Once you create test data, `A. TRANSACTIONAL` will
  correctly `FAIL`. Run it before seeding.

---

## R2 Cleanup Instructions

**The SQL cannot touch R2.** Object storage is a separate system with no transactional
link to Postgres. This step is manual and mandatory.

Normal album deletion routes through `deleteAlbum`, which enqueues an `r2-cleanup`
job with the gathered key list. This reset bypasses that path entirely, so **every
object is orphaned** unless you delete it here.

### Delete — all user-generated content

| Prefix | Contents |
|---|---|
| `{user_uuid}/albums/{album_uuid}/` | Raw uploads `{uuid}.{ext}`, sanitized masters `{uuid}_full.jpg`, thumbnails `{uuid}_thumb.jpg`, generated `preview.pdf` |

**Every top-level folder whose name is a bare UUID is a user folder. Delete all of
them. No exceptions** — including former demo and preview albums.

```bash
# Inspect first
rclone lsd r2:<bucket>

# Delete one user folder
rclone purge r2:<bucket>/<user_uuid>

# Or via AWS CLI against the R2 S3 endpoint
aws s3 rm "s3://<bucket>/<user_uuid>/" --recursive --endpoint-url "$R2_ENDPOINT"
```

### Preserve — admin catalog assets

| Prefix | Contents | Backing table |
|---|---|---|
| `album-products/` | Product gallery images | `album_product_previews` |
| `cover-templates/` | Cover artwork + `_thumb.jpg` | `cover_templates` |
| `stickers/` | Sticker artwork (PNG, alpha retained) | `stickers` |
| `blueprints/{id}/` | `preview.jpg`, `thumb.jpg` | `layout_templates.thumb_key` |

These are referenced by preserved rows. Deleting them leaves dangling keys and broken
images across the builder, admin console and marketing pages.

### Verify

```bash
rclone lsd r2:<bucket>
```

Only the four preserved prefixes should remain.

---

## Safety Warnings

> ### 🔴 Irreversible
> There is no undo. `auth.users` deletion in particular cannot be reversed by
> re-inserting rows — Supabase Auth maintains identities, sessions and refresh tokens
> that a manual insert will not reconstruct.

> ### 🔴 Never run against production
> Production is Supabase project `erpniqgzolikgokklmkc`. Check the project ref in your
> dashboard URL before every run. The Section 0 guard is the last line of defence, not
> the first.

> ### 🔴 Never renumber into the migration sequence
> If this file is ever moved to `drizzle/0052_*.sql`, a migration runner will
> eventually execute it against production. Keep it in `drizzle/dev/`.

> ### 🟠 The Section 0 guard must be re-armed
> Running requires commenting out the `RAISE EXCEPTION` in Section 0.
> **Restore it immediately afterwards and commit that restoration.** A disarmed script
> in version control is a loaded weapon.

> ### 🟠 Admin lockout risk
> If `profiles.role` has drifted and no row has `role = 'admin'`, the script aborts
> rather than deleting every account. Do not disable that assertion. Verify admin
> login works after the reset before closing your session.

> ### 🟠 Direct DML on `auth.users`
> The script deletes from `auth.users` directly. Supabase's own cascades handle
> identities, sessions and refresh tokens. If your project uses **Supabase Storage**
> (this project uses R2, so it should not), check `storage.objects.owner` for
> references first. The safer alternative is the Supabase Admin API or
> Dashboard → Authentication → Users, at the cost of not being scriptable.

> ### 🟠 Stop the worker first
> A running worker re-enqueues jobs against rows being deleted, producing confusing
> partial state and log noise.

> ### 🟡 `audit_log` is append-only by design
> `0016` establishes it as immutable history. Wiping it in development is intended;
> understand that you are deliberately overriding a schema-level guarantee.

> ### 🟡 `TRUNCATE` is never used on `public` tables
> `album_products.demo_album_id → albums(id)` means a **preserved** table references a
> **deleted** one. `TRUNCATE` does not honour `ON DELETE SET NULL`: it would fail, or
> with `CASCADE` would truncate `album_products` itself. Every `public` statement uses
> `DELETE`. Do not "optimise" this to `TRUNCATE`.

---

## Recovery

### If Part 1 fails mid-run

**Nothing is lost.** Part 1 is wrapped in a single `BEGIN … COMMIT`. Any error aborts
the whole transaction and rolls back automatically. Read the error, fix the cause,
re-run.

### If the output looks wrong before you commit

Replace `COMMIT;` with `ROLLBACK;` and re-run. Section 11 prints all counts and runs
six assertions **before** the commit point specifically so you get this chance.

### If you committed and need the data back

1. **Stop the worker immediately** — prevents new writes over the recovery target.
2. **Restore from backup:**
   ```bash
   psql "$DIRECT_URL" -f backup_pre_worker_v2.sql
   ```
   Or Supabase Dashboard → Database → Backups → Restore (**this replaces the entire
   database**, including any configuration changed since the backup).
3. **Restore R2** from your mirror:
   ```bash
   rclone sync ./r2_backup_pre_worker_v2 r2:<bucket> --progress
   ```
4. **Restore code state** if needed: `git checkout worker-v1-final`
5. **Reconcile PDF state** — `drizzle/scripts/reconcile_album_pdfs.sql` exists for
   realigning `album_pdfs` after a restore.

### If you are locked out of the admin console

Section 1 aborts on zero administrators and Section 11 asserts one survives, so this
should be unreachable. If it happens:

```sql
-- Confirm the account exists in auth
SELECT id, email FROM auth.users;

-- Re-grant admin. Note: profiles.role is column-locked (0019) against client
-- writes; this requires the postgres/service role, which the SQL Editor has.
UPDATE public.profiles SET role = 'admin' WHERE id = '<uuid>';

INSERT INTO public.admin_roles (user_id, role)
VALUES ('<uuid>', 'super_admin')
ON CONFLICT (user_id) DO UPDATE SET role = 'super_admin';
```

If **no** account remains in `auth.users`, sign up normally, then run the above
against the new user's id.

### If the queue misbehaves after reset

```sql
SELECT name, state, count(*) FROM pgboss.job GROUP BY 1, 2 ORDER BY 1, 2;
SELECT name, policy, partition_name FROM pgboss.queue ORDER BY name;
```

If `pgboss.queue` is empty or partition names are missing, restart the worker —
`createQueue()` in `worker/src/index.ts` recreates all five queues on boot. If the
schema is genuinely corrupt, `DROP SCHEMA pgboss CASCADE;` and restart; pg-boss
rebuilds from scratch.
