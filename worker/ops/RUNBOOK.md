# Worker V2 — Operational Runbook

For **operators**. No TypeScript knowledge assumed. Every procedure is copy-pasteable.

The worker is a background service. It has no UI. It takes jobs off a Postgres-backed queue
(pg-boss), processes photos and renders album PDFs, and writes results to Cloudflare R2 and Supabase.
Customers never talk to it directly — the Next.js app does.

---

## 0. The 60-second mental model

```
Customer uploads photo → app writes to R2 → app enqueues "image-hardening"
                                                        ↓
                                              ┌──── WORKER ────┐
Customer pays → app enqueues "album-pdf" ────▶│ picks up jobs  │──▶ writes R2 + Supabase
                                              └────────────────┘
Album deleted → app enqueues "r2-cleanup" ───────────▶
```

If the worker is down: **nothing is lost.** Jobs pile up in Postgres and are processed when it
returns. Customers see "Processing…" for longer than usual. That is the failure mode — degraded,
not destructive.

---

## 1. Health: is it alive?

Three endpoints on the worker's URL. `$WORKER` is the Render service URL.

| Endpoint | Question it answers | Act on it by |
|---|---|---|
| `GET /health` | Ready for work? (`{"status":"ok"}` = yes) | This is what the app checks |
| `GET /live` | Should I **restart** it? (503 = yes) | Restart the service |
| `GET /ready` | Should it be given work? (503 = no) | Wait; check dependencies |
| `GET /diagnostics` | What exactly is this process? | Investigation only |

```bash
curl -s $WORKER/health | jq
```

**Reading the result:**

- `"status":"ok"` → healthy, working.
- `"status":"degraded"` → running and processing, but something is impaired. **Not an emergency.**
  Look at `components[]` to see which one.
- `"status":"starting"` → booting or recovering. Wait 30s.
- `"status":"stopped"` → shutting down.
- **No response at all** → the service is down or asleep (Render free tiers sleep). Hit it again;
  it wakes on request.

`/diagnostics` and the detailed `/ready` need a token (see §11):

```bash
curl -s -H "Authorization: Bearer $WV2_DIAGNOSTICS_TOKEN" $WORKER/diagnostics | jq
```

Without the token `/diagnostics` returns 404 by design — that is not a fault.

---

## 2. Reading the logs

Logs are one JSON object per line (Render → service → Logs).

Every line has `level`, `message`, `timestamp`. Work-related lines also carry `jobId`,
`processor`, `correlationId`, `traceId`.

**The lines that matter:**

| `message` | Meaning | Action |
|---|---|---|
| `worker.ready` | Booted successfully | None |
| `worker.startup.report` | Startup checks — read `overall` | `warn` → read `checks[]` |
| `worker.job.start` / `.done` | Normal work | None |
| `worker.job.failed` | A job failed; will retry | None unless repeating |
| `worker.dispatch.failed` | Broker hiccup; loop survived and retried | None unless repeating |
| `worker.drain.timeout` | Shutdown abandoned a job (it will be redelivered) | None |
| `processor.rejected` | A photo/PDF was permanently rejected (bad input) | Only if a customer complains |
| `recovery.sweep` | Self-healing ran | None |
| `recovery.deferred` | Self-healing skipped — worker busy | None; normal under load |
| `resource.reset` with `reason:"unhealthy"` | **Chromium crashed and was rebuilt** | Investigate if frequent |
| `observability.metrics.degraded` | Telemetry backend failing | Non-urgent |

**Find one customer's job:**

```bash
# In Render's log search, filter by the photo/album id, then follow its correlationId.
```

---

## 3. Deploying

Render → service → **Manual Deploy** → *Deploy latest commit*. Or push to the deploy branch.

Render builds `worker/apps/worker/Dockerfile` with **Root Directory = `worker`**.

**After every deploy, verify:**

```bash
curl -s $WORKER/health | jq -r .status     # expect: ok
```

Then check the logs for `worker.startup.report` and confirm `"overall":"pass"`.

If it says `"overall":"fail"` the worker **exited on purpose** — read the failing check name. It is
almost always a missing or wrong environment variable.

### Rolling restart / worker replacement

Render replaces instances one at a time. Nothing special is required: the outgoing worker finishes
its current jobs (up to `WV2_DRAIN_TIMEOUT_MS`, default 30s), stops taking new ones, and exits.
Anything it did not finish is redelivered to the replacement.

**Do not** scale to zero and back during a busy period — prefer a rolling restart.

---

## 4. Scaling workers

Render → service → **Scaling** → set instance count.

Multiple workers are safe: the queue hands each job to exactly one worker (validated — see the
multi-worker suite). No configuration changes are needed to add workers.

See `CAPACITY.md` for how many you need.

---

## 5. Something is stuck

### Photos stuck on "Processing…"

1. Is the worker up? `curl -s $WORKER/health`
2. Is it *ready*? A `degraded` status with `database` or `storage` unhealthy means it cannot work.
3. Wait 5 minutes. The **recovery sweep** re-drives stuck photos automatically every 60s.
4. Still stuck after 10 minutes → check logs for `processor.rejected` (the photo was invalid — the
   customer must re-upload) or `recovery.failed`.

### A PDF never appears

1. PDFs are generated automatically on payment. The recovery sweep also re-drives stuck ones and
   heals any paid album missing a PDF.
2. If it stays missing, regenerate it: **Admin → Albums → \[album\] → Regenerate PDF**.
3. Check logs for `processor.rejected` with `reason` — e.g. `render_timeout`, `print_route_error`.
   `print_route_error` means the *app* failed to serve the print page, not the worker.

### Restarting recovery

Recovery runs on its own every `WV2_RECOVERY_INTERVAL_MS` (60s). It **defers itself while the
worker is busy** — `recovery.deferred` in the logs is normal, not a fault.

To force it: restart the worker. A sweep runs shortly after boot.

---

## 6. Dead-letter jobs

A job that fails its retry limit is parked by pg-boss rather than lost or retried forever.

```sql
-- Connect to Supabase (SQL editor) — jobs that gave up:
select name, data, output, created_on
from pgboss.job
where state = 'failed'
order by created_on desc
limit 50;
```

**To retry one** (rare — only after fixing the cause):

```sql
update pgboss.job set state = 'created', retry_count = 0
where id = '<job-id>';
```

Then confirm the worker picks it up in the logs.

---

## 7. Queues with no processor ⚠️

**Known gap.** The app enqueues onto `cover-thumbnail` and `blueprint-thumbnail`; Worker V2 does
**not** implement those two. Those jobs accumulate in Postgres, unprocessed, forever.

Consequences: admin-uploaded cover artwork does not get its generated thumbnail/dimensions, and
blueprint thumbnails are not produced. **Nothing customer-facing in the photo → album → PDF → payment
flow is affected**, and no data is lost.

The worker reports this itself:

- at boot, in `worker.startup.report` as a `queue-coverage` **warn**;
- continuously, as a `queue-coverage` **degraded** component in `/health`.

**Monitor the backlog:**

```sql
select name, count(*) from pgboss.job
where name in ('cover-thumbnail','blueprint-thumbnail') and state = 'created'
group by name;
```

If it grows without bound, purge it (these jobs are non-essential and idempotent to drop):

```sql
delete from pgboss.job
where name in ('cover-thumbnail','blueprint-thumbnail') and state = 'created';
```

Resolution requires implementing the two processors — tracked for a future phase.

---

## 8. Updating configuration

Render → service → **Environment** → edit → save. Render restarts the service automatically.

Configuration is validated at boot. A bad value **stops the worker** with a message naming the
variable — check `worker.startup.report` and the exit log. Fix the variable and redeploy; there is
no half-configured state.

See `CONFIGURATION.md` for every variable and its recommended value.

---

## 9. Emergency shutdown

**Stop processing immediately, keep data safe:**

Render → service → **Suspend**.

Queued jobs remain in Postgres. In-flight jobs are not acknowledged, so they return to the queue.
Nothing is lost. Resume when ready.

**Do not** delete the service — that also removes the environment configuration.

---

## 10. Rollback

1. Render → service → **Events** → find the last known-good deploy → **Rollback**.
2. Verify: `curl -s $WORKER/health | jq -r .status` → `ok`.
3. Check `worker.startup.report` is `pass`.

Rollback is safe at any time: the worker holds no state of its own. All state lives in Postgres and
R2, and both are backward-compatible across worker versions in this series.

**Caveat:** if the rollback crosses a database migration, roll the migration back first (see
`docs/DEPLOYMENT.md`).

---

## 11. Rotating secrets

Rotate in this order to avoid downtime:

1. Create the new credential in the provider (Supabase / Cloudflare / etc).
2. Render → Environment → update the variable → save (service restarts).
3. Verify health + a test job.
4. Revoke the old credential.

**Variables that are secrets:** `DIRECT_URL`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`,
`WV2_DIAGNOSTICS_TOKEN`.

`WV2_DIAGNOSTICS_TOKEN` can be rotated freely at any time — nothing depends on it except your own
`curl` commands.

**Never** paste secrets into logs, tickets, or chat. The worker itself redacts them: any log field
named like a token/secret/password/credential is written as `[redacted]`.

---

## 12. Upgrading Chromium

Chromium comes from the Debian package in the Docker image. To pick up a new version, **rebuild the
image** (deploy again) — `apt-get install chromium` fetches the current package.

After upgrading, verify a PDF renders:

1. Admin → Albums → pick any paid album → **Regenerate PDF**.
2. Watch for `processor.result` with `outcome:"ready"`.
3. Download the PDF and open it.

If rendering breaks after a Chromium upgrade, roll back the deploy (§10) — the previous image has
the previous Chromium.

---

## 13. Escalate to a developer when…

- `worker.startup.report` fails on a check you cannot fix by changing an environment variable.
- `resource.reset reason:"unhealthy"` appears repeatedly (Chromium crash-looping).
- The same job dead-letters repeatedly across different customers.
- `/live` returns 503 and a restart does not fix it.
- Memory `degraded` persists on an idle worker (possible leak).

Attach: the output of `/diagnostics`, and the last 200 log lines.
