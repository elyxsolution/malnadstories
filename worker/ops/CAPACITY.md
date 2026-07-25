# Worker V2 — Capacity Planning

**Read the assumptions first.** The numbers below are derived, not measured on production hardware,
and the per-job cost figures are the weakest link in the chain.

---

## Assumptions (and how confident each one is)

| Assumption                                                                       | Value       | Confidence                                        |
| -------------------------------------------------------------------------------- | ----------- | ------------------------------------------------- |
| Image hardening wall time (12MP JPEG: download + decode + 2 encodes + 2 uploads) | 2–5 s       | **Low** — not measured on the target instance     |
| PDF render wall time (24–48 page album via Chromium)                             | 20–60 s     | **Low** — depends on photo count and network      |
| Cleanup job                                                                      | < 1 s       | Medium                                            |
| Image job peak RSS                                                               | ~150–250 MB | **Low** — sharp holds a full raster               |
| PDF job peak RSS (Chromium page)                                                 | ~300–500 MB | **Low**                                           |
| Baseline worker RSS (idle)                                                       | ~60–80 MB   | Medium — observed locally                         |
| Scheduler overhead                                                               | negligible  | **High** — measured: 20k–33k jobs/s with 0ms jobs |

**What _is_ measured:** the scheduler itself is not the bottleneck. Under load tests, one worker
dispatched 10,000 jobs with no loss or duplication, and 4 workers completed a fixed workload 3.7×
faster than one (638ms → 170ms). Throughput is therefore governed almost entirely by per-job cost —
which is exactly the figure not yet measured on production hardware.

**Treat the tables below as a starting point to validate in staging, not as a guarantee.**

---

## Per-worker capacity (2GB instance, recommended config)

With `WV2_MAX_IN_FLIGHT=4`, image lane 3, PDF lane 1 (heavy):

| Metric                | Estimate                                                       |
| --------------------- | -------------------------------------------------------------- |
| Concurrent image jobs | 3 (drops to 1 while a PDF renders)                             |
| Concurrent PDFs       | 1                                                              |
| Image throughput      | ~40–90 photos/min                                              |
| PDF throughput        | ~1–3 albums/min                                                |
| Steady-state RSS      | 400–900 MB                                                     |
| Peak RSS              | ~1.2 GB (3 images + 1 PDF)                                     |
| CPU                   | 1 vCPU adequate; 2 preferred (sharp encode + Chromium contend) |

The heavy-lane rule matters here: while a PDF renders, image concurrency automatically halves, so
peak memory is bounded rather than additive across all four slots.

---

## Scaling table

| Workers | Concurrent images | Concurrent PDFs | Images/min | Albums/min | Suits                                                                            |
| ------- | ----------------- | --------------- | ---------- | ---------- | -------------------------------------------------------------------------------- |
| **1**   | 3                 | 1               | 40–90      | 1–3        | Launch / low volume. Single point of failure — a restart pauses all processing.  |
| **2**   | 6                 | 2               | 80–180     | 2–6        | **Recommended minimum for paying customers.** Survives one instance restarting.  |
| **4**   | 12                | 4               | 160–360    | 4–12       | Sustained load or marketing spikes.                                              |
| **8**   | 24                | 8               | 320–720    | 8–24       | High volume. **Check Supabase connection limits before going here** (see below). |

Scaling is near-linear because workers share nothing: each competes for jobs through the queue's
atomic fetch, validated up to 8 workers with zero duplicate processing and zero job loss.

---

## Queue latency

Latency is queue depth ÷ throughput, plus up to `WV2_POLL_INTERVAL_MS` (1s) pickup delay on an idle
worker.

| Scenario              | 1 worker   | 2 workers | 4 workers |
| --------------------- | ---------- | --------- | --------- |
| 20-photo album upload | ~15–30 s   | ~8–15 s   | ~4–8 s    |
| 100-photo burst       | ~1–2.5 min | ~35–75 s  | ~20–40 s  |
| PDF after payment     | ~20–60 s   | ~20–60 s  | ~20–60 s  |

PDF latency does not improve with more workers for a _single_ album — one render is one job. More
workers increase how many albums render **concurrently**.

---

## The real ceilings (hit these before CPU)

1. **Supabase direct connections.** Each worker holds up to `WV2_DB_MAX_CONNECTIONS` (default 5)
   plus pg-boss's own. At 8 workers that is ~50+ session connections, _plus_ whatever the Next.js
   app holds. Supabase plans cap this. **Check before scaling past 4.**
2. **Chromium memory.** The hard ceiling on PDF concurrency. Raising `WV2_PDF_CONCURRENCY` above 1
   without ≥2GB per instance will cause OOM kills.
3. **R2 request rate.** Each image job does ~1 read + 2 writes + 1 delete. Generous, but bill-visible.

---

## Sizing recommendation

**Launch with 2 workers on 2GB instances.** One worker is a single point of failure during restarts;
two costs little and removes that. Scale to 4 when sustained queue depth exceeds ~200 jobs or p95
upload-to-ready exceeds a minute.

**Before scaling past 4, measure — do not extrapolate these tables.** Take the per-job timings from
`worker.jobs.duration_ms` (per processor) and the RSS from `worker.process.memory_rss_bytes`, both
already emitted, and recompute.
