# Malnad Stories — CLAUDE.md

## What this project is

A web platform for travelers to upload photos, edit them, arrange them into
printed photo albums (24/36/48 pages), and order for printing.

- **Market**: India — INR pricing, Razorpay payments
- **Team**: 3 developers
- **Architecture note**: Must support a travel-agency phase later (new `/agency`
  section, new `role`) without a rebuild. Don't add it yet — just don't close the door.

---

## Tech stack

| Layer | Choice |
|---|---|
| Framework | Next.js 14.2 (App Router) + React 18 + TypeScript |
| Package manager | pnpm |
| Styling | Tailwind CSS v3 + shadcn@4 (`@base-ui/react`) + lucide-react |
| Database + Auth | Supabase (Postgres + Supabase Auth) |
| Auth in Next.js | `@supabase/ssr` — cookie-based, works in Server Components |
| ORM | Drizzle ORM (`drizzle-orm/postgres-js`) — admin and schema only |
| Validation | Zod on every API route input |
| Payments | Razorpay — **not added yet** |
| Storage | Cloudflare R2 — direct presigned upload (built) |
| Email | Resend — **not added yet** |
| Worker | Separate `/worker` Node service — **built**: image hardening (pg-boss + sharp + file-type + exifr + heic-convert) and album **preview-PDF** render (Puppeteer driving the app's print route) |

---

## Folder layout

```
src/
  middleware.ts               Session refresh + route guards (getUser, NOT getSession)
  app/
    page.tsx                  Landing page
    auth/callback/route.ts    Supabase PKCE code → session exchange + profile upsert
    (auth)/                   Route group — public (login, signup)
    (app)/                    Route group — protected; layout redirects if no session
      dashboard/page.tsx      Albums grid — queries via Supabase server client (RLS)
      dashboard/_album-card.tsx   Client card with delete control + confirm dialog
      albums/
        new/page.tsx          Create album — server component fetches products
        new/_form.tsx         Client component with useFormState
        [id]/build/page.tsx   Builder — fetches album + photos + saved layout (RLS)
        [id]/build/_builder.tsx   Client orchestrator: photos/blocks state, save/submit
        [id]/build/_uploader.tsx  Upload-only dropzone (presign→PUT→confirm), controlled
        [id]/build/_tray.tsx      Photo tray — draggable thumbnails, edit/delete, placed badge
        [id]/build/_block.tsx     One layout block: base slot, picker, unlimited overlays (drag/resize)
        [id]/build/_photo-editor.tsx  Free crop + rotate 90° + straighten + flip + brightness + sharpness
        [id]/build/_photo-frame.tsx   THE renderer: applies edit_config (crop/rotate/tilt/flip/brightness/sharpen)
        [id]/build/_preview.tsx   In-app paged full-album preview
    admin/                    Admin section; layout checks role='admin' via Drizzle
  components/
    app-header.tsx            Shared header with logout form (server action)
    ui/                       shadcn/ui generated components
  db/
    index.ts                  Drizzle client (postgres superuser, bypassrls — admin only)
    schema.ts                 Drizzle table definitions
  lib/
    actions/
      auth.ts                 signOut server action
      albums.ts               createAlbum + deleteAlbum server actions
      builder.ts              saveLayout / savePhotoEdit / submitAlbum server actions
      cart.ts                 addAlbumToCart server action (ownership + eligibility gate)
      pdf.ts (REMOVED)        customer PDF action gone — generation is backend-only now
    print/
      spec.ts                 THE PRINT SPECIFICATION — every physical mm, pure + deterministic
    pdf/
      kind.ts                 PdfKind vocabulary: preview | print_cover | print_content (0058)
      key.ts                  deterministic R2 keys, one per (user, album, kind)
      print-token.ts          THE print-route token gate (kind-scoped), shared by all 3 routes
      print-data.ts           one album read for every print route (preview + both exports)
      print-preflight.ts      page-count invariant for the interior export
      generate.ts             startAlbumPdfGeneration (service-role: validate→mint→enqueue→nudge)
    cart/
      queries.ts              cart_items data access (server-only; takes a client, never service role)
      provider.tsx            CartProvider — count-only client context for the header badge
    builder/
      model.ts                Shared builder types + accounting + render helpers (no I/O)
    queue.ts                  App-side pg-boss (ENQUEUE only) — image-hardening + album-pdf
    supabase/
      client.ts               createBrowserClient() — 'use client' components
      server.ts               createServerClient() — Server Components, Server Actions
      service.ts              createServiceClient() — service role, bypasses RLS
    validations.ts            Zod schemas
  app/albums/[id]/print/      Token-gated print routes (OUTSIDE (app); service access) → PDF
    print/page.tsx              PREVIEW book — cover + blanks + content + back + spine. UNCHANGED
    print/cover/                PRINTER-READY cover: ONE 487 × 327 mm flat spread
    print/content/              PRINTER-READY interior: N × 206 × 291 mm pages, reading order
  app/api/photos/route.ts     GET ?albumId= — status + signed sanitized URLs (builder polls)
  app/api/albums/[id]/pdf/route.ts  GET — PDF status + short-lived signed download URL
drizzle/
  0001_init.sql               Tables, RLS policies, trigger, product seed
  0002_backfill_profiles.sql  Backfill + idempotent trigger fix
  0003_grants.sql             Table-level GRANTs for anon and authenticated roles
  0004_album_sizes.sql        Album sizes 50/100/200 → 24/36/48 (CHECK + product rows)
  0005_album_pages_layout.sql album_pages.layout_config jsonb + template/photo_ids guards
  0006_generic_overlays.sql   Generic unlimited overlays; retire pip; relax photo_ids CHECK
  0007_photo_processing.sql   photos: status + sanitized_key/thumb_key + width/height/taken_at
  0008_album_pdfs.sql         album_pdfs (service-only): PDF status/key + single-use print token
  0009_service_role_grants.sql service_role table/sequence grants (worker 42501 fix)
  0010_orders_payments.sql    orders 'failed' status; dedupe indexes; webhook_events (service-only) + atomic process_razorpay_event()
  0011_one_pending_order_per_album.sql  partial unique index: ≤1 'pending' order per album (concurrent double-submit backstop)
  0012_orders_payments_write_rls.sql  independent write-side RLS: SELECT-only user policy + RESTRICTIVE write-deny on orders/payments
  0013_webhook_amount_currency.sql    process_razorpay_event gains p_currency + amount/currency match gate (mismatch → recorded, NOT paid)
  0014_orders_fulfillment.sql         orders: copies + pricing breakdown + fulfillment fields + 'printing'/'packed' states + indexes + carrier-scoped unique tracking
  0015_coupons.sql                    coupons + coupon_redemptions (min-order, starts_at, soft-cap); admin RLS + restrictive client write-deny
  0016_audit_notes.sql                append-only audit_log + order_notes + log_audit() helper; admin-read, service-insert only
  0017_admin_rpcs_and_consumption.sql admin RPCs (status/tracking/notes/coupons) + process_razorpay_event rewrite (paid-family guard + coupon consumption + audit)
  0018_coupon_created_reason.sql      coupons.created_reason + admin_create_coupon extended (10-arg) to record + audit it
  0019_lock_profile_role.sql          column-scoped profiles grants: authenticated can write only (id,name,phone)/(name,phone) — role/id/created_at/delete locked (anti self-promotion)
  0020_photos_column_lockdown.sql     column-scoped photos grants: authenticated writes only INSERT(user_id,album_id,r2_key,original_filename)/UPDATE(edit_config)/DELETE — worker columns service-role-only (no hardening bypass)
  0021_album_status_hardening.sql     column-scoped albums grants: status is server-only (submitAlbum→service role); INSERT(user_id,title,size,cover_template_id)/UPDATE(title,cover_template_id,updated_at); CHECK narrowed to (draft,submitted)
  0022_email_log.sql                  email delivery audit + idempotency (claim 'sending' → 'sent'/'failed'); service-write, admin-read. (0020/0021 now applied to production)
  0025_album_pdf_recovery.sql         album_pdfs.requested_at + attempts — backend PDF stuck-job recovery (timeout + retry cap)
  0028_support_center.sql             support_tickets + support_messages (customer-owned RLS); SECURITY DEFINER triggers (ticket-created/message audit + auto-transition) + admin RPCs (admin_set_support_status / admin_assign_support_ticket); admin-read, audited via log_audit
  0029_refund_reprint.sql             refund_requests + reprint_requests (customer-owned RLS; column-scoped grants hide admin_notes/resolved_by; partial unique index = one active per order); SECURITY DEFINER created-triggers + admin status/note RPCs. RECORDS DECISIONS ONLY — no Razorpay/payment/order-status side effects
  0030_album_review.sql               album_reviews (one per album) + revision_requests (customer-owned RLS; NO client writes — all transitions via SECURITY DEFINER RPCs: submit_album_for_review / mark_revision_in_progress / admin_set_album_review / admin_add_review_note); column grant hides reviewed_by; partial unique = one active revision per review. ADVISORY review layer — never gates checkout; no payment/PDF/order-status side effects
  0031_cms.sql                        content_pages (admin-owned CMS: blog/faq/testimonial/legacy_story/homepage_section/announcement + metadata jsonb). PUBLIC-READ model (anon/authenticated SELECT published only; admins write via service role + restrictive deny). No bespoke RPCs — audit via log_audit, like cover_templates
  0032_layout_templates.sql           layout_templates (admin-owned PRESET catalog: geometry = {base: single-pair|double-spread, overlays: Rect[]}). ACTIVE-read model (authenticated SELECT active only; admins write via service role + restrictive deny). Applying a preset emits an ordinary Block[] — no renderer/saveLayout/schema change. Audit via log_audit
  0033_shipments.sql                  shipments (one/order) + shipment_events (append-only). SUPPLEMENTAL courier layer — independent of orders.status (never writes it). Child-of-order RLS (customers read own; admins write via service role + restrictive deny). Courier abstraction (Mock today). Audit via log_audit
  0034_admin_roles.sql                admin_roles (one fixed back-office role per admin: super_admin/production/support/content). RBAC scoping ON TOP of the existing profiles.role='admin' gate (does NOT grant admin access). Service-role writes only + restrictive deny. Absent row → treated as super_admin (migration safety). Audit role.assigned/changed + access.denied
  0035_monitoring.sql                 health_checks (append-only per-service snapshots) + system_alerts (append-only; resolving marks; partial unique (dedupe_key) where not resolved = anti-fatigue). Admin-only RLS + service-role writes. Read-only collectors over existing tables; audit health.check/alert.created/alert.resolved
  0036_error_events.sql               error_events (append-only captured failures/exceptions/slow ops; deduped by fingerprint via partial unique (fingerprint) where not resolved → occurrences++). Admin-only RLS + service-role writes (no delete). record_error_event() SECURITY DEFINER RPC = single capture entrypoint (app + worker): dedupe-upsert + audit error.created + open a critical system_alert (reuses 0035). Phase 10B
  0037_perf_indexes.sql               PURELY ADDITIVE performance indexes (Phase 10D) — no schema/RLS/grant change: albums(user_id,updated_at), orders(user_id,placed_at), orders(album_id,status), addresses(user_id), payments(order_id). Targets the hottest RLS/lookup predicates the base tables (0001) never indexed
  0052_cover_template_default.sql     cover_design_templates.is_default + partial unique index (at most ONE default across the table). The creation flow no longer asks the customer for a cover — every new album gets the admin's default, applied server-side in insertAlbumForUser through the SAME active + config-validity gates as a customer pick. No default set → blank custom cover (pre-0052 behaviour). Covers stay fully browsable/switchable/editable in the builder
  0055_cart_items.sql                 cart_items (Phase 6 cart foundation) — one row per (user, album) with a 1..10 quantity; NO parent `carts` table and NO price/product snapshot (createOrder stays the only price authority). Customer-owned RLS (`user_id = auth.uid()`, the albums/addresses shape) + admin SELECT. Both FKs CASCADE (a cart row names no R2 object, so 0054's RESTRICT reasoning does not apply). Two non-SECURITY-DEFINER SQL helpers do the writes because PostgREST cannot express `least(existing + new, 10)`: cart_add_or_increment (manual add) + cart_ensure_item (submit auto-add, DO NOTHING). ✅ EXECUTED against the live database
  0056_order_items.sql                order_items (Phase 8 multi-album order FOUNDATION) — the AUTHORITATIVE list of albums in an order, so ONE order can name several albums while staying ONE Razorpay order + ONE payment. `orders.album_id`/`copies`/product snapshot stay NOT NULL LEGACY POINTERS to the FIRST item. Money stays order-level (shipping charged ONCE per order); the per-line columns are an immutable snapshot (unit_price, line_subtotal, product, album_title). Child-of-order RLS (customer SELECT via EXISTS-through-orders, admin SELECT, restrictive client write-deny); authenticated = SELECT only, anon nothing. Adds create_order_with_items() SECURITY DEFINER (service-role EXECUTE only) = the atomic order+lines primitive used by BOTH createOrder and createCombinedOrder. Backfilled all 4 existing orders. ✅ EXECUTED against the live database
  0058_album_pdf_kind.sql             album_pdfs.kind ('preview' | 'print_cover' | 'print_content') + PK widened to (album_id, kind). ONE ALBUM, THREE INDEPENDENT PDF ARTIFACTS: each owns its status, stage, failure_code, print token, attempt count and R2 key, so a failed printer-ready export can never reset a preview the customer can already download. `kind` defaults to 'preview', so every pre-0058 row keeps its exact meaning with no backfill. Adds a partial index on (requested_at) where status='generating' for the worker's recovery sweep. ⚠️ WRITTEN, NOT YET RUN — see the run-order table
  0039_stickers.sql                   sticker_categories + stickers (admin-managed decorative artwork for the cover + pages). Mirrors cover_templates (0023): artwork in private R2 under stickers/…; PUBLIC-READ active rows (anon/authenticated SELECT active); service-role writes only. RBAC `sticker:manage` (content role). Placed stickers store only `stickerId` in album jsonb — the print route/admin/builder resolve URLs by id so a deactivated-but-placed sticker still renders
worker/                       Worker V2 — its OWN pnpm workspace (Worker V1 was removed; tag `worker-v1-final`)
  .env.example                Env template — copy to worker/.env, or use the repo-root .env.local
  ops/                        RUNBOOK.md · CONFIGURATION.md · CAPACITY.md (written for operators)
  packages/                   Foundation libraries (@workerv2/*): contracts, logger, metrics, health, …
  apps/worker/                THE DEPLOYABLE SERVICE (Docker/Render target)
    src/main.ts               Entrypoint: load .env → config → reference OR production worker
    src/env.ts                .env discovery (process.env always wins)
    src/config.ts             All config + two-pass validation; `mode` = production | reference
    src/concurrency.ts        Adaptive per-job-type lanes + backpressure
    src/infra/                pg-boss queue · R2 object store · Supabase Postgres adapters
    src/processors/           image-hardening · album-pdf · r2-cleanup (registry → pipeline → stages)
    src/recovery/             Recovery Coordinator + periodic scheduler
    src/observability/        Logging · tracing · metrics · health · diagnostics
    src/testing/              Load + chaos harness (never imported by production; absent from dist)
```

> **Production mode requires `WV2_INFRA=on`.** Without it the worker boots into *reference mode*:
> healthy, idle, and processing nothing. The startup banner says so explicitly, with the reason.

---

## Non-negotiable security rules

1. **GRANTs allow table access; RLS policies filter rows — both are always required.**
2. **User data via Supabase server client** (`createClient()` from `server.ts`): carries the user's JWT, `auth.uid()` resolves, RLS is enforced as a real DB boundary.
3. **Privileged writes via service-role client** (`createServiceClient()` from `service.ts`): bypasses RLS — only for order creation, webhook processing, and admin writes. **Never use in Client Components. Never expose `SUPABASE_SERVICE_ROLE_KEY` to the browser.**
4. **Admin portal queries via Drizzle** (`db` from `@/db`): postgres superuser, also bypasses RLS — use for role checks and future admin panel.
5. **RLS on every table** — `0001_init.sql`. Second enforcement layer for user data, not just defense-in-depth.
6. **Zod validation before any DB access** in every API route / server action.
7. **`getUser()` not `getSession()`** — JWT can be stale; `getUser()` validates against Supabase.
8. **No secrets in committed code** — `.env.local` is gitignored.
9. **CSP headers** in `next.config.mjs`. Tighten before prod.


---

## Destructive operations & test data — MANDATORY PROCEDURE

> **This is a project convention, not an automatic protection.** The worker's
> `diagnostics/orphan-cleanup` subsystem enforces its own safety in the type system (see below).
> **Ad-hoc scripts connecting over `DIRECT_URL` are enforced by NOTHING.** They run as `postgres`,
> bypass RLS, and can delete any row in the database. A real incident already happened this way:
> an over-broad `id ~ '^evt_[0-9a-f]{16}'` regex intended for test fixtures deleted **4 genuine
> `webhook_events` dedupe markers**, which turned out to be unrecoverable. Everything below exists
> because of that.

### The rule

**A row may be deleted only by its exact primary key, recorded BEFORE the row was created, after
re-verifying ownership at deletion time.** Nothing else is sufficient — not a name, not an email
domain, not a timestamp window, not an id shape.

### The 12-point checklist every destructive test script MUST satisfy

1. **Explicit fixture IDs.** Every id is generated or captured by the script itself.
2. **A written manifest.** Ids are persisted to a manifest file *before/as* the rows are created,
   outside the database, so a crashed run still leaves a record of what to clean up.
3. **Pre-mutation fingerprint.** Row counts for every affected table (and the R2 object
   count/bytes/digest if object storage is involved) captured and stored before anything changes.
4. **Exact-PK deletion only.** `delete … where id = any($1::uuid[])` with the manifest's ids.
5. **Ownership re-check immediately before deleting.** Re-read the rows and abort the entire run
   if any row's `user_id` (or equivalent owner column) is not the fixture user. Fail closed.
6. **A transaction wherever the driver allows it**, so a partial failure rolls back.
7. **Post-delete verification.** Re-run the fingerprint and assert it equals the baseline exactly.
   "The script exited 0" is not verification.
8. **NO pattern matching.** No `LIKE`, no `~`/regex, no prefix, suffix, or `ILIKE` as the thing
   that decides a row is disposable. A pattern may *find* candidates for a human to read; it may
   never *authorise* a delete.
9. **No deletion from resemblance.** Not by email address, email domain, display name, title,
   amount, or "looks like test data".
10. **Dry-run is the default** for anything touching production. The destructive mode must be an
    explicit, separate flag (`--execute`), never the default path.
11. **Explicit acknowledgement before destructive execution.** The script prints exactly what it
    will delete — table, count, and the ids — and proceeds only on a deliberate confirmation.
12. **Exact affected-row count** reported, and compared against the expected count. A mismatch is
    a failure, not a warning.

### What the codebase already enforces (and what it does not)

- **Enforced in types — `worker/apps/worker/src/diagnostics/orphan-cleanup/`.** The only deletion
  entrypoint is `deleteVerified(orphan: VerifiedOrphan)`. `VerifiedOrphan` carries a `unique
  symbol` brand that is never exported, and the sole function that can mint one is
  `verifyCandidate`, which re-asks every gate at deletion time (scope → key parse → `photos`
  recheck → R2 size/ETag/LastModified recheck → age recheck against `MIN_DESTRUCTIVE_AGE_MS`, the
  24h floor). Every gate fails closed. There is no `delete(key: string)` in the subsystem — "delete
  an arbitrary key" is a sentence that cannot be written in that type system.
- **NOT enforced anywhere — one-off scripts.** A script with `DIRECT_URL` has none of the above.
  The checklist is the only thing standing between it and a production incident, and the checklist
  is followed by discipline, not by the compiler. Do not describe such scripts as "safe" because
  the worker is safe.
- **`r2-cleanup` (the pg-boss job) has no gate of its own.** It deletes the exact key list it is
  handed, idempotently. Its safety comes entirely from the caller: `deleteAlbum` gathers keys from
  DB rows whose ownership RLS already proved. It must never be handed keys that were not derived
  from rows the caller owns — doing so is an ungated deletion with an extra hop.

### `webhook_events` — a specific, permanent trap

**`webhook_events` has no `created_by`, `source`, `is_test` or provenance column of any kind.** A
test fixture written into it is therefore *indistinguishable* from a real Razorpay delivery: same
shape, same id format, same columns. There is no query that can separate them after the fact, and
Razorpay exposes no events API to reconstruct from (`GET /v1/events` → 404). The four markers
deleted in the incident were gone permanently.

Consequences, which are not negotiable:

- **A test harness that writes to `webhook_events` MUST record the event ids externally, before
  insertion**, and delete only those exact ids.
- **NEVER clean `webhook_events` by** `LIKE`, regex, id shape, event name, amount, customer email,
  or `created_at` window — alone or in combination. These select real deliveries too.
- **Deleting a `webhook_events` row destroys an idempotency marker**, not a log line. It is the
  record that says "this Razorpay event was already processed".
- Redelivery of an already-settled event happens to remain safe, because
  `process_razorpay_event`'s paid-family guard skips the transition, the coupon consumption and any
  status downgrade (runtime-proven by the duplicate-webhook tests). **That is a second line of
  defence, not permission to delete markers.**
- Adding a provenance column would make fixtures separable, but that is a schema change to the
  money path and has deliberately **not** been done.

---

## Data access pattern — THREE clients, distinct purposes

### 1 — User actions → `createClient()` from `@/lib/supabase/server`

```ts
import { createClient } from '@/lib/supabase/server';
const supabase = createClient(); // anon key + user JWT from cookie
// RLS policy "user_id = auth.uid()" filters rows automatically
const { data } = await supabase.from('albums').select('id, title, size, status');
```

Use for: all reads and writes that belong to the logged-in user.
RLS is the DB-level gate; a missing app-layer filter cannot leak other users' data.

Tables with full CRUD for `authenticated`: `profiles`, `addresses`, `albums`,
`album_pages`, `photos`.

Tables with SELECT only for `authenticated`: `orders`, `payments` (writes are
server-controlled — see client 2 below).

### 2 — Server-controlled writes → `createServiceClient()` from `@/lib/supabase/service`

```ts
import { createServiceClient } from '@/lib/supabase/service';
const adminSupabase = createServiceClient(); // service role, bypasses RLS
// Use when the authenticated role intentionally has no write GRANT
await adminSupabase.from('orders').insert({ user_id, album_id, total_amount, ... });
```

Use for:
- **Order creation** — `total_amount` must be computed server-side (never from user input)
- **Razorpay webhook** — writes `payments` row after validating the signature
- **Admin operations** that touch any user's data across the board

`authenticated` role has no INSERT/UPDATE/DELETE on `orders` or `payments`.
If client 1 accidentally tries a write there, Postgres returns `42501` — correct behaviour.

### 3 — Admin role check → `db` from `@/db` (Drizzle, postgres superuser)

```ts
import { db } from '@/db';
const [profile] = await db.select({ role: profiles.role }).from(profiles).where(eq(profiles.id, userId)).limit(1);
```

Use for: `admin/layout.tsx` role check, future admin portal complex queries.
The postgres superuser (`BYPASSRLS`) is intentional — admin verification must not be
gameable by RLS policy logic.

### Why orders/payments writes go through service role, not authenticated

```
User submits order → Server Action:
  1. Validates album belongs to user (via client 1 + RLS)
  2. Fetches product price from DB
  3. Computes total_amount server-side
  4. Inserts order via createServiceClient() (authenticated has no INSERT GRANT)

Razorpay POST /api/webhooks/razorpay:
  1. Verify HMAC signature with RAZORPAY_WEBHOOK_SECRET
  2. Write payment row via createServiceClient()
```

---

## Database

- Supabase project ID: `erpniqgzolikgokklmkc`
- URL: `https://erpniqgzolikgokklmkc.supabase.co`
- Region: ap-northeast-1 (AWS Tokyo)

**Tables**: `profiles`, `addresses`, `products`, `albums`, `album_pages`,
`photos`, `orders`, `order_items`, `payments`, `cart_items`

**GRANT summary** (see `0003_grants.sql`):

| Table | anon | authenticated | service_role |
|---|---|---|---|
| products | SELECT | SELECT | ALL |
| profiles | — | ALL | ALL |
| addresses | — | ALL | ALL |
| albums | — | ALL | ALL |
| album_pages | — | ALL | ALL |
| photos | — | ALL | ALL |
| orders | — | SELECT | ALL |
| order_items | — | SELECT | ALL |
| payments | — | SELECT | ALL |
| cart_items | — | SELECT, INSERT, UPDATE, DELETE | ALL |

**RLS model**:
- User tables: `user_id = auth.uid()`
- Child tables (album_pages, payments): access via parent ownership subquery
- `products`: public SELECT for active rows; admin writes
- Admin: `public.is_admin()` SQL function checks `profiles.role = 'admin'`

**`cart_items` (0055 — Phase 6 cart foundation)**:

| column | notes |
|---|---|
| `id` | uuid pk, `gen_random_uuid()` |
| `user_id` | uuid → `profiles(id)` **ON DELETE CASCADE** |
| `album_id` | uuid → `albums(id)` **ON DELETE CASCADE** |
| `quantity` | integer, default 1, `check (quantity >= 1 and quantity <= 10)` |
| `created_at` | timestamptz, `now()` |
| `updated_at` | timestamptz, `now()` |

- `unique (user_id, album_id)` — one row per album per customer; also the `ON CONFLICT`
  target the atomic increment depends on. Plus `(user_id, created_at desc)` for the read.
- There is **no `cart_id`** and **no parent `carts` table** (one cart per user is implicit in
  `user_id`), so RLS is the same direct `user_id = auth.uid()` predicate as albums/addresses
  rather than a subquery — and there is no client-supplied cart id to forge.
- There is **no price, product, title or cover snapshot, deliberately**. `createOrder`
  resolves the price server-side and snapshots product/pricing onto the *order*; a price on
  the cart would be a second, staler authority for money.
- Both FKs **CASCADE**, which intentionally differs from `0054`'s `RESTRICT` on
  `photos.user_id`/`albums.user_id`: those rows name R2 objects, a cart row names none. So
  deleting an album just removes it from the cart and `deleteAlbum` needed no change.
- `quantity 1..10` is not a new rule — it mirrors `orders_copies_check` (0014) and
  `CreateOrderSchema.copies`, so a cart can never hold a quantity an order would reject.

**Profile guarantee (three layers)**:
1. `on_auth_user_created` trigger — idempotent (`ON CONFLICT DO NOTHING`) since `0002`
2. `auth/callback/route.ts` — upserts profile after every email-link login
3. `0002_backfill_profiles.sql` — one-time fix for users who signed up before the trigger

All user tables FK to `profiles(id)`. A profile row must exist before any
album/photo/order insert can succeed.

**Migrations**: Write SQL to `drizzle/NNNN_description.sql`, paste into
Supabase Dashboard → SQL Editor → New query to run.

### Migration conventions (project-specific; learned the hard way in 0055)

**1 — EVERY NEW PUBLIC TABLE MUST EXPLICITLY REVIEW AND REVOKE DEFAULT ANON/PUBLIC
PRIVILEGES BEFORE GRANTING THE INTENDED ROLES.** In *this* Supabase project, a freshly
created `public` table came out of `create table` with `REFERENCES, TRIGGER, TRUNCATE`
granted to **`anon`** — which no other table here carries (`albums`, `orders`, `photos`,
`addresses`, `support_tickets` all give anon nothing), because they were created before those
default privileges applied. So a new migration must state the final privilege state itself:

```sql
revoke all on table public.<new_table> from anon;
grant select, insert, update, delete on table public.<new_table> to authenticated;
grant all on table public.<new_table> to service_role;
```

- **RLS does NOT protect `TRUNCATE`.** That is what made the anon grant a real vulnerability
  rather than a cosmetic one: `TRUNCATE` is reachable with the public anon key and no policy
  filters it, so anon could have emptied every customer's cart while every policy read
  correctly. **RLS is a row filter, not a table-level permission** — the GRANT is the only
  thing standing between anon and `TRUNCATE`.
  - **Proven, not theorised** (Phase 9 P3, on a throwaway table inside a rolled-back
    transaction): with RLS enabled and no policy granting access, `anon` saw **0 rows** via
    `SELECT` and removed **0 rows** via `DELETE` — and then `TRUNCATE` **succeeded and emptied
    the table**.
  - **ROOT CAUSE, now fixed.** `pg_default_acl` carried an `ALTER DEFAULT PRIVILEGES` entry
    owned by `postgres` for schema `public` granting `Dxtm` (TRUNCATE, REFERENCES, TRIGGER,
    MAINTAIN) to **both** `anon` and `authenticated`. Migrations run as `postgres`, so *every*
    table ever created by a migration silently inherited TRUNCATE at birth — 0055 did not
    introduce the problem, it merely noticed it. **`0057_revoke_truncate_privilege.sql`**
    revoked TRUNCATE from both roles on all 38 existing tables **and changed that default**, so
    new tables no longer inherit it (verified: a freshly created table now comes out
    `anon=xtm` / `authenticated=xtm`). Nothing in the app or worker issues SQL `TRUNCATE`, so
    no code path lost a capability.
  - A new migration should still state its intended final privilege state explicitly rather
    than relying on the corrected default.
- **Function `EXECUTE` defaults must be reviewed too.** Postgres grants `EXECUTE` on a new
  function to `PUBLIC`, so a new SQL function needs
  `revoke all on function public.f(args) from public;` followed by explicit grants to
  `authenticated` / `service_role` (matching `log_audit` / `submit_album_for_review`, which
  anon cannot execute).
- **Verify against `pg_catalog` after execution — do not trust the file.** A migration that
  returns without an error has not been verified. 0055's anon grants were correct *in the SQL
  file* and wrong *in the database*; only querying
  `information_schema.role_table_grants` / `has_function_privilege` / `pg_policies` /
  `pg_constraint` after the run found it.

**2 — New migrations should be safely re-runnable where practical.** `create table if not
exists`, `create index if not exists` and `create or replace function` already are, but
**`create policy` has no `IF NOT EXISTS`**, so a re-run fails partway through unless you
write:

```sql
drop policy if exists "<name>" on public.<table>;
create policy "<name>" on public.<table> …
```

Grants/revokes should likewise *establish the intended final privilege state* rather than
assume a starting point. This applies to **future** migrations only — `0001`–`0054` are not
being retrofitted.

---

## Auth flow

1. User signs up → Supabase sends verification email
2. User clicks link → browser hits `/auth/callback?code=...`
3. Route handler exchanges code, upserts profile, sets session cookie → redirects to `/dashboard`
4. Middleware refreshes session on every request (reads + re-sets cookies)

**Password login + "Stay logged in"**: login signs in via the `signIn` **server
action** (not the browser client) so the server controls auth-cookie persistence.
A non-sensitive `remember_me` cookie (`1`/`0`) is set before sign-in:
- `1` (checkbox checked, the default) → persistent auth cookies (survive browser close).
- `0` → `setAll` in `server.ts` + `middleware.ts` omits `maxAge`/`expires`, making
  the `sb-*` auth cookies **session cookies** (applied on refresh too, not just login).
  An `rm_login_at` cookie + an **8-hour absolute backstop** in middleware clears the
  cookies and forces re-login (handles browsers that restore session cookies on
  restart). The backstop clears cookies only — it does not revoke the refresh token.

Album `size` is data-driven: the create-album form renders `products.pages`, and
`albums.size`/the photo cap follow it. The allowed values live in the DB CHECK
(`0004`), not in TS — there is no size literal or Zod size enum to keep in sync.

---

## Environment variables

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | JWT anon key — safe for client, used in `server.ts` and `client.ts` |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role JWT — **server-only, never expose**; used in `service.ts` and `db/index.ts` |
| `DATABASE_URL` | Transaction pooler (port 6543) — Drizzle runtime |
| `DIRECT_URL` | Session pooler (port 5432) — drizzle-kit migrations **and pg-boss** (the worker + the app's enqueue; pg-boss can't use the 6543 transaction pooler) |
| `R2_ACCESS_KEY_ID` | Cloudflare R2 access key — **server-only** |
| `R2_SECRET_ACCESS_KEY` | Cloudflare R2 secret — **server-only, never expose** |
| `R2_ENDPOINT` | Account-level S3 endpoint `https://<account_id>.r2.cloudflarestorage.com` |
| `R2_BUCKET_NAME` | Private R2 bucket name |
| `R2_REGION` | `auto` (R2 ignores region; SDK needs a value) |
| `R2_ACCOUNT_ID` | Cloudflare account id |
| `RAZORPAY_KEY_ID` | Razorpay TEST key id. Server-side Basic-auth for the Orders API **and** returned to the client per-order by `createOrder` so Checkout can open. **Not** `NEXT_PUBLIC` (non-sensitive, but delivered via the action response). |
| `RAZORPAY_KEY_SECRET` | Razorpay TEST key secret — **server-only, never expose**. Orders-API auth + client-callback payment-signature check. |
| `RAZORPAY_WEBHOOK_SECRET` | Webhook secret (matches the Razorpay dashboard webhook) — **server-only**. Verifies `X-Razorpay-Signature`. |
| `WORKER_URL` | App-side, **server-only** (never `NEXT_PUBLIC`); base URL of the worker service. The app probes `WORKER_URL/health` to gate/wake worker-dependent ops (Phase G). Unset → gating disabled (probe reports "ready"), for local dev. |
| `PORT` | Worker-only; port the worker's `/health` availability server binds to (Render injects it; default `8080`) |
| `APP_URL` | **Worker-only, server-side.** The ORIGIN Chromium loads the print route from. Chromium runs *inside the worker*, so `localhost` here means the WORKER's machine — pointing it at localhost while the app runs elsewhere fails every PDF with `ERR_CONNECTION_REFUSED`. Same host → `http://localhost:3000`; worker in Docker → `http://host.docker.internal:3000`; deployed app → its https origin. `PDF_RENDER_BASE_URL` is an accepted alias (APP_URL wins). Unset → defaults to `http://localhost:3000` and the startup banner says **DEFAULT**. |
| `WV2_INFRA` | **Worker-only; THE MASTER SWITCH.** `on`/`true`/`1`/`yes` enables production mode. Unset → the worker runs *reference mode*: healthy, idle, processing nothing. |

The worker auto-loads `.env.local` / `.env`, searching from its working directory **upward**, so the
**repo-root `.env.local`** (single source of secrets) is picked up automatically. `process.env`
always wins, so Render/Docker injection is never overridden. Worker-only overrides go in
`worker/.env`. Full template + every worker variable: **`worker/.env.example`**;
operational reasoning: **`worker/ops/CONFIGURATION.md`**.

> `KEEP_RAW_ORIGINAL` and `WORKER_SWEEP_INTERVAL_MS` were Worker V1 variables and no longer exist.
> V2 uses `WV2_RECOVERY_INTERVAL_MS` for the sweep. The worker does **not** use `SUPABASE_URL` or
> `SUPABASE_SERVICE_ROLE_KEY` — it connects to Postgres directly via `DIRECT_URL`.

**R2 bucket CORS** (Cloudflare dashboard → bucket → Settings) must allow `PUT` and
`GET` from the app origin, with `content-type`/`content-length` headers and `ETag`
exposed — direct browser uploads/displays fail without it.

---

## Tests

Two suites, ONE framework (Vitest). Neither touches a database, a network, or R2.

```bash
pnpm test              # app suite — 28 files / 543 tests
cd worker && pnpm test # worker suite — 141 files / 1235 tests
```

- **`tests/`** (repo root, added Phase 9 P4) — app-side commerce domain. Full index and rationale
  in **`tests/README.md`**. It protects the invariants Phase 8/9 established: one order → many
  `order_items` with per-line album/copies/title/product snapshots, **no first-album-only
  collapse**, snapshot immutability under a later album rename, the settlement cascade fanning out
  over every album (and refusing anything not already paid, and never throwing), shipping charged
  once per order, email content for single vs combined orders, one customer status CTA per album,
  cart eligibility + the two deliberately-separate add helpers, the absolute blueprint-draft PDF
  block, derived album titles, and migration-inventory/documentation consistency.
- **`worker/`** — owns everything worker-side and is NOT duplicated by the app suite: the PDF
  pipeline and deletion race, `previewPdfKey` determinism, orphan scan/cleanup safety
  (`VerifiedOrphan`, the 24h floor, dry-run default, ownership + ETag rechecks, "admin assets can
  never be verified"), image hardening, recovery.

**What no automated test covers, and why** — recorded so nobody assumes otherwise:

| gap | why |
|---|---|
| RLS row filtering · atomic cart increment · the `quantity <= 10` cap · `create_order_with_items` money re-checks · the TRUNCATE revoke | enforced by Postgres. **The only database this repository can reach is production**, so they are verified against the live catalog during phase work (Phases 6–9) rather than re-run per commit. Closing this needs a disposable Postgres. |
| `/admin/production`, `/admin/orders`, `/admin/customers/[id]`, `/admin/shipping`, admin dashboard | async Server Components with their Drizzle queries written inline — nothing importable to assert against without a database, and extracting a helper purely for tests is a production refactor. Proven in the browser against seeded fixtures in Phase 9 P2. |
| the PDF SIGKILL crash-window | the forensic proof was a manual kill harness; the worker suite covers the same window deterministically via `pdf-deletion-race.test.ts` (A–E), so the crash harness stays forensic-only. |

**Three combined-order lookup bugs are KNOWN, DEFERRED, and deliberately untested** (no test
implies they are fixed): `admin/albums/[id]`, `admin/reviews/_detail.tsx` and
`admin/_resolutions/detail.tsx` find orders with `where(orders.album_id = X)`, so an album that is
the *second* line of a combined order does not appear in those lists. Display/lookup only —
`album-lock.ts` resolves membership through `order_items`, so no money, lock or eligibility
decision is affected.

## Running locally

```bash
# Terminal 1 — the Next.js app (repo root)
pnpm dev          # http://localhost:3000

# Terminal 2 — the background worker (FIRST TIME: install its own deps)
cd worker && pnpm install   # standalone workspace; has its own pnpm-workspace.yaml
cp .env.example .env        # then set WV2_INFRA=on (secrets come from the repo-root .env.local)
pnpm dev                    # = tsx watch apps/worker/src/main.ts
```

On boot the worker prints a banner stating whether it is in **PRODUCTION** or **REFERENCE** mode,
which processors are registered, and — if it is idle — exactly why.

The worker connects to the same Supabase Postgres (pg-boss creates its own `pgboss`
schema automatically) and reads the repo-root `.env.local`. Without it running,
uploads stay stuck on "Processing…" — start it to sanitize photos to `ready`.

**SQL migrations — the complete, verified run order.**

Run in ascending numeric order in Supabase Dashboard → SQL Editor. **This table is built from
`drizzle/*.sql` on disk, and the applied state was verified against `pg_catalog`** (tables,
columns, indexes, functions, policies, constraints and grants — there is no migrations tracking
table, so object existence *is* the evidence). It is not a hand-maintained narrative: if it and
the disk disagree, the disk is right and this table is stale.

**Status of this repository: 58 migration files, `0001`–`0058`, no gaps and no duplicates.
`0001`–`0057` are APPLIED to the live database; nothing among them is unapplied. `0058` is
WRITTEN AND PENDING — it must be run before (or with) the deploy that ships the print exports,
because the shipped code reads `album_pdfs.kind`.**

| # | file | what it does | applied |
|---|---|---|---|
| 0001 | `0001_init.sql` | tables, RLS, trigger, product seed | ✅ |
| 0002 | `0002_backfill_profiles.sql` | profile backfill + idempotent trigger | ✅ |
| 0003 | `0003_grants.sql` | table-level GRANTs for anon/authenticated | ✅ |
| 0004 | `0004_album_sizes.sql` | album sizes → 24/36/48 (CHECK + product rows) | ✅ |
| 0005 | `0005_album_pages_layout.sql` | `album_pages.layout_config` + layout guards | ✅ |
| 0006 | `0006_generic_overlays.sql` | generic unlimited overlays; retire pip; relax CHECKs | ✅ |
| 0007 | `0007_photo_processing.sql` | photos status + sanitized/thumb keys + EXIF date | ✅ |
| 0008 | `0008_album_pdfs.sql` | `album_pdfs` (service-only PDF state + print token) | ✅ |
| 0009 | `0009_service_role_grants.sql` | service_role table/sequence grants | ✅ |
| 0010 | `0010_orders_payments.sql` | orders 'failed', dedupe indexes, `webhook_events` + `process_razorpay_event()` | ✅ |
| 0011 | `0011_one_pending_order_per_album.sql` | partial unique index: ≤1 pending order per album | ✅ |
| 0012 | `0012_orders_payments_write_rls.sql` | write-side RLS on orders/payments (supersedes 0001's `users_own_orders`) | ✅ |
| 0013 | `0013_webhook_amount_currency.sql` | webhook amount/currency gate — run WITH the matching app deploy | ✅ |
| 0014 | `0014_orders_fulfillment.sql` | copies/pricing breakdown/fulfilment fields + lifecycle states | ✅ |
| 0015 | `0015_coupons.sql` | `coupons` + `coupon_redemptions` (+ `orders.coupon_id`) | ✅ |
| 0016 | `0016_audit_notes.sql` | append-only `audit_log` + `order_notes` + `log_audit()` | ✅ |
| 0017 | `0017_admin_rpcs_and_consumption.sql` | admin RPCs + `process_razorpay_event` rewrite — run WITH the app deploy | ✅ |
| 0018 | `0018_coupon_created_reason.sql` | `coupons.created_reason` + 10-arg `admin_create_coupon` | ✅ |
| 0019 | `0019_lock_profile_role.sql` | column-scoped `profiles` grants (anti self-promotion) | ✅ |
| 0020 | `0020_photos_column_lockdown.sql` | column-scoped `photos` grants — deploy code first | ✅ |
| 0021 | `0021_album_status_hardening.sql` | column-scoped `albums` grants + status server-only — deploy code first | ✅ |
| 0022 | `0022_email_log.sql` | email delivery audit + idempotency claim | ✅ |
| 0023 | `0023_photobook_model.sql` | physical-photobook page model + `cover_templates` | ✅ |
| 0024 | `0024_cover_meta.sql` | cover-template description + dimensions | ✅ |
| 0025 | `0025_album_pdf_recovery.sql` | `album_pdfs.requested_at` + `attempts` (stuck-job recovery) | ✅ |
| 0026 | `0026_album_metadata.sql` | album destination / travel_dates / description — run SQL FIRST | ✅ |
| 0027 | `0027_orders_shipping_method.sql` | persist the delivery tier on the order — run SQL FIRST | ✅ |
| 0028 | `0028_support_center.sql` | Support Center (tickets + messages) — run SQL FIRST | ✅ |
| 0029 | `0029_refund_reprint.sql` | Refund & Reprint requests — run SQL FIRST | ✅ |
| 0030 | `0030_album_review.sql` | Album Review & Request-Changes — run SQL FIRST | ✅ |
| 0031 | `0031_cms.sql` | CMS `content_pages` — run SQL FIRST | ✅ |
| 0032 | `0032_layout_templates.sql` | layout-template catalog — run SQL FIRST | ✅ |
| 0033 | `0033_shipments.sql` | courier shipments + events — run SQL FIRST | ✅ |
| 0034 | `0034_admin_roles.sql` | multi-role RBAC — run SQL FIRST; no backfill (absent row → super_admin) | ✅ |
| 0035 | `0035_monitoring.sql` | monitoring & alerting — run SQL FIRST | ✅ |
| 0036 | `0036_error_events.sql` | error tracking + `record_error_event()` — run SQL FIRST | ✅ |
| 0037 | `0037_perf_indexes.sql` | performance indexes — purely additive, safe any time | ✅ |
| 0038 | `0038_album_cover_config.sql` | `albums.cover_config` jsonb + column grant | ✅ |
| 0039 | `0039_stickers.sql` | sticker catalog (`sticker_categories` + `stickers`) — run SQL FIRST | ✅ |
| 0040 | `0040_cover_design_templates.sql` | cover DESIGN templates (builder-JSON cover presets) | ✅ |
| 0041 | `0041_cover_template_metadata.sql` | cover-template merchandising metadata (popular · pinned) | ✅ |
| 0042 | `0042_sticker_tags.sql` | sticker tags (searchable keywords) | ✅ |
| 0043 | `0043_album_blueprints.sql` | Album Blueprints (whole-album layout templates) | ✅ |
| 0044 | `0044_blueprint_preview_token.sql` | blueprint preview render token (thumbnail worker) | ✅ |
| 0045 | `0045_blueprint_default.sql` | default blueprint per album size | ✅ |
| 0046 | `0046_blueprint_draft_album.sql` | blueprint-editing draft albums (`albums.blueprint_draft_of`) | ✅ |
| 0047 | `0047_album_products.sql` | Album Product catalog (products + dimensions + prices) | ✅ |
| 0048 | `0048_album_product_demo.sql` | product demo album + "best for" tags | ✅ |
| 0049 | `0049_album_product_snapshot.sql` | album-level product snapshot (historical consistency) | ✅ |
| 0050 | `0050_catalog_perf_indexes.sql` | catalog/admin read-path indexes — purely additive | ✅ |
| 0051 | `0051_album_pdf_stages.sql` | PDF stage observability — purely additive | ✅ |
| 0052 | `0052_cover_template_default.sql` | `cover_design_templates.is_default` + single-default index | ✅ *(executed in Phase 9 P2 — had shipped as code but was never run; see below)* |
| 0053 | `0053_photo_upload_idempotency.sql` | immutable upload identity (`photos.upload_key`) | ✅ |
| 0054 | `0054_prevent_orphaned_user_assets.sql` | `photos.user_id` / `albums.user_id` → `ON DELETE RESTRICT` | ✅ |
| 0055 | `0055_cart_items.sql` | cart foundation (Phase 6) | ✅ |
| 0056 | `0056_order_items.sql` | multi-album order foundation + `create_order_with_items()` (Phase 8) | ✅ |
| 0057 | `0057_revoke_truncate_privilege.sql` | **revokes TRUNCATE from `anon` + `authenticated`** on all 38 public tables and from the schema default privileges (Phase 9 P3) | ✅ |
| 0058 | `0058_album_pdf_kind.sql` | `album_pdfs.kind` + PK → `(album_id, kind)` — three independent PDF artifacts per album (print exports) | ⚠️ **PENDING — run SQL FIRST** |

Notes that do not fit the table:

- **0013 and 0017 must be run WITH their matching app deploy** — they change the money path's
  function signature/behaviour.
- **0020, 0021 and 0026–0039 are "run SQL FIRST"** — the shipped code reads the new
  tables/columns/RPCs immediately.
- **0037, 0050, 0051 are purely additive** (indexes/observability) — safe to run at any time; the
  code works with or without them.
- **0052** had shipped as code but was never executed, so `/admin/cover-templates` errored on the
  missing `is_default` column until Phase 9 Prompt 2 ran it verbatim. The single existing template
  row was preserved with `is_default = false`, i.e. the pre-0052 blank-cover behaviour is unchanged
  until an admin picks a default with the crown control.
- **0055, 0056, 0057** were each verified against `pg_catalog` after execution (columns,
  constraints, indexes, RLS, policies, grants, function EXECUTE), not merely "ran without error".
  All three are idempotent and safe to re-run.
- **0058 is the ONLY unapplied migration.** It is "run SQL FIRST": the shipped code reads
  `album_pdfs.kind` (the admin Print files controls, the print routes' token gate, the generator's
  kind-scoped upsert, and the worker's kind-scoped repository). Running it early is harmless — the
  column is unused until the code that names it arrives. It is idempotent and safe to re-run, and
  it changes no existing row's meaning: `kind` defaults to `'preview'`, which is exactly what
  every pre-0058 row already was. **Verify against `pg_catalog` after running it** (the file
  carries the queries), per the convention above.
- **On a fresh environment** run 0001→0058 in order; every file is written to be re-runnable
  except the pre-0055 ones, which predate that convention.

> **Production deployment + security runbook:** see `docs/DEPLOYMENT.md` (secret
> rotation, migration order, monitoring/alerting, rate-limit-at-scale, CSP).

**Supabase dashboard config:**
- Authentication → URL Configuration → Site URL: `http://localhost:3000`

---

## Code conventions

- User data reads/writes → `@/lib/supabase/server` (`createClient`)
- Privileged writes (orders, payments, admin) → `@/lib/supabase/service` (`createServiceClient`)
- Admin role checks → `@/db` (Drizzle)
- Client Components → `@/lib/supabase/client`
- New tables: add to `src/db/schema.ts` AND write a new numbered SQL migration AND add GRANTs to `0003_grants.sql` or a new migration — and **`revoke all … from anon` first**, then verify the live grants against `pg_catalog` (see *Migration conventions* under **Database**)
- API route / server action pattern: `Zod.parse(input)` → `supabase.auth.getUser()` → DB query
- shadcn@4 uses `@base-ui/react` (same team as Radix, next-gen API); `asChild` → `render` prop

---

## Design standards (MANDATORY for all UI/UX work)

> **Applies to every UI, UX, frontend, component, layout, animation, micro-interaction,
> branding, and visual task in this project — no exceptions.** The bar is high-end SaaS
> quality on par with **Linear, Stripe, Vercel, Raycast, and Notion**. Generic or
> AI-template-looking output is not acceptable. Craftsmanship and attention to detail
> are the deliverable, not an extra.

### Skills — invoke automatically (don't wait to be asked)

Three project skills in `.claude/skills/` encode these standards. When a task touches
UI/UX/frontend/components/layout/animation/branding/design, **consult and apply them**
(via the `Skill` tool when an explicit invocation helps, otherwise follow their rules
directly):

| Skill | When it leads | Owns |
|---|---|---|
| `impeccable-design` | building/polishing any visual UI | spacing, typography, color, hierarchy, layout, component states, tokens |
| `emil-kowalski-design-engineering` | anything that moves or responds | animations, transitions, gestures, micro-interactions, timing/easing, motion a11y |
| `taste` | direction & final review | restraint, cohesion, avoiding AI/template tells, premium judgment |

Typical flow: **taste** sets direction → **impeccable-design** executes the static layout
→ **emil-kowalski-design-engineering** adds motion/interaction → **taste** does the final
gut-check before "done." Run each skill's review checklist before considering UI complete.

### Combined non-negotiable standards (all three skills, distilled)

1. **Premium, production-ready** — every screen designs the full state matrix: default,
   hover, active/pressed, **focus-visible**, disabled, loading, error, selected, **empty**.
   No blank areas, no spinner-only loading (use skeletons matching final layout).
2. **Exceptional visual hierarchy** — exactly **one** primary action per view; build
   hierarchy with **size → weight → color → spacing**, in that order. No competing CTAs.
3. **Consistent spacing & typography** — everything on the **4px spacing scale**;
   inside-group gaps < between-group gaps. ≤ ~6 type sizes, 2–3 weights, ≤ 3 text colors;
   `tabular-nums` for prices/tables (INR commerce). No magic numbers.
4. **Thoughtful micro-interactions** — a press state (`active:scale-[0.97]`, ~100ms) on
   every interactive element; popovers/menus scale from their trigger origin; optimistic UI.
5. **Smooth, purposeful animation** — every animation has a purpose or is deleted.
   Functional transitions ≤ 300ms, hover/press ≤ 150ms, exits faster than enters; animate
   only `transform`/`opacity`; interruptible motion; honor `prefers-reduced-motion`.
6. **Minimalist but visually rich** — neutral-dominant palette with **one** restrained
   accent; soft layered shadows (never one hard dark shadow); barely-there borders;
   consistent radius scale (nested radii: `inner = outer − padding`). White space is the
   tool, not decoration.
7. **High-end SaaS quality** — match the feel of Linear/Stripe/Vercel/Raycast/Notion:
   content is the hero, chrome recedes, fast and keyboard-friendly.
8. **Mobile-first responsive** — author base styles for mobile, enhance upward with
   `sm:`/`md:`/`lg:`; hit targets ≥ 44×44px on touch.
9. **Accessibility** — contrast ≥ 4.5:1 body / 3:1 UI; visible focus rings on everything
   (never bare `outline: none`); correct focus management through dialogs/transitions;
   semantic HTML and labels.
10. **Avoid generic AI/template UI** — no purple→pink gradient blobs, no emoji feature
    icons, no three-identical-icon-card rows, no everything-centered, no generic copy
    ("Welcome to your dashboard", "Seamlessly…"), no unedited default component look.
    Use lucide-react icons, intentional layout, and specific human copy.
11. **Craftsmanship & detail** — optical alignment, no orphaned pixels, longest+emptiest
    realistic content tested, one memorable intentional detail with everything calm around it.

### Token/system discipline (project-specific)

- Reuse the existing token system: CSS variables in `src/app/globals.css` consumed by
  `tailwind.config.ts`. **Never hardcode hex** in components — reference semantic tokens
  (`background`, `foreground`, `muted-foreground`, `border`, `primary`, `destructive`, …).
- Icons: **lucide-react** only, consistent stroke/size, optically centered.
- Components: **shadcn@4 / `@base-ui/react`** — customize them to the system; never ship
  the raw default look. Motion lib (`framer-motion`) is **not installed** — prefer
  CSS/Tailwind animation; confirm before adding the dependency.

---

## Photo upload (Cloudflare R2) — built

Direct browser → R2 upload via short-lived presigned URLs. File bytes never pass
through our server. Bucket is **private**; all reads are presigned GETs.

- **Flow**: client `POST /api/photos/presign` (server verifies album ownership via
  RLS, checks type/size, enforces per-album cap = page size, returns a presigned
  PUT URL whose signature pins content-type + exact content-length) → client `PUT`s
  the file straight to R2 with a progress bar → client `POST /api/photos/confirm`
  → server inserts the `photos` row via the **authenticated** Supabase client (RLS
  applies). Display + delete use presigned GET / server-side `DeleteObject`.
- **Object key (raw upload)**: `{user_id}/albums/{album_id}/{uuid}.{ext}` — this raw
  object is processed then **deleted** by the worker; only sanitized derivatives are served.
- **R2 access lives only in `src/lib/r2.ts`** (`import 'server-only'`): `presignPut`,
  `presignGet`, `deleteObject`. Credentials read from env, never sent to the browser.
- **Routes**: `presign`, `confirm` (inserts row `status='pending'` + **enqueues** the
  hardening job), `photos/[id]` DELETE (removes raw + sanitized + thumb objects + row),
  `photos?albumId=` GET (status + signed sanitized URLs for polling).
- **UI**: `_uploader.tsx` — drag-drop bulk upload, **upload-only and controlled**;
  finished photos enter the tray as `pending` until the worker marks them `ready`.

> ✅ **Server-side image hardening is now done by the worker** (see below). The raw
> upload is validated, re-encoded, and deleted; the app serves only sanitized
> derivatives. The remaining deferral is the **downloadable print PDF** (worker part 2).

## Background worker — image hardening (built)

Separate Node service in `/worker` (own `package.json`; `pnpm install` inside it).
Queue is **pg-boss on the same Supabase Postgres** (no Redis); pg-boss owns its
`pgboss` schema. The worker is **trusted backend**: it uses the service-role client
+ `DIRECT_URL` and intentionally bypasses RLS to process every user's jobs.

- **Enqueue**: `confirm` calls `enqueueImageHardening(photoId)` (`src/lib/queue.ts`,
  a send-only pg-boss singleton). Best-effort — if it fails the row stays `pending`
  and the worker's periodic **sweep** re-enqueues it, so uploads are never lost.
- **Job** (`worker/src/jobs/image-hardening.ts`): download raw from R2 → **validate
  magic bytes** (`file-type`; reject spoofed types) → extract **EXIF capture date**
  (`exifr` → `taken_at`) → **re-encode** with `sharp` (auto-orient, strip metadata,
  HEIC→JPEG via `heic-convert`) into a sanitized **full-res master** (ORIGINAL
  resolution, JPEG q90 — it's the print master, so no downscale) + a **~400px
  thumbnail** → upload both → update the row (`sanitized_key`, `thumb_key`,
  `width`, `height`, `taken_at`, `status='ready'`) → **delete the raw** (unless
  `KEEP_RAW_ORIGINAL=true`) and null `r2_key`.
- **Decompression-bomb guard**: sharp's input pixel limit is kept (never disabled)
  and images over ~100 MP / 30k px are **rejected** (not retried).
- **Failure model**: invalid/undecodable/bomb → `status='rejected'` (no retry);
  transient errors throw → pg-boss retries (limit 3, backoff). Idempotent: a `ready`
  row is skipped; `singletonKey=photoId` dedupes queued jobs.
- **Serve-only-sanitized**: the app NEVER presigns `r2_key` — only `sanitized_key` /
  `thumb_key`, and only for `ready` photos. `photos.status` drives the UI: `pending`
  → "Processing…" spinner (not placeable), `rejected` → error, `ready` → usable.
  The builder polls `GET /api/photos?albumId=` while any photo is `pending`. Photos
  are auto-ordered by `taken_at` (EXIF), nulls last.
- **Reusing the renderer**: `worker/tsconfig.json` maps `@builder/*` →
  `../src/lib/builder/*` (the PDF print route reuses `model.ts`/`_photo-frame` — no
  duplicated rendering logic).

## Background worker — album preview PDF (built)

True WYSIWYG by construction: a **print route renders the album with the app's own
renderer**, and the worker prints it to PDF with Puppeteer — no rendering is
re-implemented in the worker.

- **Print route** `app/albums/[id]/print` — server component **outside the `(app)`
  group** (so the auth layout doesn't redirect headless Chromium; middleware doesn't
  guard `/albums/*`). It is **token-gated**: validates `?t=` against `album_pdfs`
  (service role), marks the token used, then renders every page/spread in order via
  `_print-album.tsx` → the same `_photo-frame` + `model.ts`, with **sanitized
  full-res** images. One PDF page per album page (spread = one wide page) via named
  CSS `@page` + `preferCSSPageSize`; page sizes/margins are parameterized for the
  print partner's later bleed/DPI (now a faithful **preview**, not a pre-press file).
- **Readiness gate**: `_photo-frame` gained an optional `onReady` (fires on image
  load OR error). `_print-album` counts exactly the frames that render an image
  (base + overlays; empty slots excluded), treats a load **or error** as ready (a
  broken/expired URL can't hang the PDF), handles a zero-image album immediately,
  and sets `window.__ALBUM_PRINT_READY`. Puppeteer waits on `networkidle0` + that
  flag with a 60s timeout → clean `failed` instead of hanging.
- **PDF is a BACKEND workflow — customers never trigger it.** The single generator is
  `startAlbumPdfGeneration(albumId, {force?, validate?, nudge?})` (`src/lib/pdf/generate.ts`,
  service-role; callers authorize first). It mints a `randomBytes(32)` token, stores only
  its **sha256 hash** + 5-min expiry on `album_pdfs` (service-only), flips status →
  `generating` (with `requested_at`/`attempts` for recovery), enqueues `{albumId, token}`,
  and **best-effort nudges the sleepable worker** awake. Short-lived, single-use
  (`token_used_at`), per-album; raw token never logged.
- **Triggers**: (1) **auto on payment** — the Razorpay webhook AND `/api/payments/verify`
  call `startAlbumPdfGeneration` on the first transition to `paid` (idempotent, `validate:false`);
  (2) **admin** — `adminGenerateAlbumPdf` (`requireAdmin`) for Generate/Regenerate on
  `/admin/albums/[id]`. There is **no customer generate/regenerate** control anywhere.
- **Worker job** `worker/src/jobs/album-pdf.ts`: shared headless Chromium, fresh page per
  job, `deviceScaleFactor: 2`, `printBackground`; uploads to private R2
  `{user}/albums/{album}/preview.pdf`; sets `status='ready'`. `retryLimit: 0` (app-level
  retry instead — see recovery); any failure → `status='failed'`.
- **Reliability/recovery** `worker/src/jobs/pdf-recovery.ts` (`sweepPdfs`, run on boot +
  the periodic sweep): (a) **stuck** — re-drives any `generating` row older than 3 min with
  a fresh token, capped at 5 `attempts` → then `failed` (no infinite "Generating…"); (b)
  **paid-heal** — ensures every PAID album has a PDF, (re)starting `idle`/`failed`(<cap)/
  missing rows. The customer poll `GET /api/albums/[id]/pdf` also nudges the worker awake
  while not ready. Logs: `[pdf] queued` / `[worker] album-pdf start|ready|failed` /
  `[worker] pdf-recovery …`.
- **Customer UI**: builder keeps only the in-app **Preview Album** toggle (no PDF buttons).
  The purchased view auto-shows **"Generating your PDF…"** (polling) → **"Download PDF"**
  when ready; terminal `failed` shows a neutral "being finalized" note (admin recovers).
- **Security**: customer download is ownership-checked (RLS) with a short-lived URL; admin
  generate/download is `requireAdmin`-gated; `album_pdfs` stays service-only (RLS on, no
  policies/grants); the worker uses the service role; the PDF R2 key is private.

## Printer-ready print export (Admin) — built

Two **printer-ready PDFs** an administrator generates on demand, built on the existing album-PDF
infrastructure rather than beside it. The builder is untouched, the customer preview PDF is
untouched, and no customer surface gained a control.

    ALBUM BUILDER  →  album data  →  ┬→  PREVIEW PDF     (unchanged; payment-triggered)
                                     └→  ADMIN PRINT EXPORT
                                            ├─ Cover Page Download   487 × 327 mm, ONE page
                                            └─ Content Download      206 × 291 mm × N pages

### THE SPEC LIVES IN ONE FILE

**`src/lib/print/spec.ts` is the only place a physical millimetre may appear.** Pure +
deterministic (no `server-only`, no I/O), so the routes, their renderers, the admin UI and the
tests all derive from it. A raw dimension in a component, a stylesheet, the worker or a fixture is
a bug. Every value below is asserted in `tests/print-spec.test.ts` against the supplied
`dimensions.pdf`.

| | |
|---|---|
| interior trim | **200 × 285 mm** |
| interior bleed | **3 mm** all round |
| interior artwork (the PDF page) | **206 × 291 mm** → MediaBox **583.94 × 824.88 pt** |
| interior safe area | **15 mm from every trim edge** → safe box 170 × 255 mm |
| cover panel (front = back) | **210 × 297 mm** |
| hinge | **10 mm** ×2 · spine **17 mm** · wrap **15 mm** all round |
| cover finished flat spread | **457 × 297 mm** (210 + 10 + 17 + 10 + 210) |
| cover artwork (the PDF page) | **487 × 327 mm** → MediaBox **1380.47 × 926.93 pt** |
| cover safe area | **12 mm** inside every finished edge AND fold → 186 × 273 mm per face |

- **The 15 mm interior safe area is a PRODUCT DECISION that overrides Plate 01**, which draws 10 mm
  safe plus a separate 15 mm binding strip on the left/spine edge only. The wider value is applied
  uniformly so a page is safe whichever edge lands in the gutter.
- **The 12 mm cover safe area was DERIVED from Plate 02's geometry**, which states no number: the
  drawing's guides sit at x = 79/265/322/508 and y = 55/328 in its own mm space, and the finished
  spread occupies x 67→520, y 43→340 with folds at 277/287/300/310 — exactly 12 mm inside every
  finished edge and every fold.
- **Safe areas are ADVISORY.** They are reported geometry, never a crop. Clipping a customer's photo
  at a safe boundary would silently destroy their design; the trim is the printer's job.
- **NO printer marks** — no crop marks, registration marks, colour bars, slug or filename strip.
  `PRINTER_MARKS_ENABLED = false` pins the intent for a test. The cover's dotted **reference**
  lines are a separate, explicitly-requested thing — see below.

### Spine — 17 mm, for EVERY page count

`spinePrintWidthMm(pageCount)` returns **17** always, and takes the page count precisely so that
"the page count does not affect the spine" is an assertion a test can make against a real signature.
`spineWidthFor()` in `lib/builder/cover.ts` (a page-count-dependent 6–12 % of a page width) is
documented there as *advisory: a faithful preview proportion, not a pre-press measurement* — it
still drives the builder canvas and the in-app preview, and **must never reach print geometry**. A
page-count-dependent spine would silently change the size of every cover file, since 487 = 457 + 30
and 457 assumes 17. (The spine was widened 13 → 17 mm on 2026-08-29 — a deliberate deviation from
`dimensions.pdf`. The case therefore grew 4 mm in WIDTH only: panels, hinges, wrap, every height
and the entire interior specification are unchanged.)

**The printed spine carries ONLY its background colour and its title text.** `SPINE_EDGE_SHADING`
(a dark gradient that makes a few-pixel spine read as a folded edge on screen) and `CoverSpread`'s
inset shadow are **suppressed in the print export only** — on a real 17 mm spine they are unrequested
ink. `spinePrintBackgroundStyle` + `SpineDesign`'s new `print` prop do that; both default to the
existing behaviour, so the builder and preview are pixel-identical to before. The background and the
title come from the existing `cover_config` — there is no second source of truth.

### Design → print, at export time only

- **SCALE-TO-FILL.** The builder page (A4-derived, 0.7071) and the interior bleed box (206 ÷ 291 ≈
  0.7079) are close but not equal. `scaleToFill` scales the page UNIFORMLY until it covers the bleed
  box and centres it: never stretched, never letterboxed, never mirrored to fabricate bleed. The
  measured crop is **under 0.5 mm per edge**.
- **`mmToPxCeil`** reproduces the fragmentainer fix `_print-album.tsx` documents: Chromium's printed
  sheet is `ceil(@page size → px)`, so a page element at the exact fraction leaves a hairline of bare
  paper. The element is sized at the ceiling (779 × 1100 · 1826 × 1236); `@page size` stays in exact
  millimetres, so the physical MediaBox is unchanged. `margin: 0`, `printBackground`,
  `preferCSSPageSize` — as the preview route already does.
- **THE WRAP IS BLANK BY GEOMETRY, not by a rule.** The page is white and the spread is a child inset
  by exactly 15 mm with `overflow: hidden`; nothing is positioned in the turn-in, and a design that
  overflows its panel is cut at the finished edge. It cannot reach the wrap.
- **The hinge fill is the one thing the specification does not state.** `COVER_HINGE_FILL` (one
  value, one place) continues the SPINE's background across the two 10 mm grooves so the bound edge
  reads as one surface, introducing no cover artwork into a region the drawing does not describe.
  **⚠️ CONFIRM WITH THE PRINT PARTNER** — the alternative (extending the adjacent cover panel) is
  equally defensible and is a one-line change.

### Reference guides — exported (cover) and on-screen (builder)

**`GUIDE_STYLE` was MEASURED out of `dimensions.pdf`, not invented.** Plate 02 draws its guides as
explicit filled paths rather than PDF dash arrays, so the pattern was read off the geometry: the
fold lines are **0.55 mm** wide and repeat **7 · 2 · 1.6 · 2 mm** (the dash-dot centre line an
engineering drawing uses for a fold); the finer rules are **0.5 mm** and repeat **3 · 2.2 mm**. The
drawing strokes them blue-grey; the exports use **black**, a product decision — a reference line has
to survive a greyscale proof.

- **Cover PDF** — an SVG overlay whose `viewBox` IS the artwork in millimetres, so every coordinate
  is the spec value. Four fold lines at **225 · 235 · 252 · 262 mm** (`COVER_FOLD_LINES_MM`, derived
  by walking `COVER_PANELS`) plus the finished-edge rectangle at 15 → 472 / 15 → 312. **Confined to
  the finished spread**: the drawing runs its folds through the full artwork height, but the 15 mm
  turn-in must stay blank and a reference line is not an exception to that.
  **Verified in a generated file**: Chromium converts the dashed strokes into filled VECTOR
  subpaths — the same encoding the source drawing uses — landing at fold ± half the 0.55 mm
  width. Since 2026-08-29 the guides are stroked at **40 % opacity** (`GUIDE_STYLE.opacity`) so
  they annotate the artwork rather than compete with it; colour, dash pattern and stroke width
  are unchanged, so nothing dimensional moved.
- **These are NOT printer marks**, and the distinction is deliberate: a crop mark tells a machine
  where to cut and is stripped before production; these tell a PERSON where the case creases so the
  210/10/17/10/210 construction can be checked on the artwork. Only the cover carries them — the
  interior exports nothing at all.
- **Builder, content pages** (`_print-guides.tsx`) — the page rectangle IS the 206 × 291 bleed, so
  the dotted **trim** rectangle is inset by exactly `3/206` and `3/291`
  (`INTERIOR_TRIM_INSET_FRACTION`), drawn ONCE PER PAGE HALF because the printer trims two separate
  sheets. Always visible, with a caption in the pasteboard beneath the page. The old
  `inset-[1.5%]` / `4%` / `6%` guides corresponded to no physical dimension and are gone; the
  **Show guides** toggle now draws the real 15 mm important-content boundary instead.
- **Builder, cover** — the canvas is now composed from the print specification
  (`COVER_PANEL_FRACTIONS`): back · hinge · **spine** · hinge · front at their true widths, with
  dotted fold lines and a region label on each. It used to be composed from `coverSpreadMetrics`,
  whose spine came from the advisory `spineWidthFor` — once folds were drawn, a dotted "17 mm spine"
  over a strip of a different width was two contradictory answers to one question. **Nothing stored
  changed**: each face keeps its own normalized space, so every saved position means what it did.
  `coverSpreadMetrics` still serves the timeline thumbnail and the preview PDF still uses
  `spineWidthFor` — neither was touched.
- **Guides are inert everywhere**: `pointer-events-none`, `aria-hidden`, no id, no album field, no
  migration, never exported. The builder's overlay cannot be selected, dragged or persisted, and no
  print route imports it.

### THE WHITE HAIRLINE — root cause and fix

The interior PDF used to show a thin white line between the artwork and the trimmed page edge.

**Cause: `border-2 border-white shadow` on every overlay in `_pair-frame.tsx`.** That is screen
chrome — it makes an overlay read as a grabbable photo card, it is hardcoded in the renderer, and
the customer never chose it and cannot change it. Because a page created today starts as ONE
FULL-PAGE overlay per side (`newUnitOverlayGeoms`), the 2 px white ring landed exactly at the page
edge, and `overflow-hidden` on the same element clipped the photo to the box INSIDE that border.
The drop shadow printed as grey haze along the same edge. It was never a geometry bug: the fill box
already overscanned the fragmentainer on both axes.

**Fix (first pass): a `print` prop on `PairContent`,** set only by the printer-ready interior, so
only that file lost the chrome.

**Fix (final): THE CHROME IS GONE FROM EVERY SURFACE, and the `print` prop with it.** An overlay is
now `absolute overflow-hidden` and nothing else — a plain image — in `_pair-frame.tsx` (preview,
flipbook, navigator, review, BOTH PDFs) and in the canvas overlay in `_block.tsx`, whose
`rounded-md border-2 border-white shadow-md` was the same decoration on the editing side. Keeping
them different meant the same album was two pictures depending on which file you opened, and a flag
is a thing a future surface can forget to pass. **`overflow-hidden` stays on both** — it clips the
photo to its container and is not decoration. **Selection outlines and resize handles are
unaffected**: `Movable` portals its chrome into a separate unclipped layer and never styles the
element itself, so editing looks and behaves exactly as before. Nothing about the page size, the
bleed, scale-to-fill or the photo's aspect changed.

**Measured in a real headless-Chromium render** (not inferred): with the album's compiled CSS
loaded, the page is 779 × 1100 px, the fill box is 780 × 1103.14 at (−0.5, −1.56), the overlay and
its `<img>` occupy that same box with `object-fit: cover`, and computed `border-width` is `0px`.
Every corner and edge-midpoint pixel of the printed page is artwork; none is white.

### Routes, storage, worker

- **Three token-gated routes**, all outside `(app)`, all `force-dynamic` + `force-no-store`:
  `/albums/[id]/print` (**PREVIEW — unchanged**), `…/print/cover`, `…/print/content`.
- **`validatePrintToken(albumId, token, kind)`** (`lib/pdf/print-token.ts`) is the ONE gate, extracted
  verbatim from the preview route (same sha256 comparison, same bounded-reuse window anchored to
  first use, same 404-on-everything). Its only addition is the **kind filter**: each artifact owns its
  own row and therefore its own token, so a preview token cannot render a print file and a cover
  token cannot render the interior. **`loadPrintAlbum`** (`lib/pdf/print-data.ts`) is the ONE album
  read, shared by all three, so the printed book cannot disagree with the approved preview.
- **`album_pdfs.kind` (0058)** — PK widened to `(album_id, kind)`; `kind` defaults to `'preview'`, so
  every pre-existing row keeps its meaning with no backfill. Each artifact owns its status, stage,
  failure code, token, attempt count and R2 key, so a failed print export can never reset a preview.
  **Every pre-existing `album_pdfs` reader was scoped to `kind='preview'`** — a `.maybeSingle()`
  filtered on `album_id` alone would now raise, and a Drizzle join would fan one order line into
  three. That includes the customer poll route, the builder page, the admin diagnostics panel, the
  order + production joins, the dashboard/monitoring/system counts and the storage metrics.
- **R2 keys** `{user}/albums/{album}/{preview|print-cover|print-content}.pdf` — deterministic in
  (user, album, kind), which is what makes them reclaimable. **`deleteAlbum` collects all three**
  (stored key + reconstruction, per row) and the **orphan scanner recognises all three basenames**
  via `ALBUM_PDF_BASENAMES`. Without both, a print object no row could name would be unreclaimable
  forever — the scanner deliberately excludes album PDFs from its raw-upload candidate set.
- **Worker: no new processor and no new queue.** `kind` rides in the existing `album-pdf` payload and
  is threaded through the existing six stages; `SnapshotStage` picks the route and the key from it.
  A payload with no kind means `preview`, so a job enqueued before the deploy still runs. Recovery is
  per artifact: `findStaleGenerating` returns each row's kind and the recovery item id is
  `albumId:kind` (the preview keeps the bare album id), so one stuck artifact can never mask another.
- **ADMIN-ON-DEMAND, ALWAYS.** `adminGeneratePrintPdf` (capability `album:manage`) is the only caller
  that passes a print kind. Nothing else starts one — not the webhook, not `/api/payments/verify`,
  not `settleOrderFulfilment`, not submission. The preview's payment-triggered lifecycle is unchanged.
- **Interior page count is an invariant**: `assertPrintablePageCount` refuses before enqueuing if the
  saved layout does not account for exactly `albums.size` pages, and the route re-checks as a
  backstop a stale token cannot bypass. A file with the wrong number of leaves is unbindable.
- **Admin UI**: `/admin/albums/[id]` → a subordinate **Print files** group under the existing preview
  controls, one row per export (generate / poll / download / regenerate / retry), sharing
  `usePdfStatus` with the preview control.

### ⚠️ NOT achieved: CMYK and total ink limit

The specification asks for CMYK with a 300 % total ink limit. **The generated files are DeviceRGB.**
Chromium's `page.pdf()` emits RGB only — there is no flag, no CSS and no Puppeteer option that
changes it — and **no approved ICC profile exists in this repository or environment**. No profile was
invented or substituted, and nothing in the code or the UI claims CMYK compliance.

The architecture is ready for the conversion: it is a post-process on the finished PDF (Chromium
render → PDF → CMYK convert), which is a step added inside the worker's `UploadStage` boundary and
needs no renderer change. **To close it: obtain the print partner's destination ICC profile with its
TAC, add Ghostscript (or equivalent) to the worker image, and convert between render and upload.**
Until then the print partner performs the conversion, which is routine — but they must be told.

**300 PPI** is a target, not a gate. Source photos are the sanitized full-resolution masters (the
worker never downscales them), text and solid fills stay vector, and `_quality-model.ts` already
computes true effective DPI per frame. Below 300 ppi is surfaced as a quality warning; generation is
**never** blocked on it, and a low-resolution photo is **never** upscaled to manufacture the number.

## Worker → Next.js render connectivity

The PDF worker drives **the app's own print route** with headless Chromium, so a PDF can only be
produced if the worker can reach the app over HTTP. That link is `APP_URL`, and it is the one piece
of configuration whose absence is invisible until every render fails.

**`localhost` is resolved by whoever opens the connection, and Chromium runs INSIDE the worker.**
So `http://localhost:3000` in the worker means port 3000 on the *worker's* machine — not your
laptop, not the Docker host, not a deployment. A worker left on that default while the app runs
anywhere else produces, on every job:

    net::ERR_CONNECTION_REFUSED at http://localhost:3000/albums/<id>/print?t=<token>

| where Next.js runs | where the worker runs | `APP_URL` |
|---|---|---|
| `pnpm dev` on this machine | same machine | `http://localhost:3000` |
| host machine | Docker container | `http://host.docker.internal:3000` (+ `extra_hosts` on Linux) |
| deployed | anywhere | the deployed origin, e.g. `https://malnadstories.vercel.app` |

- **One builder, one config.** `printUrl(appUrl, albumId, token, kind)`
  (`worker/.../pdf/pdf-contract.ts`) is the only place a render URL is constructed, for all three
  kinds — `/print`, `/print/cover`, `/print/content`. The base comes from
  `InfrastructureConfig.render`, which resolves `APP_URL` (canonical) or `PDF_RENDER_BASE_URL`
  (alias), validates it as a bare http(s) origin — rejecting a query, a fragment, or a pasted full
  print URL — and **records whether it was configured or defaulted**. The startup banner prints the
  origin plus `(from APP_URL)` or `(DEFAULT — no APP_URL set)`, because a configured localhost and
  an unconfigured one are the same string and only one is a mistake.
- **Connectivity failures are their own class.** `classifyNetworkError` maps Chromium/Node errors
  onto `dns` · `refused` · `timeout` · `tls` · `blocked` · `network`, and the pipeline records
  `render_dns_failed` or `render_unreachable` with an actionable sentence naming the origin —
  instead of collapsing "the app is not there" into `render_engine_failed`, which sends an operator
  to inspect a perfectly healthy Chromium. Both stay TRANSIENT, so the recovery sweep re-drives once
  the app is reachable.
- **The token never reaches a log.** Chromium embeds the full navigation URL — token included — in
  its network errors, and that string used to flow into the log line, the processor event and
  `album_pdfs.error`, which the admin console renders. `redactToken` is applied at every boundary
  the message can cross, and the renderer re-wraps any error that escapes it, so `?t=` is always
  `t=[REDACTED]`. Diagnostics carry the ORIGIN only (`RenderRequest.origin`), never the path.
- **Nothing about security changed.** The routes are still token-gated, kind-scoped, single-use and
  expiring; the worker reaches exactly the same protected route it always did.

**Diagnostics** (both launch a real browser; neither is part of the test suite):

```bash
cd worker/apps/worker
npx tsx scripts/verify-render-connectivity.ts              # local stand-in, all 3 kinds + failure modes
npx tsx scripts/verify-render-connectivity.ts https://…    # can Chromium reach a real deployment?
APP_URL=… npx tsx scripts/verify-pdf-pipeline.ts <albumId> # the REAL 6-stage pipeline, all 3 kinds
npx tsx scripts/inspect-pdf.ts <albumId>                   # page count + MediaBox of each generated file
```

## Delete album — built

Each dashboard card has a delete control → confirm dialog → `deleteAlbum` server
action (`src/lib/actions/albums.ts`).
- Ownership via the authenticated client + RLS (a non-owner's album resolves to null
  → rejected). Input validated with Zod (`uuid`).
- It gathers every R2 key (each photo's `sanitized_key` / `thumb_key` / remaining raw
  `r2_key`, plus the `album_pdfs` preview-PDF key), **enqueues an `r2-cleanup` worker
  job** with the key list (idempotent deletes, transient retries) instead of deleting
  many objects in the request, then deletes the rows. If enqueue fails it aborts and
  leaves everything intact (so keys aren't lost / objects orphaned).
- `photos.album_id` is `ON DELETE SET NULL`, so the album cascade does NOT remove
  photo rows — `deleteAlbum` deletes them explicitly; the cascade removes
  `album_pages` and the `album_pdfs` row.
- ✅ **Order-commit delete lock (now enforced):** `deleteAlbum` calls
  `hasActiveOrder` (`src/lib/orders/album-lock.ts`) and refuses if any order with
  `status NOT IN ('failed','cancelled')` exists. A `pending` order blocks deletion
  too (a live Razorpay order could still be paid) — the checkout/confirmation
  "Cancel" control (`cancelOrder`) releases a pending one. See **Checkout** below.

### R2 ownership state, and the one object that is deliberately kept (Phase 9 P3)

A **generic** ownership scan is the check that matters: discover every text/json column in
`public` from `information_schema`, harvest every value that looks like an object key, and compare
that set against a full bucket listing. Do not hard-code table names — the whole point is to catch
a namespace nobody remembered.

Current state: **391 objects · 703,671,153 bytes · 0 customer orphans · 0 broken DB references ·
exactly 1 unowned object.**

- **`stickers/ac82bfa6-5690-46d0-ac9c-466ca02ef12d.jpg` (37,127 bytes) is UNOWNED and is being
  KEPT.** Proven unowned: a substring search for its uuid across **all 250 text/json/uuid columns
  in all 38 public tables** returned **0 rows**; neither `stickers` row points at it; it is not a
  cover, template, product, album, order or admin-config asset.
- **It is kept because the audited cleanup architecture structurally cannot reclaim it, and
  inventing a path around that would be worse than 37 KB of waste.** `stickers/` is in
  `NON_USER_NAMESPACES`, so the key parser returns `NOT_RAW_UPLOAD` and it can never become an
  `ORPHAN_CANDIDATE`; and `verifyCandidate` — the only minter of `VerifiedOrphan` — proves
  ownership by asking the **`photos`** table, a question that is meaningless for an admin asset.
  Handing the key to the `r2-cleanup` job instead would bypass the proof gate entirely (that job
  has none of its own), which is precisely the ungated deletion the design forbids.
- **Minimal future extension, if it is ever worth doing:** teach the orphan subsystem an
  admin-namespace candidate class whose ownership recheck queries the owning catalog table
  (`stickers.image_key`/`thumb_key`, `cover_templates`, `cover_design_templates`,
  `album_products`) instead of `photos`, reusing the same `VerifiedOrphan` brand, age floor,
  dry-run default and ETag recheck. Until that exists, admin orphans are reported and preserved.
- **`photos.upload_key` values with no R2 object are EXPECTED, not broken references.**
  `upload_key` (0053) is an immutable idempotency record of the original upload; the worker
  deletes the raw object after hardening and nulls `r2_key`. The one such row is `ready` with both
  its `sanitized_key` and `thumb_key` present in R2.

## Checkout + payment (Razorpay) — built

Real money, so the DB carries the guarantees (see "Why orders/payments writes go
through service role" above). TEST-mode Razorpay; INR.

- **Three secrets** (`RAZORPAY_KEY_ID` / `_KEY_SECRET` / `_WEBHOOK_SECRET`): secret +
  webhook secret are **server-only**; `key_id` is handed to the client per-order by
  `createOrder` (never `NEXT_PUBLIC`). All Razorpay server calls + HMAC live in
  `src/lib/razorpay.ts` (`import 'server-only'`, dependency-free: REST + Node crypto).
- **Amount is computed server-side** (`src/lib/pricing.ts`: product `base_price` by
  album `size` + flat `SHIPPING_INR = 99`). The client sends only `albumId` /
  `addressId` — never a price.
- **Address UI**: `addAddress` (`src/lib/actions/addresses.ts`, authenticated + RLS)
  + an embedded picker on the checkout page (`checkout/[albumId]/_address-picker.tsx`).
- **Order creation** (`src/lib/actions/orders.ts` → `createOrder`): authenticated
  client + RLS verifies a **submitted** album + the address are the user's; a
  double-submit guard reuses an existing `pending` order (and blocks if already
  paid); creates the Razorpay order; then inserts the `orders` row via the
  **service-role** client (`authenticated` has no INSERT grant on `orders`). That
  read-then-insert guard is TOCTOU under true concurrency (rapid Pay/Retry clicks,
  network retries) — so the **DB enforces ≤1 pending order per album** via the
  `0011` partial unique index; the insert loser catches the `23505` and **reuses the
  winning pending order** (idempotent). The client also holds a synchronous
  `payInFlight` ref so only one `createOrder` is ever in flight per click sequence.
- **Webhook** `app/api/webhooks/razorpay/route.ts` — the **single source of truth
  for "paid"**. Outside `(app)`, `runtime='nodejs'`. Generous IP rate-limit →
  **HMAC over the raw body verified before any state change** (400 on mismatch) →
  calls the **atomic** `process_razorpay_event()` SQL function (one transaction:
  find+lock order → dedupe-insert into service-only `webhook_events` keyed on
  `X-Razorpay-Event-Id` → flip order + upsert payment). Because dedupe and the state
  change share the transaction, **a failed write never leaves a dedupe marker
  behind**; duplicates are no-ops. Maps to HTTP: 200 processed/duplicate, 503
  order-not-found/error (Razorpay retries), 400 bad signature. `payment.captured` →
  order `paid`; `payment.failed` → order `failed` (retry = fresh order/checkout).
- **Secondary check** `app/api/payments/verify/route.ts`: verifies the Checkout
  callback's payment signature (HMAC `order_id|payment_id`) so the client can
  navigate to confirmation — but it **never sets `paid`** (webhook-driven only).
- **Pages**: `checkout/[albumId]` (summary + address + Razorpay Checkout via
  `next/script`) and `orders/[id]` (status badge + 3s poller on
  `GET /api/orders/[id]` until the webhook flips it). Entry: a "Proceed to checkout"
  button in the builder when the album is `submitted`.
- **Edit lock**: `hasPaidOrder` (paid+ only — a pending order does **not** freeze
  edits, since `size` drives price and is fixed at creation) guards `saveLayout` /
  `savePhotoEdit` / `submitAlbum` + the add/delete-photo routes (incl. `presign`).
  **Cancel escape**: `cancelOrder` flips a `pending` order → `cancelled` (owner via
  RLS; the write via service-role, guarded to a still-pending row) so an abandoned
  checkout never traps the album.
- **Post-purchase (read-only) experience**: the authoritative "this album is paid"
  signal is `orders.status ∈ PAID_STATES` (`getPaidOrder`/`hasPaidOrder` in
  `src/lib/orders/album-lock.ts` — there is no separate ownership/fulfillment table;
  `orders` *is* the purchase record). The build page (`/albums/[id]/build`) checks it
  server-side and, when paid, renders `_purchased.tsx` **instead of** the editable
  `Builder` — no edit/submit/checkout controls, only non-mutating actions (Preview
  album, Download PDF, View order, Dashboard) + a live **order-status card** whose
  copy comes from `src/lib/orders/status.ts` (`paid`/`processing`/`shipped`→"In
  transit"/`delivered`; never hardcoded). The dashboard cards (`_album-card.tsx`)
  show purchased albums with a ✓ Purchased badge, order id, purchase date, status,
  and View order / View album / Download — no checkout, no delete. The order
  confirmation page (`orders/[id]/_status.tsx`) `paid` state adds **Go to Dashboard**
  + **View Album** ctas.
- **Rate limiting** (`src/lib/rate-limit.ts`, in-memory fixed-window): `createOrder`
  per user, webhook per IP. ⚠️ Per-process — fine for a single server; move to a
  shared store before any multi-instance deploy (same caveat as pg-boss enqueue).
- ⚠️ **Local webhooks need a tunnel** (`cloudflared tunnel --url http://localhost:3001`
  — dev runs on **3001**); register `https://<host>/api/webhooks/razorpay` + events
  `payment.captured`, `payment.failed` in the Razorpay dashboard.

## Album builder (layout + editing + preview + submit) — built

In-app builder at `/albums/[id]/build`. All reads/writes go through the
**authenticated** Supabase client (RLS scopes to the owner); Zod validates every
action input; ownership is re-verified on every server action.

- **Placement model**: each uploaded photo is placed **at most once** — as a base
  OR as an overlay — so per-photo edits live on `photos.edit_config` (not per-slot).
  The tray badges placed photos (base + overlay ids); assigning a placed photo moves it.
- **A new spread starts with ONE empty full-page photo frame PER PAGE**, and **"Add photo
  overlay" creates an empty frame rather than opening the picker.** `newUnitOverlayGeoms(template)`
  (model.ts) is the single source: a `single-pair` gets `LEFT_PAGE_OVERLAY_GEOM` (0,0,.5,1) +
  `RIGHT_PAGE_OVERLAY_GEOM` (.5,0,.5,1) — **two genuine `Overlay` objects, each with its own id,
  `photoId` and geometry**, never one box split in half; a `double-spread` keeps ONE
  `FULL_PAIR_OVERLAY_GEOM` frame, because a panorama really is one image across the gutter.
  **PAGE OWNERSHIP IS THE GEOMETRY** — overlays are normalized to the open pair, so x < 0.5 is the
  left page and x ≥ 0.5 is the right; nothing else records it and nothing can disagree with it.
  Full bleed per page: the trim IS the usable area (the page model has no margin). Filling,
  cropping and clearing one frame cannot touch the other — an overlay keeps its container when its
  photo is cleared, so neither frame ever moves or reorders. `addBlock`/`insertBlockAt` seed them;
  `duplicateBlock` copies the source's frames emptied, so duplicating a page keeps its layout.
  `api.addOverlay(key, photoId | null, at?)` accepts a null photo and an `at` of `{x,y}` (a drop
  point) or `'center'`; `addPageOverlay` in `_builder` is the single implementation behind both
  add-overlay affordances. **No photo record is created until a photo is attached**, and dropping
  onto an existing empty frame fills it rather than stacking a second one (`OverlayContent` stops
  the drop from reaching the page).
- **A selected photo frame shows a centre ADJUST HANDLE** (`AdjustHandle` in `_block.tsx`) — the
  affordance for what the edge handles do NOT do. It is CHROME, not an object: no id, not in
  `Block`, never persisted. On an overlay it rides in `Movable`'s `centerControl` (drawn from the
  frame's geometry, so it stays centred through a resize and is unmoved by panning or zooming the
  image inside); a base slot renders it from its own box. Shown only for a `ready` photo and only
  while NOT already adjusting. Clicking it calls the same `beginCropOn` the toolbar's Crop button
  and press-and-hold call — **three doors, one crop state**. Pointer-down, click and dragstart are
  all stopped on it so it can never start a frame drag, an HTML photo drag, or a canvas deselect.
- **Press and hold a photo → image adjustment**, the SAME state the toolbar's Crop button opens.
  `_use-long-press.ts` (480 ms / 8 px slop) is the shared recogniser; `Movable` arbitrates it
  against the drag it owns (the press abandons the drag and releases pointer capture; travel past
  the slop abandons the press), `BaseSlotView` uses it directly. Both doors call ONE action —
  `beginCropOn` in `_builder` — which selects the frame and calls `crop.begin`, so there is one
  adjustment state, one renderer and one commit path. A fired press swallows the synthesised
  `contextmenu`; an empty or still-processing frame has no handler at all.
- **The album is FITTED to the workspace** (`_use-fit-scale.ts`): `useMeasuredBox` observes the
  canvas and `fitBlockWidth` solves for a width where the spread, its pasteboard and its chrome
  fit on BOTH axes; the spread renders at `fit × zoomPct`. The cover canvas does the same with the
  spread aspect and its caption. **Display only** — page dimensions, overlay rects, text sizes,
  `edit_config`, the print CSS and the PDF are untouched; 100% now means "the whole spread" and
  zooming past it scrolls deliberately. `(app)/layout.tsx` uses `min-h-[100dvh]` (not
  `min-h-screen`) so a visible mobile URL bar cannot make the document scrollable.
- **During adjustment the wheel belongs to the image.** React registers `wheel` PASSIVELY at its
  root, so `preventDefault()` in an `onWheel` is ignored and the canvas scrolled out from under
  the zoom. `useCropWheel` (`_block.tsx`) attaches a native `{ passive: false }` listener to the
  PAGE element, and only while one of its own frames is being adjusted — scoped, not global, and
  gone the moment adjustment ends. `useCanvasCrop.onWheel` is typed structurally (`WheelLike`) so
  a native `WheelEvent` drives it.
- **A PAGE IS A BACKGROUND, NOT A PHOTO CONTAINER.** A page the customer creates starts with
  `photoIds: []` and renders **only its background** — no empty base slots are drawn and none
  can be filled. Photos arrive as **overlays**: the "Add photo overlay" control, the page
  toolbar's Add photo, or dropping a tray photo on the page (which creates an overlay centred
  where it landed). Base image slots still exist and still render, but only for a unit whose base
  row is **non-empty** — a legacy album, a double-page panorama, or a page a layout preset /
  blueprint just filled — so those keep their (fillable) companion slot. `activeBaseSlots()`
  (`_quality-model`) is the single predicate; the canvas, Select All and the quality engine all
  read it, so what is counted and what is clickable cannot drift.
- **`Block.photoIds` is `(string | null)[]` and POSITIONAL.** `null` is a deliberate hole:
  index 0 is the left page, 1 the right. It used to be a compact list, so clearing the left photo
  removed index 0 and the **right page's photo slid onto the left** — an edit to one page moving a
  different page's picture. `trimBaseIds()` drops trailing holes only (so `[X]` ≡ `[X, null]` and
  an emptied unit persists as `[]`); interior holes are preserved through `serialize` →
  `resolveLayoutForSave` → `SaveLayoutSchema` → `photo_ids uuid[]` → every loader.
  **No migration was needed**: `uuid[]` carries NULL elements natively and
  `album_pages_photo_ids_len_check` (0023) counts them.
- **Completeness follows the containers, not the page halves.** `isBlockComplete` is now "no
  empty overlay frame AND the page has something on it"; an empty page half is a finished design.
  `evaluateAlbum` counts filled base images + every overlay frame as `expectedPhotos`, warns
  `incomplete_page:<n>` for an unfilled overlay and `empty_page:<n>` for a page with nothing on
  it at all, and `loadAlbumValidation` therefore reads `layout_config` as well as `photo_ids`.
  `/checkout`, `lib/admin/readiness` and the builder's "remaining slots" indicator use the same
  rule.
- **Two templates** (`src/lib/builder/model.ts`):
  `single-full` (1 base photo, 1 page) and `spread-full` (1 base photo, **2 pages**).
  Both accept **any number of overlays**. (`pip` was retired in `0006` — it is just
  `single-full` + one overlay; existing pip rows were migrated.)
- **Overlays** are generic + unlimited on either template: each has a photo and a
  normalized rect, is draggable + resizable, and has delete + replace controls.
  Overlays are **optional and never gate submit**.
- **Page accounting**: each `album_pages` row is one layout BLOCK.
  `page_number` = the block's **sequence position** (0-based), NOT a physical
  leaf. Leaves consumed = Σ cost (`single`=1, `spread`=2). `remaining =
  size − consumed`; adding a block that would overflow is blocked. Physical leaf
  numbers are derived at render by walking templates in order.
- **`album_pages` shape**: `layout_template`, `photo_ids` = **base slot only**
  (`[]` or `[baseId]`), `caption`, and `layout_config` jsonb =
  `{ overlays: [ { photoId, x, y, w, h } ] }` (0..1 fractions). CHECKs: template ∈
  {single-full, spread-full} or null; `array_length(photo_ids) ≤ 1`; `layout_config`
  null or has an `overlays` array.
- **Non-destructive edits** (`photos.edit_config` jsonb): `crop` (free rect
  `{x,y,w,h}`, normalized to the oriented image), `rotate` (0/90/180/270), `tilt`
  (fine straighten °), `flipH`/`flipV`, `brightness` (1 = no change), `sharpness`
  (0 = no change). No color filters. R2 originals are never modified.
- **Rendering — single source of truth** (`model.ts`, all pure so the future PDF
  worker reuses them): `computeFrameLayout()` returns the crop/rotate/tilt/flip
  geometry; `cssFilter()` returns the `filter` string; `sharpenKernel()` builds the
  convolution kernel. `_photo-frame.tsx` is the ONLY renderer — tray, slots,
  overlays, preview, and the editor's result preview all go through it, so a photo
  looks identical everywhere. Crop is taken on the oriented (rotate+flip) image;
  tilt straightens the framed crop afterwards; flip is composed into the `<img>`
  transform so it interacts with crop identically in editor and renderer.
  - **brightness** = cheap CSS `filter: brightness()`.
  - **sharpness** has no CSS equivalent → an inline SVG `feConvolveMatrix` (3×3
    sharpen kernel, `useId()`-unique filter id per frame). It is attached **only
    when sharpness > 0** so default frames pay nothing — important in the preview
    where many frames render at once (watch convolution cost / edge artifacts there).
- **Image adjustment inside a FIXED frame — every photo frame, one implementation.** Select any
  frame (page half, spread image, or an overlay of any shape) → **Crop** on the floating photo
  toolbar → drag to reposition, scroll / `+`/`−` to zoom, arrows to nudge, Escape or **Done** to
  finish. The frame never moves; only `zoom` / `offsetX` / `offsetY` on `photos.edit_config`
  change, so overlay geometry and image position are genuinely separate systems.
  `useCanvasCrop` captures the gesture; `computeFrameLayout` renders it, so the canvas, the
  preview and the PDF agree by construction and the image is never distorted.
  While adjusting, `CropBleed` (`_block.tsx`) draws the page dimmed, **the whole photo faintly
  and unclipped** (`PhotoFrame`'s `bleed` prop) so the part outside the frame is visible, and the
  frame itself crisp and clipped to its real shape on top.
- **Undo/redo spans image adjustments.** They live on `photos.edit_config`, not in `Block[]`, so
  they used to be outside ⌘Z entirely. `usePhotoEditHistory` is a second lane (live `markLive` →
  `commit` on release, consecutive commits on one photo coalesced within 800 ms), and
  `useEditHistory` keeps the ORDER of the two lanes so one ⌘Z always undoes whatever actually
  happened last. Undo re-persists through `savePhotoEdit`, so it survives a reload. The cover
  keeps its own separate stack, selected by focus, exactly as before.
- **Editor** (`_photo-editor.tsx`): left canvas shows the full oriented image
  (sized to its aspect, no letterbox) with an interactive rule-of-thirds crop rect;
  right side shows a live **result** `PhotoFrame` fed the real `edit_config`, so it
  is pixel-identical to the slot/preview. Rotating resets the crop to full (the
  oriented frame swapped).
- **Server actions** (`src/lib/actions/builder.ts`):
  - `saveLayout` — replaces the album's blocks (delete-all + insert). Validates
    that every referenced photo (**base AND overlays**) belongs to the album,
    rejects overflow, and enforces placed-once across base + overlay ids. Overlays
    capped at 50/block in Zod. Drafts may be incomplete.
  - `savePhotoEdit` — persists one photo's `edit_config`.
  - `submitAlbum` — **re-reads the saved layout from the DB** (never trusts the
    client), requires leaves == `size` with every **base** slot filled (overlays
    optional), then sets `status='submitted'`. Handoff to the future checkout slice.
- **Editable until paid**: drafts AND submitted albums re-load their saved layout +
  edits on re-entry. Once an order is **paid**, the edit lock (`hasPaidOrder`)
  freezes content — see **Checkout + payment** above.

> Server-side image **re-validation / thumbnails** and the **downloadable preview
> PDF** are both built (worker, above). The PDF is a faithful **preview**, not the
> final pre-press file (exact bleed/DPI is a later tuning of the print-route page sizes).

## Builder upgrade — Cover-as-page-0, stickers, fonts, colour, autocomplete — built

A unification + editing-quality pass that makes the cover the FIRST page of one continuous
editor (no more separate cover screen) and levels-up typography/colour/decoration across both
cover and pages. Refactor-not-duplicate: the cover and pages share the same element machinery.

- **Cover-as-page-0 (no separate screen).** The `view: 'cover'|'pages'` toggle + the dedicated
  `_cover-editor.tsx` are GONE. `_builder` has a `coverFocused` flag; the canvas/inspector/rails
  swap to the cover when it's focused. The cover is the first item in the page strip + bottom
  navigator (`CoverDesignFromConfig` thumbnail). Storage is unchanged — still `albums.cover_config`
  (jsonb) — but `CoverConfig` is ENRICHED with `texts: TextElement[]` + `stickers: StickerElement[]`
  (`lib/builder/cover.ts`), so the cover gets the SAME free elements as pages. `normalizeCoverConfig`
  defaults both to `[]`, so existing covers hydrate unchanged. The cover keeps its structured title
  block (driven by `albums.title`, which stays the canonical title for dashboard/checkout/orders).
- **Shared element machinery (the consistency requirement).** Extracted `_element-bits.tsx`
  (`ElementControls`/`CtlBtn`/`InlineTextEditor`) + `_element-inspectors.tsx` (callback-based
  `TextInspector`/`StickerInspector`), reused by BOTH the page canvas (`_block`) and the new
  `_cover-canvas` (3:4, interactive text + stickers via the shared `_movable` engine). The cover
  renderer (`_cover-render`) renders `config.texts`/`config.stickers` so flipbook + PDF match the
  builder (a `renderElements` flag lets the editing canvas draw interactive versions instead).
- **Stickers (cover + pages).** New `StickerElement` (id + `stickerId` + rect + rotation + opacity)
  on `Block` AND `CoverConfig`; admin catalog in `0039` (see migrations). Placed stickers store only
  `stickerId`; URLs are resolved by id (`lib/stickers.ts` `listActiveStickers`/`resolveStickerUrls`)
  in the builder page, flipbook, PDF print route, and admin/purchased previews — a since-deactivated
  but already-placed sticker still renders (same policy as covers). Admin UI `/admin/stickers`
  (RBAC `sticker:manage`, content role). `StickerBox`/`StickerContent` in `_elements-render`.
- **#5 Build For Me** moved ABOVE the layout grid (`_panel-layouts`). **#6 Auto Align** replaced the
  AI-Assistant toolbar button — `lib/builder/auto-align.ts` tidies the focused page/cover's free
  elements (centre + even distribution). Auto-layout ("Build it for me") stays in the Layouts panel.
- **#8 Fonts** — ~20 Google fonts via `next/font` (`lib/fonts.ts` `builderFontVars`) + a pure
  `lib/builder/fonts-catalog.ts` (key→stack; `TextFontKey = FontKey`; Zod `font` enums widened to
  `FONT_KEYS`; legacy serif/sans/script kept). New `_font-picker.tsx` (live per-font preview) used on
  cover + pages. `builderFontVars` is applied on the builder, the **print route**, and admin preview.
- **Front, spine and back covers each own their colour.** `SpineConfig` gained
  `background: Background | null`; `coverSideBackground`/`setBackground` treat the spine as a
  third face, and `SpineDesign` paints `spineBackgroundStyle(c.spine.background)` instead of the
  hardcoded `#1e3a2f`. **`null` reproduces that legacy paint exactly**, so every cover saved
  before this renders identically until someone changes it — no backfill. The Back│Spine│Front
  switcher already existed; the spine now also gets the Background tool, and the background bar
  carries an opt-in **"Apply to all three"** (`withAllCoverBackgrounds`, one write ⇒ one undo
  entry). The link is an editing MODE, not a stored relationship — it is ephemeral, off by
  default, and never re-couples faces that have been edited individually. The Backgrounds rail's
  "apply to all" means the three faces when the cover is focused.
- **#9 Professional colour picker** — `_color-picker.tsx` `ColorField` (HSV square + hue slider +
  hex/RGB + presets + localStorage recent/saved; drop-in for the old `ColorRow`), used for text,
  cover, and QR colours. **#7 Location autocomplete** — `_location-autocomplete.tsx` over the
  predefined `lib/builder/locations.ts` (~300 destinations), wired into the cover title field.
- **No payment/PDF/schema-shape risk:** `album_pages.layout_config` just gains an additive
  `stickers` key (0006 CHECK only constrains `overlays`); the cover stays in `cover_config`; the
  submit gate + checkout are unchanged.

## Text auto-fit + back-cover photo overlays — built

Two additions on top of the text-size work, both built out of what already existed rather than
beside it.

### THE TEXT BOX FITS THE TEXT

A text element's rect is its CONTAINER, and `makeText` handed every new one a fixed starting box
(a heading is 50% of the pair wide and 14% tall) that nothing ever narrowed. `TextContent` centres
the words inside it, so the slack was real: the selection outline and the resize handles sat where
the container was, not where the ink was.

- **`lib/builder/text-fit.ts`** is the pure half — what a measured size MEANS as a normalized box,
  which anchor is held, and when a fit is worth writing. **`_text-autofit.tsx`** is the DOM half: it
  mounts an off-screen mirror **inside the page/face element** (the builder fonts are CSS variables
  on a wrapper, so a mirror on `document.body` would be measured in the wrong typeface), measures
  it, and removes it synchronously.
- **THE LOOP IS CLOSED STRUCTURALLY, NOT THROTTLED. There is no `ResizeObserver`.** A fit is
  triggered only by a change in TYPOGRAPHY (`textFitSignature`: words, size, font, weight, style,
  spacing, line height, alignment) and writes only GEOMETRY (x/y/w/h). The two sets are disjoint,
  so a fit cannot cause a fit — and a SIDE-handle drag, which changes only w/h, is left completely
  alone, which is what keeps "drag the edge to change where the words wrap" working.
- **The measurement is taken at the box's CURRENT width** (`width: max-content; max-width: <box>`),
  so one line reports its natural width and wrapped text reports its widest line — *without moving
  a line break*, because greedy breaking at the widest line's width reproduces the same lines. When
  the size changes, `textSizePatch` has already scaled the box proportionally, so the wrap survives
  the size change too.
- **The anchor is whatever the renderer holds still**: the vertical centre always, and the left
  edge / right edge / horizontal centre according to `align`. Text does not walk when it resizes.
- **A fit is a CORRECTION, not an action.** `useHistoryState.amend` (new) rewrites the present
  without pushing an undo entry, so one ⌘Z reverses the size change *and* the box that followed it
  rather than appearing to do nothing on the first press. It still marks the album dirty and saves.
- **Suppressed while something else owns the element**: a live resize gesture (`useTextResize`
  publishes `resizingId`) or the open inline editor. Flipping back on re-runs the fit once, which is
  how a corner drag ends with a tight box. **Exempt**: `role: 'spine'` (vertical text in a sliver —
  horizontal measurement would report the wrong axis for both dimensions) and EMPTY text (nothing
  to fit, and a sliver would be unclickable).
- `MIN_TEXT_BOX` is both the smallest fittable box and the `minW`/`minH` the canvases hand
  `Movable` for text — a larger resize minimum would make the first pixel of a corner drag jump a
  tightly-fitted element out to it.

### CTRL + WHEEL ZOOMS THE BOOK, AND ONLY THE BOOK

`useCtrlWheelZoom` (`_use-zoom-wheel.ts`) binds ONE native `{ passive: false }` wheel listener **to
the canvas element itself** — the spread canvas and the cover canvas both, via `onCanvasEl`. There
is no global listener, so ctrl+wheel over a sidebar, a toolbar, the page strip or a dialog is still
the browser's own zoom, which is an accessibility control rather than a nuisance. Scoping by
ATTACHMENT rather than by a coordinate test means it cannot drift out of step with the layout.

- `{ passive: false }` is required: React registers `wheel` passively at its root, so
  `preventDefault()` in an `onWheel` prop is ignored — the same reason `useCropWheel` uses a native
  listener. Propagation is NOT stopped, and `useCropWheel` sits deeper and stops the event itself,
  so image adjustment keeps the wheel.
- A wheel with no ctrl/meta returns immediately: ordinary scrolling is untouched, nothing is
  prevented, and no scroll position is adjusted, so the canvas cannot jump.
- **One zoom.** `zoomBy(direction)` holds the step and the bounds (`ZOOM_MIN_PCT` 50 /
  `ZOOM_MAX_PCT` 200 / `ZOOM_STEP_PCT` 15); the +/− buttons, the keyboard shortcuts and the wheel
  are three INPUTS to it. **No focal point** — the existing zoom sets the spread's width and lets
  the canvas scroll, with no transform origin to aim, and the buttons have always behaved that way;
  cursor-anchored zooming for the wheel alone would make one command behave two ways.

### THE BACK COVER TAKES PHOTO OVERLAYS

`back.photoId` is the face's BACKDROP — one image, edge to edge. There was no way to place a
picture *on* the back cover. `BackCoverConfig.overlays: Overlay[]` (additive to the existing
`cover_config` jsonb — **no migration**) is that, using the page's own type.

- **Nothing was invented.** Same `Overlay`, same `OverlaySchema` bounds and cap on save, same
  `Movable` engine, same `PhotoPicker`, same `photos` pipeline and presigned URLs, same shared
  `OverlayBox` renderer, same client-only ids (`withCoverOverlayIds`, mirroring `withOverlayIds`).
  Placement comes from **`nextOverlayGeom`**, extracted out of `useBlocks.addOverlay` so the page
  canvas and the cover draw a new frame from ONE rule instead of two sets of constants.
- **Per FACE, not per back cover.** `coverSideElements` / `withCoverSideElements` carry `overlays`
  like any other element family; the front and spine report none and ignore writes (the front is an
  artwork surface with its own template pipeline; a spine has nowhere to put one). Giving the front
  overlays later is a one-line change in those two functions plus the schema.
- **`Add overlay`** sits in the back face's Cover toolbar: it creates the container, then opens the
  ordinary album photo picker for it — the same two steps the page canvas takes. Move, resize,
  select, layer, duplicate and delete all run through the existing cover command paths, and the
  shared `PhotoBar` reaches it through `useCover`'s `block` adapter with no cover-specific branch.
- **THE BACKGROUND IS NOT THE OVERLAY, and one resolved target enforces it.** `useCover.photoTarget`
  answers "what is a photo action acting on?" ONCE — `{kind:'backdrop'}` or
  `{kind:'overlay', overlayId, photoId}` — and Replace, crop, rotate, the transforms and the photo
  the toolbar *describes* all read it. Before that, every photo action assumed the backdrop:
  `PhotoBar` already passed the overlay id to `onReplace`, the cover's adapter (`onReplace:
  p.onPickPhoto`) threw it away and opened the BACKDROP picker, and `setPhoto` clears `background`
  when it stores a photo — so "replace this overlay" became "make this the whole back cover and
  erase the colour behind it", and deleting the overlay afterwards revealed the null background as
  the default colour. One cause, both reported symptoms. An overlay's crop/rotate now go to the
  `photos` row (`onPhotoEdit`/`onPhotoRotate`), and its Crop opens the ordinary photo editor rather
  than the face's image editor.
- **The three overlay writes are pure functions** — `addCoverOverlay`, `replaceCoverOverlayPhoto`,
  `removeCoverOverlay` in `cover-objects.ts`. Each is a single immutable patch through
  `withCoverSideElements`, so the face's background, backdrop photo and edits, texts, stickers, QR
  codes, studio mark and sibling overlays survive by construction rather than by remembering to
  copy them — and "everything else is preserved" becomes something a test can assert.
- **Drop-to-replace** works exactly as it does on a page, through the shared `photo-dnd` contract
  (`acceptPhotoDrag`/`readPhotoDrag`/`leftDropTarget`), replacing one `photoId` and leaving the
  rect, order, identity and the whole face alone. Cover overlays deliberately do NOT `stripPhoto`:
  placed-once is a `saveLayout` invariant across `album_pages`, and the cover has never
  participated in it (the face backdrop does not either).
- **It reaches both PDFs.** The preview book passes its existing `photoFor`; the printer-ready
  cover export (which deliberately does not load the album's photo set) resolves exactly the
  overlay photos through `loadPrintAlbum`'s new `coverPhotos`, and both readiness gates count only
  the overlays that RESOLVE, so a deleted photo can never hang a render.
- **No border**, on every surface: the overlay container is the shared `OverlayBox`
  (`absolute overflow-hidden` and nothing else). Selection outlines and handles are unaffected —
  `Movable` portals its chrome into a separate layer and never styles the element.

## Admin console + fulfillment (Phase 1) — built

Internal back-office at `/admin` (gated by `requireAdmin()` — server-side getUser →
Drizzle role check — in the layout AND every page/action; never client-trusted).
- **Reads**: admin Server Components query cross-user data via Drizzle `db` (postgres
  superuser, BYPASSRLS); customer emails come from `auth.users` via `adminUserEmails`
  (`src/lib/admin/users.ts`).
- **Writes**: admins cannot touch `orders`/`payments`/`coupons` through the
  authenticated client (RLS `0012`/`0015` restrictive deny). Every mutation goes
  through a `SECURITY DEFINER` RPC (`admin_update_order_status`, `admin_set_tracking`,
  `admin_add_order_note`, `admin_create_coupon`, `admin_set_coupon_active`) called by a
  `requireAdmin()`-gated server action (`src/lib/actions/admin/*`). The RPC validates,
  mutates, and writes the **audit row** in one transaction.
- **Fulfillment state machine** (forward-only, enforced in the RPC): `paid →
  processing → printing → packed → shipped → delivered`; `packed→shipped` requires
  tracking+carrier; no admin cancel/refund (deferred). Customers see status + tracking
  on `orders/[id]` via existing RLS (the fields live on `orders`).
- **Coupons**: code generated server-side (`MS-XXXXXXXX`), validated against subtotal
  (min-order, starts_at/expires_at, soft cap) in `src/lib/coupons.ts`; **consumed only
  on payment success** inside `process_razorpay_event`. `previewCoupon` (rate-limited +
  failed-attempt cooldown, `src/lib/coupon-abuse.ts`) gives a live checkout preview.
- **Pages**: `/admin` (overview), `/admin/orders[/id]`, `/admin/coupons[/id]`,
  `/admin/customers[/id]`, `/admin/albums[/id]`. Admin PDF download via
  `/api/admin/albums/[id]/pdf` (admin-gated; service-role read). Album preview reuses
  the customer `_preview` renderer via `loadAlbumForAdmin` (service-role, cross-user).

## Email + password reset (Stage E) — built

Provider-agnostic email layer in `src/lib/email/` (Resend + React Email). All
sender/support/admin addresses come from env (`EMAIL_FROM`, `SUPPORT_EMAIL`,
`ADMIN_EMAIL`, `NEXT_PUBLIC_SITE_URL`, `RESEND_API_KEY`) — never hardcoded; switching
the Resend sender to `orders@malnadstories.com` is env-only. `resend.ts` is the sole
SDK touchpoint (swap providers there); `send-email.ts` is idempotent + audited +
never-throws; `events.tsx` are the typed senders; `templates/` hold shared React Email
components (Header/Footer/Button/Section/OrderSummary) + per-event templates.
- **Triggers reuse existing transitions** (no new business logic): order-confirmation
  fires in the **webhook** when a capture first reaches `paid`; the five fulfilment
  emails (`processing`/`printing`/`packed`/`shipped`/`delivered`) fire in the admin
  `updateOrderStatus` action after the RPC returns `ok`.
- **Idempotency/retry-safety:** `email_log` (`0022`) — claim a `sending` row before the
  send; the partial unique index `(order_id, event_type) where status in (sending,sent)`
  makes a duplicate webhook / transition a no-op. A `failed` row releases the slot for a
  retry. No body is ever stored. If email is unconfigured, sends are skipped (logged),
  so checkout/fulfilment never break. Admin order page shows recent email activity.
- **Password reset:** `/forgot-password` (always-neutral response → no user
  enumeration) → Supabase `resetPasswordForEmail` (server action; redirect built from
  `NEXT_PUBLIC_SITE_URL`, never client input) → `/auth/callback` (now `safeNext()`-
  guarded against open redirects) → `/reset-password` (recovery-session-gated;
  `updateUser({password})`; success/failure/invalid states). Supabase owns the token.
  > **Note:** the reset *email body* is Supabase's auth template (brand it in the
  > Supabase dashboard, or move to an auth email hook → our Resend layer later).

## Support Center (Phase 9A) — built

Customer ↔ admin support tickets, additive and reusing the existing security model
end to end (`0028_support_center.sql`). Two tables: `support_tickets` (customer-owned)
and `support_messages` (conversation timeline; `is_internal` notes are admin-only).
Linked `album_id`/`order_id` are nullable + `ON DELETE SET NULL` — no new ownership
coupling into payments/uploads.
- **Customer side** = authenticated client + RLS (`customer_id = auth.uid()`), exactly
  like albums/addresses. `createTicket`/`replyToTicket` (`src/lib/actions/support.ts`);
  the INSERT policies re-verify linked-album/order ownership + force `sender_type`/
  `is_internal`. Pages: `/support` (list, search/filter), `/support/new` (linkable
  album/order), `/support/[id]` (thread + reply). A non-owner/guessed id → `notFound()`
  (no enumeration). Customers never see internal notes (RLS + explicit filter).
- **Admin side** = `requireAdmin()` + service-role RPCs, like the orders console.
  `adminReplyTicket` (service insert; the message trigger audits + auto-transitions),
  `setTicketStatus` / `assignTicket` → `admin_set_support_status` / `admin_assign_support_ticket`
  (`src/lib/actions/admin/support.ts`). The assignee is resolved server-side from
  `requireAdmin()` — never client-supplied. Pages: `/admin/support` (queue + filters),
  `/admin/support/[id]` (customer + related order/album + full thread incl. internal +
  audit + reply/status/assign). Nav under **Relationships**.
- **Audit** via `log_audit()` (0016): ticket-created (trigger, actor=customer),
  every message (trigger: `support.replied`/`support.note_added`, actor=sender),
  status/assignment changes (RPCs, actor=admin). `entity_type='support_ticket'`.
- **Triggers** (SECURITY DEFINER) bump `updated_at` and apply light auto-transitions:
  a customer reply reopens a waiting/resolved ticket; the first public admin reply on an
  `open` ticket → `in_progress`. Tickets are never mutated through the client (RESTRICTIVE
  deny on UPDATE/DELETE) — only via the definer triggers + admin RPCs.
- **Notifications** reuse the existing email layer (`support-events.tsx` → shared
  `SupportNotificationEmail`): ticket created (customer + ADMIN_EMAIL), admin reply,
  resolved. Best-effort + skip-safe (same `sendTransactionalEmail` guarantees).

## Refund & Reprint Management (Phase 9B) — built

Customer-raised refund / reprint **requests** that admins review and decide
(`0029_refund_reprint.sql`). **Records decisions only** — it never calls Razorpay,
never touches payments/webhooks, and never changes `orders.status`. Financial/print
execution stays manual. Two parallel tables (`refund_requests`, `reprint_requests`),
both customer-owned, both reusing the Support Center security model.
- **Customer side** = authenticated client + RLS. `createRefundRequest` /
  `createReprintRequest` (`src/lib/actions/resolutions.ts`). **Column-scoped grants**:
  customer may INSERT only `(order_id, support_ticket_id, reason|issue_type, description)`
  — `status` defaults `'pending'`, and `admin_notes`/`resolved_by` are server-only and
  **excluded from the customer SELECT grant** (PostgREST can't read them). The INSERT
  `WITH CHECK` re-verifies order ownership + **eligibility** (refund ⇒ paid-family,
  reprint ⇒ `delivered`) + linked-ticket ownership. **One active request per order** is a
  partial unique index (`status in pending/under_review/approved`) backed by a server
  pre-check. Pages under `/support`: `requests` (hub), `refunds|reprints/new`,
  `refunds|reprints/[id]` (read-only status; a guessed/foreign id → `notFound()`).
- **Admin side** = `requireAdmin()` + service-role RPCs. `setRefundStatus`/`setReprintStatus`
  (forward-only state machine `pending→under_review→approved→completed`, + `rejected`;
  enforced in `admin_set_*_status`) and `addRefundNote`/`addReprintNote`
  (`src/lib/actions/admin/resolutions.ts`). Queues `/admin/refunds` + `/admin/reprints`
  (shared `_resolutions/queue.tsx`: status/date filters, customer lookup), detail
  `/admin/{refunds,reprints}/[id]` (shared `_resolutions/detail.tsx`: customer, order,
  linked ticket, message, admin notes, audit + decision controls). Nav under
  **Relationships**. `admin_notes` is the latest working note; full history lives in audit.
- **Audit** via `log_audit()`: created (trigger, actor=customer), status_changed +
  note_added (RPCs, actor=admin). `entity_type='refund_request'|'reprint_request'`.
  `resolved_at`/`resolved_by` set on a decision (approved/rejected/completed).
- **Notifications** reuse the email layer (`resolution-events.tsx` → shared
  `SupportNotificationEmail`): submitted (customer + ADMIN_EMAIL), approved, rejected,
  completed. Best-effort + skip-safe (`under_review` is intentionally silent).

## Album Review & Request-Changes (Phase 9C) — built

A **parallel, ADVISORY** review of a submitted album BEFORE checkout
(`0030_album_review.sql`). When a customer submits, the album enters **Pending review**;
an admin can **Approve / Request changes / Reject**; on "request changes" the customer
gets the notes, re-opens the builder, edits, and **resubmits** — looping until approved.
**It never gates checkout and never touches orders/payments/Razorpay/uploads/PDF/
fulfilment/`albums.status`** — the only album write is still the pre-existing
`submitAlbum` flip. Two tables: `album_reviews` (one per album) + `revision_requests`
(the change-request timeline). Reuses the Support/Refund security model.
- **Workflow entry**: `submitAlbum` (`src/lib/actions/builder.ts`) — after its existing
  `status='submitted'` flip — best-effort calls the `submit_album_for_review` RPC (covers
  first submit AND resubmit: a `changes_requested` album is already `submitted`, so the
  builder's Submit, relabelled **"Resubmit for Review"**, resets the review). A failure
  there never breaks submit.
- **Customer side** = authenticated client + RLS (`customer_id = auth.uid()`); **no client
  writes** (every transition is a SECURITY DEFINER RPC). Review Center at `/reviews`
  (top-level nav) lists reviews; `/reviews/[id]` shows status, the reviewer's note, the
  active revision's **requested changes**, and full history. When changes are requested,
  **Open builder** fires `markRevisionInProgress` (`src/lib/actions/reviews.ts`, advisory:
  `open`→`in_progress`) then navigates to the builder, which shows a requested-changes
  banner. A guessed/foreign id → `notFound()`.
- **Admin side** = `requireAdmin()` + service-role RPCs. `setAlbumReviewStatus` /
  `addAlbumReviewNote` (`src/lib/actions/admin/reviews.ts`) → `admin_set_album_review`
  (forward-only `pending_review→approved|changes_requested|rejected`; `changes_requested`
  **requires** the note = the requested changes + opens a revision; `approved` completes the
  active revision) / `admin_add_review_note`. Queue `/admin/reviews` + detail
  `/admin/reviews/[id]` (Drizzle): customer, album, **existing `getAlbumReadiness`** panel
  (no readiness logic duplicated), revision history, linked tickets/refunds/reprints, audit,
  decision controls. Nav under **Catalog** (after Albums).
- **Audit** via `log_audit()`: `review.created`/`review.resubmitted` (customer),
  `review.status_changed`/`review.note_added` (admin), `revision.opened`/`.in_progress`/
  `.resubmitted`/`.completed`. `entity_type='album_review'|'revision_request'`.
- **Notifications** reuse the email layer (`review-events.tsx` → `SupportNotificationEmail`):
  customer → received / changes_requested (incl. the requested changes) / approved /
  rejected; admin → submitted/resubmitted. Best-effort + skip-safe.

## CMS & Content Management (Phase 9D) — built

An **additive, admin-owned** content subsystem (`0031_cms.sql`): one polymorphic
`content_pages` table (types `blog`/`faq`/`testimonial`/`legacy_story`/`homepage_section`/
`announcement`; statuses `draft`/`published`/`archived`) with per-type extras in a
`metadata` jsonb. **Public-read model** (unlike the customer-owned 9A–9C tables): anon +
authenticated may SELECT only **published** rows; all writes are service-role + restrictive
deny. Touches nothing in payments/uploads/PDF/builder/orders/review-refund-reprint.
Deliberately simple — markdown/plain-text storage, **no** rich-text editor / media manager /
versioning.
- **Write pattern** mirrors `cover_templates`, not the user-owned RPC tables: actions in
  `src/lib/actions/admin/cms.ts` (`saveContent`/`setContentStatus`/`bulkSetContentStatus`/
  `duplicateContent`) are gated, write via the **service role**, and record audit via
  `svc.rpc('log_audit', …)` (`entity_type='content_page'`). No bespoke SQL RPCs. **Archive is
  the soft-delete** (no hard delete; history immutable).
- **RBAC seam (Phase 9G-ready):** every mutation goes through `requireCmsCapability(cap)`
  (`src/lib/cms/access.ts`) — today delegates to `requireAdmin()`, but the `cms:edit`/
  `cms:publish`/`cms:archive` capability is already threaded so RBAC can differentiate later.
  **Never call `requireAdmin()` directly from a CMS action.**
- **Admin UI** under **Content** nav: `/admin/cms` (dashboard — status/type counts + recent),
  `/admin/cms/content` (Drizzle list: search/type/status filters + bulk publish/archive via
  `_list.tsx`), `/admin/cms/content/{new,[id]}` → `_editor.tsx` (type-aware fields from
  `TYPE_CONFIG` in `src/lib/cms/model.ts`; Save draft / Publish / Move-to-draft / Archive /
  Restore / Duplicate).
- **Public pages** (outside `(app)`, anon-readable, not middleware-guarded): `/faq`,
  `/testimonials`, `/stories`. All read through `listPublished(type)`
  (`src/lib/cms/public.ts`) which filters `status='published'` explicitly (defense in depth on
  top of RLS) so drafts/archived **never leak**. `homepage_section`/`blog`/`announcement` are
  manage-only for now (no public render yet). Landing page footer links the three pages.
- **Audit-only** (Phase 10): `cms.created`/`updated`/`published`/`unpublished`/`archived`/
  `duplicated`. **No emails, no customer notifications.**

## Template Management Platform (Phase 9E) — built

An **additive, admin-owned catalog of curated layout PRESETS** (`0032_layout_templates.sql`).
The builder has only two renderer primitives (`single-pair`, `double-spread`) + generic
overlay rects, all flowing through one `Block[]`; a template's `geometry` is
`{ base: 'single-pair'|'double-spread', overlays: Rect[] }`, so **applying a template
produces an ordinary `Block`** — nothing new ever reaches the renderer, `saveLayout`, the
`BlockSchema` enum, or the `album_pages` CHECK. PDF parity, saveLayout compatibility, and
no-photo-loss therefore hold **by construction**. Cover management (the spec's Phase 6)
**already exists** at `/admin/covers` and is reused (linked from the templates area) — no
cover changes.
- **Geometry safety**: `validateGeometry()` (`src/lib/templates/model.ts`) is the single
  source of truth (base ∈ existing primitives; overlays = bounded numeric rects inside
  [0,1]; **no HTML/CSS/arbitrary keys**). It runs at the Zod boundary, in the save action,
  AND as the **activation gate** — a template can only become `active` (selectable) if its
  geometry validates. `listActiveTemplates()` (`catalog.ts`) re-validates on read (defense in
  depth), so a malformed/inactive template can never reach the builder.
- **Write pattern** mirrors covers: `src/lib/actions/admin/templates.ts`
  (`saveTemplate`/`setTemplateStatus`/`duplicateTemplate`) is gated by
  **`requireTemplateCapability(cap)`** (`access.ts`, the RBAC seam — `template:edit`/
  `:publish`/`:archive`, delegates to `requireAdmin()` today), writes via service role, audits
  via `log_audit` (`entity_type='layout_template'`). New templates start `inactive`; **archive
  is the soft-delete**.
- **Admin UI** under **Catalog → Layouts**: `/admin/templates` (Drizzle list + geometry
  preview + Activate/Deactivate/Archive/Duplicate), `/admin/templates/{new,[id]}` →
  `_editor.tsx` (name/description/category/base + numeric overlay-slot editor + **live
  `_preview.tsx`** matching the builder canvas; activation blocked unless geometry valid).
- **Builder integration** (additive; **no saveLayout change**): the build page loads
  `listActiveTemplates()` → `Builder`; a **Layouts** toolbar button opens `_layout-panel.tsx`
  which applies a preset to the focused spread via `applyTemplateToBlock` (existing
  `patchBlock`): sets the base, keeps base photos that fit, fills the preset's overlay slots
  from existing-overlay → dropped-base → tray photos; **anything that doesn't fit returns to
  the tray — never deleted**. Persists through the existing Save.
- **Auto-layout integration** (`src/lib/builder/auto-layout.ts`): `autoLayout`/`regenerate`
  gained an **optional** `templates` param; when active templates exist the engine
  deterministically draws each spread's overlay-slot geometry from a matching template, and
  **when none exist the output is byte-for-byte identical to before**. Still
  orientation/photo-count/page-count driven; no AI/ML/APIs; output stays `Block[]`.
- **Audit-only**: `template.created`/`updated`/`activated`/`deactivated`/`archived`/
  `duplicated`. No emails. `_photo-frame`/`_preview`/`_print-album`/`saveLayout`/`BlockSchema`/
  `album_pages`/checkout/uploads/orders are **untouched**.

## Courier & Shipping Integration (Phase 9F) — built

An **additive, SUPPLEMENTAL** shipment layer (`0033_shipments.sql`): `shipments` (one per
order) + append-only `shipment_events`. **`shipment_status` is independent of `orders.status`**
— no shipment action ever writes `orders`/`payments`/webhooks, and the fulfilment lifecycle
(`admin_update_order_status`), `setTracking` (the `orders.tracking_number/carrier` columns),
checkout, payment, and the customer `orders.status` timeline (`_status.tsx`) are **untouched**.
Admins still advance the order via the existing Fulfilment control; this adds structured
courier metadata, an event log, and a courier-abstraction seam.
- **Security** mirrors `payments` (child-of-order ownership): customers SELECT only shipments/
  events for orders they own (RLS `EXISTS … orders o where o.id=order_id and o.user_id=auth.uid()`
  + `is_admin()`); writes are service-role only + restrictive deny. **No tracking-number lookup
  route** exists — a customer reaches a shipment only via an owned order (no enumeration); the
  `tracking_number`/`external_reference` indexes are for a future service-role webhook only.
- **Courier abstraction** (`src/lib/shipping/courier/`): a `CourierProvider` interface
  (`createShipment`/`getTracking`/`cancelShipment`) + a deterministic, network-free
  `MockCourierProvider`; `getCourierProvider(courier)` is the registry (returns the mock for
  all couriers today — Shiprocket/Delhivery/BlueDart/DTDC are a one-file swap later).
- **Actions** (`src/lib/actions/admin/shipments.ts`, gated by **`requireShippingCapability(cap)`**
  — the RBAC seam — service-role writes + `log_audit` `entity_type='shipment'`): `createShipment`,
  `updateShipment` (assign courier / add tracking), `setShipmentStatus` (bounded state machine;
  "Mark dispatched" = `picked_up`), `cancelShipment` (→ `failed`), `syncTracking` (provider
  refresh — the seam a real courier webhook replaces). Audit: `shipment.created`/`updated`/
  `dispatched`/`delivered`/`failed`. **No emails.**
- **UI**: admin order detail gets a `_shipment.tsx` panel (create/manage + event history) under
  Fulfilment; the shipping dashboard adds a read-only Shipment-status column; the customer order
  page renders a read-only **Shipment card** (courier/tracking/progress) BELOW the unchanged
  `orders.status` timeline, only when a shipment exists.
- **Future webhook**: `/api/webhooks/courier` is NOT built, but `external_reference` + the
  append-only `shipment_events` + `syncTracking` are the ready seam (a webhook would append
  events via the service role keyed on `external_reference`).

## Multi-Role RBAC (Phase 9G) — built

Replaces the binary admin/non-admin model with **fixed-role, capability-driven** authorization
(`0034_admin_roles.sql`), additively and with no customer/payment/upload/PDF/lifecycle impact.
**Capabilities are the enforcement unit**, never role string checks.
- **Roles** (`src/lib/auth/capabilities.ts`, fixed — no custom roles, no editor):
  `super_admin` (everything), `production` (orders/albums/shipping/reviews + analytics),
  `support` (support/refunds/reprints/customers + order:view), `content` (cms/templates/covers).
  `Capability` is a `domain:action` union; `ROLE_CAPABILITIES` maps role→bundle;
  `roleHasCapability` is the predicate (super_admin = wildcard).
- **Access layer** (`src/lib/auth/require-admin.ts`): `getAdminContext()` (cached) does
  getUser → **profiles.role='admin' gate (unchanged; locked by 0019)** → resolves the
  back-office role from `admin_roles` (**absent → super_admin**, the migration-safe default).
  `requireCapability(cap)` checks the role, **audits `access.denied`**, and throws
  `NotAuthorizedError` on denial. `requireAdmin()` remains as the base gate (any admin).
- **Enforcement is layered**: (1) the admin **layout** route-guards every `/admin/**` before
  render via `routeCapability(pathname)` (path from a middleware-set `x-pathname` header) →
  redirects denied roles to `/admin/denied`; (2) **every admin action** independently calls
  `requireCapability` (the authoritative boundary — the three seams `requireCms/Template/Shipping
  Capability` now delegate here, and orders/covers/coupons/support/resolutions/reviews/pdf +
  the admin PDF API route were migrated off bare `requireAdmin()`); (3) the **nav** filters to a
  server-computed allow-list (`navHrefsForRole`) — UI hiding is never the security boundary.
- **Role management**: `/admin/users` (super_admin only — `role:manage`) assigns one of the four
  roles via `assignRole` (`src/lib/actions/admin/roles.ts`): service-role upsert, **forbids
  self-edits + non-admin targets**, audits `role.assigned`/`role.changed`.
- **Security invariants**: roles resolved server-side only (never from form/cookie/client);
  `admin_roles` is service-role-write-only + restrictive RLS deny; the absent-row→super_admin
  default applies **only after** the admin gate, so it can never promote a non-admin; service-role
  actions still validate capability first. **Migration**: run `0034`, then deploy — existing
  admins keep full access (super_admin default), scope teams by assigning roles later.

## Monitoring & Alerting (Phase 10A) — built

Operations visibility + early warning (`0035_monitoring.sql`), additive and **read-only over
existing tables** (it formalizes the cheap `count()`-aggregate pattern the dashboard already
used). Two tables: `health_checks` (append-only per-service snapshots) + `system_alerts`
(append-only; resolving **marks**, never overwrites/deletes).
- **Collectors** (`src/lib/monitoring/collectors.ts`): one cheap `count()`/`select 1` per service
  over existing status columns — database, uploads (stuck `pending`), photo_processing
  (`rejected` + backlog), pdf_generation (`failed` + stuck `generating`), payments
  (`orders.status='failed'` + **orders stuck `pending`** = missed webhook), email
  (`email_log.status='failed'`), shipping (`shipment_status='failed'`), support (open backlog).
  **No joins, no scans, no polling.** Thresholds live in ONE place: `THRESHOLDS` in
  `src/lib/monitoring/model.ts`.
- **Engine** (`src/lib/monitoring/engine.ts`): `persistIfStale()` runs only when an admin opens
  the page AND the last snapshot is **> 5 min** old (throttle — no write storms, no cron). It
  inserts snapshots and **reconciles alerts**: opens one alert per breached `dedupe_key`
  (partial unique index = **no alert fatigue**) and **auto-resolves** cleared conditions. All
  service-role, best-effort, never throws.
- **RBAC** (`monitoring:view` / `monitoring:manage`, added to `capabilities.ts`): super_admin
  (both), production + support (view), **content = no access** (route-guarded + nav-filtered by
  Phase 9G). UI at `/admin/monitoring` (System Health Panel + Live Alerts Feed; Run-checks/Resolve
  for `monitoring:manage`); the main dashboard shows a compact health strip **only** for
  `monitoring:view` roles. Actions in `src/lib/actions/admin/monitoring.ts`.
- **Audit**: `health.check` (per run), `alert.created`, `alert.resolved` via `log_audit`. No
  customer/anon access; no writes to any existing table.

## Error Tracking & Observability (Phase 10B) — built

Where 10A gives **aggregate** health (counts), 10B captures the **individual failures** behind
them — a persisted, deduped, queryable store of exceptions/failures/slow ops across app + worker
(`0036_error_events.sql`). **Additive + behavior-preserving**: capture is always best-effort and
NEVER throws, sits alongside existing `console.*`, and changes no existing flow (checkout/builder/
orders/payments/uploads/PDF/reviews/refunds/reprints/CMS/shipping/RBAC/monitoring 10A).
- **Capture is push, not pull.** The single DB entrypoint `record_error_event()` (SECURITY DEFINER,
  service-role-only) does an atomic **fingerprint dedupe-upsert** (one open row per condition,
  `occurrences++` — a hot loop is one growing row, not N), writes `error.created` audit, and for a
  **new critical** opens a `system_alert` keyed `error:<fingerprint>` (reuses 10A's partial-unique
  index → no alert storms; shows in the existing Monitoring feed).
- **The observability layer** lives in `src/lib/observability/`: `model.ts` (severity/category
  vocab, chips, `PERF_THRESHOLDS`, `fingerprint()`), `sanitize.ts` (**THE security boundary** —
  deny-list keys + JWT/long-hex/card/email/phone scrubbers + length/depth caps; applied to every
  persisted field), `request-id.ts` (`getRequestId()` reads the middleware-minted `x-request-id`,
  available across the whole server request scope — no signature threading), `capture.ts`
  (`captureException`/`captureMessage`/`withCapture`, never throws), `log.ts`
  (`logInfo/Warning/Error/Critical` + `recordTiming`). The worker has a self-contained mirror at
  `worker/src/lib/observability.ts` (same RPC + same sanitize contract).
- **Request correlation**: `src/middleware.ts` mints/forwards `x-request-id` (honors an upstream
  one; echoes on the response). Worker jobs get a `job:<queue>:<id>` correlation id.
- **Exception capture** (chokepoints, additive — capture **alongside** existing logs, never
  changing control flow): `src/instrumentation.ts` (process `unhandledRejection`/`uncaughtException`,
  needs `experimental.instrumentationHook` in `next.config.mjs`); `src/app/global-error.tsx` →
  rate-limited sanitized `src/app/api/observability/report/route.ts` (client crash sink);
  the Razorpay webhook (sig-fail/rpc-error/amount-mismatch), `payments/verify`, `pdf/generate.ts`,
  `email/send-email.ts`; and the worker job handlers (capture then **rethrow** so pg-boss retry is
  unchanged) + permanent photo rejections.
- **Performance observability**: `recordTiming(source,label,ms,threshold)` records a deduped
  `warning` **only** when over threshold (fast path does nothing; never blocks). Wired into the
  worker album-pdf + image-hardening jobs.
- **Admin Error Center** `/admin/errors` (list `_filters.tsx` + detail `[id]` + `_resolve.tsx`):
  read-only, severity/category/resolved/search filters, occurrence + last-seen + request-id.
  **Read-only payloads** (no editing); the only mutation is Resolve (`resolveError` in
  `src/lib/actions/admin/observability.ts`) which also resolves the linked alert + audits
  `error.resolved`.
- **RBAC** (`observability:view` / `observability:manage` in `capabilities.ts`): super_admin
  (both), production + support (view), **content = none** (route-guarded `/admin/errors` + nav).
- **Security/PII**: stores `user_id` (uuid) only — never email/phone/address/name; raw bodies,
  headers, cookies, and `Authorization` are NEVER captured; all fields sanitized + capped; the
  table is admin-read / no-client-write / **no-delete** (append-only); the RPC is service-role-only.

## Security Hardening & Abuse Protection (Phase 10C) — built

Additive + behavior-preserving hardening on top of 10A/10B: explicit password/identity
policy, rate limits on public write surfaces, a security audit trail + admin surface, a
nonce CSP staged as Report-Only, and the root-cause fix for the dashboard "delete album →
infinite loading" bug. **Nothing in builder/checkout/orders/payments/uploads/reviews/
refunds/reprints/CMS/templates/shipping/monitoring/observability changed behavior.**
- **Password + identity policy (single source)** `src/lib/auth/policy.ts` (PURE — no
  `server-only`, reused client + server): `PASSWORD_MIN/MAX = 8/25` + `passwordSchema`/
  `validatePassword`; `NAME_MIN/MAX = 2/60` + `normalizeName` (strip control chars by
  code point, collapse whitespace) + `nameSchema`/`validateName` (letters/marks + space
  `' - .` only). Wired into `SignupSchema` (`validations.ts`), signup + reset-password
  pages (policy + max-length UI), `updateProfile` (`actions/profile.ts`), and — closing
  the server gap — `auth/callback/route.ts` normalizes+validates `user_metadata.name`
  before the profile upsert. Display names are intentionally non-unique (email is the
  identity, enforced by Supabase Auth).
- **Rate limiting (centralized)** `src/lib/security/guard.ts` — `clientIp()` +
  `checkLimit(key, limit, windowMs, ctx)` over the existing `lib/rate-limit.ts` (one code
  path; audits `security.rate_limit` on block). Applied: `signIn` (per-IP + per-account
  email-hash, ~10/5min), `requestPasswordReset` (per-IP ~5/15min, still neutral response),
  `createTicket`/`replyToTicket`, `createRefundRequest`/`createReprintRequest`, upload
  `presign`/`confirm` (per-user ~120/min, burst-friendly), `payments/verify` (~20/min).
  `confirm` also sanitizes `originalFilename` via `sanitizeFilename` (G2). Signup stays
  client-direct to Supabase (provider-limited). Same per-process caveat as rate-limit.ts.
- **Security audit trail** `src/lib/security/audit.ts` — `logSecurity(action, metadata,
  actor?)` writes to the existing append-only `audit_log` via `log_audit` (0016),
  `entity_type='security'`, best-effort/never-throws (nil-uuid subject for pre-auth IP
  events). Admin read-only surface `/admin/security` (`page.tsx` + `_filters.tsx`, Drizzle)
  shows the `security.*` + `access.denied` slice; gated `security:view`. No mutations.
- **CSP (nonce, Report-Only first)** The enforced host-based CSP in `next.config.mjs` is
  UNCHANGED (no checkout-breakage). `src/middleware.ts` mints a per-request nonce (btoa —
  edge runtime), sets it as a REQUEST `content-security-policy` header (so Next nonces its
  own inline scripts) and emits `Content-Security-Policy-Report-Only` mirroring the policy
  but with `'nonce-<n>'` instead of script `'unsafe-inline'`, plus `Reporting-Endpoints`.
  Violations POST to `src/app/api/security/csp-report/route.ts` (rate-limited; recorded via
  the 10B capture layer, `source:'csp'`, deduped — visible in the Error Center). No
  `strict-dynamic`; `style-src 'unsafe-inline'` retained. This is the staged path to an
  enforced nonce CSP. `next.config.mjs` also adds `X-DNS-Prefetch-Control: off`.
- **Delete-album hang fix** `deleteAlbum` (`actions/albums.ts`) now bounds the
  `enqueueR2Cleanup` call with a 5s `withTimeout` (pg-boss `boss.send` over the DIRECT_URL
  pooler had no client timeout) → fails fast with a retryable error (rows intact, no R2
  orphans) instead of hanging forever; `dashboard/_album-card.tsx` adds a try/catch so the
  confirm dialog can never spin permanently.
- **RBAC** new `security:view` / `security:manage` (`capabilities.ts`): super_admin (both),
  production + support (view), **content = none** (route-guarded `/admin/security` + nav,
  ShieldAlert icon, Platform group).
- **Audit (Phase 9 RLS re-check):** 0028/0030/0031/0032/0033/0034 re-verified (RLS enabled
  + restrictive write-deny + ownership) — all sound, **no corrective 0037 needed**.

## Performance, Caching, CDN & Scale Readiness (Phase 10D) — built

Additive + behavior-preserving performance pass — **no redesign** of any feature; identical
outputs, just faster reads + lower query cost + better cache/CDN usage. No payment-flow,
security, or architecture change.
- **DB indexes** (`0037_perf_indexes.sql`, purely additive): the base tables (0001) never
  indexed their hottest predicates. Added `albums(user_id, updated_at desc)` +
  `orders(user_id, placed_at desc)` (dashboard lists, RLS `user_id=auth.uid()`),
  `orders(album_id, status)` (the order-commit locks `hasPaidOrder`/`hasActiveOrder`/
  `getPaidOrder` + build page + presign/confirm/delete — very hot), `addresses(user_id)`
  (account/checkout/orders), `payments(order_id)` (FK + RLS subquery). `if not exists` →
  idempotent; code works with or without it (queries just get faster).
- **Centralized caching** `src/lib/cache.ts` defines tags + TTLs in ONE place. Only GLOBAL,
  public, non-user data is cached (never per-user → no cross-user/stale-auth leakage):
  - `listPublished` (CMS public /faq /testimonials /stories) — `unstable_cache`, tag
    `cms-public`, 300s. Switched to the SERVICE client inside the cache (no cookies →
    cacheable) but STILL filters `status='published'`, so the result is identical
    (published-only). Busted by `revalidateTag('cms-public')` in `admin/cms.ts`
    (save-of-published / publish / unpublish / archive / bulk).
  - `listActiveTemplates` (builder catalog) — `unstable_cache`, tag `templates-active`,
    300s; geometry re-validation runs inside the cache. Busted by
    `revalidateTag('templates-active')` in `admin/templates.ts` (edit-active / activate /
    deactivate / archive). TTL is only a backstop; tag bust is the primary refresh.
- **CDN / ISR**: `/faq`, `/testimonials`, `/stories` now `export const revalidate = 300` —
  combined with the cookie-free cached read they become CDN/ISR-cacheable; admin publishes
  bust them via the tag. Static `_next/static` immutability + security headers stay in
  `next.config.mjs` (10C); storage architecture (R2 presigned, private) unchanged.
- **Observability (Phase 8)**: new `PERF_THRESHOLDS.slowQueryMs = 800`. `recordTiming`
  (10B) wired into the dashboard read + the two cached read MISS paths — a slow read becomes
  a deduped `warning` in the Error Center, never blocks the request.
- **Builder review (Phase 6)**: already memoization-aware (useMemo/useCallback/useState
  throughout `_builder.tsx`); NOT touched (UX-identical requirement + regression risk). No
  blind changes — recommend profiling-driven tuning only.
- **Admin review (Phase 7)**: all queues already paginate (PAGE_SIZE 25–50: orders/support/
  shipping/customers/coupons directly; refunds/reprints via `_resolutions/queue.tsx`; reviews
  via `_queue.tsx`; errors via its pager). No large-table render risk; no change needed.
- **Image review (Phase 4)**: public CMS images use `next/image` (`fill` + `sizes` + lazy,
  `unoptimized` to avoid remote-domain config); dashboard uses a CSS spine (no `<img>`);
  R2-private assets stay plain presigned (next/image can't cache short-lived signed URLs).
  Sound — no change.
- **Scale (Phase 9)**: Supabase + R2 + Vercel + Render worker. Small/medium: comfortable
  (indexes + caching remove the main read costs). High scale bottlenecks to watch (documented,
  not migrated): the **in-process** rate-limit + pg-boss enqueue (per-instance — move to a
  shared store before multi-instance), single Render worker (scale horizontally for PDF/image
  throughput), and Supabase connection-pool limits under heavy concurrency.

## Cart foundation (Phase 6) — built

A pre-purchase staging area — *which of MY albums do I intend to order, and how many copies of
each* — and nothing more. `cart_items` (0055, documented under **Database**) is additive:
orders, payments, Razorpay, uploads, the worker, PDF generation and their RLS are all
untouched, and `deleteAlbum` needed no change. **Phase 6 is the data + plumbing layer; there is
no cart page yet** (see the boundary below).

### FOUR INVARIANTS — do not break these

**1 — MANUAL ADD IS DATABASE-ATOMIC, AND CAPPED AT 10.** `addOrIncrementCartItem`
(`src/lib/cart/queries.ts`) calls the `cart_add_or_increment` SQL function, which does
`on conflict (user_id, album_id) do update set quantity = least(existing + excluded, 10)` in
**one statement**. Never rewrite it as *read quantity → increment in TypeScript → write
quantity*: that reintroduces a lost-update race which was **proven** in Phase 6 Prompt 3 (10
genuinely concurrent adds → exactly 1 row at quantity 10, 0 duplicates, 0 lost increments;
10 more at the cap → still 10, 0 failures). The cap lives in the same statement, so it can
never be bypassed by a client and never raises the `quantity <= 10` constraint error.

**2 — SUBMIT AUTO-ADD IS IDEMPOTENT.** `submitAlbum` (`src/lib/actions/builder.ts`) calls
`ensureCartItem`, **not** `addOrIncrementCartItem` — `cart_ensure_item` is
`on conflict do nothing`. `submitAlbum` has no guard against an already-`submitted` album and
is also the **"Resubmit for Review"** path, so it can run many times for one album. Repeated
submit/resubmit must leave the album at **quantity = 1**; it must never increment merely
because the album was resubmitted (verified: 3 submits → 1 row, quantity 1). These are two
deliberately separate helpers because one ambiguous "add" is a bug waiting to happen.

**3 — THE HEADER BADGE COUNTS DISTINCT ALBUMS, NOT TOTAL QUANTITY.** Album A at quantity 9 +
album B at quantity 1 → badge **2**, not 10. An order is per-album with `copies` as an
attribute and the library is album-oriented throughout, so "2 albums" is the number the
product actually asks about. `unique (user_id, album_id)` means a row count *is* the
distinct-album count, which is why `getCartCount` is a `head: true` count and not a sum.

**4 — IDENTITY ALWAYS COMES FROM `auth.uid()`.** The client supplies only `albumId` and
`quantity` (`AddToCartSchema`). Neither SQL helper takes a user id and neither is
`SECURITY DEFINER`, so the caller's RLS applies and there is no `p_user_id` to forge; a
hand-written insert with someone else's `user_id` is rejected by the policy with `42501`
(verified). **Do not introduce a `cart_id`** unless a future architectural decision
explicitly requires one — its absence is what removes the classic cart-hijack surface.

### Query architecture

- **`src/lib/cart/queries.ts`** (`import 'server-only'`) — `getCartCount`, `listCartItems`,
  `addOrIncrementCartItem`, `ensureCartItem`. Each **accepts a client** rather than creating
  one, so the caller owns the security boundary; all four are called with the
  **authenticated** client. **No customer cart operation uses the service role** — RLS
  (`user_id = auth.uid()`) is the real gate, exactly as for albums/addresses. No price or
  product snapshot is read or written anywhere in this file. `getCartCount` returns 0 rather
  than throwing (chrome must never break a page).
- **`src/lib/actions/cart.ts`** — `addAlbumToCart`: Zod → `getUser()` → re-read the album
  through the RLS-scoped client (a foreign album resolves to `null` → ordinary "Album not
  found", no existence oracle) → reject `blueprint_draft_of !== null` → reject
  `status !== 'submitted'` (matching `createOrder`'s eligibility) → atomic add →
  `revalidatePath('/dashboard', 'layout')` so the layout re-renders a fresh count.
- **`src/lib/cart/provider.tsx`** — `CartProvider` mounted once in `(app)/layout.tsx`
  (innermost, inside `UploadProvider` → `PendingPlacementsProvider`), seeded by the layout's
  single server-side `getCartCount`. It is **count-only**: no cart contents, **no
  localStorage, no polling, no timers, no sockets, no store or singleton**. A `useEffect`
  adopts a changed `initialCount` because the layout is deliberately never remounted by
  navigation. `setCount`/`bumpCount` exist unused for Phase 7's optimistic add/remove.
  Do not redesign it.
- **`src/components/customer-shell.tsx`** — the badge; the Cart nav row is intentionally
  **non-interactive** (`href: null`) until Phase 7 creates `/cart`.

### Phase 6 boundary — DONE vs NOT IMPLEMENTED

**DONE**: `cart_items` data model · RLS · grants (incl. the anon revoke) · atomic
add/increment · quantity cap · auto-add on album submit · cart count query · `CartProvider` ·
header badge · ownership + blueprint + submitted eligibility enforcement · cascade behaviour.

**NOT IMPLEMENTED IN PHASE 6** (later phases — do not add until asked): `/cart` page ·
remove from cart · quantity-editing UI · Buy Now · individual checkout · combined
multi-album checkout · payment changes · order-schema changes · the `order_items`
decision · clearing the cart after payment.

**Next**: **Phase 7** = cart page + remove + quantity editing + individual Buy Now +
dashboard integration. **Phase 8** = combined multi-album checkout and the order/payment
architecture (which is precisely why the cart stores no pricing). **Phase 9** = upload/cart
robustness and recovery hardening.

### Verification caveat — STRUCTURAL ONLY

Phase 6 Prompt 3 ran 32 PASS / 1 STRUCTURAL ONLY / 0 FAIL / 0 NOT RUN against the live
database with real JWTs. The one **STRUCTURAL ONLY** item is **failure injection for the
submit auto-add**: no safe failure-injection seam exists, and production source was not
modified merely to manufacture one. Code inspection confirms the intended semantics — the
`ensureCartItem` call sits in a best-effort `try/catch` (logging
`[cart] submit auto-add — continuing`) so `submitAlbum` still returns success if the cart
write fails, following the Phase 9C review-hook precedent. **This is not a failure**, and no
test seam should be added solely for it; future hardening may revisit it if a legitimate seam
appears. Separately **not yet exercised**: the `revalidatePath`-driven badge refresh, because
no UI calls `addAlbumToCart` yet — Phase 7 should confirm it the moment an Add button exists.

## Multi-album orders + combined checkout (Phase 8) — built

`order_items` (0056, above) lets ONE order contain several albums, `/checkout/cart` sells them
in one payment, and the paid transition fulfils every album and clears exactly what was bought.

### The invariant, and why it is shaped this way

**ONE PURCHASE = ONE `orders` ROW = ONE Razorpay ORDER = ONE PAYMENT.** A combined order is
one `orders` row with N `order_items` lines, not N orders. That is what allows
`process_razorpay_event`, `payments`, `webhook_events`, `coupon_redemptions`,
`orders_razorpay_order_id_key` and the amount gate (`round(p_amount,2) = orders.total_amount`)
to remain **byte-for-byte unchanged** — verified by md5 of the function definition. The
alternative (N orders sharing one payment) would have required dropping a unique index and
rewriting the atomic money function; that was rejected in the Phase 8 Prompt 1 preflight.

- **`order_items` is the AUTHORITY** for "which albums does this order contain?".
- **`orders.album_id` / `copies` / `product_id` / `product_name` / `product_dimensions` are
  LEGACY POINTERS to the FIRST item.** They stay NOT NULL and remain exactly correct for a
  single-album order. `orders.copies` is deliberately **not** a sum — `orders_copies_check`
  caps it at 10, and 3 albums × 4 copies would violate it.
- **Money stays order-level.** `subtotal_amount` (= Σ `line_subtotal`), `shipping_amount`,
  `discount_amount`, `total_amount`. The line columns are an immutable **snapshot**
  (`unit_price`, `line_subtotal`, product, `album_title`) so a receipt stays correct after
  titles, products, catalog prices or dimensions change. There is deliberately **no** per-item
  shipping/coupon allocation, tax, status or refund field — a second money authority is how a
  receipt starts disagreeing with a payment.
- **SHIPPING IS CHARGED ONCE PER ORDER** — ₹99 standard / ₹199 priority / ₹399 express,
  regardless of album count or copies (product decision, locked in Phase 8 Prompt 2).

### What exists

- **`create_order_with_items(...)`** (0056) — SECURITY DEFINER, **`service_role` EXECUTE only**
  (`authenticated` deliberately cannot call it: `orders` is never written by a client). ONE
  function serves both paths (single-album = one line). It creates the order **and all its
  lines in one transaction**, so an order can never exist without its items; re-checks that
  every album/address belongs to the customer, that each album is `submitted`, not a blueprint
  draft and not already in a paid order, and that the money agrees with itself
  (`Σ line_subtotal = subtotal`, `line = unit × copies`, `total = subtotal + shipping −
  discount` with the ₹1 floor). It creates **no payment row** and only ever writes status
  `'pending'` — `process_razorpay_event` remains the only path to `paid`. It deliberately does
  **not** swallow `23505`, so `orders_one_pending_per_album` still reaches the caller.
- **`src/lib/orders/items.ts`** — `listOrderItems`, `albumIdsForOrder`, `buildOrderItemSnapshot`
  (pure; computes `line_subtotal` itself). Reads take a client so RLS stays the gate.
- **`computeCombinedOrderAmount(lines, discount, shipping)`** in `pricing.ts` —
  `computeOrderAmount` is **unmodified**; the new function sums per-line subtotals (each
  rounded before summing, so the order total can never drift from Σ lines), applies the same
  subtotal-only clamped discount, adds shipping **once**, and uses the same ₹1 floor and paise
  rounding. A one-line combined amount equals the single-album amount to the paise.
- **`album-lock.ts` now reads `order_items`** — `hasPaidOrder`/`hasActiveOrder`/`getPaidOrder`
  join `order_items → orders`, because `orders.album_id` names only the first album and would
  answer "not locked" for the second album of a paid combined order. **Public signatures are
  unchanged**, so all 11 existing call sites (builder ×7, photos presign/confirm/[id], album
  actions) were untouched. The gates now **fail CLOSED**: a read error counts as locked (the
  old code ignored errors and failed open). `getPaidOrder` is display-only and still yields
  null on error.
- **`createOrder` (single-album) is otherwise unchanged** — same pricing, coupon, shipping,
  Razorpay call, pending resume and cancel-remint semantics; it now writes its one line through
  the atomic RPC and additionally consults `hasPaidOrder` so an album bought inside a combined
  order can't be re-bought.
- **`createCombinedOrder`** (`src/lib/actions/orders-combined.ts`). The client sends only
  `{addressId, shippingMethod, couponCode?}` (`CreateCombinedOrderSchema`); the server
  re-resolves the cart, re-checks eligibility, re-prices every line, validates the coupon against
  the combined subtotal, charges shipping once, resumes an identical pending order or cancels a
  conflicting one, then creates the Razorpay order and calls the RPC. **No price, quantity, title
  or total is ever accepted from the browser.** `previewCombinedOrder` is the advisory
  tier/coupon preview (writes nothing, consumes nothing).
- **Address ownership is filtered explicitly, not just by RLS.** `addresses` carries an
  `admins_read_all_addresses` policy, so for an ADMIN customer the RLS-scoped read returns every
  customer's address — the checkout picker listed a foreign one and pre-selected it (found by the
  real browser payment run in Prompt 4; `create_order_with_items` refused the order, which is how
  it surfaced). Both checkout pages and both order actions now add `.eq('user_id', …)`. No change
  for a normal customer, whose RLS view is already only their own rows.
- **`resolveCartForCheckout`** (`src/lib/cart/checkout.ts`) — ONE server-side resolver used by
  BOTH the `/checkout/cart` page (to render) and `createCombinedOrder` (to charge). Its per-album
  work runs in PARALLEL (`Promise.all` over the cart, and over the three independent facts per
  album). Measured: 3-album cart 1551ms → 593ms; the same 88-assertion matrix passes before and
  after, so the result is identical — only the serialisation is gone. Sharing it is
  the point: a projection computed one way and an order computed another way is how a customer
  ends up charged something they were never shown. It returns priced `lines` plus `blocked`
  entries (not-submitted / blueprint / already-ordered / unavailable / no-price) so an ineligible
  album is **named, never silently dropped**.
- **`/checkout/cart`** (`page.tsx` + `_combined-checkout.tsx` + `loading.tsx`) — the combined
  checkout. Reuses the single-album route's `AddressPicker`, `SHIPPING_TIERS` shape, coupon field
  and Razorpay `next/script` + handler sequence, and posts the callback to the **existing**
  `/api/payments/verify`. **`_checkout.tsx` is untouched**: it carries a per-album readiness panel
  and copies stepper that have no meaning here, so the flows stay separate rather than one
  component being bent around both. `/checkout/[albumId]` still handles single-album purchases.
- **`/cart` has a "Checkout all" CTA**, enabled only when at least one row is eligible, and it
  names the albums that block checkout using the row's own `eligible` flag — the same rule the
  server enforces. Per-row Buy now, remove, quantity editing and the badge are unchanged.

### The paid-transition cascade (`src/lib/orders/settlement.ts`)

`settleOrderFulfilment(orderId, source)` is the ONE downstream path, called by **both** the
Razorpay webhook and `/api/payments/verify` after `process_razorpay_event` reports a capture that
processed. Per paid order it: sends the confirmation email (order-scoped), then **per
`order_items` row** enters the review queue and starts the preview PDF, then **clears exactly
those albums from that customer's cart**, then revalidates the cart surfaces.

- **It iterates `order_items`, never `orders.album_id`** — that pointer names only the first
  album, so a combined order would otherwise review and render just one book.
- **Idempotent by construction, no new lock:** the email claims an `email_log` row (0022);
  `submit_album_for_review` re-reaches the same `pending_review` state;
  `startAlbumPdfGeneration` short-circuits on `already-ready`/`in-progress`; the cart delete is a
  filtered DELETE. It also refuses to run unless the order is already in the paid family, and it
  never writes `orders.status`. Duplicate webhook, duplicate verify and a genuine
  verify+webhook race were all runtime-tested: one paid transition, one payment row, one email,
  one `album_pdfs` row per album, one net cart deletion.
- **NEVER THROWS** — a sleeping worker or a bounced email must not turn a settled payment into a
  503 retry.

### What was proven against real Razorpay, and what was not

A real **test-mode** payment run (Prompt 4) drove the actual browser flow: add both albums →
`/cart` → Checkout all → `/checkout/cart` → **Pay**. That created a real Razorpay order whose
amount was independently confirmed at Razorpay itself (`GET /v1/orders/…` → 319600 paise =
`orders.total_amount` ₹3,196), and opened the genuine Razorpay Checkout sheet in test mode.

**The payment sheet itself was not completed** — it renders in a cross-origin iframe that the
automation could not drive, and completing it by hand would mean entering card or bank
credentials. Settlement was therefore proven by POSTing a **correctly HMAC-signed** payload to the
real `/api/webhooks/razorpay` endpoint: real route, real signature verification, real
`process_razorpay_event`, real cascade. Only the event's *origin* was simulated. A wrong signature
returned 400 and changed nothing; a signed-but-underpaid capture returned `amount_mismatch` and
fulfilled nothing.

**Webhook delivery from Razorpay has never been exercised here**: the configured webhook is
`active: false` and points at a dead ngrok tunnel, so activating it would need a dashboard login
and a public tunnel. `/api/payments/verify` remains the co-equal settle path and both share one
cascade.

**Historical `webhook_events` dedupe markers are unrecoverable.** Four were deleted in error in
Prompt 3; Razorpay exposes no events API (`GET /v1/events` → 404) and nothing else in this schema
stores an event id, so they were NOT reinvented. Redelivery of those long-settled events remains
safe because `process_razorpay_event`'s paid-family guard skips the transition, the coupon consume
and any downgrade — runtime-proven by the duplicate-webhook tests.

### Cart clearing rules

Cart rows are removed **only** on the first transition into the paid family, **only** for the
albums in that order, server-side via the service role. Not when checkout opens, not when the
order is created, not when the Razorpay order is minted, and never from the browser. So a failed,
cancelled or abandoned checkout leaves the cart exactly as it was (runtime-verified), and buying
A+B out of a cart of A+B+C leaves C with its quantity intact. Paid rows therefore normally
disappear; Phase 7's "Already ordered" row remains as the fallback renderer for a row that
survives (clearing failed, webhook late, or the customer re-added the album).

### Display surfaces reading `order_items`

**THE RULE: a HISTORICAL order display reads the `order_items` snapshot; a LIVE album workspace
reads `albums`.** Two distinct failures follow from breaking it — a combined order presenting
itself as its first album only, and a later album rename silently rewriting what a past order
says it sold. Completed in Phase 9 Prompt 2 (R2/R3/R4); a single-album order renders byte-for-byte
as before, and every surface falls back to the legacy single-album shape if the lines cannot be
read.

| Surface | Reads |
|---|---|
| `orders/[id]` | one summary row per album; `_status.tsx` takes `albums: OrderAlbum[]` and renders **one "View album" button per album** (single-album keeps the original single primary CTA) |
| `orders` list | label = the single title, or `First + N more` |
| `admin` dashboard · `admin/orders` list · `admin/customers/[id]` · `admin/shipping` | SQL-aggregated `count`/`min(album_title)`/`sum(copies)` per order — one row per order, no join fan-out |
| `admin/orders/[id]` | `Albums (N)` panel: per-line title, product + dimensions, copies, line total, **per-album** album-status and PDF chip |
| `admin/production` | one card per ORDER containing one row **per album**, each linking to **its own** `/admin/albums/[id]` (where the album-level PDF/regenerate action lives) |
| order-confirmation + `order-status` emails | `OrderEmailData.items`; combined → `Order #x · N albums` + the item list, single → the original one-title line |

`orders.album_id` survives in these files only as (a) a **search filter** join on live titles
(`admin/orders` — correct for a lookup), (b) a **fallback** when an order has no lines, and (c)
the order-level `Album status`/PDF/review lookups on `admin/orders/[id]`, which by construction
describe the first album. **Still first-album-only, reported not fixed (out of Phase 9 P2 scope):**
`admin/albums/[id]`, `admin/reviews/_detail` and `admin/_resolutions/detail` find orders with
`where(orders.album_id = X)`, so an album that is the *second* line of a combined order does not
appear in those lists. `album-lock.ts` already resolves membership through `order_items`, so no
money, lock or eligibility decision is affected — this is a display/lookup gap only.

### Pending-order limitation (application-level, by design)

`orders_one_pending_per_album` (0011) is unchanged and still guards the **first** line's album.
A partial unique index cannot reference the parent's status, so the second..Nth album of a
combined order has **no DB-level backstop**; `createCombinedOrder` instead cancels every
pending order that shares an album with the cart before minting, and stops with a clear error
if one of those albums turns out to be paid. A trigger-maintained index would close the gap and
was deliberately not added in this phase.

### Refund and reprint granularity — DECIDED (Phase 8 Prompt 4)

**REFUND = WHOLE ORDER ONLY.** A combined order of A+B+C cannot refund just B. This is not a
gap to fill later; it is the correct unit for this architecture, because every financial fact is
order-level: one Razorpay payment, one `payments` row, one coupon and one `discount_amount`, one
`shipping_amount`, and `refund_requests` itself is order-scoped with one active request per order
(0029). A per-item refund would need an allocation policy for shipping and the coupon — i.e. new
accounting semantics — so it must not be improvised. **Verified by inspection:** neither
`refund_requests` nor `reprint_requests` has an album column, and no refund/cancel path reads
`orders.album_id` for logic (`cancelOrder` is order-id keyed), so combined orders cannot
accidentally enter a partial-refund path today.

**REPRINT = PER ALBUM, and already is.** `adminGenerateAlbumPdf(albumId)` takes one album and
`album_pdfs` is one row per album, so regeneration was never order-wide. Runtime-proven on a
combined order: regenerating album A rotated only A's token and `requested_at`, while B's token,
`requested_at` and `attempts` were untouched — no order-level PDF, `previewPdfKey` unchanged. The
admin order page now shows each album's own status + PDF chip and links to that album's page,
where the existing regenerate control lives.

### NOT implemented yet (later phases — do not add until asked)

- **Per-item (partial) refunds** — see the decision above. Whole-order is the deliberate policy.
- **A dedicated combined-order success screen.** Combined checkout navigates to `/orders/[id]`,
  which already lists every album, the subtotal, shipping and total, and owns the poller;
  `_success.tsx` (single-album) is untouched and unused by this flow. Verified in the browser as
  clear and correct, so no second success architecture was built.
- **Refund execution, post-paid cancellation, order editing** — unchanged from earlier phases.
- **The pending-order DB backstop for a combined order's non-primary albums** — still
  application-level (a trigger-maintained index would close it; deliberately not added).
- **Retiring `orders.album_id` / `orders.copies`** — audited, not retired (see below).

### Legacy `orders.album_id` / `orders.copies` — audited (Phase 8 Prompt 4)

Both columns stay NOT NULL as first-item pointers. Every remaining reader was classified:

- **MIGRATED because they were actually wrong for combined orders:** the dashboard and `/cart`
  purchase maps. Both keyed "is this album bought?" on `orders.album_id`, so albums 2..N of a
  combined purchase rendered as unbought — offering checkout and delete on a book the customer
  already owned. Both now read through `order_items`. (The server always refused such an order,
  so this was a display defect, not a money one.)
- **SAFE LEGACY DISPLAY** (shows the first album; the detail views list all): admin order/customer
  lists, production and shipping queues, `orders/[id]/_status.tsx` links, the support/refund/
  reprint order pickers, `OrderEmailData.albumTitle` (fulfilment status emails only).
- **SAFE (conservative)**: `lib/storage/metrics.ts` retention eligibility — missing albums 2..N
  means it keeps data longer, never deletes more.
- **MUST MIGRATE EVENTUALLY (not a bug today)**: `admin/production/page.tsx` shows `orders.copies`
  as the print quantity, which for a combined order is only the first item's copies. Harmless
  while no combined order has been printed; fix before the first combined production run.

## What's NOT built yet (do not add until asked)

- ✅ **Cart + checkout are now complete** through Phase 8: `/cart` (page, remove, quantity, Buy
  now — Phase 7), `/checkout/cart` combined checkout, per-item fulfilment and cart clearing on the
  paid transition (Phase 8). See **Cart foundation (Phase 6)** for the data model and
  **Multi-album orders + combined checkout (Phase 8)** for the order/settlement architecture and
  what remains unimplemented.
- Refund/reprint **execution** (the request workflow is built — Phase 9B — but actually
  issuing a Razorpay refund or kicking off a reprint order stays MANUAL by design) /
  post-paid cancellation (admin order lifecycle is forward-only)
- Welcome / album-submitted emails (optional; not built — low priority)
- Auto-retry worker for `failed` emails (today: logged + idempotent; manual/cron resend)
- Pre-press PDF tuning (exact bleed/DPI/ICC for the print partner)
- Travel agency portal (`/agency`)
- ✅ Pre-launch hardening `0020` (photos column lockdown) + `0021` (albums.status
  hardening) are WRITTEN + paired code shipped (createAlbum drops explicit status;
  submitAlbum writes status via service role) **and now APPLIED to the production DB**
  (code shipped first, then the SQL was run). No longer a backlog item.

## Checkout copies + coupon UI (Stage D) — built

The checkout page (`checkout/[albumId]/_checkout.tsx`) has a **copies stepper** (1–10)
and a **coupon field**. Every amount is server-computed: copy-count changes call
`previewOrderAmount`, coupon apply/re-validate call `previewCoupon` — both advisory.
The client sends only `{albumId, addressId, copies, couponCode?}`; `createOrder`
recomputes the total + re-validates the coupon authoritatively (a stale preview can't
underpay). Resuming a pending order rehydrates its exact copies/coupon from the stored
breakdown. A coupon that stops validating when copies drop (e.g. min-order) is auto-
removed with a message. Purchased albums still redirect to the order page (unchanged).
