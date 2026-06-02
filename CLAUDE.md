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
| Worker | Separate `/worker` Node service — **image hardening built** (pg-boss + sharp + file-type + exifr + heic-convert). PDF render (Puppeteer + archiver) is part 2, **not added yet** |

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
      albums.ts               createAlbum server action
      builder.ts              saveLayout / savePhotoEdit / submitAlbum server actions
    builder/
      model.ts                Shared builder types + accounting + render helpers (no I/O)
    queue.ts                  App-side pg-boss (ENQUEUE only) — enqueueImageHardening
    supabase/
      client.ts               createBrowserClient() — 'use client' components
      server.ts               createServerClient() — Server Components, Server Actions
      service.ts              createServiceClient() — service role, bypasses RLS
    validations.ts            Zod schemas
    app/api/photos/route.ts   GET ?albumId= — status + signed sanitized URLs (builder polls)
drizzle/
  0001_init.sql               Tables, RLS policies, trigger, product seed
  0002_backfill_profiles.sql  Backfill + idempotent trigger fix
  0003_grants.sql             Table-level GRANTs for anon and authenticated roles
  0004_album_sizes.sql        Album sizes 50/100/200 → 24/36/48 (CHECK + product rows)
  0005_album_pages_layout.sql album_pages.layout_config jsonb + template/photo_ids guards
  0006_generic_overlays.sql   Generic unlimited overlays; retire pip; relax photo_ids CHECK
  0007_photo_processing.sql   photos: status + sanitized_key/thumb_key + width/height/taken_at
worker/                       Separate Node service (own package.json; pnpm install inside)
  src/index.ts                Boot: start pg-boss, register worker, self-healing sweep
  src/jobs/image-hardening.ts validate → EXIF → re-encode → thumbnail → upload → delete raw
  src/lib/image.ts            sharp + file-type + exifr + heic-convert helpers
  src/{env,queue,r2,supabase}.ts   env, pg-boss conn, R2 client, service-role client
  tsconfig.json               @builder/* -> ../src/lib/builder/* (part-2 PDF reuses model.ts)
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
  `../src/lib/builder/*` so part 2's PDF job imports `computeFrameLayout` /
  `cssFilter` / `sharpenKernel` from `model.ts` — no duplicated rendering logic.

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
- **Always editable**: drafts AND submitted albums re-load their saved layout +
  edits on re-entry (until an order is placed — a later slice).

> Server-side image **re-validation / thumbnails** are now built (worker, above).
> The **downloadable print PDF** is worker **part 2** — it will reuse `model.ts`'s
> `computeFrameLayout` / `cssFilter` / `sharpenKernel` to render the exact same edits.

## What's NOT built yet (do not add until asked)

- Order + payment flow (needs Razorpay)
- Email notifications (needs Resend)
- Worker **part 2**: downloadable print/preview **PDF** (Puppeteer + archiver),
  reusing the builder's pure renderer
- Travel agency portal (`/agency`)
