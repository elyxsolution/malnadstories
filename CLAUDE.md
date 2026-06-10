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
      pdf.ts                  requestAlbumPdf server action (mint print token, enqueue)
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
  0022_email_log.sql                  email delivery audit + idempotency (claim 'sending' → 'sent'/'failed'); service-write, admin-read. (0020/0021 still pending backlog)
worker/                       Separate Node service (own package.json; pnpm install inside)
  src/index.ts                Boot: start pg-boss, register image + pdf workers, sweep
  src/jobs/image-hardening.ts validate → EXIF → re-encode → thumbnail → upload → delete raw
  src/jobs/album-pdf.ts       Puppeteer → print route → page.pdf → upload PDF to R2
  src/jobs/r2-cleanup.ts      delete a batch of R2 keys (album deletion; idempotent)
  src/lib/image.ts            sharp + file-type + exifr + heic-convert helpers
  src/{env,queue,r2,supabase}.ts   env, pg-boss conn, R2 client, service-role client
  tsconfig.json               @builder/* -> ../src/lib/builder/* (PDF reuses model.ts)
```

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
| `KEEP_RAW_ORIGINAL` | Worker-only; `false` (default) deletes the raw upload after sanitizing |
| `WORKER_SWEEP_INTERVAL_MS` | Worker-only; how often to re-scan for stuck `pending` photos (default 60000) |

The worker reads these from the **repo-root `.env.local`** (single source of secrets);
see `worker/.env.example`.

**R2 bucket CORS** (Cloudflare dashboard → bucket → Settings) must allow `PUT` and
`GET` from the app origin, with `content-type`/`content-length` headers and `ETag`
exposed — direct browser uploads/displays fail without it.

---

## Running locally

```bash
# Terminal 1 — the Next.js app (repo root)
pnpm dev          # http://localhost:3000

# Terminal 2 — the background worker (FIRST TIME: install its own deps)
cd worker && pnpm install   # standalone package; has its own pnpm-workspace.yaml
pnpm dev                    # = tsx watch src/index.ts
```

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
20. `drizzle/0022_email_log.sql` — email delivery audit + idempotency (0020/0021 are pending backlog, run when built)

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
- **Token scheme**: `requestAlbumPdf` (server action) verifies ownership (RLS),
  mints a `randomBytes(32)` token, stores only its **sha256 hash** + 5-min expiry on
  `album_pdfs` (service-only table), and enqueues `{ albumId, token }`. Short-lived,
  **single-use** (`token_used_at`), per-album. The raw token is never logged.
- **Worker job** `worker/src/jobs/album-pdf.ts`: a **shared** headless Chromium with
  a **fresh page per job** (closed after), `deviceScaleFactor: 2`, `printBackground`
  (so brightness CSS filter + SVG `feConvolveMatrix` sharpness rasterize into the
  PDF). Uploads to private R2 `{user}/albums/{album}/preview.pdf`; sets
  `album_pdfs.status='ready'`. `retryLimit: 0` keeps the token single-use; any
  failure → `status='failed'`.
- **Trigger/UI**: a "Preview PDF" button (debounced; `singletonKey` also dedupes
  server-side) enqueues and shows "Generating…"; the builder polls
  `GET /api/albums/[id]/pdf` until `ready`, then "Download PDF" fetches a **fresh
  ~2-min signed URL** (Content-Disposition: attachment). `failed` → retry.
- **Security**: only the owner can request (ownership checked before minting) or
  download (ownership-checked route, short-lived URL); `album_pdfs` is service-only
  (RLS on, no policies/grants); the worker uses the service role; the PDF R2 key is
  private (never public).

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

## What's NOT built yet (do not add until asked)

- Refunds / post-paid cancellation (admin lifecycle is forward-only)
- Welcome / album-submitted emails (optional; not built — low priority)
- Auto-retry worker for `failed` emails (today: logged + idempotent; manual/cron resend)
- Pre-press PDF tuning (exact bleed/DPI/ICC for the print partner)
- Travel agency portal (`/agency`)
- Pre-launch hardening backlog (`docs/SECURITY_BACKLOG.md`): `0020` photos column
  lockdown, `0021` albums.status hardening — not yet implemented.

## Checkout copies + coupon UI (Stage D) — built

The checkout page (`checkout/[albumId]/_checkout.tsx`) has a **copies stepper** (1–10)
and a **coupon field**. Every amount is server-computed: copy-count changes call
`previewOrderAmount`, coupon apply/re-validate call `previewCoupon` — both advisory.
The client sends only `{albumId, addressId, copies, couponCode?}`; `createOrder`
recomputes the total + re-validates the coupon authoritatively (a stale preview can't
underpay). Resuming a pending order rehydrates its exact copies/coupon from the stored
breakdown. A coupon that stops validating when copies drop (e.g. min-order) is auto-
removed with a message. Purchased albums still redirect to the order page (unchanged).
