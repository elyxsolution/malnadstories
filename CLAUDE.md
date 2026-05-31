# Malnad Stories — CLAUDE.md

## What this project is

A web platform for travelers to upload photos, edit them, arrange them into
printed photo albums (50/100/200 pages), and order for printing.

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
| Storage | Cloudflare R2 — **not added yet** |
| Email | Resend — **not added yet** |
| Worker | Separate `/worker` Node service (pg-boss + sharp + Puppeteer + archiver) — **not added yet** |

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
        [id]/build/page.tsx   Builder placeholder — ownership via RLS SELECT
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
    supabase/
      client.ts               createBrowserClient() — 'use client' components
      server.ts               createServerClient() — Server Components, Server Actions
      service.ts              createServiceClient() — service role, bypasses RLS
    validations.ts            Zod schemas
drizzle/
  0001_init.sql               Tables, RLS policies, trigger, product seed
  0002_backfill_profiles.sql  Backfill + idempotent trigger fix
  0003_grants.sql             Table-level GRANTs for anon and authenticated roles
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

---

## Environment variables

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | JWT anon key — safe for client, used in `server.ts` and `client.ts` |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role JWT — **server-only, never expose**; used in `service.ts` and `db/index.ts` |
| `DATABASE_URL` | Transaction pooler (port 6543) — Drizzle runtime |
| `DIRECT_URL` | Session pooler (port 5432) — drizzle-kit migrations |

---

## Running locally

```bash
pnpm dev          # http://localhost:3000
```

**First-run SQL migrations (run in order in Supabase SQL Editor):**
1. `drizzle/0001_init.sql` — tables, RLS, trigger, seed
2. `drizzle/0002_backfill_profiles.sql` — backfill + idempotent trigger
3. `drizzle/0003_grants.sql` — table-level GRANTs

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

## What's NOT built yet (do not add until asked)

- Photo upload (needs Cloudflare R2)
- Album editor / page arranger
- Order + payment flow (needs Razorpay)
- Email notifications (needs Resend)
- Worker service
- Travel agency portal (`/agency`)
