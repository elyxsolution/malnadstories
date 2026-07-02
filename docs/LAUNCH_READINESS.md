# Malnad Stories — Launch Readiness Checklist

> Manual, end-to-end verification before MVP launch. Run each item against a **staging
> deploy built from the latest `main`** with the worker running. Mark ✅ / ⚠️ / ❌.
> This is a verification checklist, not a spec — it changes no behavior.

## 0. Pre-flight (config / deploy blockers)
- [ ] App deployed on Vercel from the **latest commit** (`view-source` shows the new 4‑step wizard, no "Chapter V").
- [ ] Worker deployed on Render from latest `main`; `pnpm build` clean; **Chrome present** (`.puppeteerrc.cjs` cache dir + worker `postinstall`).
- [ ] `WORKER_URL` (app) points at the Render worker; `APP_URL` (worker) points at the deployed app origin.
- [ ] **Razorpay LIVE** keys set + LIVE webhook registered (`payment.captured`, `payment.failed`) with `RAZORPAY_WEBHOOK_SECRET`.
- [ ] **Email** sender on a **verified domain** in Resend (`EMAIL_FROM`); `RESEND_API_KEY` set. `NEXT_PUBLIC_SITE_URL` has **no trailing slash**.
- [ ] R2 env complete (`R2_*`) and bucket CORS allows PUT/GET from the app origin.
- [ ] Migrations applied through **0037** in order; ~~confirm **0020 + 0021** (column lockdowns) applied~~ — ✅ **0020 + 0021 applied to production**.
- [ ] At least one admin has a back-office role (or relies on the super_admin default).

## 1. Customer journey
- [ ] Sign up → verify email → land on dashboard.
- [ ] Dashboard empty state explains how to start; "Create" → wizard.
- [ ] Wizard: Begin (title, destination, **From/To album period** with From ≤ To), Format (size + cover), Memories (upload, **"N of cap used"**), Review.
- [ ] Upload photos → they process (pending → ready); cap enforced (24→72, 36→102, 48→128); over-cap upload blocked.
- [ ] "Build it for me" produces a varied layout (uses active templates when present) → preview → opens builder.
- [ ] Builder: place photos, edit in-page (Edit on a placed photo → crop/rotate/brightness/flip), apply a Layout, Save, Submit.
- [ ] Submitted album → enters review (advisory) and is checkout-eligible.
- [ ] Checkout: copies stepper, address picker, coupon, server-computed total → Razorpay → success.
- [ ] Order confirmation page polls to `paid`; confirmation email arrives.
- [ ] Order tracking page shows status timeline; shipment card appears once a shipment exists.
- [ ] Purchased album is read-only (no edit/checkout); Download PDF works once ready.

## 2. Admin journey
- [ ] `/admin` reachable only by admins; non-admin → `/dashboard`; wrong-capability role → `/admin/denied`.
- [ ] Nav groups render only the allowed items per role (super_admin/production/support/content).
- [ ] Order console (`/admin/orders/[id]`): Overview / Fulfilment & Shipping / Activity tabs; **one** tracking field + **one** courier picker.

## 3. Order fulfilment
- [ ] Advance order status forward-only (paid→processing→printing→packed→shipped→delivered).
- [ ] `packed→shipped` blocked until tracking + courier saved; "Save tracking" sets it once (order + shipment).
- [ ] Each transition fires the matching customer email (processing/printing/packed/shipped/delivered).
- [ ] Audit trail records every status/tracking/note change.

## 4. Review workflow
- [ ] Customer submit → admin `/admin/reviews` shows it; Approve / Request changes / Reject.
- [ ] "Request changes" requires notes; customer sees them in the builder banner + `/reviews/[id]`; resubmit loops.
- [ ] Review never blocks checkout (advisory).

## 5. Support workflow
- [ ] Customer creates a ticket (rate-limited); admin replies; internal notes hidden from customer.
- [ ] Auto-transitions (customer reply reopens; first admin reply → in_progress); emails fire.

## 6. Refund workflow
- [ ] Refund request only on a paid-family order; one active per order; admin status machine + notes; emails on submit/approve/reject/complete.
- [ ] No Razorpay refund is issued automatically (manual by design).

## 7. Reprint workflow
- [ ] Reprint request only on a delivered order; one active per order; admin decisions + emails.
- [ ] No automatic reprint order/PDF (manual by design).

## 8. Shipping workflow
- [ ] Create shipment (courier + tracking); status transitions (created→picked_up→…→delivered/failed); Sync / Cancel.
- [ ] Shipment status is independent of order status; customer sees a read-only shipment card.
- [ ] No tracking-number enumeration route exists.

## 9. Monitoring (10A)
- [ ] `/admin/monitoring` shows health per service + live alerts; "Run checks" persists a snapshot (throttled).
- [ ] A breached threshold opens exactly one alert (dedupe); clearing it auto-resolves.

## 10. Error tracking (10B)
- [ ] `/admin/errors` lists captured errors (deduped, occurrence counts, request id, last-seen).
- [ ] A forced client/server error appears; Resolve marks it + the linked alert.
- [ ] No raw bodies/headers/PII stored.

## 11. PDF generation (audit — see §PDF below)
- [ ] Admin Generate → queued → processing → **ready**; Download works.
- [ ] Forced failure shows **status = failed** with the **stored worker reason** surfaced in the admin UI.
- [ ] Auto-generation on first `paid` (webhook + verify) produces a PDF.

## 12. Payments
- [ ] Amount is server-computed; client sends no price.
- [ ] Webhook is the source of truth for `paid`; duplicate webhook is a no-op; amount/currency mismatch is recorded but not paid.
- [ ] `payments/verify` reconciles but never sets paid alone; both are rate-limited.

## 13. Security / RBAC (10C)
- [ ] Login + forgot-password rate-limited; password policy 8–25; name normalized.
- [ ] Every admin action independently capability-gated; `access.denied` audited.
- [ ] CSP Report-Only header present; violations land in the Error Center.
- [ ] Delete album never hangs (timeout-bounded enqueue + client finally).

## 14. UX consistency (10E.2)
- [ ] Every list page has a real empty state (what / why / next action) — no bare "No data".
- [ ] Status pills share one badge structure across orders/shipments/reviews/support/refunds/reprints/monitoring/errors.
- [ ] Loading uses skeletons/spinner consistently; no layout shift.
- [ ] Mobile: builder tray/navigator/panels usable; checkout + admin order console usable; no clipped controls.

---

## Known non-blockers (accept for MVP, revisit at scale)
- In-process rate-limit + pg-boss enqueue are per-instance (single server only).
- Single Render worker = SPOF for PDF/image; monitoring is pull-on-view (no external uptime ping).
- Refund/reprint execution is manual; failed-email retry is manual.
- CSP still Report-Only (staged toward enforced nonce).
