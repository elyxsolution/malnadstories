# Malnad Stories — Frontend Architecture Audit & Implementation Plan

> **Scope & guarantee.** This document is an *analysis-only* deliverable. No database
> schema, API contract, auth flow, payment/email/storage integration, admin workflow,
> or deployment artifact was modified to produce it. Every recommendation below adapts
> the **frontend** to the existing backend — never the reverse. The only file added by
> this work is this document.
>
> **Headline finding.** The brief is written as if the frontend is greenfield. It is
> not. The repository already contains a **production-grade, near-complete frontend**:
> 64 page routes, 70+ feature components, a full HSL design-token system, a custom
> album-builder studio, a working Razorpay checkout, and a 9-section admin console.
> The honest work remaining is **public-marketing depth, onboarding polish, and a
> handful of Pixory-class editor enhancements** — not a rebuild. This audit documents
> what exists, maps every endpoint to its consumer, inventories components (built vs.
> gap), compares against Pixory, and gives a roadmap targeted at the *real* gaps.

---

## Table of contents

1. [Phase 1 — System Architecture Analysis](#phase-1)
2. [Phase 2 — Frontend Dependency Mapping](#phase-2)
3. [Phase 3 — Frontend Component Inventory](#phase-3)
4. [Phase 4 — Pixory Feature Analysis](#phase-4)
5. [Phase 5 — Gap Analysis](#phase-5)
6. [Phase 6 — Frontend Development Roadmap](#phase-6)

---

<a name="phase-1"></a>

# Phase 1 — System Architecture Analysis

## 1.1 Framework & runtime

| Layer | Choice (verified in repo) |
|---|---|
| Framework | **Next.js 14.2.35**, App Router, React 18, TypeScript 5 |
| Package manager | pnpm |
| Styling | Tailwind CSS v3.4 + `@base-ui/react` (shadcn@4 generation) + `lucide-react` |
| Data + Auth | Supabase (Postgres + Supabase Auth) via `@supabase/ssr` (cookie sessions) |
| ORM | Drizzle ORM (`drizzle-orm/postgres-js`) — **admin/schema reads only** |
| Validation | Zod 4 on every route/action input (`src/lib/validations.ts`) |
| Payments | Razorpay (REST + Node crypto HMAC, dependency-free in `src/lib/razorpay.ts`) |
| Storage | Cloudflare R2, private bucket, presigned PUT/GET only (`src/lib/r2.ts`) |
| Email | Resend + React Email (`src/lib/email/*`) |
| Worker | Separate Node service (`/worker`): pg-boss + sharp + Puppeteer |

No client-state library (Redux/Zustand) and **no `framer-motion`** — animation is
CSS/Tailwind only (confirm before adding the dependency). State is local React
(`useState`/`useReducer`-style orchestration in the builder) + Server Components for reads.

## 1.2 API structure — three surfaces

The backend exposes work through **three distinct surfaces**, not one REST API:

1. **Server Actions** (the dominant surface) — `src/lib/actions/**`. Mutations are
   `'use server'` functions invoked directly from client components; no fetch URL.
   These cover auth, albums, builder, addresses, orders, profile, support, reviews,
   resolutions, and all admin writes.
2. **Route Handlers** (`app/api/**/route.ts`) — used only where a *URL* is genuinely
   needed: browser-direct uploads, pollers, third-party webhooks, and client crash sinks.
3. **Server Components** — pages read data directly through the Supabase server client
   (RLS-scoped) or Drizzle (admin), so most "GET" needs never become an endpoint.

This is why the endpoint count looks small: **most reads are co-located in Server
Components, and most writes are Server Actions.** The frontend's "API" is mostly typed
function imports, which is a strength — contracts are compile-checked.

## 1.3 Route architecture

```
src/app/
  page.tsx                       Public landing (minimal hero + footer)
  faq / testimonials / stories   Public CMS-backed pages (ISR, revalidate 300)
  albums/[id]/print              Token-gated print route (Puppeteer target, outside (app))
  auth/callback/route.ts         Supabase PKCE exchange + profile upsert

  (auth)/                        Public auth group — login, signup, forgot/reset password
  (app)/                         Protected group — layout redirects if no session
    dashboard                    Album library grid
    account                      Profile + addresses
    albums/new                   Create-album wizard
    albums/[id]                  Album detail
    albums/[id]/build            The album BUILDER (studio)
    checkout/[albumId]           Razorpay checkout
    orders, orders/[id]          Order history + tracking
    reviews, reviews/[id]        Album-review center (advisory pre-checkout review)
    support/**                   Support tickets, refunds, reprints

  admin/                         Back-office (RBAC-gated) — 9 sections, see §1.9
```

**Middleware** (`src/middleware.ts`): session refresh (uses `getUser()`, never
`getSession()`), route guards, `x-request-id` minting, `x-pathname` header for the admin
RBAC layout guard, per-request CSP nonce, and the "stay logged in" cookie backstop.

## 1.4 Authentication architecture

- Cookie-based Supabase Auth through `@supabase/ssr`. Three clients, strict separation:
  - `createClient()` (`server.ts`) — anon key + user JWT, **RLS-enforced**, for user data.
  - `createServiceClient()` (`service.ts`) — service role, **bypasses RLS**, server-only,
    for order/webhook/admin writes. Never reaches the browser.
  - `db` (Drizzle, `@/db`) — postgres superuser (BYPASSRLS) for admin role checks/reads.
- Flow: signup → email verify → `/auth/callback?code=` exchange + profile upsert →
  `/dashboard`. Password login goes through a `signIn` **server action** so the server
  controls cookie persistence ("Stay logged in" → persistent vs. session cookies + an
  8-hour absolute backstop in middleware).
- Password reset: `/forgot-password` (neutral response, no enumeration) →
  `resetPasswordForEmail` → `/auth/callback` (open-redirect-guarded) → `/reset-password`.
- **RBAC** (admin): `profiles.role='admin'` gate, then a fixed back-office role
  (`super_admin`/`production`/`support`/`content`) resolved from `admin_roles`. Enforcement
  is **capability-based** (`domain:action`), layered across layout guard + per-action
  `requireCapability` + nav filtering.

## 1.5 Database architecture

- Supabase Postgres (project `erpniqgzolikgokklmkc`, ap-northeast-1). 37 numbered SQL
  migrations in `drizzle/`. Core tables: `profiles`, `addresses`, `products`, `albums`,
  `album_pages`, `photos`, `orders`, `payments` — plus coupons, audit, support, refund/
  reprint, album_reviews, CMS content, layout templates, shipments, admin_roles,
  monitoring, error_events.
- **Two-layer security on every table: GRANTs (table access) + RLS (row filter).**
  User tables filter on `user_id = auth.uid()`; child tables via parent-ownership
  subqueries; service-only tables (`album_pdfs`, `webhook_events`, audit) have RLS on
  with no client policies.
- Privileged transitions run inside `SECURITY DEFINER` RPCs (e.g. `process_razorpay_event`,
  `admin_update_order_status`, `submit_album_for_review`) so dedupe + state change +
  audit are atomic.

## 1.6 Payment architecture

- TEST-mode Razorpay, INR. **Amount is always computed server-side** (`src/lib/pricing.ts`:
  product base price × copies − coupon + shipping tier). The client transmits only ids +
  copy count + coupon code — never a price.
- `createOrder` (action) verifies ownership (RLS) → validates coupon → computes total →
  inserts via service role (authenticated has no INSERT grant) → returns Razorpay order +
  `key_id` to the browser. A DB partial-unique index enforces ≤1 pending order/album.
- **The webhook is the single source of truth for "paid"** (`/api/webhooks/razorpay`):
  HMAC over raw body → atomic `process_razorpay_event()`. `/api/payments/verify` is a
  signature-checked reconciliation backstop that *also* drives the same RPC but never
  invents "paid" from client input.
- On first transition to paid: order-confirmation email + `startAlbumPdfGeneration` fire
  (idempotent).

## 1.7 Email architecture

- Provider-agnostic layer in `src/lib/email/`: `resend.ts` (sole SDK touchpoint),
  `send-email.ts` (idempotent + audited + never-throws), typed event senders, React Email
  templates. Idempotency via the `email_log` table (claim a `sending` row, partial-unique
  on `(order_id, event_type)`). If email is unconfigured, sends are skipped (logged) so
  checkout never breaks. **No customer-facing email UI** — it's backend-triggered.

## 1.8 Storage architecture

- Cloudflare R2, **private** bucket. File bytes never pass through the app server:
  browser `POST /api/photos/presign` → `PUT` straight to R2 → `POST /api/photos/confirm`.
- All reads are short-lived presigned GETs. The worker hardens every raw upload
  (validate magic bytes → strip EXIF → re-encode → thumbnail → upload sanitized
  derivatives → delete raw). **The app serves only sanitized derivatives of `ready`
  photos** — never the raw `r2_key`.
- Object key: `{user_id}/albums/{album_id}/{uuid}.{ext}`. R2 access is isolated to
  `src/lib/r2.ts` (`import 'server-only'`).

## 1.9 Admin architecture

`/admin` is RBAC-gated and spans nine areas, all already built:

| Area | Routes |
|---|---|
| Overview / analytics | `/admin`, `/admin/analytics`, `/admin/production` |
| Orders & fulfilment | `/admin/orders[/id]` (status machine, tracking, notes) |
| Catalog | `/admin/albums[/id]`, `/admin/covers`, `/admin/templates[/…]`, `/admin/reviews[/id]` |
| Commerce | `/admin/coupons[/…]`, `/admin/customers[/id]` |
| Relationships | `/admin/support[/id]`, `/admin/refunds[/id]`, `/admin/reprints[/id]` |
| Content | `/admin/cms[/content/…]` |
| Shipping | `/admin/shipping`, shipment panel on order detail |
| Platform | `/admin/monitoring`, `/admin/errors[/id]`, `/admin/security`, `/admin/storage`, `/admin/system`, `/admin/settings` |
| Access | `/admin/users` (role assignment), `/admin/denied` |

Admin reads use Drizzle (cross-user, BYPASSRLS); admin writes go through gated server
actions → `SECURITY DEFINER` RPCs that validate + mutate + audit in one transaction.

---

<a name="phase-2"></a>

# Phase 2 — Frontend Dependency Mapping

Because most of the API is **Server Actions** (typed imports, not URLs), the map below
is split into (A) route handlers (true HTTP endpoints) and (B) server actions. For each,
the consuming screen is named.

## 2.A — Route handlers (HTTP endpoints)

| Endpoint | Method | Auth | Request | Response | Frontend consumer |
|---|---|---|---|---|---|
| `/api/photos/presign` | POST | User JWT (RLS) + rate-limit | `{albumId, filename, contentType, size}` | `{url, key}` | **Album Builder** → `_uploader.tsx` |
| `/api/photos/confirm` | POST | User JWT (RLS) | `{albumId, key, originalFilename}` | `{id, status:'pending'}` | **Album Builder** → `_uploader.tsx` |
| `/api/photos/[id]` | DELETE | User JWT (RLS) | path id | `{ok}` | **Album Builder** → `_tray.tsx` |
| `/api/photos?albumId=` | GET | User JWT (RLS) | query `albumId` | `{photos:[{id,status,url,thumbUrl,takenAt,width,height}]}` | **Album Builder** poll while `pending` |
| `/api/orders/[id]` | GET | User JWT (RLS) | path id | `{status}` | **Order confirmation** (`orders/[id]/_status.tsx` 3 s poll) |
| `/api/albums/[id]/pdf` | GET | User JWT (RLS) | path id | `{status, url?, generatedAt?}` | **Purchased album / order** PDF poll |
| `/api/admin/albums/[id]/pdf` | GET | Admin (capability) | path id | `{status, url?}` | **Admin album detail** PDF download |
| `/api/payments/verify` | POST | User JWT + rate-limit | `{razorpay_order_id, _payment_id, _signature}` | `{ok}` | **Checkout** success callback (`_checkout.tsx`) |
| `/api/webhooks/razorpay` | POST | HMAC signature | raw Razorpay event | 200/400/503 | Razorpay (server-to-server; no UI) |
| `/api/observability/report` | POST | rate-limited | sanitized client error | `{ok}` | `global-error.tsx` crash sink |
| `/api/security/csp-report` | POST | rate-limited | CSP violation | 204 | Browser CSP reporter |
| `/api/worker/health` | GET | — | — | health JSON | Worker pre-warm component |
| `/auth/callback` | GET | PKCE code | `?code, ?next` | redirect | Auth (email link / reset) |

## 2.B — Server actions (typed imports)

| Action (file) | Consumer screen | Notes |
|---|---|---|
| `signIn`, `signUp`?, `signOut` (`actions/auth.ts`) | Login, Signup, header logout | server-controlled cookies |
| `createAlbum`, `deleteAlbum` (`actions/albums.ts`) | Create-album wizard, Dashboard card | delete enqueues R2 cleanup, locked once paid |
| `saveLayout`, `savePhotoEdit`, `submitAlbum`, `selectCover` (`actions/builder.ts`) | **Album Builder** | re-reads layout from DB on submit; edit-locked when paid |
| `addAddress` (`actions/addresses.ts`) | Checkout address picker, Account | RLS |
| `createOrder`, `cancelOrder`, `previewCoupon`, `previewOrderAmount` (`actions/orders.ts`) | **Checkout** | amount server-computed; coupon advisory then re-validated |
| `updateProfile` (`actions/profile.ts`) | Account | name policy in `lib/auth/policy.ts` |
| `createTicket`, `replyToTicket` (`actions/support.ts`) | Support center | RLS + ownership re-check |
| `createRefundRequest`, `createReprintRequest` (`actions/resolutions.ts`) | Support → requests | eligibility gate; one active/order |
| `markRevisionInProgress` (`actions/reviews.ts`) | Review center → Open builder | advisory |
| Admin actions (`actions/admin/*`) | Admin console | each `requireCapability` → `SECURITY DEFINER` RPC → audit |

### Endpoint → screen coverage check

Every endpoint and action maps to a built consumer. **There are no orphaned endpoints
without a frontend, and no frontend screen calling a missing endpoint.** The integration
surface is complete; gaps are in *presentation breadth*, not wiring (see Phase 5).

---

<a name="phase-3"></a>

# Phase 3 — Frontend Component Inventory

Legend: **✅ Built** · **🟡 Partial / thin** · **⬜ Gap (frontend-only, buildable)** ·
**🚫 Backend-required (out of scope)**

## Public website

### Homepage — 🟡 (minimal)
- ✅ Hero (`page.tsx`), brand wordmark, primary/secondary CTA, footer links
- ⬜ Feature/benefit section, How-it-works (3-step), Sample-album showcase,
  Testimonials strip (CMS `testimonial` exists), Pricing teaser, Final CTA band
- ✅ Tokens, grain, `animate-rise` entrance already available to build with

### Pricing page — ⬜ (absent; frontend-only)
- ⬜ Pricing cards (24/36/48), package comparison, FAQ accordion
- Data source already public: `products` table has **anon SELECT** → no backend change

### Contact page — ⬜ (public absent) / ✅ (authenticated exists)
- ✅ Authenticated support center (`/support`)
- ⬜ Public/pre-auth contact surface + support info block

### FAQ / Testimonials / Stories — ✅
- ✅ `/faq`, `/testimonials`, `/stories` render published CMS content (ISR, `revalidate 300`),
  via `listPublished()` (cached, published-only). `components/public-page.tsx` shell.

## Authentication — ✅ (complete)
- ✅ Login form, validation, error states (`(auth)/login`)
- ✅ Signup + email-verification state (`(auth)/signup`)
- ✅ Forgot-password (neutral) + reset-password (recovery-gated) + `_auth-shell.tsx`

## Customer dashboard — ✅ (mostly) / 🟡 (widgets)
- ✅ Header (`app-header.tsx`, `customer-nav.tsx`, `customer-shell.tsx`)
- ✅ Album library grid (`dashboard/_library.tsx`, `_album-card.tsx` with purchased state,
  delete + confirm, status badge)
- 🟡 "Order overview" / "Recent activity" surfaced via cards, not a dedicated widget
- 🚫 "Notifications" widget — **no notifications table/endpoint** in backend → Backend-required
- ✅ Profile widget → `/account` (`_account.tsx`)

## Album creation flow — ✅
- ✅ Create-album wizard (`albums/new/_wizard.tsx`, `_form.tsx`): size selection from
  `products`, **mandatory cover selection** (active cover templates), optional metadata
  (destination / travel dates / description)
- Note: "Theme selection" maps to **cover + layout templates** (no separate theme entity)

## Album builder — ✅ (rich, custom "studio")
- ✅ Drag-and-drop canvas / pages (`_builder.tsx` orchestrator, `_block.tsx`, `_pair-frame.tsx`)
- ✅ Photo tray (`_tray.tsx`, `_tray-toolbar.tsx`) — draggable thumbs, placed badge, edit/delete
- ✅ Layout picker (`_layout-panel.tsx`) applying active layout-template presets
- ✅ Photo editor (`_photo-editor.tsx`): free crop, rotate 90°, straighten/tilt, flip,
  brightness, sharpness — non-destructive (`photos.edit_config`)
- ✅ Quick crop (`_quick-crop.tsx`): zoom/pan within a fixed frame
- ✅ The renderer (`_photo-frame.tsx`) — single source of truth, reused in tray/slots/
  preview/PDF
- ✅ Zoom/rotation controls, page navigation (`_navigator.tsx`), keyboard shortcuts
  (`_shortcuts.tsx`)
- ✅ Auto-save semantics + submit; **preview mode** (`_preview.tsx`)
- ✅ Auto-layout assistant (`_assistant.tsx`, `_proposal.tsx`) over `lib/builder/auto-layout.ts`
- ✅ Purchased (read-only) view (`_purchased.tsx`) replacing the editor once paid
- 🟡 "Auto-save indicator" exists implicitly; a more explicit saved/saving status pill is a polish item
- 🚫 Per-page background color/texture, text boxes, stickers/clipart — **not in schema** → Backend-required

## Checkout — ✅
- ✅ Cart/order summary, copies stepper (1–10), coupon field (`_checkout.tsx`)
- ✅ Address form + picker (`_address-picker.tsx`)
- ✅ Readiness panel (`_readiness.tsx`), progress (`_progress.tsx`)
- ✅ Razorpay payment status + success (`_success.tsx`); confirmation poller
- ✅ Shipping-tier selection (standard/priority/express, server-resolved fee)

## Order tracking — ✅
- ✅ Status timeline + copy (`orders/[id]/_status.tsx`, `lib/orders/status.ts`)
- ✅ Shipment card (`_shipment-card.tsx`) — courier/tracking/progress when a shipment exists
- ✅ Order history list (`orders/page.tsx`)

## Admin console — ✅ (broad)
- ✅ User/role management (`admin/users/_roles.tsx`)
- ✅ Album management + preview + PDF controls
- ✅ Orders (table, filters, console, operations), production board
- ✅ Analytics overview, monitoring, errors, security, storage, system
- ✅ Settings, coupons, covers, templates, CMS, support, refunds, reprints, reviews, shipping
- ✅ Admin nav (`admin/_nav.tsx`) capability-filtered

## Shared UI primitives — ✅
`components/ui/`: `button`, `card`, `input`, `label`, `skeleton`, `status-badge`,
`empty-state`, `back-link`. Brand/atmosphere: `brand`, `grain`, `book`, `page-frame`,
`public-page`. Worker gating: `worker/use-worker-gate`, `worker-prewarm`.

> **Inventory verdict:** the component matrix the brief asks to "generate" is ~90%
> already present. Genuine net-new frontend components live almost entirely in the
> **public marketing** band plus a few **builder/onboarding polish** pieces.

---

<a name="phase-4"></a>

# Phase 4 — Pixory feature analysis

Pixory's editor is a browser photobook builder centered on: smart auto-fill, theme/
background systems, spread-based editing, drag-drop with snapping, per-page text and
embellishments, and a guided onboarding. Each capability is assessed against **existing
backend APIs only**.

| Pixory capability | Backend supports it? | Frontend needed | State / interactions |
|---|---|---|---|
| Album creation (size → cover → photos) | ✅ Yes (`createAlbum`, products, cover templates) | ✅ Already built (wizard) | wizard step state |
| Smart auto page-generation ("auto-fill") | ✅ Yes (`lib/builder/auto-layout.ts`, layout templates) | ✅ Built (`_assistant`/`_proposal`); enhance UX | proposal preview + accept/regenerate |
| Layout selection per spread | ✅ Yes (layout templates → `Block[]`) | ✅ Built (`_layout-panel`) | focused-block state |
| Drag-drop photo organization | ✅ Yes (overlays = normalized rects) | ✅ Built; add snapping/guides polish | drag state, snap thresholds |
| Spread / two-page preview | ✅ Yes (`spread-full`/`double-spread`, `_preview`) | ✅ Built | page index, spread walk |
| Non-destructive crop/rotate/adjust | ✅ Yes (`edit_config`) | ✅ Built (`_photo-editor`) | per-photo edit config |
| Photo reordering by capture date | ✅ Yes (EXIF `taken_at` ordering) | ✅ Built | server order |
| WYSIWYG print/preview PDF | ✅ Yes (print route + worker Puppeteer) | ✅ Built (poll + download) | PDF status poll |
| Onboarding / first-run guidance | ✅ Yes (no backend needed) | ⬜ **Build** (coachmarks, empty-state CTA) | local "seen" flag (localStorage) |
| Captions / page text | 🟡 Partial (`album_pages.caption` only) | 🟡 caption UI can expand; **rich text boxes** = backend | caption state |
| Per-page **background color/texture** | 🚫 No column | — | **Requires Backend Enhancement – Not Included** |
| **Stickers / clipart / embellishments** | 🚫 No model | — | **Requires Backend Enhancement – Not Included** |
| Multiple **theme** packs (bg + font sets) | 🚫 Partial only via cover/layout templates; no theme entity | — | **Requires Backend Enhancement – Not Included** |
| Auto photo **enhancement / filters** (AI) | 🚫 Only brightness/sharpness exist; no color filters | — | **Requires Backend Enhancement – Not Included** |
| Shared/collaborative albums | 🚫 No share model (single-owner RLS) | — | **Requires Backend Enhancement – Not Included** |
| Face/auto photo selection | 🚫 No ML pipeline | — | **Requires Backend Enhancement – Not Included** |

**Takeaway:** Malnad Stories already matches Pixory on the *core* builder loop
(create → auto-layout → arrange → edit → preview → order) and in some areas (security,
non-destructive editing, true WYSIWYG PDF) is more rigorous. The Pixory-style polish
that is *frontend-only and in scope*: **onboarding/coachmarks, drag snapping/alignment
guides, an explicit save-state indicator, and a richer auto-layout proposal UX.**
Everything requiring a new content model (backgrounds, stickers, themes, AI filters,
sharing) is correctly **out of scope**.

---

<a name="phase-5"></a>

# Phase 5 — Gap analysis

## A. Existing (backend + frontend both shipped)
Auth (login/signup/reset), dashboard/library, create-album wizard, the full album
builder (upload, tray, layouts, editor, quick-crop, preview, auto-layout, submit,
purchased view), checkout (copies/coupon/shipping/address/Razorpay), order history +
tracking + shipment card, review center, support + refunds + reprints, public FAQ/
testimonials/stories, the entire admin console (orders, fulfilment, coupons, customers,
covers, templates, CMS, reviews, shipping, monitoring, errors, security, storage,
users/RBAC). **This is the bulk of the product.**

## B. Frontend-only (buildable on existing APIs — *the real backlog*)

| # | Gap | Backend source already present | Effort |
|---|---|---|---|
| B1 | **Homepage depth** — features, how-it-works, sample showcase, testimonials strip, pricing teaser, CTA band | static + `listPublished('testimonial')` | M |
| B2 | **Public pricing page** | `products` (anon SELECT) | S |
| B3 | **Public contact / support-info page** | static + existing support flow | S |
| B4 | **Public blog & announcements rendering** | CMS `blog`/`announcement` (currently manage-only) | M |
| B5 | **Builder onboarding / coachmarks + richer empty states** | none needed (localStorage flag) | M |
| B6 | **Explicit auto-save / save-state indicator** in builder | existing `saveLayout` returns | S |
| B7 | **Drag snapping + alignment guides** for overlays | overlays already normalized rects | M |
| B8 | **Auto-layout proposal UX upgrade** (side-by-side compare, per-spread accept) | `auto-layout.ts` | M |
| B9 | **Account/notifications surface** built from existing signals (open tickets, review-changes, order updates) — *aggregation in UI, not a notifications table* | reviews/support/orders reads | M |
| B10 | **Global polish pass** — consistent empty/loading/error/focus states, mobile builder ergonomics, `prefers-reduced-motion` audit | design tokens present | M |
| B11 | **SEO/meta + OpenGraph** for public pages | Next metadata API | S |

## C. Backend-required (DO NOT implement — flagged only)
- Per-page background color/texture; rich text boxes; stickers/clipart/embellishments
- Theme packs (background + font systems as a first-class entity)
- AI auto-enhance / color filters / face-based auto-selection
- Real-time **notifications** model (table + endpoint + read state)
- Collaborative/shared albums; gifting/multi-recipient
- Refund/reprint **execution** (issuing Razorpay refunds / kicking reprints) — manual by design
- Wishlist/cart for multiple albums (orders are per-album today)

> Each item in **C** is marked **"Requires Backend Enhancement — Not Included."**

---

<a name="phase-6"></a>

# Phase 6 — Frontend development roadmap

Ordered as the brief requests. For each: components, API integrations, state,
dependencies, complexity. Because the app is already built, most "sections" are
**verify + polish**, with net-new work concentrated in the public/marketing band and
builder enhancements.

### 1. Design system — **verify & document** (S)
- **Components:** the token layer (`globals.css` HSL vars + `tailwind.config.ts`) and
  `components/ui/*` already exist. Add a short token/usage reference; fill any missing
  primitive (e.g. `Dialog`, `Select`, `Tooltip`) only if a later section needs it.
- **API:** none. **State:** none. **Deps:** none (do **not** add framer-motion without
  approval; CSS motion + `--ease-premium`/`--ease-glide` are in place).
- **Why first:** everything below consumes these tokens; lock the vocabulary.

### 2. Authentication UI — **verify** (XS)
- Already complete; pass only for state-matrix/focus-ring/`prefers-reduced-motion`
  consistency and mobile spacing. **API:** existing auth actions. **State:** form-local.

### 3. Dashboard — **polish** (S–M)
- **Components:** recent-activity widget, clearer empty state for first-time users
  ("Create your first album"), optional aggregated-signal strip (B9).
- **API:** existing RLS reads (albums, orders, reviews, tickets). **State:** server reads
  + minimal client toggles. **Dependency:** none. **No notifications table** (that's C).

### 4. Album creation — **polish** (S)
- **Components:** richer cover-preview, size comparison inline in the wizard.
- **API:** `products`, cover templates, `createAlbum`. **State:** wizard step.

### 5. Album builder — **enhance** (M, the highest-value net-new band)
- **Components:** onboarding coachmarks (B5), save-state indicator (B6), snapping/
  alignment guides (B7), upgraded auto-layout proposal compare (B8), mobile ergonomics.
- **API:** `saveLayout`/`savePhotoEdit`/`submitAlbum`, `/api/photos/*`, `auto-layout.ts`.
- **State:** existing builder orchestration (already memoized); add `localStorage`
  "onboarding seen" + transient snap-guide state. **Dependency:** keep `_photo-frame`
  the single renderer; do not fork rendering. **Risk:** regression-sensitive — change
  behind feature toggles, verify PDF parity unchanged.

### 6. Checkout — **verify** (XS)
- Complete; verify error/empty/loading states and the Razorpay script-load fallback.
  **API:** `createOrder`/`previewCoupon`/`previewOrderAmount`/`/api/payments/verify`.

### 7. Order tracking — **verify/polish** (XS–S)
- Complete; optionally enrich the timeline visual + shipment progress animation.
  **API:** `/api/orders/[id]`, shipment reads. **State:** poller (exists).

### 8. Admin console — **verify** (S)
- Broad and built; pass for table empty/loading states, mobile/responsive admin tables,
  and capability-aware UI hiding (security boundary stays server-side). **API:** existing
  admin actions/RPCs. **No workflow changes.**

### 9. Pixory-inspired enhancements — **build (in-scope subset only)** (M)
- **Components:** public marketing depth (B1–B4: homepage sections, pricing, contact,
  blog/announcements rendering), SEO/meta (B11), global polish pass (B10).
- **API:** `products` (anon), `listPublished()` (extend to `blog`/`announcement`),
  Next metadata API. **State:** mostly static/server. **Dependency:** CMS public reader
  already filters published-only and is cached + tag-busted — reuse it; do not change its
  contract.
- **Explicitly excluded** (Backend-required, Phase 5C): backgrounds, stickers, themes,
  AI filters, notifications model, sharing.

## Suggested sequencing

```
Sprint 1  Design-system doc + primitives gap-fill  →  Public marketing band (B1–B4, B11)
Sprint 2  Builder enhancements (B5–B8) behind toggles + PDF-parity verification
Sprint 3  Dashboard/account polish (B9) + global state-matrix & a11y pass (B10)
Sprint 4  Admin responsive/empty-state polish + final taste review
```

Each sprint ends with the project's mandatory design review (taste → impeccable-design →
emil-kowalski motion → taste) and a confirmation that **no backend file changed**.

---

## Final deliverable checklist

1. ✅ **Architecture audit** — Phase 1 (framework, API surfaces, auth, DB, payments,
   email, storage, admin).
2. ✅ **API-to-frontend mapping** — Phase 2 (route handlers + server actions → screens;
   coverage confirmed, no orphans).
3. ✅ **Component inventory** — Phase 3 (built vs. gap vs. backend-required, by screen).
4. ✅ **Pixory feature comparison** — Phase 4 (per-feature backend-support verdict).
5. ✅ **Gap analysis** — Phase 5 (Existing / Frontend-only / Backend-required).
6. ✅ **Frontend roadmap** — Phase 6 (prioritized, with components/APIs/state/deps/effort).

**Backend untouched: confirmed.** Every recommendation adapts the frontend to the
existing contracts. Items needing schema/API/auth/payment/storage/admin changes are
listed only and marked *Not Included*.
