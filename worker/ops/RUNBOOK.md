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

| Endpoint           | Question it answers                       | Act on it by                |
| ------------------ | ----------------------------------------- | --------------------------- |
| `GET /health`      | Ready for work? (`{"status":"ok"}` = yes) | This is what the app checks |
| `GET /live`        | Should I **restart** it? (503 = yes)      | Restart the service         |
| `GET /ready`       | Should it be given work? (503 = no)       | Wait; check dependencies    |
| `GET /diagnostics` | What exactly is this process?             | Investigation only          |

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

| `message`                                  | Meaning                                           | Action                       |
| ------------------------------------------ | ------------------------------------------------- | ---------------------------- |
| `worker.ready`                             | Booted successfully                               | None                         |
| `worker.startup.report`                    | Startup checks — read `overall`                   | `warn` → read `checks[]`     |
| `worker.job.start` / `.done`               | Normal work                                       | None                         |
| `worker.job.failed`                        | A job failed; will retry                          | None unless repeating        |
| `worker.dispatch.failed`                   | Broker hiccup; loop survived and retried          | None unless repeating        |
| `worker.drain.timeout`                     | Shutdown abandoned a job (it will be redelivered) | None                         |
| `processor.rejected`                       | A photo/PDF was permanently rejected (bad input)  | Only if a customer complains |
| `recovery.sweep`                           | Self-healing ran                                  | None                         |
| `recovery.deferred`                        | Self-healing skipped — worker busy                | None; normal under load      |
| `resource.reset` with `reason:"unhealthy"` | **Chromium crashed and was rebuilt**              | Investigate if frequent      |
| `observability.metrics.degraded`           | Telemetry backend failing                         | Non-urgent                   |

**Find one customer's job:**

```bash
# In Render's log search, filter by the photo/album id, then follow its correlationId.
```

---

## 3. Deploying

Render → service → **Manual Deploy** → _Deploy latest commit_. Or push to the deploy branch.

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
2. Is it _ready_? A `degraded` status with `database` or `storage` unhealthy means it cannot work.
3. Wait 5 minutes. The **recovery sweep** re-drives stuck photos automatically every 60s.
4. Still stuck after 10 minutes → check logs for `processor.rejected` (the photo was invalid — the
   customer must re-upload) or `recovery.failed`.

### A PDF never appears

1. PDFs are generated automatically on payment. The recovery sweep also re-drives stuck ones and
   heals any paid album missing a PDF.
2. If it stays missing, regenerate it: **Admin → Albums → \[album\] → Regenerate PDF**.
3. Check logs for `processor.rejected` with `reason` — e.g. `render_timeout`, `print_route_error`.
   `print_route_error` means the _app_ failed to serve the print page, not the worker.

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

## 7b. R2 orphan cleanup (manual, not scheduled)

Unconfirmed raw uploads can accumulate in R2: the browser PUTs the bytes, then the confirm never
lands (tab closed, offline, permanent 4xx). The object then has no `photos` row and nothing else
in the system knows it exists.

Two diagnostics ship in the worker image for this. **Both default to reading only.**

```bash
# What is in the bucket? (read-only, deletes nothing, ever)
node dist/diagnostics/orphan-scan/cli.js --bucket

# What WOULD be deleted? (dry run — this is the default, no flag needed)
node dist/diagnostics/orphan-cleanup/cli.js --bucket

# Actually delete. Only verified orphans; see the gates below.
node dist/diagnostics/orphan-cleanup/cli.js --bucket --execute
```

Scope is **required** — `--bucket`, `--user <uuid>`, or `--album <userUuid> <albumUuid>`. There is
no implicit whole-bucket run.

**What can be deleted.** Only a bare raw-upload key (`{user}/albums/{album}/{uuid}.jpg|png|heic|webp`)
that passes every fresh gate at deletion time: unowned on a new database lookup, unchanged since the
scan (size + ETag + LastModified), at least 24 h old, and inside the requested scope.

**What can never be deleted by it.** Sanitized masters (`_full.jpg`), thumbnails (`_thumb.jpg`),
`preview.pdf`, `cover-templates/`, `album-products/`, `stickers/` — these are a different object
class and the parser rejects them before any gate runs. Orphaned *derivatives* are a known separate
issue and are **not** in scope for this tool.

**Safety properties worth knowing before you run it:**

- `--execute` **cannot** run with `--min-age-hours` below 24. It aborts before touching anything.
  (Dry run may use lower values for diagnostics.)
- An incomplete R2 listing or a failed database lookup **aborts the run** — a partial scan is never
  treated as authority to delete.
- Deletion is exact-key. There is no prefix, wildcard, or batch delete in the tool.
- Each delete is verified afterwards by re-reading the key; an object that survives is reported as
  `DELETE_VERIFICATION_FAILED`, not as success.
- Exit code is non-zero on abort, partial revalidation, or any delete failure.

Read the `OUTCOME:` line at the bottom of the report — it states in one sentence whether nothing was
eligible, candidates were found but protected, objects were deleted, or the run aborted.

**There is no scheduler.** This is invoked by hand today. To automate it, add a **Render Cron Job**
pointing at the same image and Docker build, with the same environment group, running:

```
node dist/diagnostics/orphan-cleanup/cli.js --bucket --execute
```

Daily is ample. Do not add an in-process loop to the worker for this — deletion should be a bounded,
separately-scheduled task whose failures are visible on their own, not a background side effect of
the job processor.

---

## 7c. Deleting a customer account ⚠️

**Deleting a profile that still owns albums or photos now FAILS.** That is deliberate
(migration `0054`). It used to succeed silently — and because `photos` and `albums` cascaded from
`profiles`, the delete destroyed the only rows that named the customer's R2 objects while leaving
the objects themselves behind. That is where the ~1,300 unreferenced derivative objects currently
in the bucket came from.

If you try it now you get a foreign-key violation instead:

```
update or delete on table "profiles" violates foreign key constraint
  "photos_user_id_fkey" on table "photos"
```

**This is the correct procedure:**

1. See what the account still owns (read-only, deletes nothing):

   ```bash
   node dist/diagnostics/account-assets/cli.js --user <userUuid>
   ```

   It reports albums, photos by lifecycle state, and every distinct R2 key still owned —
   raw uploads, masters, thumbnails and preview PDFs.

2. Remove the customer's albums **through the application**. `deleteAlbum` enqueues exact-key
   `r2-cleanup` for every object first and aborts if that handoff fails, so nothing is stranded.
   Never `delete from albums` or `delete from photos` in SQL — that reintroduces exactly the
   problem `0054` prevents.

3. Re-run the preflight. If it still shows photos while `albums` is already `0`, those rows have
   `album_id IS NULL` and `deleteAlbum` cannot reach them — it filters by album. That happens when
   an album was removed by something other than the app (a blueprint-draft cleanup, or direct
   SQL), because `photos.album_id` is `ON DELETE SET NULL` and the photo rows survive. Remove each
   one through `DELETE /api/photos/:id`, which deletes its raw, master and thumbnail objects
   before the row. Do not delete these rows in SQL — that strands exactly the objects this
   procedure exists to reclaim.

4. Re-run the preflight. When it reports `delete blocked: no`, the profile owns nothing.

5. Delete the auth user / profile as normal.

**Do not "fix" a blocked delete by dropping the constraint.** If a customer genuinely must be
removed immediately, remove their albums first — that is the same amount of work and it reclaims
the storage instead of abandoning it.

---

## 7d. Preview-PDF orphan reclamation (manual, not scheduled)

`{userId}/albums/{albumId}/preview.pdf` is a **different object class** from a raw upload, with a
different owner, so it has its own tool. The raw-upload scanner deliberately refuses PDFs
(`other-object-class`) and always will — do not "fix" that by widening it.

```bash
cd worker/apps/worker
pnpm preview-pdf-cleanup                    # DRY RUN — the default; deletes nothing
pnpm preview-pdf-cleanup -- --execute       # deletes VERIFIED orphans only
pnpm preview-pdf-cleanup -- --min-age-hours 0   # dry-run inspection of recent objects
```

A preview PDF is reclaimable **only** when every one of these holds:

1. the key is a structurally valid `{userId}/albums/{albumId}/preview.pdf`;
2. **no `album_pdfs` row references that exact key**;
3. **the owning album does not exist** — while the album lives, `r2_key` may simply be null
   mid-render and recovery can still adopt the object, so it is never ours to take;
4. it is older than the 24h grace period (`--execute` refuses anything lower — the floor is
   enforced in the engine, not just the CLI, so it cannot be bypassed by calling the API directly);
5. it is not in an admin namespace (`cover-templates/`, `album-products/`, `stickers/`).

Every gate is re-asked from scratch immediately before each delete, and each delete is verified by
re-reading the key afterwards. Deletion is authorised by a branded `VerifiedPreviewOrphan` that only
the verification path can mint — there is no "delete this key" function to call.

**When you should NOT need this.** Normal album deletion already reclaims the PDF: `deleteAlbum`
reconstructs the deterministic key even when `r2_key` is still null, so a worker that dies between
the R2 upload and finalize no longer strands anything. This tool exists for objects predating that
fix, and for the case where a cleanup enqueue itself failed.

### Admin namespaces have no reclamation tool — by design

`stickers/`, `cover-templates/` and `album-products/` are admin-managed and are refused by **both**
scanners. Their upload flow is two-step (presign → separate row insert), so an abandoned admin
upload leaves an object with no row. Those are found by the read-only reconciliation, reported, and
removed **by hand after a human decision** — never automatically.

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
