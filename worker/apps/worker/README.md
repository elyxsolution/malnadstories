# @workerv2/app — the deployable Worker

The minimal executable process that hosts the Worker V2 **production runtime** (`@workerv2/worker-runtime`).
It is a pure **composition/bootstrap layer** — it duplicates no runtime logic and modifies no completed
architecture (Phases 0–19). It loads config, constructs the runtime, recovers unfinished work, consumes
jobs from a replaceable queue adapter, and shuts down gracefully.

```
startup → recovery → idle → processing → draining → shutdown
```

## Local execution

Run from the **`worker/`** directory:

```bash
pnpm install        # install the workspace
pnpm build          # bundle the app → apps/worker/dist/main.js (only the app emits artifacts)
pnpm start          # node apps/worker/dist/main.js
# or, without building:
pnpm dev            # tsx watch apps/worker/src/main.ts
```

`pnpm build` / `pnpm start` / `pnpm dev` at the workspace root delegate to this app via
`pnpm --filter @workerv2/app`. On startup you'll see structured JSON logs
(`worker.startup` → `runtime.started` → `worker.recovery` → `worker.ready`); the worker then idles,
waiting for jobs. `Ctrl-C` (SIGINT) / SIGTERM triggers graceful shutdown.

## Docker execution

```bash
# from the worker/ directory (build context = worker/)
docker build -f apps/worker/Dockerfile -t workerv2 .
docker run --rm -e WV2_STORAGE=filesystem -e WV2_STORAGE_ROOT=/data -v "$PWD/.data:/data" workerv2
```

Multi-stage: stage 1 installs the workspace and bundles the app into one self-contained `dist/main.js`
(all `@workerv2/*` libraries inlined; only Node built-ins external); stage 2 copies **only** that
bundle onto `node:20-alpine` — no `node_modules` at runtime, so the image is tiny. Runs as non-root.

## Render deployment

Create a **Background Worker** (or Web Service if you want the health port):

| Setting        | Value                        |
| -------------- | ---------------------------- |
| Root Directory | `worker`                     |
| Build Command  | `pnpm install && pnpm build` |
| Start Command  | `pnpm start`                 |

Or point Render at the Dockerfile: **Dockerfile Path** `apps/worker/Dockerfile`, **Root Directory**
`worker`. Set env vars (below). For a Web Service, `PORT` is provided by Render and the app exposes
`GET /health`.

## Environment variables

| Variable               | Default     | Meaning                                                                                                                 |
| ---------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------- |
| `WV2_STORAGE`          | `memory`    | `memory` or `filesystem`. **Use `filesystem` in production** — it is required for durable artifacts + restart recovery. |
| `WV2_STORAGE_ROOT`     | —           | Required when `WV2_STORAGE=filesystem`; the durable storage directory.                                                  |
| `WV2_BACKEND`          | `reference` | Image backend id (the deterministic reference backend).                                                                 |
| `WV2_LOGGING`          | on          | `off` disables structured logging.                                                                                      |
| `WV2_METRICS`          | on          | `off` disables metrics.                                                                                                 |
| `WV2_POLL_INTERVAL_MS` | `1000`      | Queue poll interval while idle.                                                                                         |
| `PORT`                 | —           | If set, exposes the HTTP health endpoint on this port (Render Web Services).                                            |

Configuration is validated at startup; a bad value **fails fast** with a clear error.

## Startup / shutdown / recovery flow

- **Startup** — load + validate config → `runtime.start()` → recover interrupted runs → start the
  health server (if `PORT`) → ready. Logs `worker.startup` (worker/runtime/node versions, storage
  backend, config summary), `worker.recovery` (recovered count), `worker.ready`.
- **Recovery** — for every run in durable storage, the runtime re-reads the blueprint, re-prepares the
  identical coordinator, and re-folds the durable journal via the Coordinator's own resume. Artifacts
  are reused (content-addressed), not regenerated. **Requires filesystem (or a durable) backend.**
- **Consume** — poll the queue; each job's Blueprint is handed to `runtime.run(...)`, which composes →
  assembles the Document → exports the PDF Artifact into durable storage; the job is acked. Logs
  `worker.job.start` / `worker.job.done` plus the runtime's own `run.settled` records.
- **Shutdown** (SIGINT/SIGTERM) — stop accepting work, drain the in-flight job, `runtime.shutdown()`
  (persists final state), close health. Logs `worker.draining` (outstanding) and `worker.shutdown`
  (outstanding jobs, drain duration, complete).

## Queue integration

Queue integration was intentionally deferred in the architecture (the runtime is queue-unaware). This
app owns the isolated seam: a `QueueAdapter` interface + a default in-memory polling adapter. A real
broker (SQS / pg-boss / Redis) drops in behind the same interface **without touching the runtime**.

## What this app must NOT do (and does not)

Modify the runtime, Coordinator, Worker Host, Processor SDK, recovery, durable storage, document
generation, or dependency injection. It only composes the existing libraries into a runnable process.

> Health/logging/metrics are **observational only** — they never influence execution.
