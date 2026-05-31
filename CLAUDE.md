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
| ORM | Drizzle ORM (`drizzle-orm/postgres-js`) |
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
    auth/callback/route.ts    Supabase PKCE code → session exchange
    (auth)/                   Route group — public (login, signup)
    (app)/                    Route group — protected; layout redirects if no session
      dashboard/page.tsx
    admin/                    Admin section; layout checks role='admin' via Drizzle
  components/ui/              shadcn/ui generated components
  db/
    index.ts                  Drizzle client (service-role Postgres, server-only)
    schema.ts                 Drizzle table definitions (mirrors drizzle/0001_init.sql)
  lib/
    supabase/
      client.ts               createBrowserClient() — for 'use client' components
      server.ts               createServerClient() — for Server Components & Route Handlers
    validations.ts            Zod schemas (SignupSchema, LoginSchema, …)
drizzle/
  0001_init.sql               All tables, RLS policies, triggers, product seed
```

---

## Non-negotiable security rules

1. **User data via Supabase server client** — `createClient()` carries the user's JWT; `auth.uid()` resolves in Postgres and RLS is enforced as a real DB boundary.
2. **Admin / privileged data via Drizzle** — service role (`DATABASE_URL`) bypasses RLS intentionally for the admin portal and schema operations.
3. **Never mix them up** — don't use Drizzle for user-scoped reads/writes; don't expose service role to client code.
4. **RLS on every table** — see `drizzle/0001_init.sql`. Not defense-in-depth: it's the second enforcement layer for user data.
5. **Zod validation before any DB access** in every API route / server action.
6. **`getUser()` not `getSession()`** — session token can be stale; `getUser()` validates against Supabase.
7. **No secrets in committed code** — `.env.local` is gitignored. `.env.example` has placeholders.
8. **CSP headers** in `next.config.mjs`. Tighten `unsafe-eval` / `unsafe-inline` with nonces before prod.
9. **httpOnly/Secure/SameSite cookies** — handled automatically by `@supabase/ssr`.

---

## Data access pattern (IMPORTANT — follow this in every session)

### User-scoped reads and writes → Supabase server client

```ts
const supabase = createClient(); // from @/lib/supabase/server
// No WHERE user_id = ? needed — RLS policy "user_id = auth.uid()" filters automatically
const { data } = await supabase.from('albums').select('id, title, size, status');
```

The anon key + user JWT in the cookie means `auth.uid()` resolves in every query.
If a bug omits a filter, RLS still prevents data leaking to the wrong user.

### Admin / privileged operations → Drizzle (service role, bypasses RLS)

```ts
import { db } from '@/db';
// Used in admin/layout.tsx to check role, future admin portal queries, etc.
const [profile] = await db.select({ role: profiles.role }).from(profiles).where(eq(profiles.id, userId)).limit(1);
```

`DATABASE_URL` uses the `postgres.PROJECT_REF` user (superuser, `bypassrls`).
Never use `db` for ordinary user CRUD — the explicit filter is the only gate.

### Why this split
Drizzle was originally used for everything, but the connection bypasses RLS.
A missing `WHERE user_id = ?` would silently return all rows.
Switched in session 3 after confirming code `23503` (FK violation) revealed
the pattern, with the Supabase client as the enforcement layer for user data.

---

## Database

- Supabase project ID: `erpniqgzolikgokklmkc`
- URL: `https://erpniqgzolikgokklmkc.supabase.co`
- Region: ap-northeast-1 (AWS Tokyo)

**Tables**: `profiles`, `addresses`, `products`, `albums`, `album_pages`,
`photos`, `orders`, `payments`

**RLS model**:
- User tables: `user_id = auth.uid()`
- Child tables (album_pages, payments): access via parent ownership subquery
- `products`: public SELECT for active rows; admin writes
- Admin: `public.is_admin()` SQL function checks `profiles.role = 'admin'`

**Profile guarantee (three layers)**:
1. `on_auth_user_created` trigger (idempotent — `ON CONFLICT DO NOTHING` since `0002`)
2. `auth/callback/route.ts` upserts the profile after every email-link login
3. `0002_backfill_profiles.sql` one-time fix for users who signed up before the trigger

All user tables FK to `profiles(id)`, not `auth.users(id)`. A profile row must
exist before any album/photo/order insert can succeed.

**Migrations**: Write SQL to `drizzle/NNNN_description.sql`, paste into
Supabase Dashboard → SQL Editor → New query to run.

---

## Auth flow

1. User signs up → Supabase sends verification email
2. User clicks link → browser hits `/auth/callback?code=...`
3. Route handler exchanges code → sets session cookie → redirects to `/dashboard`
4. Middleware refreshes session on every request (reads + re-sets cookies)

---

## Environment variables

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | JWT anon key (safe for client) |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role JWT — **server-only, never expose** |
| `DATABASE_URL` | Transaction pooler (port 6543) — Drizzle runtime |
| `DIRECT_URL` | Session pooler (port 5432) — drizzle-kit migrations |

---

## Running locally

```bash
pnpm dev          # http://localhost:3000
```

Before first run:
1. Paste `drizzle/0001_init.sql` into Supabase SQL Editor and run it.
2. Paste `drizzle/0002_backfill_profiles.sql` and run it (backfills profiles for pre-existing users).
3. Set `Site URL = http://localhost:3000` in Supabase → Authentication → URL Configuration.
4. Ensure `.env.local` has all five variables filled in.

---

## Code conventions

- Server Components → `@/lib/supabase/server`
- Client Components → `@/lib/supabase/client`
- New tables: add to `src/db/schema.ts` AND write a new numbered SQL migration
- API route pattern: `Zod.parse(input)` → `supabase.auth.getUser()` → Drizzle query
- No React Hook Form yet — plain controlled forms for now
- shadcn@4 uses `@base-ui/react` primitives (same team as Radix, next-gen API)

---

## What's NOT built yet (do not add until asked)

- Photo upload (needs Cloudflare R2)
- Album editor / page arranger
- Order + payment flow (needs Razorpay)
- Email notifications (needs Resend)
- Worker service
- Travel agency portal (`/agency`)
