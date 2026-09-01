# Worker Production Audit — Capacity, Architecture & Hosting Readiness

**Subject:** `worker/` — Worker V2 (`@workerv2/app`), the background service that hardens uploaded
photos and renders album PDFs.
**Audit date:** 2026-08-31 · **Commit:** `0f55a94` (backend change v16) · **Branch:** `main`
**Scope:** AUDIT ONLY. No production code was modified, no database was touched, no job was
triggered, no file was uploaded or deleted. The only writes were read-only analysis scripts in a
scratchpad directory.

---

## READ THIS FIRST — the seven things that decide the hosting question

| # | Finding | Class | Where |
|---|---|---|---|
| 1 | **The worker must be reachable over HTTP by the Next.js app.** In production `WORKER_URL` is fail-closed: unset ⇒ `workerConfigOk()` is false ⇒ **photo upload presign is rejected**. A platform shape with no inbound networking (a classic "background worker" with no address) **cannot host this service unchanged.** | VERIFIED | `src/lib/worker/health.ts:59-62`, `src/app/api/photos/presign/route.ts` |
| 2 | **Backpressure is blind to Chromium.** The memory sensor reads `process.memoryUsage().rss` — the **Node process only**. Chromium is a separate process tree launched by Puppeteer, so the single largest memory consumer in the container is invisible to the throttle and to `/health`. The worker will report `healthy` right up to a container OOM kill. | VERIFIED | `worker/apps/worker/src/concurrency.ts:235-246`, `.../resources/browser-resource.ts:30` |
| 3 | **A 300 MB PDF is held in Node memory 3–4 times over.** CDP base64 chunks → merged array → an extra `new Uint8Array(pdf)` copy → a `Buffer.from()` copy → a full-file `.toString('latin1')` **JavaScript string** for geometry verification. Estimated Node-side peak **900 MB – 1.2 GB for one 300 MB PDF**, before Chromium's own footprint. | VERIFIED (code) / CALCULATED (peak) | `puppeteer-renderer.ts:49-56`, `pdf-geometry.ts:96-108`, puppeteer `common/util.js` |
| 4 | **~13–24% of every interior PDF is a screen-only decorative texture.** The root layout renders `<Grain/>` (`opacity:.035; mix-blend-mode:multiply` fractal noise) globally; the print routes inherit it and there is **no `@media print` suppression anywhere**. Chromium flattens the resulting transparency group to a raster **per page**: measured **17.5 MiB of 72.1 MiB** and **12.7 MiB of 97.6 MiB** in two real generated files. | **VERIFIED — measured in real output** | `src/app/layout.tsx:24`, `src/app/globals.css:217-224`; artefacts `outputpdf/*.pdf` |
| 5 | **Photos are embedded at ~425 effective DPI against a 300 DPI target.** Skia **passes the source JPEG through byte-for-byte** (proven: progressive SOF2 + no JFIF/EXIF = the mozjpeg signature the worker writes; identical SHA-1 across two independent renders). Resampling to exactly 300 DPI is a **40–42% payload reduction with zero visible change at print size.** | **VERIFIED — measured** | see §16 |
| 6 | **Node has no `--max-old-space-size` and there is no `unhandledRejection`/`uncaughtException` handler.** An unhandled rejection crashes the process with no drain and no observability record; the V8 heap limit is whatever Node infers at boot, which may exceed the container limit. | VERIFIED | `worker/apps/worker/Dockerfile` (no `NODE_OPTIONS`); no `process.on('unhandledRejection')` anywhere in `apps/worker/src` |
| 7 | **The job path writes nothing to disk.** No temp files, no streaming to disk, no `os.tmpdir()` use. Everything is buffered in RAM. Disk is needed only for Chromium's own scratch (`--disable-dev-shm-usage` pushes shared memory to `/tmp`) and the unused runtime journal at `/data`. | VERIFIED | grep for `node:fs`/`tmpdir`/`createWriteStream` across `apps/worker/src` returns only CLIs, `env.ts`, and the runtime journal backend |

**Bottom line:** the worker is architecturally excellent — clean ports, real backpressure, real
recovery, a geometry safety net, careful redaction. It is **not yet sized or shaped for a 300 MB
PDF**. Fix items 1, 2, 3 and 6 before production; fix 4 and 5 to make the PDF workload roughly a
third of its current size at no quality cost.

---

## 0. Method, evidence, and how to read the claims

Every conclusion below is tagged:

- **VERIFIED** — read directly out of source, configuration, a dependency's shipped code, or
  measured out of a real generated artefact in this repository.
- **CALCULATED** — arithmetic on verified values.
- **ESTIMATED** — a reasoned figure that needs a runtime benchmark before it is trusted.
- **UNKNOWN FROM CODEBASE** — cannot be established without running the thing.

**Primary evidence.** In addition to the source, this repository contains four real generated
interior PDFs (`outputpdf/`, committed in `0f55a94`, 72–98 MiB, 24 pages each). They were analysed
with read-only scripts: object index, image XObject inventory, JPEG marker walk, SHA-1 dedupe, and
effective-DPI arithmetic. That is the difference between "PDFs are big because images are big" and
the specific, quantified breakdown in §16.

**What was NOT done:** no worker was started, no Chromium was launched, no job was enqueued, no
measurement was taken on the target instance. Every RAM/CPU/duration figure for the *running*
system is therefore ESTIMATED or UNKNOWN, and §27 specifies exactly how to replace them.

---

## 1. What the worker actually is

`worker/` is a **self-contained pnpm workspace** (its own lockfile, isolated from the Next.js app at
the repo root — `worker/pnpm-workspace.yaml`). It contains:

- `packages/*` — ~30 pure, product-agnostic libraries (`@workerv2/contracts`, `logger`, `metrics`,
  `health`, `runtime`, …). **They contain no image, PDF, R2 or Postgres code.**
- `apps/worker` — the single deployable service. `src/main.ts` (858 lines) is the composition root.

### The master switch

```
WV2_INFRA unset/false  →  REFERENCE MODE: healthy, idle, processes nothing, opens no connections
WV2_INFRA=on           →  PRODUCTION MODE: adapters built, 3 processors registered, real jobs consumed
```

VERIFIED — `src/infra/config.ts:182-195`, `src/main.ts:557-563`. The startup banner states the mode
and, when idle, the reason. Every production SDK (`pg-boss`, `postgres`, `@aws-sdk/client-s3`,
`sharp`, `puppeteer`, `heic-convert`) loads through a **dynamic import gated on this switch**
(`main.ts:590-620`), so reference mode never pulls the native binaries.

### The three job types it serves

| Queue | Processor | Producer | Retry policy (set by producer) | Lane default |
|---|---|---|---|---|
| `image-hardening` | `ImageProcessor` | `enqueueImageHardening` (`src/lib/queue.ts:53`) | `retryLimit 3`, `retryDelay 30s`, backoff, `singletonKey = photoId` | max 3 |
| `album-pdf` | `PdfProcessor` | `enqueueAlbumPdf` (`src/lib/queue.ts:72`) | **`retryLimit 0`**, no singletonKey (deliberate — see §12) | max 1, **`heavy`** |
| `r2-cleanup` | `CleanupProcessor` | `enqueueR2Cleanup` (`src/lib/queue.ts:88`) | `retryLimit 5`, `retryDelay 30s`, backoff | max 2 |

### Two queues that are produced but never consumed — **live defect**

`WORKER_QUEUES` declares five queues (`src/infra/config.ts:63-69`) but the registry registers only
three processors (`main.ts:601-628`). The app actively enqueues onto the other two:

- `cover-thumbnail` — `enqueueCoverThumbnail`, called from the admin create-cover action
- `blueprint-thumbnail` — `enqueueBlueprintThumbnail`, called from the blueprint actions

**VERIFIED.** Those jobs are created, declared, never polled (the poll filter is
`knownTypes ∩ queues`, `pgboss-queue.ts:124-126`), never processed, and accumulate in `pgboss.job`
until pg-boss's archive/retention sweeps them. The startup report warns loudly
(`main.ts:756-763`: *"no processor for: … — those jobs accumulate unprocessed"*), which is exactly
right — but the warning has evidently been living in the banner rather than in a backlog. Cover
thumbnails and blueprint thumbnails are silently never generated.

---

## 2. Architecture diagram

```
┌──────────────────────────── NEXT.JS APP (Vercel or equivalent) ─────────────────────────────┐
│                                                                                              │
│  browser ──presigned PUT──────────────────────────────────────────────┐                      │
│  /api/photos/presign  ── gated on workerConfigOk() [FAIL-CLOSED] ─┐   │                      │
│  /api/photos/confirm  ── inserts photos row ──────────────────────┤   │                      │
│  startAlbumPdfGeneration()  mint token → album_pdfs 'generating' ─┤   │                      │
│  deleteAlbum()  gathers R2 keys ──────────────────────────────────┤   │                      │
│                                                                    │   │                      │
│  /albums/[id]/print            ← token-gated PREVIEW route         │   │                      │
│  /albums/[id]/print/cover      ← token-gated COVER route      ▲    │   │                      │
│  /albums/[id]/print/content    ← token-gated INTERIOR route   │    │   │                      │
└───────────────────────────────────────────────────────────────┼────┼───┼──────────────────────┘
              │ probe GET WORKER_URL/health (fail-closed in prod)│    │   │
              ▼                                       HTTP (APP_URL)  │   │
   ┌──────────────────────────────────────────────────────────┐  │    │   │
   │              pg-boss  (SAME Supabase Postgres)           │◄─┘    │   │
   │   queues: image-hardening · album-pdf · r2-cleanup       │       │   │
   │           cover-thumbnail ✗  blueprint-thumbnail ✗       │       │   │
   │   expire_in 15 min (default) · retry per producer        │       │   │
   └───────────────────────────┬──────────────────────────────┘       │   │
                               │ boss.fetch(batchSize 1) round-robin  │   │
┌──────────────────────────────▼──────────────────────────────────────┼───┼──────────────────┐
│  WORKER CONTAINER   node:20-slim + distro chromium + tini(PID 1)    │   │                  │
│                                                                      │   │                  │
│  WorkerApplication  (dispatch loop, lanes, drain)                    │   │                  │
│    ├─ ConcurrencyController  ── memory sensor = **Node RSS ONLY** ✗  │   │                  │
│    ├─ RecoveryCoordinator + PeriodicScheduler (60 s ± 15 s jitter)   │   │                  │
│    ├─ RuntimeMonitor (30 s gauges) — no disk, no Chromium mem ✗      │   │                  │
│    ├─ health HTTP server on $PORT  (/health /live /ready /diagnostics)   │                  │
│    │                                                                 │   │                  │
│    ├─ ImageProcessor ─── sharp / file-type / exifr / heic-convert    │   │                  │
│    │      LARGE OBJECTS IN RAM: rawBytes, decodable, RASTER,         │   │                  │
│    │      masterBytes, thumbBytes  — all live simultaneously         │   │                  │
│    │                                                                 │   │                  │
│    ├─ PdfProcessor ──── ResourceManager ─► ONE shared Chromium ──────┘   │                  │
│    │      Browser (lazy, rebuilt on crash) · FRESH PAGE PER JOB          │                  │
│    │      LARGE OBJECT IN RAM: ctx.pdfBytes (100–300 MB) ×3–4 copies     │                  │
│    │                                                                     │                  │
│    └─ CleanupProcessor ── sequential DeleteObject per key                │                  │
│                                                                          │                  │
│  Postgres: pg-boss pg.Pool (default max 10) + postgres.js (max 5) = up to 15 sessions/instance │
│  DISK: nothing from the job path. Chromium scratch in /tmp. /data journal unused.             │
└──────────────────────────────────┬────────────────────────────────────────┼──────────────────┘
                                   │ @aws-sdk/client-s3 — FULLY BUFFERED    │
                                   ▼  (no streaming, no multipart)          │
                     ┌───────────────────────────────┐                      │
                     │  Cloudflare R2 (private)      │◄─── Chromium fetches │
                     │  {user}/albums/{album}/…      │     photos DIRECTLY  │
                     │    <uuid>.jpg      raw        │     via presigned GET│
                     │    <uuid>_full.jpg master     │     (900 s TTL)      │
                     │    <uuid>_thumb.jpg thumb     │                      │
                     │    preview.pdf                │                      │
                     │    print-cover.pdf            │                      │
                     │    print-content.pdf          │                      │
                     └───────────────────────────────┘                      │
                                   ▲                                        │
                                   └── customer/admin download = PRESIGNED URL, 120 s.
                                       **The worker never downloads a PDF.**
```

### Lifecycle of one 48-page / ~300 MB interior PDF

```
T0   admin clicks "Generate print interior"  (adminGeneratePrintPdf, capability album:manage)
     startAlbumPdfGeneration(albumId, {kind:'print_content'})
     ├ assertPrintablePageCount  — refuses unless the layout emits exactly `size` pages
     ├ randomBytes(32) → sha256 → album_pdfs{kind}.token_hash, +5 min TTL, status='generating'
     ├ boss.send('album-pdf', {albumId, token, kind}, {retryLimit:0})
     └ best-effort GET WORKER_URL/health to wake the service
                                                                            RAM    CPU   DISK  NET
T1   worker polls, ConcurrencyController.acquire('album-pdf')  [heavy lane]  ~120M  low    0     0
     → image lane immediately halves to its floor of 1
T2   ValidateAlbumStage   2 SELECTs                                          ~120M  low    0    ~0
T3   SnapshotStage        printUrl + deterministic R2 key                    ~120M  nil    0     0
T4   PrepareRenderStage   UPDATE stage='preparing'                           ~120M  nil    0    ~0
T5   RenderStep ─ browser.acquire()  (COLD: puppeteer.launch, up to 45 s)    +Chromium tree
     page.setViewport(1600×1200, dsf 2)
     page.goto(networkidle0, 45 s)   ← Next.js HTML + JS + CSS                      med   /tmp  ~3M
     Chromium fetches **every placed photo** from R2 via presigned GET
       48-page cap = 128 photos × ~2.4 MB                                    Chromium HIGH      ~300M ⬇
     waitForFunction(window.__ALBUM_PRINT_READY, 45 s)
     settle(): document.fonts.ready + **Promise.all(img.decode()) over ALL images**  ← peak Chromium
     page.pdf({printBackground, preferCSSPageSize}, 60 s)
       CDP Page.printToPDF transferMode:ReturnAsStream
       IO.read loop → **base64** chunks → atob() → Uint8Array.from(str, per-char cb)  VERY HIGH CPU
       chunks accumulate in buffers[]                                        +300 MB
       mergeUint8Arrays → one new Uint8Array                                 +300 MB → peak 600 MB
     `new Uint8Array(pdf)` in PuppeteerPageRenderer                          +300 MB → peak 900 MB
T6   page.close()  — Chromium page memory released; browser kept
T7   VerifyGeometryStage
       Buffer.from(bytes)                                                    +300 MB
       .toString('latin1') → one V8 STRING of 300M chars                     +300 MB → **peak ~1.2 GB**
       regex object index over the whole string + per-page inflateSync       HIGH CPU (blocks loop)
T8   UploadStage  PutObjectCommand(Body: 300 MB Uint8Array) — single PUT     +SDK copy       ~300M ⬆
T9   FinalizeStage  UPDATE … RETURNING (detects album deleted mid-flight)
T10  release lane; bytes go out of scope; image lane returns to 3

PEAK RESOURCE POINT = T7 (geometry verification), NOT T5.
Node-side peak ≈ 0.9–1.2 GB.  Container peak = that + the whole Chromium tree.
```

---

## 3. End-to-end workflow — the three jobs

### 3.1 `image-hardening`

**Step 1 — job creation.** `POST /api/photos/confirm` inserts a `photos` row (`status='pending'`)
and calls `enqueueImageHardening(photoId)`. **Payload is `{photoId}` only** — ~40 bytes, no image
data. Best-effort: if the enqueue fails the row stays `pending` and the recovery sweep finds it.

**Step 2 — queue.** pg-boss on the *same* Supabase Postgres over `DIRECT_URL` (session pooler,
5432 — the transaction pooler cannot host pg-boss). `boss.fetch(queue, {batchSize:1})` claims one
job atomically. **Visibility timeout = pg-boss's `expire_in`, default `interval '15 minutes'`**
(VERIFIED, `pg-boss@10.4.2/src/plans.js:192`; default `retry_limit` is 2 at line 184). If the worker
dies mid-job, `failJobsByTimeout` deletes the active row and re-inserts it as a retry, or fails it
if the retry budget is exhausted. `singletonKey = photoId` dedupes queued jobs per photo.

**Step 3 — worker initialization.** Node ≥ 20 (`engines`), ESM, `tsup`-bundled to one
`dist/main.js`. Startup order (`main.ts` `StartupDiagnostics`): configuration → environment →
**infrastructure (connect + probe DB, queue, R2 — CRITICAL, failure ⇒ exit)** → chromium (resolves
the executable path only, **never launched at boot** — NON-critical) → processors →
queue-coverage → recovery → resources. The health server binds `$PORT`; unset ⇒ headless.

**Step 4 — image processing** (`processors/image/stages.ts`, nine sequential stages):

| # | Stage | Work | CPU | RAM | Net |
|---|---|---|---|---|---|
| 1 | `LoadStage` | `objectStore.read(rawKey)` → `transformToByteArray()` — **whole object into RAM** | Low | +file size | ⬇ ≤20 MB |
| 2 | `ValidateStage` | `MAX_BYTES` 30 MB check; `file-type` magic bytes (never the declared type) | Low | — | — |
| 3 | `DecodeStage` | HEIC/HEIF → JPEG via `heic-convert` (WASM). Otherwise pass-through by reference | **Very High** for HEIC | +JPEG | — |
| 4 | `MetadataStage` | `exifr` capture date from ORIGINAL bytes; `sharp().metadata()` header probe; **bomb guard** | Low | +copy | — |
| 5 | `NormalizeStage` | **THE single decode.** `.rotate().flatten(#fff).toColourspace(srgb).raw()` | **High** | **+W×H×3 raster, then a full copy** | — |
| 6 | `MasterStage` | `sharp(raw).jpeg({quality:90, mozjpeg:true})` at **ORIGINAL resolution** | **Very High** (mozjpeg) | +raster copy +output | — |
| 7 | `ThumbnailStage` | resize longest edge ≤400, q80, mozjpeg | Medium | +raster copy | — |
| 8 | `PersistStage` | two `PutObject`s under **deterministic** keys (`_full.jpg`, `_thumb.jpg`) | Low | — | ⬆ ~2.5 MB |
| 9 | `FinalizeStage` | `markReady` FIRST, **then** delete raw + null `r2_key` (crash-safe order) | Low | — | ⬆ ~0 |

**Guards (VERIFIED, `image-codec.ts:56-65`):** `MAX_PIXELS = 100_000_000` (100 MP),
`MAX_DIMENSION = 30_000`, `MAX_BYTES = 30 MB`, `MASTER_QUALITY = 90`, `THUMBNAIL_MAX_EDGE = 400`,
`THUMBNAIL_QUALITY = 80`. `limitInputPixels` is never disabled. The upload presign caps at
**20 MB** (`src/lib/r2.ts:30`).

**Step 5 — upload.** `@aws-sdk/client-s3@3.1093.0`, `PutObjectCommand` with a `Uint8Array` body.
**Single-part PUT. No streaming, no multipart, no explicit retry or timeout configuration** —
`R2ObjectStore.fromConfig` passes only region/endpoint/credentials
(`r2-object-store.ts:104-114`). SDK defaults apply (standard retry mode, 3 attempts; **no socket
timeout**, so a stalled connection can hang until the pg-boss visibility timeout).

### 3.2 `album-pdf`

**Step 1 — job creation.** `startAlbumPdfGeneration(albumId, {kind})` — service-role; callers
authorize first. It refuses blueprint-draft albums absolutely; idempotency-checks `album_pdfs`
scoped to `kind`; mints `randomBytes(32)` and stores **only its sha256** plus a 5-minute expiry;
flips `status='generating'` with `requested_at`/`attempts`; enqueues `{albumId, token, kind}` with
`retryLimit: 0`; and best-effort probes `WORKER_URL/health` to wake the service.
**The payload is three short strings.** The raw token rides in it (the pgboss tables live in the
trusted DB) and is **never logged** — `redactToken` is applied at every boundary.

- **Preview** is payment-triggered (webhook + `/api/payments/verify` → `settleOrderFulfilment`).
- **`print_cover` / `print_content` are ADMIN-ON-DEMAND ONLY.** Nothing else starts one.

**Step 6 — PDF generation.** Six stages (`processors/pdf/stages.ts`); `RenderStep` is unified
because the `PageRenderer` port owns acquire-render-produce. Launch flags
(`browser-resource.ts:22-35`):

```
puppeteer.launch({
  headless: true,                    // Puppeteer 23 ⇒ NEW headless (a full browser process tree)
  timeout: 45_000,                   // launch + websocket connect
  protocolTimeout: 90_000,           // ceiling on every CDP call (newPage / evaluate / pdf)
  args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage'],
})
```

**ONE browser per worker process**, created lazily on first render, health-checked via
`browser.connected`, rebuilt on crash (`handle.reset()`), destroyed on shutdown. **A fresh page per
job**, closed in `finally`; a page that will not close marks the browser broken and forces a
rebuild. VERIFIED — `resources/resource-manager.ts`, `puppeteer-renderer.ts:88-97`.

Timeouts (`page-renderer.ts:155-161`): `navigationMs 45 s`, `readinessMs 45 s`, `settleMs 12 s`,
`pdfMs 60 s`. **`newPageMs: 20_000` is declared and never used** — `browser.newPage()` is bounded
only by `protocolTimeout`. Dead configuration.

**Step 7 — "PDF download".** There is none. **The worker never downloads a PDF.** Customer and
admin downloads are 120-second presigned R2 GET URLs returned as JSON
(`src/app/api/albums/[id]/pdf/route.ts:71`, `src/app/api/admin/albums/[id]/pdf/route.ts:51`); the
bytes go R2 → browser and never traverse the app server or the worker. **This removes an entire
class of resource concern from the hosting decision.**

**Step 8 — cleanup.** `page.close()` in `finally`; the browser is retained across jobs; `pdfBytes`
goes out of scope (no explicit release); on shutdown `ResourceManager.shutdown()` →
`browser.close()`. `tini` is PID 1 specifically to reap orphaned Chromium children
(`Dockerfile:48-53`).

### 3.3 `r2-cleanup`

`{keys: string[]}` — for a 48-page album deletion that is up to ~384 keys (128 photos × 3). Deleted
**one at a time, sequentially**, with a cancellation check between objects
(`cleanup/stages.ts:137-156`). Idempotent; a transient failure rethrows so pg-boss retries
(`retryLimit 5`). At ~50 ms per DeleteObject, 384 keys ≈ **19 seconds** of a lane, serially. Memory
and CPU are negligible.

---

## 4. One job, start to finish, through the actual source

`album-pdf`, kind `print_content`:

| # | File · function | Purpose | In | Out | Resource | Can fail with |
|---|---|---|---|---|---|---|
| 1 | `src/lib/pdf/generate.ts` · `startAlbumPdfGeneration` | mint token, mark generating, enqueue, wake | albumId, kind | `StartResult` | trivial | album missing, blueprint draft, page-count mismatch, enqueue failure |
| 2 | `src/lib/queue.ts` · `enqueueAlbumPdf` | `boss.send('album-pdf', …, {retryLimit:0})` | payload | job id | 1 DB round-trip | pooler unavailable |
| 3 | `apps/worker/src/main.ts` · `consume → dispatchAvailable` | lane check **before** polling | — | — | trivial | broker blip (caught, retried next tick) |
| 4 | `infra/queue/pgboss-queue.ts` · `poll` | round-robin `boss.fetch(batchSize 1)` | eligible types | `Job` | 1–3 DB queries | connection reset |
| 5 | `main.ts` · `startJob → runJob` | acquire lane, run, ack/nack | Job | — | trivial | — |
| 6 | `processors/runner.ts` → `router.ts` · `route` | registry lookup | Job | — | trivial | `UnroutableJobError` |
| 7 | `processors/pdf/pdf-processor.ts` · `process` | parse payload, run pipeline, classify outcome | Job | void | trivial | poison payload (ack) |
| 8 | `pdf/stages.ts` · `ValidateAlbumStage` | owner + token-hash + expiry | ctx | +userId | 2 SELECTs | `album_missing`, `SupersededError`, `token_expired` |
| 9 | `pdf/stages.ts` · `SnapshotStage` | `printUrl()` + `albumPdfKey()` | ctx | +url,+key | pure | invariant violation |
| 10 | `pdf/stages.ts` · `PrepareRenderStage` | `setStage('preparing')` | ctx | ctx | 1 UPDATE | — |
| 11 | `pdf/stages.ts` · `RenderStep` → `puppeteer-renderer.ts` · `render` | **the whole render** | url | **+pdfBytes (100–300 MB)** | **peak CPU + Chromium RAM + Node RAM** | unreachable (dns/refused/tls/blocked), print-route non-200, renderer crash, any timeout, 0 bytes |
| 12 | `pdf/pdf-geometry.ts` · `verifyPdfGeometry` | per-page MediaBox + painted CSS sheet | bytes | verdict | **+2 full copies, high CPU, blocks the event loop** | `render_geometry_invalid` (TRANSIENT) |
| 13 | `pdf/stages.ts` · `UploadStage` | single PUT to the deterministic key | bytes | ctx | ⬆ full size | `upload_failed` (TRANSIENT) |
| 14 | `pdf/stages.ts` · `FinalizeStage` | `markReady … RETURNING`; **compensating delete if the album vanished** | ctx | ctx | 1 UPDATE (+1 DELETE) | `db_update_failed`, `album_missing` |
| 15 | `main.ts` · `queue.ack` | `boss.complete` | jobId | — | 1 UPDATE | unknown job (already expired) |

---

## 5. CPU analysis

| Stage | Intensity | Why |
|---|---|---|
| R2 download / upload | **Low** | I/O bound; SDK does checksum + TLS only |
| `file-type` magic bytes | **Low** | reads a header |
| `exifr` capture date | **Low** | picks two tags |
| `heic-convert` (HEIC only) | **Very High** | pure-JS/WASM libheif decode, no native acceleration, single-threaded |
| `sharp` decode + orient + flatten + colourspace | **High** | libvips native, multi-threaded, ~1 pass over W×H×3 |
| `sharp` JPEG encode, **mozjpeg, q90, ORIGINAL resolution** | **Very High** | mozjpeg trellis quantisation is several × baseline libjpeg cost, on 20–27 MP |
| `sharp` thumbnail | **Medium** | resize + small encode |
| Chromium page load + layout + image decode | **Very High** | separate process tree, multi-core; `settle()` forces `img.decode()` on **every** image concurrently |
| `page.pdf()` serialisation | **High** | Skia PDF writer; JPEG pass-through avoids re-encode |
| **CDP transfer of the PDF** | **Very High, in Node, single-threaded** | `atob()` then `Uint8Array.from(binaryString, m => m.codePointAt(0))` — **one JS callback per byte**. For 300 MB that is 300 million callback invocations. VERIFIED in `puppeteer-core@23.11.1/lib/esm/puppeteer/common/util.js`. **This blocks the event loop and is invisible in Chromium's CPU.** |
| `verifyPdfGeometry` | **High, in Node, single-threaded** | `.toString('latin1')` over the whole file, a global regex object scan, plus `inflateSync` per page. Blocks the loop. |
| Cleanup deletes | **Low** | network only |

**Cores per job.** `sharp` uses a libvips thread pool sized to the core count; Chromium spawns
renderer/GPU/network/storage utility processes. A single PDF job can saturate every available core
during load and decode, then collapse to **one busy core** during the CDP transfer and geometry
verification — the phase most likely to be mistaken for "the worker hung".

**Recommendation:** 1 vCPU is workable only for image jobs. **2 vCPU minimum for any worker that
renders PDFs**; 4 vCPU if PDF and image work share a process.

---

## 6. RAM analysis

### 6.1 A 5 MB source JPEG is not 5 MB of RAM

The pipeline's canonical intermediate is a **raw interleaved raster**: `width × height × channels`
bytes, with `channels = 3` after `flatten()` / `toColourspace('srgb')`.

Real dimensions measured out of this project's own generated PDFs: **5568×4872 (27.1 MP)** and
**6000×4000 (24.0 MP)**. So the "5 MB average image" is a ~24–27 MP camera JPEG.

| Source | Decoded raster (W×H×3) |
|---|---|
| 12 MP (4000×3000) | **36 MB** |
| **24 MP (6000×4000) — typical here** | **72 MB** |
| **27.1 MP (5568×4872) — measured here** | **81 MB** |
| 50 MP | 150 MB |
| **100 MP — the hard cap (`MAX_PIXELS`)** | **300 MB** |

(CALCULATED.)

### 6.2 Where the copies come from — VERIFIED, line by line

`ImageContext` is **accumulative**: every stage returns `{...ctx, newField}` and **nothing is ever
nulled** (`image-context.ts:192-212`). At `PersistStage` the context simultaneously holds
`rawBytes`, `decodable`, `raster`, `masterBytes` and `thumbBytes`.

On top of that, `SharpImageCodec` copies at every boundary:

```ts
probeDimensions:  sharp(Buffer.from(bytes))                        // +source
decodeOriented:   sharp(Buffer.from(bytes)) … .toBuffer()          // +source, +raster (libvips)
                  return { data: new Uint8Array(data) }            // +ANOTHER FULL RASTER COPY
encodeJpeg:       sharp(Buffer.from(raster.data))                  // +ANOTHER FULL RASTER COPY
                  return new Uint8Array(out)                       // +output copy
encodeThumbnail:  sharp(Buffer.from(raster.data))                  // +ANOTHER FULL RASTER COPY
```

VERIFIED — `sharp-image-codec.ts:111-148`.

**Per-image peak (CALCULATED):**

| Source | Steady (context) | Transient peak (decode / encode) |
|---|---|---|
| 24 MP / 5 MB | ~80 MB | **~220 MB** |
| 27 MP | ~90 MB | **~250 MB** |
| 100 MP (cap) | ~305 MB | **~900 MB — a single-image OOM path** |

**The 100 MP cap is reachable.** `guardDimensions` rejects `> MAX_PIXELS`, so exactly 100 MP passes
(`stages.ts:391-396`). A 30 MB, 100 MP PNG is legal as far as the worker is concerned (the 20 MB
presign cap helps, but the worker's own ceiling is 30 MB, and the recovery path can re-drive a row
whose object predates any cap change).

### 6.3 The PDF path — the dominant consumer

Chain for one PDF, all VERIFIED from shipped code:

| Step | Source | Bytes held |
|---|---|---|
| CDP `IO.read` returns **base64**, decoded with `atob()` + a per-character `Uint8Array.from` | `puppeteer-core/common/util.js` | transient string + chunk |
| chunks accumulated in `buffers[]` | `getReadableAsTypedArray` | **1 × N** |
| `mergeUint8Arrays(buffers)` allocates the whole result | `util/encoding.js:43-55` | **2 × N** at the merge |
| `const bytes = new Uint8Array(pdf)` | `puppeteer-renderer.ts:54` | **+1 × N** |
| `Buffer.from(bytes)` in `parse()` | `pdf-geometry.ts:97` | **+1 × N** |
| `.toString('latin1')` — one **V8 string** | `pdf-geometry.ts:97` | **+1 × N in the JS heap** |
| `doc.raw` retains the original | `pdf-geometry.ts:107` | still live |
| `PutObjectCommand({Body: bytes})` | `r2-object-store.ts:129` | SDK may copy again |

**CALCULATED Node-side peak:**

| PDF | Peak Node RSS attributable to the PDF alone |
|---|---|
| 100 MB (24-page) | **~300–400 MB** |
| 200 MB (36-page) | **~600–800 MB** |
| **300 MB (48-page)** | **~900 MB – 1.2 GB** |

**Two hard walls (VERIFIED):**

1. **V8's maximum string length on 64-bit is 536,870,888 characters.** `parse()` builds one string
   from the whole file, so a PDF **larger than ~512 MB throws** `Cannot create a string longer than
   0x1fffffe8 characters` — inside `VerifyGeometryStage`, which is classified TRANSIENT, so the
   recovery sweep re-drives it up to five times and then fails it. A 48-page album with 128 large
   photos is within ~40% of that wall.
2. **The CDP transport's `maxPayload` is 256 MB** (`NodeWebSocketTransport.js:19`). Individual
   `IO.read` chunks are far smaller, so this is not hit today — but the ceiling exists.

### 6.4 Full memory budget

| Component | Estimate | Basis |
|---|---|---|
| Node process baseline (bundle + pg-boss + postgres.js + aws-sdk) | 80–120 MB | ESTIMATED; the ops doc observed 60–80 MB idle |
| `sharp`/libvips native arena | 30–80 MB | ESTIMATED |
| One image job, 24 MP | 80 MB steady / **220 MB transient** | CALCULATED |
| One PDF job, Node side, 300 MB file | **900 MB – 1.2 GB** | CALCULATED |
| **Chromium browser tree, 35 large photos on one page** | **UNKNOWN FROM CODEBASE** — expect 0.5–1.5 GB | requires §27 Test C |
| Health / observability / traces | < 10 MB | bounded: 512 open traces, a 200-record ring, 512-char strings |

**The gap that matters:** `memoryPressureSensor` reads `process.memoryUsage().rss`
(`concurrency.ts:238`). Chromium is not in it. `memoryProbe` reads the same. So both the throttle
and `/health` under-report container usage by the entire browser tree. **This is the single most
important correctness gap for capacity planning.**

---

## 7. Temporary disk analysis

**The job path writes zero bytes to disk.** VERIFIED — a repository-wide grep for `node:fs`,
`os.tmpdir`, `createWriteStream`, `mkdtemp` across `apps/worker/src` returns only the diagnostic
CLIs (`--json-out`), `env.ts` (`existsSync`), and the runtime journal backend.

| Consumer | Path | Size | Class |
|---|---|---|---|
| Source images | — | 0 | never touches disk |
| Processed images | — | 0 | never touches disk |
| Generated PDF | — | 0 | never touches disk |
| Downloaded PDF | — | 0 | **never happens** |
| Upload staging | — | 0 | body is an in-memory `Uint8Array` |
| Chromium profile (`--user-data-dir`, per launch) | `/tmp/puppeteer_dev_chrome_profile-*` | ESTIMATED 50–300 MB | grows with cache over a long-lived browser |
| **Chromium shared memory, forced to disk by `--disable-dev-shm-usage`** | `/tmp` | **UNKNOWN — measure** | the flag *moves* pressure from `/dev/shm` to `/tmp` |
| Runtime journal | `/data` | ~0 (the processor path creates no runs) | must still be **writable** — the probe is liveness-critical |
| Logs | stdout | 0 | platform-captured |

| Concurrent jobs | Temp disk (ESTIMATED) |
|---|---|
| 1 (any type) | < 500 MB |
| 2 | < 500 MB — **one browser is shared**, and `WV2_PDF_CONCURRENCY=1` means one page at a time |
| 3 / 5 / 10 | still < 1 GB unless `WV2_PDF_CONCURRENCY` is raised; then ~+200–400 MB per concurrent page |

**Recommendation: 2 GB writable `/tmp` and a writable `/data`.** Disk is **not** a bottleneck at any
realistic concurrency — but `/tmp` must not be read-only, and it must not be a tmpfs sized out of the
container's memory allowance, which would silently convert disk pressure into an OOM kill.

**⚠️ `Dockerfile:68` declares `VOLUME ["/data"]`.** On platforms where an attached disk pins a
service to a single instance, this blocks horizontal scaling. Set `WV2_STORAGE=memory` for the
processor deployment — as `CONFIGURATION.md` already advises — and **drop the `VOLUME` line**;
`memory` storage needs no disk at all.

---

## 8. Network analysis

### Per job

**Image job:** 1 GET (raw, ≤20 MB, ~5 MB typical) + 1 PUT (master, ~2.4 MB) + 1 PUT (thumb, ~30 KB)
+ 1 DELETE ≈ **7.5 MB typical, 22.5 MB worst.**

**PDF job:**

- HTML + Next.js client bundle + CSS + fonts: ~1–3 MB (ESTIMATED)
- **Every placed photo, fetched by Chromium directly from R2** — equal to the *unique* photo bytes
  the PDF embeds (Chromium's HTTP cache deduplicates the download; **the PDF writer does not
  deduplicate the embedding** — §16.5)
- PDF upload to R2: the full file
- a handful of small SQL round-trips

| Album | Photos | PDF | Download | Upload | **Total per job** |
|---|---|---|---|---|---|
| 24-page, measured (`print-content_correct.pdf`) | 24 | 72 MiB | ~55 MiB | 72 MiB | **~127 MiB** |
| 24-page, measured (`print-content_FIXED`) | 35 | 85 MiB | ~68 MiB | 85 MiB | **~153 MiB** |
| 36-page at the 102-photo cap | 102 | ~245 MB | ~245 MB | ~245 MB | **~490 MB** |
| **48-page at the 128-photo cap** | 128 | **~307 MB** | ~307 MB | ~307 MB | **~615 MB** |

### Aggregate (CALCULATED, 48-page worst case)

| Rate | Traffic/hour | Sustained |
|---|---|---|
| 1 PDF/hr | 0.6 GB | ~0.2 MB/s |
| 10 PDF/hr | 6.1 GB | **1.7 MB/s** |
| 50 PDF/hr | 30.7 GB | **8.5 MB/s** |
| 100 PDF/hr | 61.5 GB | **17 MB/s** |
| 1,000 images/hr | 7.5 GB | 2.1 MB/s |

**R2 egress is free at Cloudflare**, so the cost lands on the *compute platform's* bandwidth
metering, in both directions. At 100 PDFs/hour this is a real line item — and §16 shows a
quality-neutral path to roughly a third of it.

**No connection concurrency is configured anywhere** — no `maxSockets`, no keep-alive agent, no
per-request timeout on the S3 client. SDK defaults apply.

---

## 9. Job duration and the timeout matrix

### Every configured bound (VERIFIED)

| Bound | Value | Where |
|---|---|---|
| Browser launch | 45 s | `browser-resource.ts:32` |
| CDP `protocolTimeout` (caps `newPage`, `evaluate`, `pdf`) | 90 s | `browser-resource.ts:33` |
| `page.goto` (`networkidle0`) | 45 s | `DEFAULT_RENDER_TIMEOUTS.navigationMs` |
| `waitForFunction(__ALBUM_PRINT_READY)` | 45 s | `readinessMs` |
| in-page fonts + `img.decode()` settle cap | 12 s | `settleMs` |
| `page.pdf()` | 60 s | `pdfMs` |
| `newPageMs` | 20 s | **declared, never used** |
| **pg-boss visibility (`expire_in`)** | **15 min** (default) | `pg-boss/src/plans.js:192` |
| pg-boss default `retry_limit` | 2 (overridden per producer) | `plans.js:184` |
| PDF stale ⇒ recovery re-drive | **7 min** | `WV2_RECOVERY_PDF_STALE_MS` |
| PDF recovery attempt cap | 5 | `WV2_RECOVERY_PDF_MAX_ATTEMPTS` |
| Print-token TTL | 5 min mint / 5 min re-drive | `generate.ts:26`, `pdfTokenTtlMs` |
| Presigned photo GET TTL | **900 s** | `print-data.ts:40` |
| Graceful drain | **30 s** | `WV2_DRAIN_TIMEOUT_MS` |
| Image stale ⇒ re-enqueue | 5 min | `WV2_RECOVERY_IMAGE_STALE_MS` |
| DB / R2 request timeout | **none configured** | postgres.js + AWS SDK defaults |

### Estimated durations

| Job | Fastest | Normal | Slow | Worst realistic |
|---|---|---|---|---|
| `image-hardening`, 24 MP | 2 s | **4–8 s** | 15 s | 45 s (cold pool + slow R2) |
| `image-hardening`, HEIC | 6 s | 12–25 s | 45 s | 90 s |
| `album-pdf`, 24-page preview | 15 s | **30–60 s** | 120 s | 162 s (the render budget) |
| **`album-pdf`, 48-page print_content, ~300 MB** | 60 s | **120–200 s** | 250 s | **~290 s** (45 launch + 162 render + ~30 CDP/base64 + ~20 verify + ~30 upload) |
| `r2-cleanup`, 384 keys | 5 s | **15–25 s** | 60 s | 120 s |

All PDF figures are **ESTIMATED**; §27 Test C replaces them.

### Mismatches found

1. **`WV2_DRAIN_TIMEOUT_MS = 30 s` vs a 120–290 s PDF render.** Every SIGTERM during a render
   abandons the job. That is the *deliberate and correct* choice (`main.ts:433-443` explains why:
   overrunning the grace period earns a SIGKILL, which loses the durable flush). But the consequence
   is that **any deploy or restart during a print export costs that render**, and it does not come
   back for up to 15 minutes (pg-boss expiry) or 7 minutes (the recovery sweep), whichever fires
   first.
2. **`WV2_RECOVERY_PDF_STALE_MS = 7 min` is only ~2.4× the estimated worst-case 48-page job.**
   `validateAppConfig` enforces `pdfStaleMs > WORST_CASE_RENDER_MS`, but that constant is
   `60+60+5+60 = 185 s` — **a stale duplicate of `DEFAULT_RENDER_TIMEOUTS`, which is actually
   `45+45+12+60 = 162 s`** (`config-validation.ts:50` vs `page-renderer.ts:155`). Neither accounts
   for browser launch, the CDP transfer, geometry verification, or the upload. **A 48-page render
   that legitimately runs past 7 minutes will be re-driven while still running.** The original then
   finds its token superseded and skips — correct, but the work is wasted and Chromium load doubles
   at exactly the wrong moment.
3. **`protocolTimeout` (90 s) exceeds `pdfMs` (60 s) but is below a slow launch plus a slow first CDP
   call.** Fine today; re-check after any launch-flag change.
4. **The print token expires in 5 minutes while the presigned photo URLs last 900 s.** The ordering
   is correct (the token is checked once, at navigation), but a queue backlog longer than 5 minutes
   makes every queued PDF job fail with `token_expired`, recoverable only via the sweep minting a
   fresh token. Under a burst this is a self-inflicted retry storm.

---

## 10. Concurrency analysis

### The model (VERIFIED, `concurrency.ts`)

```
pressure = critical (RSS ≥ hard)  →  allowance 0 for EVERY lane; intake stops, in-flight finishes
pressure = elevated (RSS ≥ soft)  →  allowance = max(min, floor(max/2))
a HEAVY lane is active            →  every other lane = max(min, floor(max/2))
otherwise                         →  allowance = lane.max, capped by maxInFlight
```

Defaults: `maxInFlight 4`; `image-hardening {min 1, max 3}`; `album-pdf {min 1, max 1, heavy}`;
`r2-cleanup {min 1, max 2}`; `recoveryQuietFraction 0.5`.

The controller's verdict becomes the **poll filter** — a full lane is never even asked for, so
backpressure keeps jobs durably queued instead of pulling them into a process that cannot run them
(`main.ts:200-230`). Jobs are started **without awaiting** (`startJob`), so a long PDF does not
head-of-line-block image work.

### Where multiple large objects coexist

| Location | What overlaps |
|---|---|
| `ImageContext` at `PersistStage` | rawBytes + decodable + **raster** + master + thumb, per job × up to 3 jobs |
| `SharpImageCodec.encodeJpeg` | `raster.data` **and** its `Buffer.from` copy **and** libvips' internal buffers |
| `getReadableAsTypedArray` | the chunk array **and** the merged result (2 × PDF) |
| `puppeteer-renderer.ts:54` | the merged result **and** `new Uint8Array(pdf)` (up to 3 × PDF) |
| `pdf-geometry.ts:parse` | `bytes` **and** `Buffer.from(bytes)` **and** the latin1 string (3 × PDF) |
| `image-recovery.ts:212` | the only `Promise.all` on a job path — two small bounded reads |

There is **no parallelism inside a job**: image stages, PDF stages and cleanup deletes are all
strictly sequential. All parallelism is across jobs, via lanes.

### Resource requirements by concurrency (CALCULATED + ESTIMATED)

| Config | Node RAM | Chromium | **Container total** | CPU | Risk |
|---|---|---|---|---|---|
| 1 image (24 MP) | 300 MB | — | **~0.3 GB** | 1 core burst | Low |
| 3 images | 0.5–0.8 GB | — | **~0.8 GB** | 2–3 cores | Low |
| 1 PDF, 24-page (~85 MB) | 0.5 GB | 0.5–1.0 GB | **~1.0–1.5 GB** | 2 cores | Medium |
| **1 PDF, 48-page (~300 MB)** | **0.9–1.2 GB** | **0.5–1.5 GB** | **~1.5–2.8 GB** | 2 cores | **High** |
| 1 PDF (48p) + 1 image *(the actual default — heavy halves the image lane to its floor of 1)* | 1.1–1.4 GB | 0.5–1.5 GB | **~1.7–3.0 GB** | 3 cores | **High** |
| 2 PDFs (48p) — requires `WV2_PDF_CONCURRENCY=2` | 1.8–2.4 GB | 1.0–3.0 GB | **~3–5.5 GB** | 4 cores | **Very High** |
| 4 concurrent jobs, mixed | 1.5–2.0 GB | 0.5–1.5 GB | **~2–3.5 GB** | 4 cores | High |
| 8 concurrent jobs | 3–4 GB | 1–3 GB | **~4–7 GB** | 8 cores | Very High |

### Safe initial concurrency — RECOMMENDED

- **Do not exceed `WV2_PDF_CONCURRENCY=1` per process.** The default is already correct.
- **Single mixed worker on 4 GiB / 2 vCPU:** `WV2_MAX_IN_FLIGHT=3`, image 2, PDF 1, cleanup 1,
  soft 2200 MB, hard 2800 MB — **and read §15 on why those limits under-count.**
- Scale PDF throughput **horizontally** (more single-PDF processes), never by raising the PDF lane.

---

## 11. Crash and OOM analysis

| Failure | Probability | Impact | Detection today | Recovery today | Preventive fix |
|---|---|---|---|---|---|
| **Container OOM kill during a 48-page render** | **High** on ≤2 GB | SIGKILL: no drain, no flush, job redelivered after 15 min, row stuck `generating` for 7 min | **None until it happens** — the sensor cannot see Chromium | pg-boss expiry + the PDF sweep | 4 GiB; §29 P0-2 memory fixes; a container-aware sensor |
| **V8 heap exhaustion in `parse()`** (`Buffer.from` + a latin1 string of the whole file) | Medium at 300 MB | `FATAL ERROR: JavaScript heap out of memory` → hard exit | crash log only | pg-boss redelivery | stream/window the verifier; set `--max-old-space-size` |
| **PDF > ~512 MB ⇒ V8 max-string throw** | Low today, **rises with album size** | `render_geometry_invalid`, 5 sweep attempts, then `failed` | typed failure code | admin regenerate | verify without a whole-file string |
| Unhandled promise rejection | Medium | **Process exits** (Node 20 default); no drain, no capture | crash log only | platform restart | **add `process.on('unhandledRejection'/'uncaughtException')`** |
| Chromium crash / disconnect mid-render | Medium | `RendererCrashedError` (TRANSIENT), `handle.reset()`, next acquire rebuilds | `browser.connected` probe + `chromiumProbe` (degraded, non-critical) | recovery sweep | **already handled well** |
| Chromium launch failure (missing libs/fonts) | Low with this Dockerfile | every PDF fails; images unaffected | startup `chromium` check (NON-critical — **resolves the path, does not launch**) | manual | consider an opt-in launch smoke test |
| Orphaned Chromium children | Low | zombies accumulate over long uptime | none | none | **already handled** — `tini` as PID 1 |
| `/tmp` exhaustion (`--disable-dev-shm-usage` puts shm there) | Low–Medium | Chromium crashes or wedges | none — **no disk metric exists** | none | ensure 2 GB `/tmp`; add a disk gauge |
| `/data` read-only | Low | `runtime-storage` is **liveness-critical** ⇒ `/live` fails ⇒ **restart loop** | `/live` | none | `WV2_STORAGE=memory` |
| Postgres connection exhaustion | **Medium at 4+ workers** | worker cannot poll or write | `databaseProbe` (readiness-critical) | reconnect | 15 conns/instance (10 pg-boss + 5 postgres.js) — budget it |
| R2 outage / stalled PUT | Low | `upload_failed` TRANSIENT; **a stalled socket can hang to the 15-min expiry** (no request timeout) | none until expiry | sweep | set `requestTimeout` on the S3 client |
| Corrupt / spoofed image | Medium | `PermanentImageError` → `rejected`, **no retry** | processor event | — | **already handled** |
| 100 MP decompression bomb | Low | ~900 MB spike; may OOM **before** the guard, because `probeDimensions` reads headers but `decodeOriented` allocates | none | — | lower `MAX_PIXELS`; check dimensions before the second decode |
| Malformed PDF from Chromium | Low | `render_geometry_invalid` (TRANSIENT) → sweep → fail at the cap | **already handled** — the geometry net | — | — |
| Renderer timeout | Medium on huge albums | `render_timeout` TRANSIENT | typed code | sweep | raise `pdfMs` for the print kinds |
| **SIGTERM during a PDF render** | **Certain on every deploy** | the 30 s drain expires, the job is abandoned, the row stays `generating` for up to 7 min | `worker.drain.timeout` warn | sweep | drain PDF-only workers separately with a longer budget |
| SIGKILL (grace period exceeded) | Low if drain < grace | durable state unflushed | none | pg-boss expiry | keep `WV2_DRAIN_TIMEOUT_MS` < the platform grace |
| Deploy/restart during a job | Certain | as above | | | |
| Broker poll outage | Low | **already handled** — `consume()` catches, counts `worker.dispatch.error`, retries next tick | metric + log | automatic | — |
| Socket / FD exhaustion | Low | — | none | — | no FD metric exists |
| **Recovery re-enqueue amplification** | **Medium under backlog** | `ImageRecoverableProcessor.recover` calls `producer.enqueue` with **no `singletonKey`** (unlike the app's producer), so the same stale photo is re-enqueued **every 60 s sweep** until processed — up to 100 per sweep | `recovery.*` events | processing is idempotent, so duplicates are cheap no-ops — but they are real queue growth | pass `singletonKey: photoId` |

---

## 12. Retry and idempotency audit

| Operation | Safe to retry? | Why |
|---|---|---|
| Image processing | **Yes** | `status` is re-read up front; `ready`/`rejected` short-circuit; derivative keys are a **deterministic** function of the raw key, so a retry **overwrites** — no orphans |
| Image upload | **Yes** | deterministic keys, PUT overwrite |
| Raw delete + `clearRawKey` | **Yes** | best-effort, DeleteObject idempotent; a crash leaves `ready` + `r2_key` set, healed by the `orphan-raw` sweep |
| PDF generation | **Yes** | `status='ready'` ⇒ `SupersededError` (silent skip); a token-hash mismatch ⇒ skip. **Fresh tokens make re-drive safe under concurrency: only the current token renders.** |
| PDF upload | **Yes** | deterministic key `{user}/albums/{album}/{preview\|print-cover\|print-content}.pdf` |
| PDF finalize | **Yes** | `UPDATE … RETURNING` detects a vanished row and **compensates by deleting the uploaded object** — a genuinely well-handled race (`stages.ts:388-411`) |
| DB status writes | **Yes** | keyed by `(album_id, kind)` / `id`; `setStage` is gated on `status='generating'` so a late write cannot resurrect a superseded row |
| Cleanup deletes | **Yes** | DeleteObject idempotent |
| Job completion | **Mostly** | `boss.complete` on a job pg-boss has already expired affects 0 rows and is silent |

**Can a retry make things worse?** Three cases:

1. **Expensive repeated work.** A `render_geometry_invalid` or `render_timeout` re-drives the *whole*
   render — for a 48-page album that is another ~300 MB download, another Chromium page, another
   ~300 MB upload. Five attempts is up to **3 GB of transfer and ~25 minutes of compute** for one
   album. The attempt cap is the right guard; the cost per attempt is what makes §16 matter.
2. **Duplicate concurrent execution.** If a job outlives pg-boss's 15-minute `expire_in`, it is
   re-queued (for `image-hardening`, `retryLimit 3`) while the original is still running. Image
   processing is idempotent so the outcome is correct, but two workers burn CPU on the same photo.
3. **Recovery re-enqueue without a singleton key** — see §11, last row.

**Inconsistent states possible:** a photo `ready` with `r2_key` still set (healed by the sweep); an
`album_pdfs` row `generating` for up to 7 minutes after an abandoned render (healed by the sweep); a
`pgboss.job` marked failed-by-timeout while the render actually succeeded (harmless — the
`album_pdfs` row is the source of truth for status).

---

## 13. Deployment environment audit

| Requirement | Value | Source |
|---|---|---|
| OS | **glibc Linux**, not musl/Alpine — `sharp`'s prebuilt binary requires it | `Dockerfile:19,41` (`node:20-slim`) |
| Node | ≥ 20 | `package.json` `engines`, `tsup` `target: node20` |
| Package manager | pnpm via corepack; `--frozen-lockfile` (supply-chain correct) | `Dockerfile:20,30` |
| Build | `pnpm --filter @workerv2/app run build` (tsup → one ESM bundle), then `pnpm deploy --prod /deploy` | `Dockerfile:33,38` |
| Start | `node dist/main.js` under `tini` | `Dockerfile:82-83` |
| Runtime `node_modules` | **required** for `sharp`, `heic-convert`, `libheif-js`, `puppeteer` (native/WASM, not bundleable) | `tsup.config.ts` `external` |
| Chromium | **distro `chromium`**, not Puppeteer's download (`PUPPETEER_SKIP_DOWNLOAD=1`, `PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium`) | `Dockerfile:51-56` |
| Fonts | `fonts-liberation`, `fonts-noto-color-emoji` | `Dockerfile:53` |
| PID 1 | `tini` — reaps orphaned Chromium children, forwards SIGTERM verbatim | `Dockerfile:48-53,82` |
| Writable dirs | `/tmp` (Chromium — **mandatory**), `/data` (the liveness probe round-trips through it) | `Dockerfile:58-68` |
| Ports | one HTTP port from `$PORT` for `/health`, `/live`, `/ready`, `/diagnostics` | `config.ts:180`, `health.ts` |
| Health check | `GET /health` ⇒ `{status:"ok"}` | `Dockerfile:78-79` |
| Egress | Supabase Postgres **5432 session** (not 6543), Cloudflare R2 HTTPS, the app's origin over HTTP(S) | |
| **Ingress** | **REQUIRED** — the app probes `WORKER_URL/health` and is **fail-closed in production** | `src/lib/worker/health.ts:59-62` |
| DNS / TLS | needed for R2, Supabase and the app origin; `ca-certificates` installed | |
| Graceful shutdown | SIGINT/SIGTERM → drain (30 s) → stop recovery → close Chromium → close pools → flush | `shutdown.ts`, `main.ts` `stop` |
| Stateless? | **Yes, with `WV2_STORAGE=memory`.** Nothing durable is kept in the container. | |

### Deployment defects found

1. **`worker/.dockerignore` does not exclude `.env`.** `worker/.env` exists on this machine (360 B,
   gitignored) and `COPY . .` (`Dockerfile:29`) copies it into the **build stage**. The runtime stage
   copies only `/deploy/node_modules` and `dist`, so it does not reach the final image — but it is
   baked into an intermediate layer and the build cache. **Add `.env` and `.env.*` to
   `worker/.dockerignore`.** (P1)
2. **`ENV WV2_STORAGE=filesystem` + `VOLUME ["/data"]` are wrong for the processor deployment.** The
   documentation already says so; the image still defaults the other way. Override to `memory` and
   remove the `VOLUME`. (P1)
3. **No `NODE_OPTIONS`/`--max-old-space-size`.** Node picks a heap limit at boot; whether it respects
   the container's cgroup limit **must be verified in the running container**
   (`node -e "console.log(require('v8').getHeapStatistics().heap_size_limit)"`). Set it explicitly to
   ~60–70% of the instance RAM. (P0)
4. **`--disable-gpu` is not passed.** New headless Chromium may initialise a GPU/SwiftShader path
   that is pure overhead in a container. Also absent: `--no-zygote`,
   `--disable-background-timer-throttling`, `--renderer-process-limit`. (P2 — validate before
   changing; launch flags are load-bearing.)

---

## 14. Render Background Worker suitability

### Can this run as a Render Background Worker? — **No, not unchanged.**

**The blocker is architectural, not a resource limit.** A Render Background Worker has no inbound
network address. This service *must* be HTTP-reachable:

- `src/lib/worker/health.ts:59-62` — in production, `workerConfigOk()` is false when `WORKER_URL` is
  unset, and callers reject the operation. **Photo upload presign is gated on it.**
- `startAlbumPdfGeneration` probes `WORKER_URL/health` to wake a sleeping worker.
- `useWorkerGate` / `worker-prewarm` drive a customer-visible "waking the worker" UX over
  `/api/worker/health`.
- `Dockerfile:78` health-checks `http://127.0.0.1:$PORT/health`.

**The right Render shape is a service type that (a) runs a long-lived container, (b) binds a port,
and (c) is reachable by the app — i.e. a Private Service (internal-only) or a Web Service.** Exact
service-type capabilities, instance specifications, disk support and SIGTERM grace period are
**platform-dependent — verify against Render's current documentation.** Do not take instance names
or sizes from this report; none were invented here.

**Everything else about the worker is container-native and fits that shape well:** stateless with
`WV2_STORAGE=memory`, one process, graceful SIGTERM handling, a real Dockerfile, health endpoints, no
cron dependency, and horizontal-scale-safe (atomic `boss.fetch`; the in-repo load harness validated
8 workers with zero duplicate processing and zero job loss).

### Required specifications

> Numbers are CPU cores, GiB RAM, and GiB ephemeral disk. Map them onto instance types yourself —
> instance naming is platform-dependent.

**Minimum viable — images only, no PDF rendering**

- CPU **1 vCPU** · RAM **1 GiB** · Disk **1 GiB**
- `WV2_MAX_IN_FLIGHT=2`, image 2, PDF 1, cleanup 1; soft 600 / hard 800 MB
- Workload: uploads only. **A 48-page render on this will OOM.**

**Recommended production — mixed worker**

- CPU **2 vCPU** · RAM **4 GiB** · Disk **2 GiB** (`/tmp`)
- `WV2_MAX_IN_FLIGHT=3`, `WV2_IMAGE_CONCURRENCY=2`, `WV2_PDF_CONCURRENCY=1`,
  `WV2_CLEANUP_CONCURRENCY=1`
- `WV2_MEMORY_SOFT_LIMIT_MB=2200`, `WV2_MEMORY_HARD_LIMIT_MB=2800`,
  `NODE_OPTIONS=--max-old-space-size=2560`, `WV2_STORAGE=memory`,
  `WV2_DRAIN_TIMEOUT_MS` = platform grace − 5 s
- Workload: ~40–80 photos/min plus 1 concurrent PDF of any size.
- **Why 4 GiB and not 2:** a 48-page 300 MB render is 0.9–1.2 GB Node-side *before* Chromium. 2 GiB
  is the size at which that becomes an OOM kill, and the memory sensor cannot see it coming.

**High throughput — split by job type (needs the code change in §29 P1-1)**

- **Image workers ×N:** 2 vCPU · 2 GiB · 1 GiB disk · `WV2_IMAGE_CONCURRENCY=3`
- **PDF workers ×M:** 2 vCPU · 4 GiB · 2 GiB disk · `WV2_PDF_CONCURRENCY=1`, one browser each
- Scale N and M independently. **This is the correct end state:** the two workloads have opposite
  resource shapes — image is short, predictable CPU/heap bursts; PDF is a long-lived browser tree
  plus hundreds of MB of external memory.
- **Ceiling to watch first:** Supabase session connections — **15 per instance** (`pg.Pool` default
  max 10 for pg-boss + `postgres.js` max 5). At 8 instances that is **120 session connections**, plus
  whatever the Next.js app holds. Check the plan limit before scaling past 4.

---

## 15. Resource safety margins

| Resource | Estimated peak | Recommended allocation | Margin | Reasoning |
|---|---|---|---|---|
| RAM (mixed, 48-page PDF) | **1.7–3.0 GB** | **4 GiB** | ~35–135% | The estimate's widest term is Chromium, which is UNKNOWN and unobserved by the throttle. A margin that only covers the *midpoint* of an unmeasured range is not a margin. |
| RAM (images only) | 0.5–0.8 GB | 1.5–2 GiB | ~150% | Absorbs one pathological high-resolution image (up to ~900 MB at the 100 MP cap). |
| Temp disk | < 500 MB | **2 GiB** | ~300% | Chromium's `/tmp` use with `--disable-dev-shm-usage` is unmeasured, and disk is the cheapest thing to over-provision. |
| CPU | 1.5–2 cores sustained during a render | **2 vCPU** | ~30% | The base64 decode and geometry verification are single-threaded and serialise anyway; more cores help image throughput, not PDF latency. |
| Postgres connections | 15/instance | budget 20/instance | 33% | Leaves room for a maintenance connection and a probe. |

**Never size to the estimated peak.** Three of the four peaks above are ESTIMATED, and the memory
throttle cannot see the largest contributor. The margins exist to cover that measurement gap, not
ordinary variance.

---

## 16. File size and compression audit — **the empirical core**

### 16.1 Method

Four real generated interior PDFs are committed in `outputpdf/` (24 pages each, 206 × 291 mm,
MediaBox 583.92 × 824.88 pt). They were analysed read-only: object index, image XObject inventory
(width/height/BPC/ColorSpace/Filter/stream length), JPEG marker walk, SHA-1 per stream, and
effective-DPI arithmetic against the 8.110 × 11.457 inch page.

### 16.2 Where the bytes are — MEASURED

| File | Size | Pages | Photos (JPEG) | Overlay rasters (Flate) |
|---|---|---|---|---|
| `print-content_correct.pdf` | **72.1 MiB** | 24 | 24 · **54.5 MiB (75.6%)** | 96 · **17.5 MiB (24.3%)** |
| `print-content_incorrect.pdf` | **97.6 MiB** | 24 | 35 · **84.9 MiB (87.0%)** | 96 · **12.7 MiB (13.0%)** |
| `print-content_FIXED_dd0ad776.pdf` | **84.9 MiB** | 24 | 35 · **84.9 MiB (100%)** | **none** |
| `print-content_repro_dd0ad776.pdf` | 84.9 MiB | 24 | 35 · 84.9 MiB | none |

**`incorrect` and `FIXED` contain the identical 35 photos** — same count, same 678.6 MP, same
84.9 MiB, same top-12 stream lengths. The *only* difference between them is the 12.7 MiB of overlay
rasters. That is a controlled A/B inside the repository's own artefacts.

**Images are 99.9–100% of every file.** Fonts: **zero embedded font programs** in the interior (the
pages are all image). Metadata is negligible.

### 16.3 Finding A — a screen-only texture is 13–24% of every interior PDF

The 96 Flate images are **4 distinct rasters repeated once per page** (24×). Their dictionaries:

```
obj 10  /Type /Pattern /PatternType 1 /BBox [0 0 862 1217] /XStep 862 /YStep 1217
obj 11  <</ca .035 /BM /Multiply>>                        ← 3.5% opacity, multiply blend
obj 12  /Subtype /Form /BBox [0 0 2432 3435] /Group <</S /Transparency>>
obj 17  /Subtype /Image 862×1217 /DeviceRGB /SMask 18 0 R   554,601 bytes
obj 18  /Subtype /Image 862×1217 /DeviceGray                209,887 bytes   (the alpha mask)
obj 19  /Subtype /Image   1×1217 /DeviceRGB /SMask 20 0 R       530 bytes
obj 20  /Subtype /Image   1×1217 /DeviceGray                    224 bytes
```

**Root cause — VERIFIED in source:**

```
src/app/layout.tsx:24          <Grain />            ← in the ROOT layout
src/components/grain.tsx:8     <div className="paper-grain" />
src/app/globals.css:217-224    .paper-grain {
                                 position: fixed; inset: 0; z-index: 9999;
                                 opacity: 0.035; mix-blend-mode: multiply;
                                 background-image: url("data:image/svg+xml,…feTurbulence…");
                               }
```

The print routes live at `src/app/albums/[id]/print/…`. **There is no `layout.tsx` anywhere under
`src/app/albums/`**, so they inherit the root layout and its `<Grain/>`. A repository-wide grep for
`@media print` in `src/app/globals.css` returns **nothing** — the overlay is never suppressed.

Chromium cannot express a `feTurbulence` tiling pattern under a `multiply` blend as vectors, so it
**flattens the transparency group to a raster per page** (the `/Group /S /Transparency` form objects
above) at 2432 × 3435 px — which is exactly **300 DPI × the 206 × 291 mm page**.

**Consequences:**

- **12.7–17.5 MiB per 24-page interior**, purely decorative. On a 48-page book that scales to
  ~25–35 MiB.
- It is also **ink on the customer's book.** A noise texture at 3.5% multiply is printed onto every
  page. Nobody chose that, and it is not in the print specification.
- The fix is one `@media print { .paper-grain { display: none } }`, or better, not rendering
  `<Grain/>` on the print routes at all.

> **Confidence note, stated honestly:** the two files that carry the grain (16:26 and 16:38) were
> rendered through the app route; the two later files (17:40, 18:31) do not carry it and were
> produced during the page-containment investigation. The *source* still renders `<Grain/>`
> unconditionally in the root layout with no print suppression, so the code path is present.
> **One confirming render of the current build settles it** (§27, Test A-0).

### 16.4 Finding B — photos are embedded verbatim, at ~425 DPI against a 300 DPI target

**Skia passes the source JPEG through byte-for-byte. It does not re-encode.** Proof, from the marker
walk:

```
obj 56  5,243,401 B  sha1=919b9b3d222f  SOI=ffd8  SOF2 (progressive)  2 qtables  3 comps  4:2:0
        markers: DQT DQT SOF2 DHT DHT SOS      ← no JFIF APP0, no EXIF APP1, no COM
```

- **Progressive (SOF2) with optimized Huffman tables and no JFIF/EXIF segment is the mozjpeg
  signature** — exactly what `sharp().jpeg({quality:90, mozjpeg:true})` writes, with `sharp`
  stripping metadata. Chromium's own encoder emits **baseline SOF0 with a JFIF APP0**.
- **The same photo has an identical SHA-1 in two independently generated PDFs**
  (`919b9b3d222f` = `correct.pdf` obj 56 = `FIXED` obj 26).

**Therefore: the PDF photo payload equals the sum of the sanitized masters on R2, exactly.** Every
lever on PDF size is a lever on `MASTER_QUALITY` / master resolution, and vice versa.

**Effective print resolution — MEASURED:**

| Metric | Value |
|---|---|
| Page | 206 × 291 mm = 8.110 × 11.457 in |
| Typical photo | 5568 × 4872 (27.1 MP) and 6000 × 4000 (24.0 MP) |
| Effective full-page DPI (cover-fit; the limiting edge governs) | **min 84 · median 349–425 · max 425** |
| Project's stated target | `TARGET_PPI = 300` (`src/lib/print/spec.ts:437`) — **declared and used nowhere** |
| Project's own quality thresholds | `DPI_NOTICE = 200`, `DPI_ATTENTION = 150` (`_quality-model.ts:41-43`) |
| Pixels needed for a 300 DPI full page | 2433 × 3437 = **8.36 MP** |
| Pixels actually supplied | **19–27 MP — 2.3× to 3.2× more than 300 DPI needs** |

**Resampling to exactly 300 DPI (never upscaling) saves 40–42% of the photo payload** — computed per
photo from its own dimensions, not as a blanket ratio.

### 16.5 Finding C — Chromium does not deduplicate identical images

`print-content_FIXED_dd0ad776.pdf`: **35 image XObjects, 28 unique streams. 16.9 MiB (19.9% of the
file) is byte-identical duplicates.** Seven photos used on more than one page are embedded in full,
once per use. (Chromium's HTTP cache means each is *downloaded* once, so this is a file-size and
upload cost, not a download cost.)

### 16.6 Answering the brief's specific questions

| Question | Answer |
|---|---|
| How is PDF size produced? | ~100% image XObjects |
| Why so large? | Full-resolution mozjpeg q90 masters embedded verbatim, plus a per-page decorative raster, plus per-use duplication |
| Images embedded directly? | **Yes — byte-for-byte pass-through** |
| Encoding format | `/DCTDecode` (JPEG) for photos; `/FlateDecode` RGB + DeviceGray SMask for the grain rasters |
| Resolution inside the PDF | 19–27 MP, ~349–425 effective DPI |
| PNG / WebP | none |
| Recompressed? | **No** |
| Duplicate image data? | **Yes — 19.9% in one measured file** |
| Does the renderer rasterize? | Only the transparency group (the grain). Photos stay compressed. |
| Chromium holds the whole PDF in memory? | Yes, then streams it over CDP as base64 |
| Additional temporary copies? | **Yes — 3 to 4 full copies in Node** (§6.3) |
| Whole PDF in RAM? | **Yes, several times** |
| PDF downloaded by the worker? | **No — never** |
| Streamed or buffered? | **Fully buffered everywhere** |
| Files written to disk first? | **No** |
| base64 / data URLs? | **Yes — the CDP transfer is base64, decoded one byte per JS callback** |
| Blob/ArrayBuffer/Buffer? | `Uint8Array` throughout; `Buffer` at the sharp and geometry boundaries |
| Does browser/page memory dominate? | Almost certainly during the render; the Node side dominates after `page.pdf()` returns |

### 16.7 Modelled sizes at the album caps

Photo caps are `24 → 72`, `36 → 102`, `48 → 128` (`src/lib/builder/model.ts:51`). At the measured
**~2.43 MiB per master**:

| Album | Photo cap | Photos × 2.43 MiB | + grain | **Modelled max** | Brief's figure |
|---|---|---|---|---|---|
| 24-page | 72 | 175 MB | +18 MB | **~193 MB** | ~100 MB (typical placement) |
| 36-page | 102 | 248 MB | +26 MB | **~274 MB** | ~200 MB |
| **48-page** | **128** | **311 MB** | +35 MB | **~346 MB** | **~300 MB** ✅ |

The brief's 100/200/300 MB figures are consistent with real placement counts. **The 48-page /
300 MB case is the design maximum, not a tail case** — it is what a customer who fills their album
produces.

---

## 17. Quality-preserving compression — recommendation

**The question is not "how much can we compress?" It is "what resolution does a 200 × 285 mm trimmed
page actually need?"** That is answerable from the specification:

| Target | Pixels for a full-bleed 206 × 291 mm page | Payload vs today |
|---|---|---|
| **425 DPI (today)** | 3,447 × 4,869 = 16.8 MP | 100% |
| **300 DPI** — the spec's own `TARGET_PPI`, and standard for photographic offset | **2,433 × 3,437 = 8.36 MP** | **~50–58%** |
| 240 DPI | 1,946 × 2,749 = 5.35 MP | ~32% |
| 200 DPI — the project's own `DPI_NOTICE` floor | 1,622 × 2,291 = 3.72 MP | ~22% |

### Recommended, in order of confidence

1. **Remove the grain overlay from print output.** −13 to −24%. **Zero quality risk — it is a defect,
   not a trade-off.** Do this first and independently.
2. **Cap embedded photo resolution at 300 DPI at placed size, never upscaling.** −40 to −42%.
   Justified by the codebase's own `TARGET_PPI = 300` and by the fact that its quality model already
   treats 200 DPI as acceptable. **Do not apply a blanket downscale to the R2 master** — the master
   is the archival print original, and a photo's *placed* size is layout-dependent. Two clean
   implementations:
   - **Preferred:** a third derivative — a `_print.jpg` at the resolution the layout needs — chosen
     by the print route. Keeps the master untouched, is fully reversible, and adds one encode per
     photo per album rather than per render.
   - **Alternative:** a post-process on the finished PDF (Ghostscript `-dDownsampleColorImages
     -dColorImageResolution=300`) inside `UploadStage`. **This is the same integration point the
     CMYK conversion will need** — one Ghostscript step could do both.
3. **Deduplicate identical image streams.** −0 to −20%, workload-dependent. A `qpdf --linearize` or
   Ghostscript pass in `UploadStage`. Cheap, lossless, zero quality risk.
4. **Do NOT lower `MASTER_QUALITY` below 90 as a first move.** q90 mozjpeg 4:2:0 measured at
   0.131–0.140 bytes/px is already an efficient operating point. Dropping to q85 might save ~15% and
   *is* a real quality decision; resolution has 40% available with none.
5. **Do NOT change chroma subsampling.** It is already 4:2:0.

### Combined projection (CALCULATED from the measured files)

| File | Today | − grain | − 300 DPI resample | − dedupe | **Projected** | Reduction |
|---|---|---|---|---|---|---|
| `print-content_correct.pdf` | 72.1 MiB | 54.5 | 32.9 | 32.9 | **~33 MiB** | **−54%** |
| `print-content_incorrect.pdf` | 97.6 MiB | 84.9 | 49.0 | ~39.2 | **~39 MiB** | **−60%** |
| Modelled 48-page max | ~346 MB | ~311 | ~180 | ~150 | **~150 MB** | **−57%** |

That is not a marginal saving. **It roughly halves Node peak memory on the PDF path, halves network
in both directions, and shortens the base64 decode and geometry verification proportionally.**

### What is missing before this can be finalised

**The print partner's actual requirement.** `src/lib/print/spec.ts` states trim, bleed, safe areas
and spine, and declares `TARGET_PPI = 300` — but **no partner-confirmed minimum resolution, screen
ruling (LPI), or destination ICC profile exists in this repository.** Specifically missing:

- **A confirmed minimum effective DPI at final trim size.** 300 is the safe industry default and the
  project's own constant; the partner may accept 240.
- **The destination CMYK ICC profile and its total ink limit.** `CLAUDE.md` already records that the
  output is DeviceRGB and that no approved profile exists. **A CMYK conversion will re-encode every
  image anyway**, so the resolution decision and the colour conversion should be designed as one
  post-process step, not two.

**Do not ship a resolution reduction before asking the partner.** Ship the grain fix and the dedupe
now — both are lossless.

---

## 18. Compression experiment plan

Use the existing, real diagnostics — no new harness is needed:

```bash
cd worker/apps/worker
APP_URL=<app origin> npx tsx scripts/verify-pdf-pipeline.ts <albumId> print_content
npx tsx scripts/inspect-pdf.ts <albumId>        # page count + MediaBox of each generated file
```

Plus the read-only forensic scripts written for this audit (image inventory, JPEG markers, SHA-1
dedupe, DPI). Pick **one 24-page and one 48-page album with real customer photos.**

| Variant | Change | Measure |
|---|---|---|
| **V0 baseline** | current build, unmodified | size, per-image bytes, DPI distribution, wall time, peak RSS, Chromium RSS |
| **V1 no grain** | `@media print { .paper-grain { display:none } }` | Δsize; **verify pages are visually identical apart from the texture** |
| **V2 300 DPI** | V1 + a `_print.jpg` derivative at placed size, capped at 300 DPI, never upscaled | Δsize, Δwall time, Δpeak RSS |
| **V3 240 DPI** | V2 at 240 | Δsize; **for comparison only — do not ship without partner sign-off** |
| **V4 q85** | V2 with `MASTER_QUALITY=85` | Δsize; the least attractive lever |
| **V5 dedupe** | V2 + a `qpdf`/Ghostscript pass in `UploadStage` | Δsize, Δwall time |

**Acceptance criteria — justified, not invented:**

1. **Every embedded image ≥ 300 effective DPI at placed size**, or unchanged where the source is
   already below 300 (never upscale). *Justification: `TARGET_PPI = 300` in the project's own print
   specification; the project's warning floor is `DPI_NOTICE = 200`, so 300 keeps a full stop of
   margin above the level it already calls acceptable.*
2. **No page differs from V0 other than by resolution and the absent grain.** Verify by rendering
   both PDFs to PNG at 300 DPI and comparing structurally; MediaBox and page count must be identical
   (`inspect-pdf.ts` already asserts this, and `VerifyGeometryStage` enforces it in production).
3. **≥ 45% size reduction on the 48-page album** — the floor implied by the measured 40–42% resample
   plus the 13–24% grain, discounted for overlap.
4. **A print-partner physical proof of V2 is signed off before V2 ships.** No purely digital metric
   substitutes for that.
5. Wall time must not regress more than 15%; peak Node RSS must fall.

---

## 19. Chromium / Puppeteer audit

| Item | Finding |
|---|---|
| Version | `puppeteer` / `puppeteer-core` **23.11.1**; browser = **distro `chromium`** at `/usr/bin/chromium` |
| Download | disabled (`PUPPETEER_SKIP_DOWNLOAD=1`, `allowBuilds.puppeteer: false`) — deliberate and correct |
| Launch args | `--no-sandbox --disable-setuid-sandbox --disable-dev-shm-usage` |
| Sandbox | **disabled.** Acceptable *only* because the browser navigates exactly one first-party, token-gated route. See §24. |
| Headless mode | Puppeteer 23 `headless: true` = **new headless** — a full browser process tree, not the old lightweight shell |
| Browser reuse | **one browser per worker process**, lazy, health-checked, rebuilt on crash |
| Page reuse | **fresh page per job**, closed in `finally`; failure to close forces a browser rebuild |
| Renderer processes | 1 per page plus browser/network/storage/GPU utilities ⇒ **ESTIMATED 5–7 OS processes per browser** |
| Browser / disk cache | **not disabled** — grows over the browser's lifetime in `/tmp` |
| `/dev/shm` | bypassed by `--disable-dev-shm-usage`; the pressure moves to **`/tmp`**, which must be real, writable and roomy |
| Fonts | `fonts-liberation` + `fonts-noto-color-emoji`. **The builder offers ~20 Google fonts via `next/font`** — self-hosted by Next.js and fetched over HTTP, so no system packages are needed, but a font that fails to load silently substitutes. `settle()` awaits `document.fonts.ready` with a 12 s cap. |
| System libs | supplied by the `chromium` apt package |
| Cleanup | `ResourceManager.shutdown()` → `browser.close()`; orphans reaped by `tini` |
| Zombies | **handled** — `tini` as PID 1, explicitly for this |
| Custom image | **required and present** — `worker/apps/worker/Dockerfile` |
| Missing flags worth testing | `--disable-gpu`, `--no-zygote`, `--disable-background-timer-throttling`, `--renderer-process-limit=1`, `--js-flags=--max-old-space-size=…` |
| **Not observed** | Chromium's RSS, its process count, its `/tmp` usage — **none of it is measured anywhere.** `RuntimeMonitor` reports only `browsers` (0/1) and `openPages`. |

---

## 20. Bottleneck ranking

| # | Bottleneck | Why | Evidence | Impact | Recommended fix | Priority |
|---|---|---|---|---|---|---|
| 1 | **Node memory on the PDF path** | 3–4 full copies of a 100–300 MB file, one of them a V8 string | `puppeteer-renderer.ts:54`, `pdf-geometry.ts:97`, puppeteer `util.js` | OOM kill; drives the whole hosting decision | drop the redundant copy; verify geometry without a whole-file string; §16 compression | **P0** |
| 2 | **Chromium memory is invisible to backpressure and health** | the sensor reads Node RSS only | `concurrency.ts:238`, `probes.ts:172` | silent OOM; capacity cannot be planned | read the cgroup limit/usage, or sample the Chromium PID tree | **P0** |
| 3 | **PDF payload size** | 300 MB per 48-page album; ~57% of it is avoidable | §16 | drives RAM, network, duration, storage, cost | grain fix + 300 DPI derivative + dedupe | **P0** |
| 4 | **Base64 CDP transfer** | `Uint8Array.from(str, cb)` — one JS callback per byte, single-threaded, blocks the loop | puppeteer `common/util.js` | tens of seconds of unattributable "hang" per large PDF | pass a `path` to `page.pdf()` and stream from disk, or accept and measure | **P1** |
| 5 | **`verifyPdfGeometry` cost** | a full-file latin1 string, a global regex, and per-page inflate, on the event loop | `pdf-geometry.ts:96-182` | blocks health responses and dispatch mid-job | window the scan; read pages via the xref instead of a global regex | **P1** |
| 6 | **Chromium render time and memory** | one page holding 24–128 large photos, all `decode()`d at once | `puppeteer-renderer.ts:105-127` | latency + RAM | **measure first** (§27); consider batching the decode | **P1** |
| 7 | **Postgres session connections** | 15 per instance (10 pg-boss + 5 postgres.js) | `pg-boss/src/db.js` uses `pg.Pool` defaults; `WV2_DB_MAX_CONNECTIONS=5` | caps horizontal scale before CPU does | budget explicitly; consider lowering pg-boss's pool | **P1** |
| 8 | **Missing recovery indexes** | `findStalePending` (`status`,`uploaded_at`) and `findReadyNeedingCleanup` (`status`, `r2_key is not null`) have **no supporting index** — `photos` has only `(album_id,status)` and `upload_key` | `photo-repository.ts:102-116`; `drizzle/0007`, `drizzle/0053` | **a sequential scan of `photos` every 60 s per worker**, worsening as the table grows | two partial indexes | **P1** |
| 9 | **mozjpeg encode at full resolution** | q90 trellis on 20–27 MP, and both encodes re-`Buffer.from` the raster | `sharp-image-codec.ts:131-148` | image throughput ceiling | reuse one sharp pipeline; `mozjpeg:false` for the thumbnail | **P2** |
| 10 | **Sequential cleanup deletes** | one DeleteObject at a time; ~384 keys for a 48-page album | `cleanup/stages.ts:137-156` | ties up a lane for ~20 s | use the `DeleteObjects` batch API (1,000/call) | **P2** |

---

## 21. Observability audit

### Measured today (VERIFIED)

| Signal | Metric |
|---|---|
| Job duration, per processor | `worker.jobs.duration_ms{processor}` |
| Jobs received / completed / failed | `worker.jobs.*{processor}` |
| **Per-stage duration** | derived from `stage.started`/`stage.completed` events → spans + timings |
| Node RSS / heap used / heap total / external | `worker.process.memory_*` |
| Node CPU user/system % | `worker.process.cpu_*_percent` |
| **Event-loop delay (mean)** | `worker.process.event_loop_delay_ms` — the best early warning present |
| Active jobs | `worker.jobs.active` |
| Live browsers / open pages | `worker.resources.live{chromium}`, `worker.browser.pages_open` |
| Recovery: stale detected, outcome, duration, sweep duration, backlog | `worker.recovery.*` |
| Dispatch errors, backpressure, empty polls | `worker.dispatch.error`, `worker.dispatch.backpressure`, `worker.queue.poll_empty` |
| Resource create/acquire/reset (**Chromium restarts are visible**) | via `ResourceObserver` |
| Uptime | `worker.process.uptime_seconds` |
| Per-job traces | a root span per job, a child span per stage, correlation id threaded |

That is a genuinely strong baseline. The gaps are specific:

### Missing — and what each one costs

| Missing | Why it matters | Priority |
|---|---|---|
| **Chromium process RSS / process count** | the largest consumer is unmeasured; capacity cannot be planned and the throttle cannot act on it | **P0** |
| **Container memory limit + usage (cgroup)** | Node RSS is not container usage; an operator cannot see how close to an OOM kill the service is | **P0** |
| **Queue depth** | `MonitorSources.queueDepth` exists in the type and **is never wired** (`main.ts:673-684`). An operator cannot see a backlog forming. | **P1** |
| **`/tmp` disk usage** | `--disable-dev-shm-usage` makes `/tmp` load-bearing and it is unobserved | **P1** |
| **PDF byte size per job** | the single best predictor of memory and duration; trivially available at `UploadStage` | **P1** |
| **Photo count / megapixels per PDF job** | explains duration variance | P2 |
| **Queue latency (enqueued → received)** | both timestamps are on the `Job` envelope; the subtraction is never emitted | P2 |
| Retry/attempt count | `job.metadata.attempt` is carried, never counted | P2 |
| Network bytes in/out per job | cost attribution | P2 |
| Open file descriptors / sockets | a slow leak would be invisible | P3 |

### Minimum production metric set

`worker.jobs.duration_ms{processor}` p50/p95/p99 · `worker.jobs.failed{processor}` rate ·
**container memory usage vs limit** · **Chromium RSS** · `worker.process.event_loop_delay_ms` ·
**queue depth per queue** · `worker.recovery.backlog` · Chromium reset count · **`/tmp` free bytes** ·
count of `album_pdfs` rows in `generating` older than the stale threshold.

---

## 22. Logging audit

**Good, and better than most:**

- Structured, JSON in production (`WV2_LOG_FORMAT=json`), with one `worker.mode` line stating
  exactly what the process will do and why.
- **Every line carries worker id, job id, processor and correlation id** automatically via
  `logger.child({jobId, processor})`.
- **Bounded by construction:** `maxString 512`, `maxKeys 32`, `maxArray`, `maxDepth 4`
  (`observability/model.ts:140-145`). A 384-key cleanup payload cannot produce a giant log line.
- **Key-based redaction:** any key containing `secret`, `password`, `token`, `authorization`,
  `apikey`, `accesskeyid`, `secretaccesskey`, `connectionstring`, `credential` → `[redacted]`.
- **Print tokens specifically:** `redactToken()` is applied at *every* boundary a Chromium network
  error can cross — the log line, the processor event, and `album_pdfs.error` (which the admin
  console renders). Chromium embeds the full URL including `?t=` in its errors, and the renderer
  re-wraps any error that escapes the classifier. This was clearly hard-won and it is correct.
- `summarizeConfig` reports **shape, never values** — safe for `/diagnostics` and a log aggregator.
- Retries are visible: `job.metadata.attempt` is logged on `worker.job.start`.
- Stack traces: `sanitizeValue` reduces an `Error` to `{name, message}` — **stack traces are NOT
  logged.** Deliberate and defensible, but it makes an unexpected exception harder to diagnose.

**Recommendations:**

1. **Log the PDF byte size** at `UploadStage` — the highest-value missing field.
2. **Include a truncated stack** (first ~5 frames, sanitized) for `error`/`fatal`.
3. **`WV2_TRACE_SAMPLE=1` will be expensive at volume.** Each PDF job emits ~16 events (7 stages × 2
   plus lifecycle); each image job ~20. At 1,000 images/hour that is ~20k log records/hour from
   tracing alone. Drop to `0.1` once confidence is established, as `CONFIGURATION.md` already advises.
4. **Set `WV2_DIAGNOSTICS_TOKEN`.** Unset, `/diagnostics` is disabled and `/ready` is redacted —
   safe, but you lose the investigation tool exactly when you need it.

---

## 23. Graceful shutdown audit

**Sequence (VERIFIED, `main.ts` `stop`):** state → `draining` → stop the loop → cancel every
in-flight job cooperatively → await the loop → **`drain(30 s)`** → stop the recovery scheduler →
stop the monitor → `runtime.shutdown()` → close the health server → close Chromium → close pg-boss
(`graceful: true, wait: true`) and the DB pool → flush observability.

| SIGTERM during… | What happens |
|---|---|
| **Image processing** | Cancellation is checked **between stages** (`pipeline.ts:60`). A stage in flight runs to completion. Typical jobs finish inside 30 s ⇒ **completes and acks.** |
| **Image upload** | Same — finishes the PUT, marks ready, acks. |
| **PDF generation** | **Cannot be interrupted.** A cooperative token cannot abort `page.pdf()`. A 120–290 s render blows the 30 s drain ⇒ **abandoned.** The job was never acked, so pg-boss redelivers after `expire_in`; `album_pdfs` stays `generating` until the 7-minute sweep. `PdfProcessor` explicitly does **not** mark it failed on cancellation (`pdf-processor.ts:109-117`) — correct. |
| **PDF download** | n/a — never happens. |
| **DB update** | Sub-second; completes. |

**Assessment:**

| Property | Status |
|---|---|
| Current jobs finish | Image/cleanup yes; **PDF no** |
| Browser closes | **Yes** — `ResourceManager.shutdown()` in the `cleanup` hook |
| Temp files cleaned | Chromium's own profile dir; the container is discarded anyway |
| Queue locks released | **Not explicitly** — an abandoned job returns via `expire_in` (up to 15 min) |
| Job becomes retryable | Yes, via expiry plus the recovery sweep |
| Partial output left | **No.** Bytes go out of scope before upload; the compensating delete in `FinalizeStage` covers the album-deleted race. |
| Second signal | Ignored while draining (`shutdown.ts:9-11`) |

**Recommendations:**

1. **`WV2_DRAIN_TIMEOUT_MS` must stay strictly below the platform's SIGKILL grace period.** Verify
   that value on the chosen platform and set the drain 5 s under it.
2. **Give PDF-dedicated workers a longer grace and drain** (e.g. 300 s / 290 s) once the §14 split is
   in place. A mixed worker cannot have both.
3. **Nack abandoned jobs explicitly before exiting** so they return immediately instead of after 15
   minutes. Today the drain-timeout path just leaves them (`main.ts:459-467`).
4. Consider **`page.close()` on cancellation** — it would abort the render in Chromium far faster
   than waiting out `pdfMs`.

---

## 24. Security audit (worker-specific)

| Area | Finding |
|---|---|
| Secret handling | Env-only; never logged; `summarizeConfig` reports shape only; `worker/.env` is gitignored. **✅** |
| **`.env` in the Docker build context** | `worker/.dockerignore` excludes `node_modules`, `dist`, `coverage`, `.git` — **not `.env`.** `COPY . .` puts it in the build layer. Not in the final image, but in the cache. **P1** |
| **Print-token leakage** | Chromium puts the full URL (token included) in network errors; `redactToken` is applied at the log line, the event, `album_pdfs.error`, and as a re-wrap for anything escaping the classifier. `RenderRequest.origin` carries only the origin. **✅ genuinely well done** |
| SSRF | `printUrl(appUrl, …)` is the only URL builder; the base is validated as a **bare http(s) origin** (rejecting a query, a fragment, or a pasted full print URL). **No user-controlled URL reaches Chromium.** **✅** |
| Arbitrary URL fetching | The rendered page loads presigned R2 URLs the *app* generated. A compromised app could point Chromium anywhere — but that is an app-trust boundary, not a worker one. |
| Untrusted HTML | The print route is first-party. It does contain **customer-authored text** (titles, captions, locations) — React escapes it, and no `dangerouslySetInnerHTML` appears in the print components. **✅** |
| **`--no-sandbox`** | Chromium runs unsandboxed as user `node`. Mitigations: a first-party origin only, no user-supplied URLs, non-root, ephemeral container. Acceptable **only while those hold** — if the print route ever renders remote third-party content, this becomes critical. |
| Malicious image payloads | Magic-byte validation, `limitInputPixels` never disabled, 100 MP / 30k px / 30 MB guards, and a full re-encode that strips all metadata and any embedded payload. **✅ strong** |
| **HEIC path** | `heic-convert`/`libheif-js` is WASM and runs **before** the pixel guard has authoritative post-orient dimensions. A crafted HEIC is the least-hardened input. Consider a size/dimension pre-check on the HEIC container. |
| Path traversal | `expectedPrefix(userId, albumId)` is enforced as defense-in-depth on every raw key; derived keys are computed, never client-supplied. `albumPdfKey` is deterministic in (user, album, kind). **✅** |
| Temp files | None from the job path. **✅** |
| Command injection | No `exec`/`spawn` anywhere except Puppeteer's own launch with a fixed argv. **✅** |
| Authn/authz | The worker is trusted backend: service-role Postgres over `DIRECT_URL`, bypassing RLS by design. It authorizes nothing itself — callers do. **✅ documented and consistent** |
| Storage permissions | Full R2 credentials for the bucket. **`r2-cleanup` deletes exactly the key list it is handed and has no gate of its own** — its safety comes entirely from `deleteAlbum` deriving keys from rows whose ownership RLS proved. Correct today; **fragile if another caller is ever added.** |
| Health endpoints | `/health` and `/live` are open (the app's gate needs them); `/diagnostics` and detailed `/ready` require `WV2_DIAGNOSTICS_TOKEN` and are **disabled/redacted when unset**. The detail includes hostname, CPU model, core count, memory, PID and the composition — exactly the reconnaissance worth withholding. **✅ correct default** |
| Excessive network access | Egress to Postgres, R2 and the app origin. No allow-list, but nothing to constrain it to either. |

---

## 25. Data flow and storage map

| Object | Source | Destination | Size | RAM? | Disk? | Network? | Lifetime |
|---|---|---|---|---|---|---|---|
| Raw upload | browser → R2 (presigned PUT) | R2 `{user}/albums/{album}/{uuid}.{ext}` | ≤20 MB (~5 MB avg) | **not in the worker until `LoadStage`** | no | direct browser→R2 | until hardened |
| Raw bytes in-worker | R2 GET, fully buffered | `ImageContext.rawBytes` | ≤20 MB | **yes** | no | ⬇ | one job |
| Decoded raster | sharp | `ImageContext.raster` + copies | **W×H×3 = 72–300 MB** | **yes, ×2–3** | no | no | one job |
| Sanitized master | sharp mozjpeg q90, full res | R2 `…_full.jpg` | **~2.43 MiB measured** | yes | no | ⬆ | permanent |
| Thumbnail | sharp, ≤400 px, q80 | R2 `…_thumb.jpg` | ~30 KB | yes | no | ⬆ | permanent |
| Photos for a render | R2 presigned GET (900 s) | **Chromium**, not Node | 55–307 MB/job | **Chromium only** | Chromium cache in `/tmp` | ⬇ | one render |
| **PDF bytes** | `page.pdf()` via base64 CDP | `ctx.pdfBytes` → R2 | **100–300 MB** | **yes — 3–4 copies, up to ~1.2 GB** | no | ⬆ | one job |
| Stored PDF | `UploadStage` | R2 `…/{preview\|print-cover\|print-content}.pdf` | 100–300 MB | no | no | — | until regenerated/deleted |
| **Downloaded PDF** | **R2 → browser via a 120 s presigned URL** | the customer's disk | 100–300 MB | **never in the worker or the app server** | no | R2→browser | — |
| Cleanup key list | `deleteAlbum` | job payload | ~384 strings | trivial | no | — | one job |
| Runtime journal | `WV2_STORAGE=filesystem` | `/data` | ~0 (unused by processors) | no | yes | no | — |

---

## 26. Capacity model

| Configuration | Concurrent jobs | Peak container RAM | Temp disk | CPU | Throughput | Risk |
|---|---|---|---|---|---|---|
| **Images only** — 1 vCPU / 1 GiB | 2 image | ~0.6 GB | < 0.5 GB | 1 core | 25–50 photos/min | Low |
| **Small mixed** — 2 vCPU / 2 GiB | 2 image + 1 preview PDF | ~1.5 GB | < 1 GB | 2 cores | 40–80 photos/min · 1–2 previews/min | **Medium — 48-page print exports will OOM** |
| **Recommended** — 2 vCPU / 4 GiB | 2 image + 1 PDF (any size) | **~1.7–3.0 GB** | < 1 GB | 2 cores | 40–80 photos/min · 0.3–1 PDF/min | Low |
| **Large mixed** — 4 vCPU / 8 GiB | 3 image + 1 PDF | ~3.5 GB | < 1.5 GB | 4 cores | 90–180 photos/min · 0.3–1 PDF/min | Low |
| **PDF-dedicated ×M** — 2 vCPU / 4 GiB each | 1 PDF | ~1.5–2.8 GB | < 1 GB | 2 cores | M × (0.3–1)/min | Low — **the recommended scaling axis** |
| **Image-dedicated ×N** — 2 vCPU / 2 GiB each | 3 image | ~0.9 GB | < 0.5 GB | 2 cores | N × 40–90/min | Low |
| **2 PDFs in one process** | 2 PDF | **~3–5.5 GB** | ~1.5 GB | 4 cores | latency-bound | **High — do not do this** |
| **8 mixed** | 8 | **~4–7 GB** | ~2 GB | 8 cores | high | Very High — and 15 DB conns × instances |

**Derived from code, not extrapolated:** the lane model, the heavy-lane halving, and the measured PDF
sizes. The Chromium term in every row is ESTIMATED and is the first thing §27 must replace.

---

## 27. Benchmark plan — run this before choosing an instance

### Setup

One worker, `WV2_INFRA=on`, `WV2_LOG_FORMAT=json`, `WV2_MONITOR_INTERVAL_MS=5000`,
`WV2_DIAGNOSTICS_TOKEN` set. Three real albums with real customer photos (avg ~5 MB, ~24 MP):

- **Test A** — 24-page, ~30 photos (expect ~85 MB output)
- **Test B** — 36-page, ~60 photos (expect ~150–200 MB)
- **Test C** — 48-page, **at the 128-photo cap** (expect ~300 MB) ← **the decisive test**
- **Test A-0** — the grain confirmation: one render of the *current* build, then re-run the image
  inventory on the result. If Flate overlay rasters are present, Finding 16.3 is confirmed against
  today's build.

### Collect

| Metric | How |
|---|---|
| **Peak container RSS** | `docker stats --no-stream` in a 1 s loop, or the platform's memory graph. **This is the number that decides the instance size.** |
| **Node RSS / heap / external** | the `worker.process.memory_*` gauges (already emitted) at 5 s |
| **Chromium RSS + process count** | `ps -o rss,comm --ppid <node pid> --forest` in a 1 s loop, summed |
| Node heap limit **inside the container** | `node -e "console.log(require('v8').getHeapStatistics().heap_size_limit)"` — **confirms whether Node sees the cgroup limit** |
| CPU | `worker.process.cpu_*_percent` plus `docker stats` for the whole tree |
| CPU time | `/proc/<pid>/stat` before/after |
| **Per-stage duration** | already emitted as `stage.completed` events — no instrumentation needed |
| Total job duration | `worker.jobs.duration_ms{processor}` |
| **Disk** | `du -sh /tmp` in a 5 s loop; `df -h /tmp` |
| Network | container interface counters, or R2 request metrics |
| Open FDs | `ls /proc/<pid>/fd \| wc -l` |
| PDF size | `inspect-pdf.ts`, plus a `bytes` field added to the `UploadStage` event |
| Failure rate | `worker.jobs.failed` / `worker.jobs.received` |
| **Event-loop delay** | `worker.process.event_loop_delay_ms` — **watch this during the CDP transfer and geometry verification; that is where a 300 MB PDF shows up as a stall** |

### Concurrency sweep

Run A, B and C at `WV2_MAX_IN_FLIGHT` = 1, 2, 4, 8 (scaling the image lane to match). For each,
record peak container RAM, p95 job duration, failure rate, and whether the OOM killer fired.

### Pass criteria

1. Peak container RSS ≤ 70% of the instance limit at the chosen concurrency.
2. Zero OOM kills across 20 consecutive Test C runs.
3. p95 `album-pdf` duration < `WV2_RECOVERY_PDF_STALE_MS` **with 2× margin** (currently 7 min ⇒ p95
   must be under 3.5 min).
4. Event-loop delay p99 < 500 ms (health responses must stay timely).
5. `/tmp` peak < 50% of the allocation.

---

## 28. Stress test plan

| Scenario | Setup | What it proves |
|---|---|---|
| **Sustained image load** | 500 photos (a mix of 12/24/50 MP, plus one 100 MP at the cap) | throughput ceiling, whether the 100 MP image survives, the memory sawtooth |
| **Mixed load** | 200 photos + 5 concurrent 48-page renders | that heavy-lane halving actually bounds peak memory |
| **PDF burst** | 10 × 48-page enqueued at once | queue latency, whether the **5-minute print-token TTL** starts failing queued jobs (§9 mismatch 4), recovery-sweep behaviour |
| **Repeated same job** | enqueue the same `album-pdf` 5× | the `SupersededError` skip path; exactly one R2 write |
| **Failure injection** | a wrong `APP_URL`; R2 credentials revoked mid-job; `pkill -f chromium` mid-render | `render_unreachable` vs `render_engine_failed` classification; browser rebuild; typed failure codes |
| **Restart during a job** | SIGTERM during a 48-page render | the drain-timeout path, job redelivery, the `generating` row's 7-minute window |
| **SIGKILL** | `kill -9` mid-render | pg-boss expiry, sweep re-drive, no partial R2 object |
| **Memory ceiling** | lower `WV2_MEMORY_HARD_LIMIT_MB` to just above idle | that backpressure genuinely stops intake and the worker recovers without a restart |
| **Disk ceiling** | mount a 256 MB `/tmp` | how Chromium fails, and whether the worker reports it |
| **Backlog** | 1,000 pending photos older than 5 min | **the recovery re-enqueue amplification** (§11, last row) — measure `pgboss.job` growth per sweep |

**Determine:** maximum safe concurrency, sustained throughput, the album size at which a render
exceeds the stale threshold, the OOM threshold in MiB, and the `/tmp` threshold.

---

## 29. Prioritized recommendations

### P0 — must fix before production

**P0-1 · Make backpressure and health container-aware**
*Problem:* the memory sensor and `memoryProbe` read `process.memoryUsage().rss`; Chromium is a
separate process tree and is invisible.
*Evidence:* `concurrency.ts:235-246`, `probes.ts:172-197`, `browser-resource.ts:30`.
*Risk:* a silent OOM kill while reporting `healthy`; capacity cannot be planned.
*Fix:* read `/sys/fs/cgroup/memory.current` and `memory.max` (cgroup v2) as the primary signal,
falling back to Node RSS; optionally sum the Chromium PID tree's RSS. Feed the same number to both
the sensor and the probe — they must agree, which is already the stated design intent.
*Impact:* none on throughput; makes the existing throttle actually work.
*Complexity:* **Low** — one function, two call sites.

**P0-2 · Stop copying the PDF three times, and set an explicit heap limit**
*Problem:* `new Uint8Array(pdf)` (`puppeteer-renderer.ts:54`) is a redundant full copy — `page.pdf()`
already returns a `Uint8Array`. `pdf-geometry.ts:97` then makes a `Buffer` copy **and** a whole-file
V8 string. No `--max-old-space-size` is set.
*Risk:* ~1.2 GB Node peak for a 300 MB PDF; a hard V8 max-string wall at ~512 MB.
*Fix:* (a) return `pdf` directly, keeping only the empty-length check; (b) set
`NODE_OPTIONS=--max-old-space-size=<~65% of instance RAM>` in the Dockerfile or service config;
(c) verify the container's actual heap limit (§27).
*Impact:* **−300 MB peak immediately**, for a two-line change.
*Complexity:* **Trivial.**

**P0-3 · Remove the grain overlay from print output**
*Problem:* `<Grain/>` in the root layout reaches every print route; no `@media print` suppression
exists.
*Evidence:* **measured — 17.5 MiB of 72.1 MiB and 12.7 MiB of 97.6 MiB in real generated files.**
*Risk:* 13–24% wasted bytes **and unrequested ink on the customer's printed book.**
*Fix:* `@media print { .paper-grain { display: none } }`, or move `<Grain/>` out of the root layout
into the `(app)` layout so the print routes never see it. Then re-run §27 Test A-0.
*Impact:* **−13 to −24% PDF size, −13 to −24% network, proportional memory and CPU relief.**
*Complexity:* **Trivial.**

**P0-4 · Confirm the hosting shape supports inbound HTTP**
*Problem:* the app is fail-closed on `WORKER_URL`; a no-ingress worker platform breaks photo upload.
*Evidence:* `src/lib/worker/health.ts:59-62`.
*Fix:* deploy as a service type that binds a port and is reachable by the app (internal-only is fine
and preferable). Verify `PORT` is injected — without it `healthPort` is `null` and the worker runs
headless with **no `/health` at all**.
*Complexity:* **Low** (configuration), but a **blocking prerequisite.**

**P0-5 · Add process-level error handlers**
*Problem:* no `unhandledRejection`/`uncaughtException` handler anywhere in `apps/worker/src`.
Node 20 exits the process on an unhandled rejection.
*Risk:* an abrupt exit with no drain and no observability record; the cause is a bare stack on
stderr.
*Fix:* mirror the app's `src/instrumentation.ts` — log at `fatal`, flush observability, then
`app.stop('fatal')` and exit non-zero.
*Complexity:* **Low.**

### P1 — strongly recommended

**P1-1 · Allow a worker to be scoped to a subset of processors**
*Problem:* all three processors are registered unconditionally (`main.ts:601-628`), lane minimums are
1, and `WV2_*_CONCURRENCY` has a floor of 1 — **there is no way to run a PDF-only or image-only
worker.** That blocks the correct scaling shape.
*Fix:* a `WV2_PROCESSORS=image-hardening,r2-cleanup` allow-list applied at registration. The
queue-coverage startup check already reports what is unserved, so the diagnostics come for free.
*Complexity:* **Low.**

**P1-2 · Two missing indexes on `photos`**

```sql
create index if not exists photos_pending_uploaded_idx
  on public.photos (uploaded_at) where status = 'pending';
create index if not exists photos_ready_raw_idx
  on public.photos (id) where status = 'ready' and r2_key is not null;
```

*Evidence:* `photo-repository.ts:102-116`; the existing indexes are only `(album_id,status)` and
`upload_key`.
*Risk:* a full `photos` scan every 60 s per worker, forever, growing with the table.
*Complexity:* **Trivial** — purely additive, safe any time.

**P1-3 · `singletonKey` on recovery re-enqueue**
`ImageRecoverableProcessor.recover` calls `producer.enqueue(type, {photoId})` with no options, while
the app's producer uses `singletonKey: photoId`. Under a backlog the same photo is re-enqueued every
sweep. *Fix:* extend `JobProducer.enqueue` to accept send options and pass `singletonKey`.
*Complexity:* **Low.**

**P1-4 · Reconcile the render-timeout constants and raise the PDF stale threshold**
`config-validation.ts:50` hardcodes `60+60+5+60 = 185_000` and claims it comes from
`DEFAULT_RENDER_TIMEOUTS`, which is actually `45+45+12+60 = 162_000`. Neither includes browser
launch, the CDP transfer, geometry verification or the upload. *Fix:* export the sum from one place,
add a documented margin for the non-render phases, and set `WV2_RECOVERY_PDF_STALE_MS` to ≥ 2× the
measured p99 for a 48-page job. *Complexity:* **Low.**

**P1-5 · Add `.env` to `worker/.dockerignore`; set `WV2_STORAGE=memory`; drop `VOLUME ["/data"]`.**
*Complexity:* **Trivial.**

**P1-6 · Timeouts on the S3 client**
`R2ObjectStore.fromConfig` sets no `requestTimeout`/`connectionTimeout`. A stalled 300 MB PUT can
hang to the 15-minute pg-boss expiry. *Fix:* a `NodeHttpHandler` with explicit timeouts.
*Complexity:* **Low.**

**P1-7 · Wire the queue-depth metric.** `MonitorSources.queueDepth` exists and is never supplied
(`main.ts:673-684`). Without it nobody can see a backlog. *Complexity:* **Low.**

**P1-8 · Register a processor for `cover-thumbnail` and `blueprint-thumbnail`, or stop enqueuing
them.** Today those jobs are created and never processed. *Complexity:* **Medium** (a processor) or
**Trivial** (stop producing).

### P2 — performance optimization

- **P2-1 · Emit a 300 DPI print derivative (or post-process the PDF).** −40 to −42% payload.
  **Requires print-partner sign-off** (§17). *Complexity:* Medium.
- **P2-2 · Deduplicate image streams** with a `qpdf`/Ghostscript pass in `UploadStage` — measured
  19.9% on one real file, lossless. Same integration point as CMYK. *Complexity:* Medium.
- **P2-3 · Stream `page.pdf()` to disk** by passing `path`, then stream to R2 — trades the 3× RAM
  spike for disk I/O and avoids the whole-file JS string. *Complexity:* Medium.
- **P2-4 · Verify geometry without a whole-file string** — parse the xref/trailer and read page
  objects by offset instead of a global regex over 300 M characters. *Complexity:* Medium.
- **P2-5 · Free `ImageContext` intermediates** once consumed (mutable-with-clearing, or narrower
  stage signatures). *Complexity:* Medium.
- **P2-6 · Batch cleanup deletes** with `DeleteObjects` (1,000 keys/call). *Complexity:* Low.
- **P2-7 · `mozjpeg: false` for the thumbnail** — trellis quantisation on a 400 px image buys
  nothing. *Complexity:* Trivial.

### P3 — nice to have

Chromium launch-flag tuning (`--disable-gpu`, `--no-zygote`, `--renderer-process-limit=1`) ·
truncated sanitized stack traces on `error`/`fatal` · a `/tmp` disk gauge · an FD-count gauge · a
queue-latency metric (both timestamps already exist on the `Job` envelope) · remove the dead
`newPageMs` config or wire it to `browser.newPage()`.

---

## 30. Compression decision

**Is the current PDF size acceptable?** **No — but for a reason that is not really about
compression.** ~57% of a 48-page interior is avoidable *without touching image quality at all*: a
screen-only texture that should never have been in a print file, per-use image duplication, and
2.3–3.2× more pixels than the project's own `TARGET_PPI = 300` requires.

**Is compression necessary for worker stability?** **Partly.** The direct stability fix is P0-2 (stop
the redundant copies) plus P0-1 (see Chromium). But size is the multiplier on both: at ~150 MB
instead of ~300 MB, the Node peak roughly halves, the base64 decode halves, the geometry scan halves,
and a 4 GiB instance stops being marginal.

**For bandwidth and cost?** **Yes.** At 100 PDFs/hour the difference is ~61 GB/hour versus
~30 GB/hour of metered compute-platform traffic, plus half the R2 storage per album.

**Can it reduce RAM?** **Yes, roughly proportionally** — every copy in §6.3 is a copy of the file.
**Disk?** No — disk is already zero on the job path. **Generation time?** **Yes** — Chromium
downloads less, `page.pdf()` serialises less, the base64 decode is linear in size, geometry
verification is linear in size, and the upload is linear in size.

### The separation the brief asks for

**Compression for infrastructure efficiency — do it now, no quality question exists:**

1. Remove the grain overlay (**−13 to −24%**) — a *defect fix* that happens to save bytes.
2. Deduplicate identical image streams (**−0 to −20%**) — lossless by definition.

**Compression that touches print quality — do not ship without evidence and sign-off:**

3. Resample to 300 DPI at placed size (**−40 to −42%**). Justified by the project's own
   `TARGET_PPI = 300` and its `DPI_NOTICE = 200` acceptance floor, so the quality argument is
   strong — but the print partner has not confirmed a minimum, and **`TARGET_PPI` is currently
   declared and used nowhere**, so no code has ever acted on it. Benchmark it (§18) and get a
   physical proof signed off.
4. Lowering `MASTER_QUALITY` below 90: **not recommended.** It is the smallest saving with the
   largest quality risk, and q90 mozjpeg 4:2:0 at ~0.13 bytes/px is already efficient.

**Never upscale a low-resolution photo to manufacture a DPI number.** The measured minimum effective
DPI across a real album is **84** — those photos are what the customer had. `CLAUDE.md` already
states this policy; the resampler must be strictly one-directional.

---

## 31. Platform decision matrix

Architectural suitability only. **No pricing was researched. No instance specifications were
invented.**

| Requirement | Render Background Worker | Render Private/Web Service · container hosting | VM | Serverless container job | Kubernetes |
|---|---|---|---|---|---|
| **Inbound HTTP (`WORKER_URL/health`) — MANDATORY** | ❌ **no address** | ✅ | ✅ | ⚠️ usually request-scoped only | ✅ |
| Custom image with Chromium + fonts | ✅ | ✅ | ✅ | ✅ | ✅ |
| 300 MB PDF in RAM | ⚠️ instance-dependent | ⚠️ instance-dependent | ✅ | ⚠️ per-invocation memory caps | ✅ |
| ≥ 4 GiB RAM | ⚠️ verify the tier | ⚠️ verify the tier | ✅ | ⚠️ often capped | ✅ |
| Writable `/tmp` ≥ 2 GiB | ✅ | ✅ | ✅ | ⚠️ often small/tmpfs (counts against RAM) | ✅ |
| Jobs of 2–5 minutes | ✅ | ✅ | ✅ | ⚠️ execution caps | ✅ |
| Long-lived process (browser reuse, pg-boss polling) | ✅ | ✅ | ✅ | ❌ **cold start per job kills browser reuse** | ✅ |
| Per-process concurrency control | ✅ (in-process lanes) | ✅ | ✅ | ❌ external | ✅ |
| Horizontal scaling | ✅ | ✅ | ⚠️ manual | ✅ | ✅ |
| Graceful SIGTERM with a usable grace period | ⚠️ verify duration | ⚠️ verify duration | ✅ configurable | ⚠️ often short | ✅ configurable |
| Persistent queue | ✅ external (pg-boss/Postgres) — platform-independent | ✅ | ✅ | ✅ | ✅ |
| Large network transfers | ✅ | ✅ | ✅ | ⚠️ metered/limited | ✅ |
| Operational simplicity | ✅ | ✅ | ⚠️ | ✅ | ❌ |

**Verdict:**

- **Render Background Worker — ruled out** by the inbound-HTTP requirement, not by resources.
- **Render Private Service (or an equivalent container host that binds an internal port) — the
  recommended fit.** Long-lived, port-binding, image-based, horizontally scalable, with no public
  exposure of the health port. Confirm the RAM tiers, ephemeral disk and SIGTERM grace period against
  current platform documentation.
- **Serverless container jobs — poor fit.** A cold Chromium launch per job (up to 45 s) against a
  120–290 s render, plus execution and memory caps, plus no long-lived pg-boss consumer.
- **Kubernetes — over-engineered** for one service with two workload types, but the natural
  destination if PDF throughput ever needs autoscaling on queue depth.

---

## 32. Final hosting recommendation

**Can this run as a Render Background Worker?**
**No, not unchanged** — the app is fail-closed on `WORKER_URL/health` and a background worker has no
address. Use a service type that binds an internal port. Everything else about the worker suits that
shape well.

**Minimum practical configuration** (images only, no 48-page renders): 1 vCPU · 1 GiB · 1 GiB disk.

**Recommended production configuration:** **2 vCPU · 4 GiB RAM · 2 GiB ephemeral disk**, with
`WV2_MAX_IN_FLIGHT=3`, image 2, PDF 1, cleanup 1, `WV2_STORAGE=memory`,
`NODE_OPTIONS=--max-old-space-size=2560`, `WV2_MEMORY_SOFT_LIMIT_MB=2200`,
`WV2_MEMORY_HARD_LIMIT_MB=2800`, `WV2_DRAIN_TIMEOUT_MS` = platform grace − 5 s, and
`WV2_DIAGNOSTICS_TOKEN` set.

**Initial concurrency:** 3 total, **PDF strictly 1**.

**Should one process handle multiple jobs concurrently?** **Yes for images** (I/O-dominated, and the
lane model already halves them under a heavy job). **No for PDFs** — one Chromium page and one
multi-hundred-MB buffer at a time.

**Should PDF generation have dedicated workers?** **Yes, as soon as volume justifies it.** The two
workloads have opposite shapes: image is short, predictable CPU/heap bursts; PDF is a long-lived
browser tree plus hundreds of MB of external memory. Separating them lets you give the PDF worker
4 GiB and a long drain, and the image worker 2 GiB and a short one. **This currently requires the
P1-1 code change.**

**Should image processing and PDF generation be separate worker types?** **Yes — same answer, same
reason.** It also resolves the shutdown conflict: a mixed worker cannot simultaneously have a 30 s
drain (right for images) and a 300 s drain (right for PDFs).

**Horizontal or vertical scaling?** **Horizontal**, and the code is built for it: `boss.fetch` is
atomic, the in-repo load harness validated 8 workers with zero duplicate processing and zero job
loss, and 4 workers completed a fixed workload 3.7× faster than one. **Vertical only up to 4 GiB**,
which is what one 48-page render needs. **Watch the Postgres session-connection ceiling first** — 15
per instance.

**If the workload doubles:** add one instance. Queue latency halves; nothing else changes.

**If the workload grows 10×:** split by job type (P1-1); run 4–8 image workers and 2–4 PDF workers;
**you will hit Supabase session connections (15/instance) before CPU** — plan that migration, and
move the app's enqueue side off `DIRECT_URL` at the same time (the app's own `src/lib/queue.ts:15-18`
already flags this for serverless). Ship the §16 compression work before this point, or bandwidth
becomes the second wall.

---

## 33. Executive summary

**Worker purpose.** A single long-lived Node service that consumes three pg-boss queues on the
project's own Supabase Postgres. It hardens uploaded photos with `sharp` (validate → decode →
normalise → re-encode a full-resolution master plus a thumbnail → upload → delete the raw), and it
renders album PDFs by driving **the application's own token-gated print routes** with headless
Chromium and uploading the result to R2. It re-implements no rendering, which is why the printed book
cannot disagree with the preview.

**Complete workflow.** The app enqueues a tiny reference payload → the worker polls (round-robin,
lane-gated so a full lane is never asked for) → a sequential stage pipeline runs → results are
written to R2 under deterministic keys and the row is updated → the job is acked. A periodic recovery
sweep re-drives stale `pending` photos and stuck `generating` PDFs with fresh tokens, giving up at a
cap.

**Major dependencies.** `puppeteer` 23.11.1 + distro Chromium · `sharp` 0.35 (native, glibc) ·
`heic-convert`/`libheif-js` (WASM) · `pg-boss` 10.4 · `postgres` 3.4 · `@aws-sdk/client-s3` 3.109 ·
Node ≥ 20 · a reachable Next.js origin (`APP_URL`) · **and inbound HTTP from the app**.

**Largest files handled.** Source uploads ≤ 20 MB; decoded rasters **72–300 MB** in RAM; sanitized
masters ~2.4 MiB (measured); **PDFs 72–98 MiB measured for 24 pages, modelling to ~346 MB at the
48-page / 128-photo cap.**

**Peak memory.** Node-side **900 MB – 1.2 GB** for one 300 MB PDF (CALCULATED from three verified
copy sites plus a whole-file V8 string). Chromium's own footprint is **UNKNOWN and unmeasured**;
expect 0.5–1.5 GB. **Container peak ≈ 1.7–3.0 GB.**

**Peak disk.** **The job path writes nothing.** Chromium scratch in `/tmp` — estimated < 500 MB,
unmeasured. Allocate 2 GiB.

**CPU requirement.** 2 vCPU minimum for any PDF-rendering worker. The unexpected hot spots are
single-threaded and in Node, not Chromium: the base64 CDP transfer (one JS callback per byte) and the
whole-file-string geometry verification.

**Network requirement.** ~7.5 MB per image job. **~615 MB per 48-page PDF job** (download the photos,
upload the PDF). 61 GB/hour at 100 PDFs/hour. The PDF is **never** downloaded by the worker —
customers get a presigned R2 URL.

**Typical job duration.** Image 4–8 s. PDF 30–60 s for a 24-page preview.
**Worst realistic duration:** ~290 s for a 48-page print export.

**Safe concurrency.** 3 total per process, **PDF = 1**. Scale horizontally.

**Main crash risks.** Container OOM during a large render, with a throttle that cannot see it coming ·
V8 heap exhaustion in the geometry verifier · an unhandled rejection exiting the process with no
drain · SIGTERM abandoning every in-flight render.

**Main bottleneck.** **Memory on the PDF path** — driven equally by the redundant in-process copies
and by a PDF that is roughly twice the size it needs to be.

**Compression opportunity.** **~57%, quality-neutral.** Measured, not estimated: 13–24% is a
screen-only `mix-blend-mode: multiply` grain texture leaking from the root layout into every printed
page; up to 20% is byte-identical images Chromium re-embeds per use; 40–42% is pixels beyond the
project's own 300 DPI target, embedded verbatim because Skia passes the mozjpeg through unchanged.

**Required code changes before production.** P0-1 container-aware memory sensing · P0-2 remove the
redundant PDF copy and set `--max-old-space-size` · P0-3 suppress the grain in print · P0-4 confirm
the service type provides inbound HTTP · P0-5 add process-level error handlers. Then P1-1 (scope a
worker to a subset of processors), P1-2 (two missing indexes), and P1-3 through P1-8.

**Recommended hosting architecture.** A long-lived container service with an internal HTTP port — a
Render Private Service or equivalent, not a no-ingress background worker. Start with **one mixed
worker at 2 vCPU / 4 GiB / 2 GiB disk**, concurrency 3 with PDF = 1. Split into image workers (2 GiB)
and PDF workers (4 GiB) once volume justifies it; that split is the correct end state and needs one
small code change.

**Benchmark required before production.** §27 Test C — one 48-page, 128-photo album rendered to
`print_content` — with **container RSS, Chromium RSS, the Node heap limit inside the container,
`/tmp` usage and event-loop delay** all sampled. **Every RAM figure in this report that concerns the
running system is CALCULATED or ESTIMATED; that one test replaces the most important of them, and it
decides the instance size.**
