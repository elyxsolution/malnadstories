# Production Deployment & Security Runbook

Hard requirements before this app handles **real customer payments**. Derived from
the payment security audit; each item maps to an audit finding.

---

## 1. Rotate the previously-committed Razorpay secrets (Finding 1 — CRITICAL)

The TEST `RAZORPAY_KEY_SECRET` and `RAZORPAY_WEBHOOK_SECRET` were committed to
`.env.example` and remain in git history. **Treat both as compromised.**

1. **Rotate in the Razorpay dashboard**
   - Settings → API Keys → regenerate the key (new `key_id`/`key_secret`).
   - Settings → Webhooks → edit the webhook → set a **new** signing secret.
2. **Store the new values only out-of-band**
   - Local dev: `.env.local` (gitignored — never `.env.example`).
   - Prod: the host's secret manager (Vercel/Fly/Render env vars, AWS Secrets
     Manager, etc.). Never in any committed file.
3. **Purge the old values from history** (rewrites history — coordinate with the team,
   then force-push and have everyone re-clone):
   ```bash
   # using git-filter-repo (preferred)
   git filter-repo --path .env.example --invert-paths        # or scrub just the lines
   # or BFG:
   bfg --replace-text <(printf 'bGihLGOvEMTJinYj2AK7HioN\nmalnadstories_test_webhook_2026\n')
   git push --force --all && git push --force --tags
   ```
4. Confirm `gitleaks detect --config .gitleaks.toml --log-opts="--all"` is clean.

`.env.example` now contains only placeholders, and `.gitleaks.toml` +
`.github/workflows/secret-scan.yml` block regressions (Finding 1 / item 6).

---

## 2. Run the new SQL migrations (Findings 2 + 4)

Supabase Dashboard → SQL Editor, **in order**:

| Migration | Finding | What it does | Deploy coupling |
|---|---|---|---|
| `0012_orders_payments_write_rls.sql` | 2 | Makes RLS an independent write barrier on `orders`/`payments` (SELECT-only user policy + RESTRICTIVE write-deny). | Safe to run anytime — server writes use `service_role` (BYPASSRLS). |
| `0013_webhook_amount_currency.sql` | 4 | Adds `p_currency` to `process_razorpay_event` + amount/currency match gate. **Signature change.** | **Deploy the app code at the same time** — the webhook route now calls the 8-arg signature. If the migration lands first, the webhook RPC 503s and Razorpay retries until the code is live (no data loss). |

**Rollback:** `0013` — re-create the previous 7-arg function from
`0010_orders_payments.sql` (§4) and redeploy the prior route. `0012` — restore the
old `users_own_orders` (`for all using (user_id = auth.uid())`) and drop the new
policies; note this reopens Finding 2, so only do it to unblock an incident.

---

## 3. Secret-scanning (Finding 1 / item 6)

- CI: `.github/workflows/secret-scan.yml` runs gitleaks on every push/PR over full
  history. Make it a required status check.
- Local pre-commit (recommended):
  ```bash
  # .git/hooks/pre-commit  (or via husky/lefthook)
  gitleaks protect --staged --config .gitleaks.toml --redact
  ```
- Config: `.gitleaks.toml` (default ruleset + Razorpay/Supabase rules; `.env.example`
  placeholders allowlisted).

---

## 4. Monitoring & alerting (Finding 7)

Wire alerts on these log signals:

| Signal | Where it logs | Why it matters |
|---|---|---|
| `[razorpay-webhook] signature verification FAILED` | App logs (host) | Forged webhook attempts or a secret mismatch. A spike = someone probing, or a misconfigured secret after rotation. |
| `[razorpay-webhook] AMOUNT/CURRENCY MISMATCH` | App logs (host) | A captured payment that did **not** match the order. Recorded, **not** fulfilled. Investigate every occurrence. |
| `razorpay amount/currency mismatch ...` (RAISE WARNING) | Supabase Postgres logs | DB-side record of the same mismatch (source of truth). |
| `order % recovered to paid from non-pending status %` | Supabase Postgres logs | `cancelled`/`failed` → `paid` via a genuine late capture (Finding 6). Review for cancel/late-capture races. |
| `order_not_found` results | App logs | Frequent = webhook consistently racing the order INSERT; tune if noisy. |

Suggested thresholds: page on any `AMOUNT/CURRENCY MISMATCH`; alert on
`signature verification FAILED` > N/min; weekly review of recovery warnings.

---

## 5. Rate limiting at scale (Finding 3 — MEDIUM)

`src/lib/rate-limit.ts` and the pg-boss enqueue singleton are **in-process**: correct
only on a single long-lived instance. **Before any multi-instance / serverless
deploy**, move both to a shared store (Upstash Redis or a Postgres-backed limiter),
keyed the same way (`createOrder:<userId>`, `webhook:<ip>`). Until then, pin the
deployment to a single instance. This is code-not-yet-written — do not scale out first.

---

## 6. CSP / headers (Finding 5)

`next.config.mjs` already scopes Razorpay (`checkout.razorpay.com` script, `*.razorpay.com`
frames/connect, `lumberjack.razorpay.com` telemetry). Production now drops
`'unsafe-eval'` automatically (`NODE_ENV==='production'`). **Remaining hardening:**
`script-src` still carries `'unsafe-inline'` for the App Router bootstrap — replace
with a per-request nonce (generate in `middleware.ts`, thread into the CSP header and
Next's `<Script nonce>`), then remove `'unsafe-inline'`. Deferred (touches the request
pipeline); tracked here.

---

## 7. Operational hygiene

- **`webhook_events` growth (Finding 7):** add a scheduled job to delete rows older
  than Razorpay's max retry window (a few days). Unbounded otherwise; not a security
  issue.
- **Webhook tunnel (dev only):** `cloudflared tunnel --url http://localhost:3001`,
  register `https://<host>/api/webhooks/razorpay` + events `payment.captured`,
  `payment.failed` in the dashboard.
- **Pre-launch checklist:** secrets rotated & out-of-band ✓; `0012`+`0013` applied ✓;
  live Razorpay keys set ✓; webhook secret matches dashboard ✓; monitoring alerts
  wired ✓; single-instance (or shared rate-limit store) ✓; gitleaks CI green ✓.
