# worker/ — Worker V2

The background processing service for Malnad Stories. Isolated **pnpm workspace** (its own root,
separate from the Next.js app at the repo root).

Worker V1 was removed; rollback anchor is the git tag `worker-v1-final`.

---

## Quick start

```bash
cd worker
pnpm install
cp .env.example .env      # then set WV2_INFRA=on
pnpm dev                  # tsx watch apps/worker/src/main.ts
```

Secrets (`DIRECT_URL`, `R2_*`) are read from the **repo-root `.env.local`** that the Next.js app
already uses — you do not need to copy them. `worker/.env` is for worker-only settings.

### The one variable that matters

**`WV2_INFRA=on`.** Without it the worker starts, reports itself healthy, and processes **nothing** —
it runs the in-memory _reference_ worker instead. The startup banner states which mode you are in and
why:

```
┌─ Worker V2 ──────────────────────────────────────────────────
│ Mode            REFERENCE — no production jobs will be processed
│ Infrastructure  DISABLED
│   Reason        WV2_INFRA is not set
│   Expected      WV2_INFRA=on
│   Template      worker/.env.example
```

versus

```
│ Mode            PRODUCTION — processing real jobs
│ Processors      3 registered — album-pdf, image-hardening, r2-cleanup
```

Environment loading order (nearest wins; **`process.env` always wins**, so Render/Docker injection is
never overridden):

```
process.env  >  ./.env.local  >  ./.env  >  ../.env.local  >  … upward to the repo root
```

---

## What it does

Consumes three pg-boss queues and writes results to Supabase Postgres and Cloudflare R2:

| Job type          | Work                                                                              |
| ----------------- | --------------------------------------------------------------------------------- |
| `image-hardening` | validate magic bytes → EXIF → re-encode (sharp) → thumbnail → upload → delete raw |
| `album-pdf`       | drive the app's print route with Chromium → PDF → upload to R2                    |
| `r2-cleanup`      | idempotently delete a batch of R2 keys                                            |

⚠️ The app also enqueues `cover-thumbnail` and `blueprint-thumbnail`, which V2 does **not** implement.
Those jobs accumulate unprocessed (nothing is lost). The worker reports this itself as a
`queue-coverage` warning at startup and a degraded health component. See `ops/RUNBOOK.md` §7.

---

## Layout

```
worker/
  .env.example         Env template (grouped + commented)
  ops/                 RUNBOOK.md · CONFIGURATION.md · CAPACITY.md — written for operators
  packages/            Foundation libraries (@workerv2/*), one capability each
  apps/worker/         THE DEPLOYABLE SERVICE — Docker/Render build target
    src/main.ts        Entrypoint: env → config → reference or production worker
    src/env.ts         .env discovery
    src/config.ts      Configuration + two-pass validation
    src/concurrency.ts Adaptive per-job-type lanes + backpressure
    src/infra/         pg-boss · R2 · Postgres adapters
    src/processors/    Registry → pipeline → stages
    src/recovery/      Self-healing coordinator + scheduler
    src/observability/ Logging · tracing · metrics · health · diagnostics
    src/testing/       Load + chaos harness (never imported by production code)
```

**Dependency direction** is enforced by `scripts/check-boundaries.mjs` (`pnpm run boundaries`), which
is authoritative for the package graph: acyclic, with `contracts` as the leaf.

---

## Health endpoints

| Endpoint           | Answers                             | Public                      |
| ------------------ | ----------------------------------- | --------------------------- |
| `GET /health`      | Ready for work? (`{"status":"ok"}`) | yes — the app gates on this |
| `GET /live`        | Should a supervisor restart it?     | yes                         |
| `GET /ready`       | Should it be given work?            | yes (details need a token)  |
| `GET /diagnostics` | What exactly is this process?       | **token only**; 404 without |

Set `WV2_DIAGNOSTICS_TOKEN` to enable `/diagnostics`; unset it is disabled by design.

---

## Commands

```bash
pnpm run typecheck    # strict TS, whole workspace
pnpm run boundaries   # dependency-direction + cycle check
pnpm run lint
pnpm run format
pnpm run test         # Vitest
pnpm run verify       # all of the above
pnpm run build        # bundles apps/worker → dist/main.js
pnpm start            # node apps/worker/dist/main.js
```

---

## Deployment

Render, from `apps/worker/Dockerfile`, with **Root Directory = `worker`**.

Operational procedures — deploy, scale, read logs, stuck jobs, dead-letters, secrets, Chromium
upgrade, rollback, emergency shutdown — are in **`ops/RUNBOOK.md`**.
Recommended configuration values and their reasoning: **`ops/CONFIGURATION.md`**.
Sizing: **`ops/CAPACITY.md`**.
