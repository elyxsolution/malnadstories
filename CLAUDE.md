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

1. **All DB queries via Drizzle ORM** — never string-concatenated SQL, ever.
2. **RLS on every table** — see `drizzle/0001_init.sql`. Defense-in-depth.
3. **Zod validation before any DB access** in every API route.
4. **`getUser()` not `getSession()`** — session token can be stale; `getUser()` validates against Supabase.
5. **No secrets in committed code** — `.env.local` is gitignored. `.env.example` has placeholders.
6. **CSP headers** in `next.config.mjs`. Tighten `unsafe-eval` / `unsafe-inline` with nonces before prod.
7. **httpOnly/Secure/SameSite cookies** — handled automatically by `@supabase/ssr`.

---

## Drizzle + Supabase access model

Drizzle uses the **service role** key via `DATABASE_URL` (transaction pooler, port 6543).
The service role bypasses RLS — so API route code is the **primary access gate**.
RLS in SQL is defense-in-depth for direct DB access.

When writing API routes:
- Always check `supabase.auth.getUser()` first
- Only query rows where `userId = user.id`
- Never expose the service role key to the client

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

**Auto-create profile**: `on_auth_user_created` trigger inserts a row into
`profiles` on every `auth.users` insert. No client-side call needed.

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
2. Set `Site URL = http://localhost:3000` in Supabase → Authentication → URL Configuration.
3. Ensure `.env.local` has all five variables filled in.

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
