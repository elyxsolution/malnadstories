# Worker V2 — Production Configuration

Every environment variable, its recommended production value, and **why**.

Configuration is validated at boot in two passes (per-field, then cross-field). An invalid value
**stops the worker** with a message naming the variable — there is no half-configured state.

---

## Required — the worker will not start without these

| Variable                                    | Value                                        | Why                                                                                                                                                      |
| ------------------------------------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `WV2_INFRA`                                 | `on`                                         | Enables the real processors. **Without this the worker starts, idles, and processes nothing.** The single most important variable.                       |
| `DIRECT_URL`                                | Supabase **session** pooler (port **5432**)  | pg-boss cannot run on the 6543 transaction pooler. Same value the app uses.                                                                              |
| `R2_ENDPOINT`                               | `https://<account>.r2.cloudflarestorage.com` | Validated as an absolute http(s) URL at boot.                                                                                                            |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | from Cloudflare                              | Secret.                                                                                                                                                  |
| `R2_BUCKET_NAME`                            | your private bucket                          | Must be the same bucket the app writes uploads to.                                                                                                       |
| `APP_URL`                                   | `https://<your-app-domain>`                  | The origin Chromium loads the print route from. **A wrong value here fails every PDF** and nothing else — validated for shape at boot, not reachability. Chromium runs *inside the worker*, so `localhost` means the WORKER's machine: use `host.docker.internal` from a container, or the deployed origin. Unset → defaults to `http://localhost:3000`, and the banner marks it `DEFAULT`. `PDF_RENDER_BASE_URL` is an accepted alias. |
| `PORT`                                      | injected by Render                           | Health server port.                                                                                                                                      |

---

## Concurrency — the throughput/memory trade-off

| Variable                  | Recommended | Why                                                                                                                                                                                             |
| ------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `WV2_MAX_IN_FLIGHT`       | `4`         | Global ceiling. Chosen against a 512MB–1GB instance: 3 images + 1 PDF fits comfortably with headroom for a spike. Raise only with memory evidence.                                              |
| `WV2_IMAGE_CONCURRENCY`   | `3`         | Image work is mostly network I/O (R2 download/upload) with a short CPU burst for encoding, so it parallelises well.                                                                             |
| `WV2_PDF_CONCURRENCY`     | `1`         | A render owns a Chromium page — the memory-dominant operation. This lane is marked _heavy_: while it runs, other lanes automatically halve. **Do not raise without at least 2GB per instance.** |
| `WV2_CLEANUP_CONCURRENCY` | `2`         | Deletes are cheap and idempotent.                                                                                                                                                               |
| `WV2_POLL_INTERVAL_MS`    | `1000`      | How long an idle worker waits before re-polling. The loop wakes early whenever a job finishes, so this only affects a fully idle worker. Lower = faster pickup, more DB chatter.                |

---

## Memory + backpressure

| Variable                   | Recommended                           | Why                                                                                                                                                                                                          |
| -------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `WV2_MEMORY_SOFT_LIMIT_MB` | ~60% of instance RAM (`768` on 1.2GB) | Above this, concurrency halves and health reports `degraded`. An early, reversible brake.                                                                                                                    |
| `WV2_MEMORY_HARD_LIMIT_MB` | ~85% of instance RAM (`1536` on 2GB)  | Above this the worker **stops taking new work** and lets in-flight jobs finish — that is what releases memory. It is never killed for this; it recovers on its own. Must be above the soft limit (enforced). |

Set both relative to the actual instance size. Defaults assume ~2GB.

---

## Recovery (self-healing)

| Variable                        | Recommended      | Why                                                                                                                                                                                       |
| ------------------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `WV2_RECOVERY`                  | `on`             | Re-drives stuck photos and PDFs. **Leave on** — it is what makes stuck work self-correcting.                                                                                              |
| `WV2_RECOVERY_INTERVAL_MS`      | `60000`          | Sweep cadence. Recovery defers itself while the worker is busy, so this is a ceiling not a guarantee.                                                                                     |
| `WV2_RECOVERY_BATCH`            | `100`            | Items healed per processor per sweep. Bounded on purpose: recovery must never turn into a full table scan.                                                                                |
| `WV2_RECOVERY_PDF_STALE_MS`     | `420000` (7 min) | A `generating` PDF older than this is re-driven. **Must exceed a render's worst case (~185s)** or the sweep will re-drive renders that are still legitimately running — enforced at boot. |
| `WV2_RECOVERY_PDF_MAX_ATTEMPTS` | `5`              | Then the PDF is marked failed and an admin regenerates. Prevents an infinite retry loop.                                                                                                  |
| `WV2_RECOVERY_QUIET_FRACTION`   | `0.5`            | Recovery only runs when ≤50% of the concurrency budget is busy. Background reconciliation must never compete with paying customers' work.                                                 |

---

## Observability

| Variable                  | Recommended                    | Why                                                                                                                                                          |
| ------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `WV2_LOG_LEVEL`           | `info`                         | `debug` is verbose enough to cost money in log storage at volume. Use `debug` temporarily when investigating.                                                |
| `WV2_LOG_FORMAT`          | `json`                         | Machine-parseable for log search. Use `console` only locally.                                                                                                |
| `WV2_METRICS`             | `on`                           | Counters/gauges/timings. Cheap.                                                                                                                              |
| `WV2_TRACING`             | `on`                           | Per-job span trees.                                                                                                                                          |
| `WV2_TRACE_SAMPLE`        | `1` initially, `0.1` at volume | Sampling is per-trace, so a sampled trace is always complete. Start at 1 to build confidence; reduce when log volume becomes the constraint.                 |
| `WV2_MONITOR_INTERVAL_MS` | `30000`                        | Resource sampling cadence.                                                                                                                                   |
| `WV2_DIAGNOSTICS_TOKEN`   | a long random string           | **Set this.** Unset, `/diagnostics` is disabled and `/ready` is redacted (safe, but you lose the investigation tool). The health port is publicly reachable. |

---

## Shutdown

| Variable               | Recommended | Why                                                                                                                                                                                                                                                   |
| ---------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `WV2_DRAIN_TIMEOUT_MS` | `30000`     | How long shutdown waits for in-flight jobs. **Must be below your platform's SIGKILL grace period** (Render allows ~30s; use `25000` to be safe). Abandoned jobs are redelivered — overrunning the grace period and being SIGKILLed is strictly worse. |

---

## Storage (runtime's own journal)

| Variable           | Recommended                           | Why                                                                                                                                                                                                                                         |
| ------------------ | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `WV2_STORAGE`      | `memory` for the processor deployment | **Not needed for image/PDF/cleanup work** — that durability lives in pg-boss and R2. The Docker image defaults to `filesystem` + `/data`; with `WV2_INFRA=on` this path is effectively unused. Using `memory` avoids needing a Render disk. |
| `WV2_STORAGE_ROOT` | `/data` if using `filesystem`         | Must be **writable** — the `runtime-storage` probe is liveness-critical and round-trips through it. A read-only `/data` will restart-loop the worker.                                                                                       |

---

## A known-good production `.env`

```bash
WV2_INFRA=on
DIRECT_URL=postgresql://...@...pooler.supabase.com:5432/postgres
R2_ENDPOINT=https://<account>.r2.cloudflarestorage.com
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET_NAME=malnad-stories
APP_URL=https://malnadstories.com

WV2_STORAGE=memory
WV2_MAX_IN_FLIGHT=4
WV2_IMAGE_CONCURRENCY=3
WV2_PDF_CONCURRENCY=1
WV2_CLEANUP_CONCURRENCY=2
WV2_MEMORY_SOFT_LIMIT_MB=1200
WV2_MEMORY_HARD_LIMIT_MB=1700
WV2_DRAIN_TIMEOUT_MS=25000

WV2_RECOVERY=on
WV2_LOG_LEVEL=info
WV2_LOG_FORMAT=json
WV2_TRACE_SAMPLE=1
WV2_DIAGNOSTICS_TOKEN=<64 random hex chars>
```

(Memory limits above assume a 2GB instance.)
