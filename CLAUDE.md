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
      pdf.ts (REMOVED)        customer PDF action gone — generation is backend-only now
    pdf/
      generate.ts             startAlbumPdfGeneration (service-role: validate→mint→enqueue→nudge)
    builder/
      model.ts                Shared builder types + accounting + render helpers (no I/O)
    queue.ts                  App-side pg-boss (ENQUEUE only) — image-hardening + album-pdf
    supabase/
      client.ts               createBrowserClient() — 'use client' components
      server.ts               createServerClient() — Server Components, Server Actions
      service.ts              createServiceClient() — service role, bypasses RLS
    validations.ts            Zod schemas
  app/albums/[id]/print/      Token-gated print route (OUTSIDE (app); service access) → PDF
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
`photos`, `orders`, `payments`

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
| payments | — | SELECT | ALL |

**RLS model**:
- User tables: `user_id = auth.uid()`
- Child tables (album_pages, payments): access via parent ownership subquery
- `products`: public SELECT for active rows; admin writes
- Admin: `public.is_admin()` SQL function checks `profiles.role = 'admin'`

**Profile guarantee (three layers)**:
1. `on_auth_user_created` trigger — idempotent (`ON CONFLICT DO NOTHING`) since `0002`
2. `auth/callback/route.ts` — upserts profile after every email-link login
3. `0002_backfill_profiles.sql` — one-time fix for users who signed up before the trigger

All user tables FK to `profiles(id)`. A profile row must exist before any
album/photo/order insert can succeed.

**Migrations**: Write SQL to `drizzle/NNNN_description.sql`, paste into
Supabase Dashboard → SQL Editor → New query to run.

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
| `APP_URL` | Worker-only; base URL the PDF job's Chromium navigates to (default `http://localhost:3000`) |
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

**First-run SQL migrations (run in order in Supabase SQL Editor):**
1. `drizzle/0001_init.sql` — tables, RLS, trigger, seed
2. `drizzle/0002_backfill_profiles.sql` — backfill + idempotent trigger
3. `drizzle/0003_grants.sql` — table-level GRANTs
4. `drizzle/0004_album_sizes.sql` — album sizes 50/100/200 → 24/36/48
5. `drizzle/0005_album_pages_layout.sql` — album_pages.layout_config + layout guards
6. `drizzle/0006_generic_overlays.sql` — generic overlays; retire pip; relax CHECKs
7. `drizzle/0007_photo_processing.sql` — photos status + sanitized/thumb keys + EXIF date
8. `drizzle/0008_album_pdfs.sql` — album_pdfs (service-only PDF state + print token)
9. `drizzle/0009_service_role_grants.sql` — service_role table/sequence grants
10. `drizzle/0010_orders_payments.sql` — orders 'failed' status, dedupe indexes, webhook_events + process_razorpay_event()
11. `drizzle/0011_one_pending_order_per_album.sql` — partial unique index: ≤1 pending order per album
12. `drizzle/0012_orders_payments_write_rls.sql` — independent write-side RLS on orders/payments
13. `drizzle/0013_webhook_amount_currency.sql` — webhook amount/currency validation (run WITH the matching app deploy)
14. `drizzle/0014_orders_fulfillment.sql` — orders copies/pricing-breakdown/fulfillment + lifecycle states + indexes
15. `drizzle/0015_coupons.sql` — coupons + coupon_redemptions (+ orders.coupon_id FK)
16. `drizzle/0016_audit_notes.sql` — audit_log + order_notes + log_audit()
17. `drizzle/0017_admin_rpcs_and_consumption.sql` — admin RPCs + process_razorpay_event rewrite (run WITH the matching app deploy)
18. `drizzle/0018_coupon_created_reason.sql` — coupons.created_reason + admin_create_coupon extension
19. `drizzle/0019_lock_profile_role.sql` — column-scoped profiles grants (anti self-promotion to admin)
19a. `drizzle/0020_photos_column_lockdown.sql` — column-scoped photos grants (deploy code first) — ✅ APPLIED to production
19b. `drizzle/0021_album_status_hardening.sql` — column-scoped albums grants + status server-only (deploy code first) — ✅ APPLIED to production
20. `drizzle/0022_email_log.sql` — email delivery audit + idempotency (0020/0021 now applied to production)
21. `drizzle/0025_album_pdf_recovery.sql` — album_pdfs.requested_at + attempts (backend PDF recovery)
22. `drizzle/0028_support_center.sql` — Support Center (tickets + messages); **run SQL FIRST** (new code reads these tables/RPCs)
23. `drizzle/0029_refund_reprint.sql` — Refund & Reprint requests; **run SQL FIRST** (new code reads these tables/RPCs)
24. `drizzle/0030_album_review.sql` — Album Review & Request-Changes (Phase 9C); **run SQL FIRST** (new code reads these tables/RPCs)
25. `drizzle/0031_cms.sql` — CMS content_pages (Phase 9D); **run SQL FIRST** (admin UI + public pages read this table)
26. `drizzle/0032_layout_templates.sql` — Template catalog (Phase 9E); **run SQL FIRST** (admin UI + builder read this table)
27. `drizzle/0033_shipments.sql` — Courier shipments + events (Phase 9F); **run SQL FIRST** (admin order page + customer order page read these tables)
28. `drizzle/0034_admin_roles.sql` — Multi-role RBAC (Phase 9G); **run SQL FIRST** (the access layer reads `admin_roles`). No backfill — existing admins default to super_admin.
29. `drizzle/0035_monitoring.sql` — Monitoring & alerting (Phase 10A); **run SQL FIRST** (the monitoring page reads these tables)
30. `drizzle/0036_error_events.sql` — Error tracking & observability (Phase 10B); **run SQL FIRST** (the capture layer + Error Center read/write this table + the `record_error_event` RPC)
31. `drizzle/0037_perf_indexes.sql` — Performance indexes (Phase 10D); purely additive (no schema/RLS/grant change) — safe to run any time, code works with or without it (queries just get faster)
32. `drizzle/0038_album_cover_config.sql` — Editable custom front cover; adds `albums.cover_config` jsonb + extends the authenticated UPDATE column grant. Safe either way — `saveCoverDesign` is the only write that needs it; until it runs the builder loads with cover defaults and the rest of the flow is unaffected.
33. `drizzle/0039_stickers.sql` — Sticker catalog (cover + page decorative artwork); **run SQL FIRST** (the builder + admin `/admin/stickers` read these tables). Public-read active rows + service-role writes (mirrors covers). Until it runs the Stickers panel is empty and the rest of the flow is unaffected.

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
- New tables: add to `src/db/schema.ts` AND write a new numbered SQL migration AND add GRANTs to `0003_grants.sql` or a new migration
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
- **#9 Professional colour picker** — `_color-picker.tsx` `ColorField` (HSV square + hue slider +
  hex/RGB + presets + localStorage recent/saved; drop-in for the old `ColorRow`), used for text,
  cover, and QR colours. **#7 Location autocomplete** — `_location-autocomplete.tsx` over the
  predefined `lib/builder/locations.ts` (~300 destinations), wired into the cover title field.
- **No payment/PDF/schema-shape risk:** `album_pages.layout_config` just gains an additive
  `stickers` key (0006 CHECK only constrains `overlays`); the cover stays in `cover_config`; the
  submit gate + checkout are unchanged.

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

## What's NOT built yet (do not add until asked)

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
