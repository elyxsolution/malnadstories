# Worker V2 — Changelog

> **Living document.** Records all Worker V2 changes in a semantic changelog structure.
> Complements (does not duplicate) the frozen planning suite and `WORKER_V2_PROGRESS.md`
> (which tracks *status*; this records *changes*).
> **Updated after every completed implementation phase / release.**

Sections: **[Planning](#planning)** · **[Implementation](#implementation)** · **[Release History](#release-history)**

---

## Planning

Frozen planning foundation (no code).

| Date | Document | Note |
|---|---|---|
| 2026-07-22 | Architecture Design Specification (ADS) | Architectural source of truth (26 sections + ADRs). |
| 2026-07-22 | `WORKER_V2_IMPLEMENTATION_GUIDE.md` | Execution discipline — principles, gates, DoD, workflow. |
| 2026-07-22 | `WORKER_V2_PHASES.md` | Phase plan — 18 phases, invariants, version matrix, milestones M1–M18. |
| 2026-07-22 | `WORKER_V2_WBS.md` | Work Breakdown Structure — single-capability work packages. |
| 2026-07-22 | `WORKER_V2_ENGINEERING_PLAYBOOK.md` | Operational engineering standards. |
| 2026-07-22 | `WORKER_V2_PROGRESS.md` · `WORKER_V2_CHANGELOG.md` | Living operational documents created. |

---

## Implementation

<!-- Newest first. One entry per phase (and per notable change) using the Change Entry Template. -->

### v0.0.0 — 2026-07-24 — Deployable Worker Application (Phase 19.5)

> Creates the minimal executable process that composes the production runtime into a runnable worker
> service (local / Docker / Render). This is an application composition/bootstrap layer, NOT a new
> architectural phase: it duplicates no runtime logic and modifies no completed architecture
> (Phases 0–19). No ADR.

**Added:**
- **`apps/worker` (`@workerv2/app`)** — the deployable Worker process:
  - **`main.ts`** — `WorkerApplication` (lifecycle: startup → recovery → idle → processing →
    draining → shutdown) + a guarded `runFromEnv()` entrypoint. Consumes jobs from the queue adapter
    and hands each Blueprint to `runtime.run(...)`.
  - **`config.ts`** — reuses `loadRuntimeConfigFromEnv`; adds only app knobs (poll interval, health
    port); validates + fails fast (`ConfigError`).
  - **`bootstrap.ts`** — constructs `WorkerRuntime` (injecting a JSON-lines structured logger; optional
    metrics + a durable backend); selects the queue adapter. Duplicates no runtime logic.
  - **`queue.ts`** — the isolated (deferred) queue seam: a `QueueAdapter` interface + an in-memory
    polling adapter; the runtime stays queue-unaware. A real broker drops in behind the same interface.
  - **`shutdown.ts`** — one-shot SIGINT/SIGTERM handling.
  - **`health.ts`** — optional observational HTTP `/health` (lifecycle state / storage / recovery /
    current job / version).
  - **Build**: `tsup` bundles the app + every `@workerv2/*` library into one self-contained
    `dist/main.js` (only Node built-ins external → no runtime `node_modules`); `Dockerfile`
    (multi-stage, tiny, non-root); `README.md` (local / Docker / Render / env / flows).

**Changed (additive workspace wiring only — no library/behavior change):**
- `pnpm-workspace.yaml` — added `apps/*`.
- root `package.json` — added `build` / `start` / `dev` scripts delegating to `@workerv2/app`.
- root `tsconfig.json` + `vitest.config.ts` — added `apps/*` globs (typecheck + tests).
- `apps/README.md` — documents the new app.
- **`@workerv2/worker-host`** — unchanged (its Phase-19 DI seams were already sufficient).
- **`@workerv2/worker-runtime`** — one additive line: `bootstrapApp` passes an optional `backend`
  through the runtime's EXISTING `BootstrapDeps.backend` seam (no runtime behavior change).
- `.dockerignore` added at the workspace root.

**Removed:** Nothing.

**Build system:** the project no longer relies solely on `--noEmit` — **only the application emits
build artifacts** (`apps/worker/dist`, gitignored); every library stays `--noEmit`.

**Security:** runs as non-root in Docker; config validated + fail-fast; the app performs no I/O beyond
the runtime's durable store + the optional health HTTP endpoint; health/logging/metrics observational.

**Documentation:** `apps/worker/README.md` (local / Docker / Render / env vars / build pipeline /
startup+shutdown+recovery flows); `apps/README.md`; `WORKER_V2_PROGRESS.md` (Phase 19.5 → done).

**Testing:** **11 new app tests** — config loading + fail-fast validation; queue (FIFO/ack/nack);
application bootstrap + startup to idle; health snapshot; job processing → PDF (via the unchanged
runtime) + acked + metrics; graceful shutdown (drain + `runtime.shutdown` + shutdown summary +
`whenStopped`); restart-recovery startup over a shared durable backend. Build proven: `pnpm build`
emits a 256 KB self-contained bundle and `node dist/main.js` boots to `worker.ready`. **The existing
706 tests pass unchanged** → `pnpm verify` green (**717 total**).

**Breaking Changes:** None.

**Migration Notes:** From `worker/`: `pnpm install && pnpm build && pnpm start` runs a real worker.
Render: root dir `worker`, build `pnpm install && pnpm build`, start `pnpm start` (or the Dockerfile).
Set `WV2_STORAGE=filesystem` + `WV2_STORAGE_ROOT` for durability/recovery.

**ADR References:** None (application-composition layer).

**Commit References:** _(recorded at commit — branch `worker-v2/phase-12-processor-sdk`)._

---

### v0.0.0 — 2026-07-24 — Production Runtime (task-phase 19)

> Turns Worker V2 into a production-ready runtime: durable stores, worker lifecycle + graceful
> shutdown, restart recovery, health, structured logging, and metrics — a pure operational
> composition concern. No new business/rendering features and no processing-semantics change; the
> only prior-package touch is additive, default-preserving DI seams on the host.

**Added:**
- **`@workerv2/worker-runtime`** — the Production Runtime:
  - **Durable storage** — `PersistentArtifactStore` (content-addressed; SAME sha256 identities as
    in-memory), `DurableJournalStore`, `PersistentEventSink`, and `RunRecordStore`, all over a
    swappable synchronous **`StorageBackend`** (`InMemoryStorageBackend` + `FileSystemStorageBackend`).
  - **`WorkerRuntime`** — the operational facade: `start`/`run`/`recover`/`shutdown`, exposing the
    durable stores, logger, and metrics.
  - **`bootstrapRuntime`** — builds a durable-infrastructure `WorkerHost` (injects the durable stores
    via the host's DI seams) + selects logging/metrics.
  - **`WorkerLifecycle`** — `idle → starting → running → draining → stopped` with in-flight tracking +
    graceful shutdown (refuses to stop with work in flight).
  - **Restart recovery** — a durable run record + `coordinator.resume` re-fold of the durable journal;
    content-addressed artifacts are reused, not regenerated.
  - **Configuration** — `RuntimeConfig` (storage / backend / worker limits / retry overrides /
    diagnostics / features) + `resolveRuntimeConfig` + `loadRuntimeConfigFromEnv` + `retryPolicies`.
  - **Observational** — `reportHealth` (readiness/liveness/storage/backend), `StructuredLogger`
    (Run ID·Node ID·Processor·Duration·Outcome·Artifact IDs) + recording/no-op refs, and
    `RuntimeMetrics` (durations/artifact counts/retries/failures/processor timings/backend usage) —
    none influence execution.
  - **Integration harness** — `makeRuntimeHarness` + `seedRuntimeAlbum` (restart-simulating).
- **ADR-0020** — the separate-package + additive-seam decision, durable-drop-ins-behind-a-sync-seam,
  resume-based recovery, observational-only health/logging/metrics, and external config (+ rejected
  alternatives).

**Changed:** **`@workerv2/worker-host`** — additive, default-preserving DI seams only:
`WorkerHostOverrides` gains `store`/`journalStore`/`eventSink`; `prepare`/`run` gain an optional
`policies` param; `HostArtifactStore` + policy types exported. Omitting all overrides = exact Phase-18
behavior. Plus workspace wiring for `worker-runtime`. No core package or processing-semantics change.

**Removed:** Nothing.

**Performance:** Synchronous storage backend (fs sync APIs); the in-process journal append is
read-modify-write (fine at album scale; a real backend offers append). Durable I/O only around runs.

**Security:** Durable storage of content-addressed artifacts + journals only (no secrets/PII beyond
what a run produces); config is external + explicit; health/logging/metrics are read-only projections;
filesystem keys are base64url-encoded (safe + reversible).

**Documentation:** Package `README.md` + JSDoc; ADR-0020; ADR index; `WORKER_V2_PROGRESS.md`
(task-phase 19 → done, with the Phase Retrospective; M17 partial).

**Testing:** **27 new tests** — storage (in-memory + filesystem backend round-trip + durability;
`PersistentArtifactStore` content-address/idempotent/size; `DurableJournalStore` append/load;
`PersistentEventSink`; `RunRecordStore`); config (defaults, env loader, retry→policies); lifecycle
(transitions, graceful shutdown, in-flight guards); health (ready/live, not-ready-before-start);
runtime (startup → durable album run → shutdown; artifacts + journal + run record persisted;
work-rejected-after-shutdown; structured logs with required fields; metrics recorded; diagnostics
off); recovery (restart → recover to the same terminal state; artifact reuse across restart;
unknown-run → undefined; durable journal reconstructs state). `pnpm verify` green (**706 total**, 29
packages).

**Breaking Changes:** None (host changes are additive + default-preserving).

**Migration Notes:** Deploy with `storage.kind = 'filesystem'` (or a real backend behind
`StorageBackend`); inject a real logger + metrics adapter; expose `runtime.health()`; on boot iterate
`recoverableRuns()` + `recover()`. A networked object-store/KV backend, INV-6 gating, load/soak, and
the app→host cutover are the follow-ups (all drop-ins behind the existing seams).

**ADR References:** **ADR-0020**.

**Commit References:** _(recorded at commit — branch `worker-v2/phase-12-processor-sdk`)._

---

### v0.0.0 — 2026-07-24 — Worker Host & End-to-End Pipeline (task-phase 18)

> Delivers the SINGLE composition root that wires every previously-built platform into a complete
> executable album-generation pipeline, with full dependency injection. It introduces no new
> business logic, rendering algorithm, document format, or orchestration semantics, and changes no
> other package — it is purely wiring. A real album now generates end to end (Blueprint → PDF
> Artifact), lifting RSK-1 architecturally.

**Added:**
- **`@workerv2/worker-host`** — the composition root:
  - **`WorkerHost`** — constructs + injects every dependency (no globals, no ambient state); registers
    processors + image backends + repositories + the artifact store; configures capability
    negotiation; executes complete Runs; surfaces diagnostics.
  - **`ContentAddressedStore`** — one sha256, idempotent store implementing BOTH the SDK
    `ArtifactGateway` and the image-backend `ArtifactBytesPort`, so all Artifact identities stay
    consistent (a canonical Blueprint/Manifest/Document gets a key = its own hash).
  - **`ServiceRegistry` + `BackendRegistry`** — explicit DI + multi-backend registration (selected by
    config, not processor logic; reference backend canonical).
  - **`registerProcessors`** — wires every completed processor into one resolver (6 image foundation
    processors + `surface.render`/`album.assemble` adapters + `document.export.pdf`).
  - **Adapter processors** — `createSurfaceRenderProcessor` (drives `CompositionEngine`) and
    `createAlbumAssembleProcessor` (drives the Document Builder): thin bindings of the Manifest's
    node names to existing engines (no new algorithm/format).
  - **Run executor** — `WorkerHost.prepare`/`executeManifest`/`run`: Blueprint → Manifest →
    Coordinator (via the Execution Adapter, deterministic monotonic injected clock) → assembled
    Document → PDF export → PDF Artifact.
  - **Observational diagnostics** — `buildDiagnostics` (summary, execution order, produced artifacts,
    duration, retries, failures) derived purely from the post-run state; never influences execution.
- **ADR-0019** — the single-root decision, adapter-processors-as-glue, one shared store, the
  host-orchestrated export stage, determinism + observational diagnostics, and config-driven backend
  selection (+ rejected alternatives).

**Changed:** workspace wiring (tsconfig/vitest/boundaries + lockfile) for `worker-host`. No other
package changed — the host only constructs, registers, and drives.

**Removed:** Nothing (purely additive).

**Performance:** Pure in-memory composition + a synthetic deterministic clock; whole-album run is a
sequential effect loop over the Coordinator. Durable store + distributed adapter are documented
drop-ins.

**Security:** No new external surface; full DI (no globals/ambient state); the host performs no
storage/networking of its own beyond the injected in-memory store; every processor's production goes
through the Artifact gateway; no secrets/PII.

**Documentation:** Package `README.md` + JSDoc; ADR-0019; ADR index; `WORKER_V2_PROGRESS.md`
(task-phase 18 → done, with the Phase Retrospective; RSK-1 architecturally lifted; M16 partial).

**Testing:** **17 new integration tests** — complete album generation (Blueprint → valid PDF + page
count + Document); observational diagnostics (order, artifacts, retries, failures); deterministic
output + artifact-identity stability (same input → same PDF/Document keys; different album → different
keys); processor registration (all names registered + resolvable); dependency composition (service
registry contents, host isolation, duplicate-registration rejection); capability negotiation (offers,
satisfied/unmet, a run with no offers fails); replay (rebuild → identical artifacts) + resume (journal
re-fold → identical state); backend replacement (a counting backend proves the selected backend is
driven; reference backend identical across hosts; unregistered backend fails fast). `pnpm verify`
green (**679 total**, 28 packages).

**Breaking Changes:** None.

**Migration Notes:** None. Swapping the store, an image backend, or a processor changes ONLY the host
wiring. Follow-ups (all drop-ins behind existing seams): a durable store + distributed driving
adapter, one-active-run (INV-6) gating via the Control Plane Run Registry, load/soak + a
byte-reproducibility harness, and app→host enqueue re-homing for production consumption.

**ADR References:** **ADR-0019**.

**Commit References:** _(recorded at commit — branch `worker-v2/phase-12-processor-sdk`)._

---

### v0.0.0 — 2026-07-24 — PDF Export Processor (task-phase 17)

> Delivers the first concrete document exporter — a normal Processor SDK implementation that converts
> an immutable Document into a DETERMINISTIC PDF Artifact, independent of Document construction + page
> rendering. The Document Platform is unchanged. Modifies no Documents, renders no pages, processes no
> images, composes no layouts, no business logic, no storage/networking (production goes through the
> Artifact Platform via the SDK gateway).

**Added:**
- **`@workerv2/pdf-export`** — the PDF Export Processor:
  - **Processor** — `pdfExportSpec` / `createPdfExportProcessor` (`document.export.pdf`): input
    `document` (the canonical Document JSON artifact) → outputs `pdf` + `descriptor`. Parses the
    Document (read-only), resolves each Page Artifact (`decodeRaster` — container read only),
    validates page-size consistency, assembles the PDF, validates it, and produces both Artifacts
    through the SDK gateway.
  - **PDF Generator / Assembly Engine** — `generatePdf`: pure-TS deterministic writer with page
    placement (image XObject per page filling the media box inset by bleed), a metadata writer
    (fixed `Producer`, no dates), crop marks, bleed, and a compression policy (`none`/`flate`).
  - **Low-level PDF writer** — `PdfBuilder` (controlled object numbering + ordering, byte-accurate
    xref, content-derived trailer `/ID`, deterministic UTF-16BE-hex strings) + `pdfTextString`/
    `streamObject`.
  - **Image packing** — `rasterToPdfImage`: format packing only (channel select/de-interleave →
    DeviceGray / DeviceRGB / DeviceRGB+SMask); no pixel transformation.
  - **Export configuration** — `parsePdfExportConfig`/`canonicalExportConfig` (`page size · bleed ·
    crop marks · compression · metadata · PDF version`) — part of export identity.
  - **Validation** — `validateExportPages` (uniform sizes) + `validatePdf` (structure) — an invalid
    PDF Artifact is never produced.
  - **PDF Descriptor** — `buildPdfDescriptor`: document identity + ordered page identities + config +
    PDF version + processor version, for replay/audit/debug (produced as a JSON Artifact).
  - **Test harness** — `setupPdfExport`/`samplePageRaster`/`samplePrintProfile`.
- **ADR-0018** — the pure-writer decision, the SDK-processor shape, format-packing-not-processing,
  config-as-identity, and validate-gates-production (+ rejected alternatives).

**Changed:** workspace wiring (tsconfig/vitest/boundaries + lockfile) for `pdf-export`. Nothing else —
the package is a downstream leaf; the Document Platform is untouched.

**Removed:** Nothing (purely additive).

**Performance:** Pure-JS PDF assembly; `none` compression embeds raw image samples (largest, fully
deterministic); `flate` (node:zlib) is smaller and deterministic per zlib.

**Security:** Full validation at every boundary (config, Document, page references, generated PDF);
no dates / random ids / host metadata leak into the PDF; no storage/networking; production goes
through the SDK Artifact gateway; no secrets/PII.

**Documentation:** Package `README.md` + JSDoc; ADR-0018; ADR index; `WORKER_V2_PROGRESS.md`
(task-phase 17 → done, with the Phase Retrospective; M10 → PDF exporter complete).

**Testing:** **26 new tests** — config (defaults, full config, unsupported-value rejection, canonical
identity); generator (channel→colour-space packing, PDF structure, fixed Producer + no dates, PDF
version + bleed + crop marks, flate smaller + filter, byte-identical determinism, config-changes-bytes);
validation (uniform/inconsistent pages, PDF structure accept/reject); processor end-to-end (successful
export + descriptor, metadata embedding + override, page ordering; failures: malformed Document,
missing page reference, inconsistent page sizes, unsupported config); determinism + artifact identity
(byte-identical PDF + same content address; different config → different Artifact; replay-stable
descriptor). `pnpm verify` green (**662 total**, 27 packages).

**Breaking Changes:** None.

**Migration Notes:** None. A real pipeline wires the processor into the coordinator's resolver against
the real content-addressed store, feeding Documents whose pages are real composed page Artifacts.
Additional exporters (preview/print-package/archival) follow the same architecture — an SDK processor
consuming the same immutable Document.

**ADR References:** **ADR-0018**.

**Commit References:** _(recorded at commit — branch `worker-v2/phase-12-processor-sdk`)._

---

### v0.0.0 — 2026-07-24 — Document Assembly Platform (task-phase 16)

> Delivers the immutable, content-addressable, format-INDEPENDENT layer that assembles rendered
> Page Artifacts into a complete printable document model — the bridge between rendering and export.
> Generates no PDF, renders no pages, performs no storage/networking, introduces no business logic.
> Future exporters (PDF/preview/print-package) consume the same immutable Document as independent
> Processor-SDK processors; the platform is unaware of them.

**Added:**
- **`@workerv2/document`** — the Document Assembly Platform:
  - **Document aggregate + contracts** — a schema-versioned immutable `Document`: ordered pages
    (each a content-addressed Page Artifact reference + kind + optional surface provenance),
    document metadata, a print profile (settings), print metadata, and assembly configuration.
  - **Document Builder** — `buildDocument(source)`: assembles page IDENTITIES (never bytes), applies
    deterministic assembly defaults, routes through the single validation gate, computes the
    canonical form + hash, and freezes. Invalid/incomplete documents are never produced.
  - **Validation** — `validateDocument` (invariants D1–D8): schema version, complete metadata, valid
    + contiguous page ordering, no duplicate indices, present (well-formed) page artifact
    references, consistent print settings, consistent cover. Reconstructs a clean deep-frozen
    document (unknown keys dropped).
  - **Canonical serialization** — `serializeDocument`/`parseDocument` (round-trip stable; canonical
    form recomputed on parse, never trusted).
  - **Content-addressable identity** — `hashDocument` = `sha256:<hex>` over the canonical form,
    derived exclusively from ordered page identities + metadata + print config; equivalent documents
    hash identically; byte-compatible with artifact addressing (the Document is itself an artifact).
  - **Document Manifest** — `toDocumentManifest`: the ordered page-reference listing.
  - **Document Descriptor** — `describeDocument`: a deterministic, JSON-safe record (identity +
    ordered page refs + print profile + metadata + assembly config) for replay/debug/validate/audit/
    future export.
  - **Test harness** — `sampleDocumentSource`/`samplePageInputs`/`fakePageKey`/`SAMPLE_PRINT_PROFILE`.
- **ADR-0017** — the model-platform decision, pages-by-identity, structural format independence,
  canonical identity/determinism, and validate-gates-construction (+ rejected alternatives).

**Changed:** workspace wiring (tsconfig/vitest/boundaries + lockfile) for `document`. Nothing else —
the package is a downstream leaf; no existing package imports it yet.

**Removed:** Nothing (purely additive).

**Performance:** Pure data assembly + a single sha256 over the canonical form; no rendering, no I/O.

**Security:** Full validation at the construction boundary (unknown keys dropped; bounded strings /
counts / dimensions); no storage/networking; the Document references pages by content address only;
no secrets/PII; deterministic (no timestamps/randomness).

**Documentation:** Package `README.md` + JSDoc; ADR-0017; ADR index; `WORKER_V2_PROGRESS.md`
(task-phase 16 → done, with the Phase Retrospective; M10 → page compositor + document model).

**Testing:** **25 new tests** — construction (derived page count, assembly defaults, cover-first,
canonical form + hash); page ordering (sort-by-index, order-independent identity); document manifest
projection; validation failures (incomplete metadata, empty pages, missing/malformed artifact,
duplicate indices, non-contiguous indices, inconsistent print settings, inconsistent/duplicate
cover); canonical hashing (sha256 format, equivalent → identical, differing → different, print
metadata participates); serialization symmetry (round-trip + key-order independence); descriptor
generation (records identity + ordered refs + profile + metadata + assembly; pure); deterministic
identity + **replay consistency** (byte-identical builds; replay from canonical → same identity +
descriptor + manifest); immutable behavior (deep-frozen; mutation throws). `pnpm verify` green
(**636 total**, 26 packages).

**Breaking Changes:** None.

**Migration Notes:** None. The PDF/preview/print-package **export processors** are the next work,
built with the Processor SDK, each consuming the immutable `Document` (this phase deliberately builds
none). A render/assemble stage feeds real composed page Artifacts as the document's pages.

**ADR References:** **ADR-0017**.

**Commit References:** _(recorded at commit — branch `worker-v2/phase-12-processor-sdk`)._

---

### v0.0.0 — 2026-07-24 — Page Composition Engine (task-phase 15)

> Delivers the deterministic compositor that transforms a Blueprint surface + normalized image
> Artifacts into a rendered, content-addressed page Artifact. Consumes only Blueprint data +
> Artifacts; produces immutable page rasters; pixel work runs through the replaceable ImageBackend
> (future GPU acceleration). No PDF generation, no album packaging, no vendor/printing logic, no
> storage of its own.

**Added:**
- **`@workerv2/composition`** — the Page Composition Engine:
  - **`LayerStack` compositor** (`rasterizeStack`) — background fill, layer stack + **z-ordering**
    (stable), **transform application** (orthogonal rotate + fit `fill`/`cover`/`contain`),
    **clipping**, grayscale **masks** (per-pixel alpha), **frame** borders, **minimal blend modes**
    (`normal`/`multiply`/`screen`, source-over integer sRGB), **page rasterization** to one RGBA
    raster.
  - **Blueprint adapter** — `surfaceToLayerStack`/`findSurface`/`placementsOf`/`rectToPixels`/
    `surfaceArtifacts`: the only reader of blueprint data; placements → image layers (destination =
    normalized frame → pixels; z = canonical order; clip = destination); text nodes are not
    rasterized. Non-blueprint attributes come from deterministic `SurfaceCompositionOptions`.
  - **`CompositionEngine`** — `composeSurface(blueprint, surfaceId, target, options)`: resolve each
    placement's image Artifact (decode via the Pixel Gateway) → build stack → rasterize → validate →
    produce a content-addressed page Artifact. `rasterize(stack)` exposes the pure compositor path.
  - **`Canvas`** — the backend-free RGBA buffer with the isolated composite/blend + frame loop.
  - **Transform application** — `fitRaster`/`toRgba` over any `ImageBackend`.
  - **Validation** — `validateLayerStack` (pre-rasterize) + `validateComposedPage` (pre-produce).
  - **Colour/blend primitives** — `compositePixel`/`fillRgba`/`clampByte` + `WHITE`/`TRANSPARENT`.
- **ADR-0016** — the LayerStack-vs-direct decision, the adapter-only-reads-blueprint boundary,
  transforms-behind-ImageBackend (GPU seam), determinism/content-addressing, text-out-of-scope, and
  validate-gates-production (+ rejected alternatives).

**Changed:** workspace wiring (tsconfig/vitest/boundaries + lockfile) for `composition`. Nothing
else — the package is a downstream leaf; no existing package imports it yet.

**Removed:** Nothing (purely additive).

**Performance:** Pure JS per-pixel composite loop (determinism over throughput; transforms run
through the backend, so a GPU backend accelerates them). Whole-page in-memory rasterization.

**Security:** No I/O beyond the injected byte port; the rendered page is validated before it is ever
produced (no malformed page Artifact); no storage/PDF/vendor surface; no secrets/PII.

**Documentation:** Package `README.md` + JSDoc; ADR-0016; ADR index; `WORKER_V2_PROGRESS.md`
(task-phase 15 → done, with the Phase Retrospective; M10 → page compositor complete).

**Testing:** **43 new tests** — colour/blend (normal/multiply/screen, opacity, alpha accumulation,
clamp/fill); compositor (background, placement, z-order, opacity, blend, clipping, masks, frames,
orthogonal rotate); fit (fill/cover/contain dims + padding/opacity); validation (stack + composed
page gates); blueprint adapter (rect→pixels, surface lookup, placements→layers, unresolved artifact,
surfaceArtifacts); engine end-to-end (blueprint surface → page Artifact, decode round-trip,
background fill, error paths); **determinism** (byte-identical over a rotate+fit+mask+frame+blend
pipeline; same content address across independent stores; different background → different page).
`pnpm verify` green (**611 total**, 25 packages).

**Breaking Changes:** None.

**Migration Notes:** None. A later render/assemble processor drives `CompositionEngine` (the
`surface.render` manifest node); the PDF/print artifact stage consumes composed pages separately; a
future theme resolver can populate per-layer compositing attributes; a text layer type + font engine
is reserved behind the same `LayerStack`.

**ADR References:** **ADR-0016**.

**Commit References:** _(recorded at commit — branch `worker-v2/phase-12-processor-sdk`)._

---

### v0.0.0 — 2026-07-24 — Native Image Backend (task-phase 14)

> Delivers the replaceable, framework-independent pixel-processing backend future image processors
> use for DETERMINISTIC image transformations, plus the Pixel Gateway that produces immutable,
> content-addressed raster Artifacts. Ships a pure-TS deterministic reference backend; a native/GPU
> (sharp/libvips) backend is a reserved drop-in behind the SAME contracts. No album knowledge, no
> page rendering, no PDF, no product logic, no coordinator dependency.

**Added:**
- **`@workerv2/image-backend`** — the Native Image Backend:
  - **Backend contract** — `ImageBackend` (`decode`/`encode`/`resize`/`rotate`/`crop`/`convert`/
    `apply`/`validate`): a small, total, pure interface; the replaceable seam every backend
    implements.
  - **Deterministic reference backend** — `ReferenceImageBackend` (`info.deterministic = true`),
    pure TypeScript: decode of the canonical **WV2R** container + uncompressed **BMP** (24/32-bit);
    **resize** (nearest/bilinear, center-aligned + `Math.round`); **rotate** (90/180/270 lossless
    permutation); **crop**; **colour convert** (channel layout + sRGB↔linear transfer LUTs +
    Rec.601 grayscale — the deterministic ICC-family transforms); **output validation**.
  - **Pixel Gateway** — `PixelGateway(backend, store)`: read → decode → apply operation pipeline →
    **validate** → produce a content-addressed raster Artifact through a narrow `ArtifactBytesPort`
    (structurally compatible with the SDK's `ArtifactGateway`; identical output → same key).
  - **Raster IO** — `encodeRaster`/`decodeRaster` (WV2R: fixed byte order, uncompressed, no padding
    → encoded bytes are a pure function of pixels), `decodeBmp`, `validateRaster`.
  - **Operations** — declarative `ImageOperation` union (`resize`/`rotate`/`crop`/`convert`) +
    `validateOperation`.
  - **Backend test harness** — `runImageBackendContract` (the reusable suite every backend, incl. a
    future sharp/GPU backend, must pass) + `InMemoryArtifactBytesStore` + raster fixture builders
    (`makeRaster`/`solidRaster`/`gradientRaster`).
- **ADR-0015** — the reference-vs-sharp decision, the pure `ImageBackend` contract, the
  container+BMP pixel source, the narrow artifact port, and validate-before-produce (+ rejected
  alternatives).

**Changed:** workspace wiring (tsconfig/vitest/boundaries + lockfile) for `image-backend`. Nothing
else — the package is a downstream leaf; no existing package imports it yet.

**Removed:** Nothing (purely additive).

**Performance:** The reference backend favours determinism over raw throughput (pure JS loops, no
SIMD); high-throughput transforms are the reserved native backend's concern. Whole-raster in-memory
processing; no streaming yet.

**Security:** Fully bounds-checked byte parsing (a malformed container/BMP → a clean `BackendError`,
never a throw-through); output validation gates production so no malformed pixel Artifact can be
created; no I/O beyond the injected byte port; no native binary, no file paths, no storage-backend
assumptions.

**Documentation:** Package `README.md` + JSDoc; ADR-0015; ADR index; `WORKER_V2_PROGRESS.md`
(task-phase 14 → done, with the Phase Retrospective; M7 → foundation processors + pixel backend).

**Testing:** **40 new tests** — raster IO (WV2R round-trip + determinism + colour-space/channel
preservation + truncation/geometry rejects; BMP 24/32-bit BGR→RGB + bottom-up + backend decode);
transforms (crop in/out-of-bounds; rotate 90/180/270 permutations + 270∘90 inverse + dimension
swap; resize nearest replication + same-size identity copy + bilinear determinism; grayscale luma +
gray↔rgb + add/drop alpha + sRGB↔linear fixed points); gateway (decode→transform→produce +
content-addressed idempotence + invalid-raster/invalid-op rejects + pure `applyOperations`);
**determinism** (two backends byte-identical over a 6-op pipeline; same content address across
independent stores; different ops → different output) + the reusable `runImageBackendContract`
suite against the reference. `pnpm verify` green (**568 total**, 24 packages).

**Breaking Changes:** None.

**Migration Notes:** None. A native/GPU (`sharp`/libvips) backend is a drop-in behind `ImageBackend`
(validated by `runImageBackendContract`); the image foundation processors' normalization plans wire
to real pixel work via `PixelGateway`; a host passes one concrete content-addressed store to both
the gateway's `ArtifactBytesPort` and the SDK's `ArtifactGateway`.

**ADR References:** **ADR-0015**.

**Commit References:** _(recorded at commit — branch `worker-v2/phase-12-processor-sdk`)._

---

### v0.0.0 — 2026-07-24 — Image Foundation Processors (task-phase 13)

> Delivers the FIRST concrete processors — generic, deterministic image normalization + metadata
> extraction, built WITH the Processor SDK, over content-addressed Artifacts, INDEPENDENT of album
> rendering. No album knowledge, no page composition, no PDF, no layout, no storage/R2 assumptions,
> no native codec. The heavy pixel transcode is a native backend deferred behind the same contract.

**Added:**
- **`@workerv2/image-processors`** — the six Image Foundation Processors, each a single
  transformation built on `createProcessor` (`descriptor` + `execute`):
  - **`image.validate`** (`image` → `report`) — recognized + allowed format, structurally
    decodable, within byte/dimension limits INCLUDING a **decompression-bomb pixel guard**; a valid
    image yields a `ValidationReport`, an invalid one a `permanent` failure.
  - **`image.decode`** (`image` → `decoded`) — structural decode to a `DecodedImage`: geometry, bit
    depth, channels, colour type, alpha, ICC presence. (Not a pixel decode — that is deferred.)
  - **`image.metadata`** (`image` → `metadata`) — what the file declares: format, dimensions, and
    EXIF (orientation, capture date, make/model) into an `ImageMetadata`.
  - **`image.exif-orientation`** (`decoded` + `metadata` → `oriented`) — the transform mapping the
    source EXIF orientation onto the canonical display orientation (1) + the resulting dimensions.
  - **`image.color-normalize`** (`decoded` → `color`) — the plan to bring the raster into the
    canonical sRGB working space + whether a conversion is required.
  - **`image.format-normalize`** (`decoded` → `format`) — the canonical delivery container (alpha →
    PNG, else JPEG; config can force a target) + whether a transcode is required.
  - **Pure library** (`lib/`) — a bounds-checked `ByteReader`; `detectFormat` (magic bytes);
    `decodeImage` (PNG/JPEG/GIF/BMP/WebP/TIFF header geometry + colour, HEIC best-effort `ispe`);
    `extractMetadata`; `parseExif` (JPEG APP1 + TIFF IFD reader, orientation/make/model/date);
    orientation math; pure `Result`-returning config parsers. **No native codec, no ambient
    time/randomness/env** — deterministic + cross-platform.
  - **Registration surface** — per-processor factories (`createImage*Processor(deps)`) + the
    aggregate `createImageFoundationProcessors(deps)` + `imageFoundationProcessorSpecs`, wiring each
    to a host `ArtifactGateway` for the execution adapter's resolver. `IMAGE_ENGINE_VERSION` stamps
    every descriptor + processor version (version-freeze discipline).
- **ADR-0014** — the descriptor-transformation (vs native-codec) decision, the six-processor shape,
  content-addressed determinism, and the deferred pixel backend (+ five rejected alternatives).

**Changed:** workspace wiring (tsconfig/vitest/boundaries + lockfile) for `image-processors`.
Nothing else — the package is a downstream leaf that produces `Processor`s; no existing package
imports it.

**Removed:** Nothing (purely additive).

**Performance:** Header-only parsing (no full pixel decode), whole-bytes artifact I/O; descriptors
are small canonical-JSON Artifacts. No perf-sensitive paths.

**Security:** Deterministic byte parsing is fully bounds-checked (a malformed container → a clean
parse failure / `permanent` reject, never a throw-through); the decompression-bomb pixel guard
caps declared dimensions; metadata carries only image facts (no secrets/PII beyond what the file
declares); no I/O beyond the injected gateway; no file paths, URLs, or storage-backend assumptions.

**Documentation:** Package `README.md` + JSDoc; ADR-0014; ADR index; `WORKER_V2_PROGRESS.md`
(task-phase 13 → done, with the Phase Retrospective; M7 → foundation processors complete).

**Testing:** **42 new tests** — library (format detection across 6 formats + null; PNG/JPEG/GIF/
BMP/TIFF/WebP dimensions + colour + ICC; EXIF orientation 1–8, make/model/date, TIFF, garbage-safe;
metadata; orientation math); processors (validate accept/report, unrecognized/bomb/allow-list/
byte-cap/bad-config rejects; decode success + undecodable + missing-input; metadata; exif-orientation
chained on decode+metadata incl. swap + default-1 + wrong-schema reject; color-normalize sRGB plan +
ICC/grayscale conversion; format-normalize alpha→PNG/else→JPEG + force-target + invalid-target
reject); **determinism** (byte-identical content address across independent runs; different input →
different address) + registry surface. `pnpm verify` green (**528 total**, 23 packages).

**Breaking Changes:** None.

**Migration Notes:** None. The native pixel-transcode backend (canonical master + derivatives) is a
follow-up implemented behind the SAME `Processor` contract and wired to a host `ArtifactGateway`
over the real content-addressed store; the render/assemble processors follow. Register these
processors into the adapter's resolver via `createImageFoundationProcessors(deps)`.

**ADR References:** **ADR-0014**.

**Commit References:** _(recorded at commit — branch `worker-v2/phase-12-processor-sdk`)._

---

### v0.0.0 — 2026-07-23 — Processor SDK (task-phase 12)

> Delivers the reusable framework future processors are built with to execute Manifest work while
> staying INDEPENDENT of rendering technologies. Implements no concrete processor, no rendering,
> no PDF, no image processing; operates exclusively on content-addressed Artifacts; depends on no
> storage implementation and no file-path API.

**Added:**
- **`@workerv2/processor-sdk`** — the Processor SDK:
  - **Base Processor abstraction** — `createProcessor(spec, deps)`: the single construction entry
    point. The author supplies a descriptor, optional `requiredInputs`/`validate`, and an
    `execute(ctx) → Record<slot, StorageKey>`; the base runs the consistent lifecycle around it.
  - **Processor lifecycle** — report progress → validate inputs → guard cancellation/deadlines →
    execute → validate produced outputs against the declared slots (reusing the engine's shared
    `validateProcessorOutputs`). Every failure (guard trip, validation abort, output mismatch,
    unexpected throw) becomes an in-band `StepFailure` OUTCOME — never an escaping exception.
  - **Processor Context** — the ergonomic execution surface: `input`/`hasInput`/`read`/`readText`/
    `readJson`, `produce`/`produceText`/`produceJson`, `reportProgress`, `debug`/`info`/`warning`/
    `error`, and a `guard`. Byte- and content-address-oriented — no paths, no URLs.
  - **Artifact access helpers** — the `ArtifactGateway` port (`read`/`exists`/`write`): read an
    input Artifact by content address, produce a new one (content-addressed, write-once,
    idempotent). NO storage backend is assumed; the SDK owns this narrow port.
  - **Progress reporting** (`ProgressReporter` + `ProgressUpdate`/`ProgressReport`) and
    **Diagnostics hooks** (`DiagnosticsSink` + `DiagnosticEvent`/`Diagnostic`) — replaceable sinks
    stamped with the attempt's identity; no `console`.
  - **Resource guards** — `ResourceGuard`: cooperative `throwIfCancelled`/`throwIfExpired`/
    `check()`; cancellation polled from the engine-owned signal, the deadline compared against an
    INJECTED clock (no ambient time, no timer). A trip becomes a `cancelled`/`timeout` failure.
  - **Validation helpers** — `requireInputs`/`requireInput`/`requireConfig(parse)`/`ensure`, all
    failing via a `permanent` `ProcessorAbort`; config schemas stay OUT of the SDK.
  - **SDK contracts** — `ArtifactGateway`, `ProgressReporter`, `DiagnosticsSink`, `Clock` +
    `ProcessorAbort`/`abortPermanent`/`abortTransient`.
  - **Processor test harness** — `ProcessorHarness` (+ `InMemoryArtifactGateway`,
    `RecordingProgressReporter`, `RecordingDiagnosticsSink`): seed input Artifacts, run a
    processor against a built `ProcessingContext`, and inspect the outcome, produced Artifacts,
    progress, and diagnostics — the reusable scaffolding for every future processor.
- **ADR-0013** — the base-processor + narrow artifact-port + injected-sinks + guards + harness
  decisions (+ rejected alternatives).

**Changed:** workspace wiring (tsconfig/vitest/boundaries + lockfile) for `processor-sdk`.
Nothing else — the SDK is upstream of the engine; nothing else changed.

**Removed:** Nothing (purely additive).

**Performance:** In-memory helpers; whole-bytes artifact I/O (a streaming port is additive for
very large artifacts). No perf-sensitive paths.

**Security:** No secrets/PII; no I/O beyond the injected gateway. A processor that throws is
contained (normalized to a `transient` failure); diagnostics/aborts carry only JSON-safe detail.
No file paths, URLs, or storage-backend assumptions anywhere in the surface.

**Documentation:** Package `README.md` + JSDoc; ADR-0013; ADR index; `WORKER_V2_PROGRESS.md`
(task-phase 12 → done; the SDK unblocks the Image and Render processor phases).

**Testing:** **16 new tests** — harness end-to-end (read input → produce output; progress phase
sequence validate→execute→execute→finalize with attempt identity; debug/info diagnostics;
multi-input merge; validated config; content-addressed idempotence); lifecycle + validation
(missing-input → permanent, config-abort → permanent, output-slot mismatch → permanent, thrown →
transient, warning diagnostic on failure); resource guards (cancellation → `cancelled`, deadline →
`timeout`, `ResourceGuard.remainingMs`/`expired`, gateway read/miss, `abortPermanent`/`Transient`
kinds, `requireConfig` accept/reject). `pnpm verify` green (**486 total**, 22 packages).

**Breaking Changes:** None.

**Migration Notes:** None. Concrete processors (image canonicalize/derive, surface render, album
assemble) are the next phases, built WITH this SDK and registered into the adapter's resolver; a
host wires the `ArtifactGateway` to the real content-addressed store and supplies the deadline
resolver from the step's timeout policy.

**ADR References:** **ADR-0013**.

**Commit References:** _(recorded at commit — branch `worker-v2/phase-12-processor-sdk`)._

#### Phase Retrospective (task-phase 12)

- **Architectural decisions.** (1) A base processor runs one consistent lifecycle so every future
  processor is a small `execute` + descriptor and inherits validation, progress, diagnostics,
  guards, and failure normalization — no boilerplate, no drift; output conformance reuses the
  engine's `validateProcessorOutputs`. (2) Artifact access is a narrow SDK-owned `ArtifactGateway`
  port (bytes + content address only), so a processor depends on NO storage implementation and
  knows nothing of R2/paths/URLs; a host adapts its real store to it. (3) Progress/diagnostics are
  injected sinks and cancellation/deadlines are cooperative guards against an injected clock — the
  SDK reads no ambient time and arms no timer. (4) Every failure becomes an in-band `StepFailure`
  outcome with a meaningful kind, so a processor can never crash the driver and retry semantics
  stay the engine's. (5) A full test harness ships with the SDK so processor phases start with
  scaffolding, not a blank page.
- **ADRs.** ADR-0013 (accepted), incl. rejected alternatives (no framework, reuse the full
  `ArtifactStore` as the processor surface, throw-for-failure, SDK-owned real-timer deadlines).
- **Scope adjustments.** None against the task scope. The SDK is deliberately minimal: whole-bytes
  artifact I/O (a streaming gateway is additive when a processor needs very large artifacts), no
  config-schema library (only the `requireConfig` gate; schemas live with each processor), and the
  harness gateway uses a non-cryptographic `mem:` address (a test double; real gateways use sha256).
- **Remaining risks.** The concrete image/render/assemble processors are the next phases and must
  keep all rendering/PDF/image logic in THEM, never leaking into the SDK; a host must wire the
  gateway to the real store and derive deadlines from the step timeout policy; a streaming artifact
  port is a future additive extension.
- **Reusable abstractions.** `createProcessor` + the lifecycle runner is the template every
  processor uses; `ProcessorContext` is the one execution surface; `ArtifactGateway`/
  `ProgressReporter`/`DiagnosticsSink` are the host-wired ports; `ResourceGuard` is the
  cancellation/deadline pattern; `ProcessorAbort` + `requireInputs`/`requireConfig`/`ensure` are
  the validation vocabulary; and `ProcessorHarness` is the ready-made test rig for every future
  processor phase.

### v0.0.0 — 2026-07-23 — Execution Adapter (task-phase 11)

> Delivers the concrete single-process infrastructure adapter that DRIVES the pure Coordinator
> (ADR-0011): it invokes processors through contracts, feeds results back, persists journals
> through an interface, and publishes execution events — with the Coordinator staying completely
> pure and deterministic. NO processors, rendering, PDF, image processing, or storage/DB/queue/
> network/R2 implementation; no business logic.

**Added:**
- **`@workerv2/execution-adapter`** — the infrastructure adapter (all side effects live here):
  - **Execution Driver + Effect Loop** — `runToCompletion` / `pump` / `executeRun`: a tiny,
    sequential loop that per sweep ticks due timeouts, asks the Coordinator which nodes are
    dispatchable NOW, and for each (in the Coordinator's canonical order) negotiates → resolves →
    dispatches → invokes → reports, then waits out retry backoff between sweeps. It re-orders and
    decides NOTHING — the journal it produces is byte-identical to the pure Coordinator's own
    driver output (test-proven determinism).
  - **Processor Dispatcher** — `invokeProcessor`: the single call site of `Processor.process()`;
    returns the outcome unchanged, normalizing only a THROW into a `transient` `StepFailure` so
    the loop always gets in-band data and the Coordinator's retry policy decides.
  - **Processor Resolver** — `InMemoryProcessorRegistry implements ProcessorResolver`: holds
    caller-INJECTED processors by name (+ exact/wildcard version policy). The adapter implements
    no processor.
  - **Capability Negotiator** — `DefaultCapabilityNegotiator`: the concrete implementation of the
    runtime's reserved `CapabilityNegotiator` seam (interfaces-only until now). Negotiates each
    node's required capabilities against the host's offers BEFORE dispatch; unmet → a permanent
    step failure (Coordinator fail-fast takes over). Minimal deterministic version policy
    (undefined/`*` = any; else exact) — richer semver ranges additive behind the same interface.
  - **Execution Session** — `ExecutionSession`: one run's stateful holder and the ONLY place a
    Coordinator step's side effects apply — advance the held state, PERSIST the journal entries,
    PUBLISH the events (persist-then-publish; the journal is the source of truth). A Coordinator
    rejection (out-of-sequence command) surfaces as an `AdapterError`.
  - **Tick Driver** — `tickIfDue` / `nextWakeAt`: advance injected time (drive a `tick` when a
    timeout budget elapsed) and report the earliest future wake instant (retry backoff / timeout)
    so a host resumes without polling. No timer armed.
  - **Adapter contracts** — replaceable seams `Clock`, `Waiter`, `JournalStore`, `EventSink` +
    references `systemClock`/`manualClock`, `immediateWaiter`/`clockAdvancingWaiter`,
    `InMemoryJournalStore`, `InMemoryEventSink`/`noopEventSink`/`publisherSink`.
  - **Execution validation** — `validateExecutable`: the pre-flight gate (every node's processor
    resolves AND its capabilities negotiate) — mis-wiring becomes an up-front error.
- **ADR-0012** — the effect/purity boundary, replaceable seams, injected-processors, and the
  concrete capability-negotiation policy (+ rejected alternatives).

**Changed:** workspace wiring (tsconfig/vitest/boundaries + lockfile) for `execution-adapter`.
Nothing else — the Coordinator and every upstream package are untouched (the adapter depends on
them; nothing depends on the adapter).

**Removed:** Nothing (purely additive).

**Performance:** In-memory reference seams; the loop is O(work) with one processor invocation per
attempt; no perf-sensitive paths. Durable/parallel backends tune later behind the same interfaces.

**Security:** No secrets/PII; no networking/DB/storage. A processor that throws is contained
(normalized to a transient failure) so a misbehaving injected processor cannot crash the driver;
`AdapterError` carries only JSON-safe context.

**Documentation:** Package `README.md` + JSDoc; ADR-0012; ADR index; `WORKER_V2_PROGRESS.md`
(task-phase 11 → done; the Coordinator now has a concrete driving adapter).

**Testing:** **24 new tests** — end-to-end diamond + Manifest runs to a succeeded run (journal
persisted, events published, `coordinator.resume` reconstructs the exact state, `coordinator.validate`
passes); deterministic journal (identical across runs + exact canonical kind sequence); resume a
partial journal and finish; already-settled run is a no-op; retry-with-backoff to success (via the
clock-advancing waiter); permanent fail-fast + skip; thrown-processor normalization; unmet-capability
permanent failure; processor dispatcher (outcome pass-through + throw normalization); registry
resolve (name/version/wildcard/missing/duplicate); negotiator (satisfied/unmet/version/empty);
`validateExecutable` (accept / missing processor / unmet capabilities / manifest-with-offers);
tick driver (`nextWakeAt` earliest backoff, `tickIfDue` no-op); session (persist+publish on start,
coordinator-rejection → `AdapterError`). `pnpm verify` green (**470 total**, 21 packages).

**Breaking Changes:** None.

**Migration Notes:** None. Concrete processors (image / render-PDF / assemble) are built in their
own phases and REGISTERED into the resolver; durable `JournalStore` / bus-backed `EventSink` /
distributed driver drop in behind the existing seams without touching the Coordinator.

**ADR References:** **ADR-0012**.

**Commit References:** _(recorded at commit — branch `worker-v2/phase-11-execution-adapter`)._

#### Phase Retrospective (task-phase 11)

- **Architectural decisions.** (1) A hard effect/purity split: the Coordinator decides, the
  adapter performs — the driver relays Coordinator decisions unchanged, so a `manualClock`-driven
  run's journal is byte-identical to the pure Coordinator's, which is how "decisions unchanged" is
  a test, not a hope. (2) Every side effect is a replaceable seam (`Clock`/`Waiter`/`JournalStore`/
  `EventSink`), and `ExecutionSession` is the single funnel that applies a step's effects — so a
  distributed/durable adapter swaps seams without touching the Coordinator API. (3) The adapter
  implements no work and no policy: processors are injected; `invokeProcessor` only relays,
  normalizing a throw to a transient failure so the Coordinator's retry policy stays authoritative.
  (4) The runtime's reserved `CapabilityNegotiator` seam is filled with a minimal, deterministic
  exact-or-wildcard policy, negotiated before dispatch.
- **ADRs.** ADR-0012 (accepted), incl. rejected alternatives (fold the driver into the Coordinator,
  parallel dispatch by default, ship a `setTimeout` waiter, adapter-side retry/output logic, full
  semver-range negotiation now).
- **Scope adjustments.** None against the task scope. The reference driver is deliberately
  single-process and serial (deterministic + easy to reason about); a distributed/parallel adapter
  and durable seam backends are additive follow-ups behind the same interfaces. Waiting between
  retry sweeps is a `Waiter` seam (deterministic `clockAdvancingWaiter` for tests; a wall-clock
  waiter is a one-line host impl) so the package ships timer-free.
- **Remaining risks.** The reference seams are in-memory/ambient (`systemClock` is the sole ambient
  reference) — durable backends are the drop-in; the default `immediateWaiter` does not advance a
  clock, so retry-backoff runs need a clock-advancing/wall-clock waiter (guarded by `maxSweeps`);
  one-active-run (INV-6) is the Control Plane Run Registry's job, consulted by a host before a
  session is created; real end-to-end album production still waits on the injected image/render
  processors (RSK-1 lifts when those land).
- **Reusable abstractions.** The `ExecutionSession` "apply one Coordinator step → persist + publish"
  funnel is the template every future adapter reuses; `JournalStore`/`EventSink`/`Clock`/`Waiter`
  are the seam set a durable or distributed adapter re-implements; `InMemoryProcessorRegistry` +
  `DefaultCapabilityNegotiator` are the resolver/negotiator any host starts from; `invokeProcessor`
  (throw-normalizing) is the safe processor call site; `validateExecutable` is the pre-flight gate
  for any driver.

### v0.0.0 — 2026-07-23 — Coordinator Platform (task-phase 10)

> Delivers the frozen Pipeline & Coordinator phase's **Coordinator/engine** (M11 — Pipeline
> Ready): the deterministic execution coordinator that orchestrates Manifest/Pipeline execution
> WITHOUT performing any processing. Consumes a Manifest; produces execution DECISIONS + a
> recorded history only. No processor execution, rendering, PDF, image processing, artifact
> loading, storage, queue, networking, or timers (time is injected).

**Added:**
- **`@workerv2/coordinator`** — the Coordinator Platform, a pure, event-sourced deterministic
  reducer:
  - **Execution State model** — `ExecutionState`: immutable, serializable snapshot of a run
    (run status + per-node `NodeExecution` records keyed by Manifest node id, the primary
    execution identity, + the fold counter `seq`). Holds no topology (the `ExecutionGraph`) and
    no history (the journal), so it stays small and reconstructable.
  - **Run + node state machines** — the run REUSES the Control Plane `RUN_MACHINE` (INV-8: one
    source of truth); the per-node `NODE_MACHINE` (`pending → ready → running →
    succeeded|failed|cancelled|skipped`, with `running → ready` for a retry) is enforced on
    every journal fold — illegal transitions are unrepresentable.
  - **Execution graph** — `buildExecutionGraph` derives immutable topology (canonical Kahn
    order + stages + dependency/dependent adjacency + terminal nodes) once from a validated
    `ProcessingPipeline`.
  - **Execution Journal** — `JournalEntry`/`JournalKind` + `applyJournalEntry`: the SINGLE,
    validating, total state-mutation function. Every command decides entries and folds them —
    state is always the fold of the journal.
  - **Dependency scheduler + Ready Queue** — `computeReadyQueue`: a pure query returning
    deterministically-ordered `dispatchable` nodes (ready, backoff elapsed, run live, within an
    optional declarative `maxInFlight`) and `waiting` nodes gated by a retry `readyAt`.
  - **Node Lifecycle + Context** — `dispatch` marks a new attempt running and returns the
    resolved `ProcessingContext` (`buildProcessingContext` resolves step-output bindings from
    recorded upstream outputs + frozen version pins + injected start time). `validateProcessors`
    accepts a `ProcessorResolver` to check resolvability — the coordinator NEVER calls `process`.
  - **Retry Orchestrator** — reuses processing's shared `planFailureAction`, so retry semantics
    never drift from the pipeline model. A retry is a `node.retry-scheduled` entry whose backoff
    is a FUTURE `readyAt` (never a timer).
  - **Timeout State tracking** — dispatch records `attemptDeadline`/`overallDeadline` as pure
    offsets of the injected start; `dueTimeouts(now)` reports elapsed budgets and `tick(now)`
    converts them into `timeout` failures via the orchestrator. No timer fires.
  - **Cancellation propagation** — `requestCancellation` begins a cancel drain (un-started nodes
    cancelled immediately; in-flight nodes settle; run finalizes once quiescent).
  - **Progress model** — `progressOf`: a pure projection (counts by state, terminal fraction,
    settled flags).
  - **Event publication contracts** — `ExecutionEvent` + `ExecutionEventPublisher` seam; events
    are DERIVED from journal entries (`execution.<kind>`), so the published stream and recorded
    history can never disagree. Distinct from Control Plane domain events (INV-12).
  - **Resume model** — `resumeFromJournal`: re-fold a persisted journal into the EXACT prior
    state (INV-7 crash recovery, no drift); a tampered journal (out-of-order seq, illegal
    transition, unknown node) is rejected.
  - **Replay model** — `describeReplay`/`seedReplay`: the semantics of **Retry / Replay /
    Rebuild / Regenerate** (Rec 18) as data + a seed. `retry` reuses succeeded outputs and
    re-runs only the rest; `replay`/`rebuild` seed a clean run on the SAME frozen versions;
    `regenerate` is a documented seam (a new manifest needs a new coordinator).
  - **Coordinator validation** — `validateExecutionState`: the untrusted-state gate (node set
    matches the graph, the dependency rule holds, success records outputs, run status agrees
    with node states).
  - **Coordinator façade** — `createCoordinator` binds a run's graph + frozen `VersionSet` and
    exposes the pure transition/query API; `coordinatorFromManifest` bridges a compiled Manifest
    via `toPipeline` (ADR-0010). Holds no mutable state — any infrastructure adapter
    (single-process, distributed, queue-backed) drives it through the same public API.
- **ADR-0011** — deterministic Coordinator decisions (event-sourced reducer, no infrastructure,
  injected time, Manifest via the pipeline bridge; + rejected alternatives).

**Changed:** workspace wiring (tsconfig/vitest/boundaries + lockfile) for `coordinator`. Nothing
else — processing/manifest/control-plane are untouched (reused, not modified).

**Removed:** Nothing (purely additive).

**Performance:** Pure in-memory reducers/queries; scheduling is O(V+E) over the graph per query;
no perf-sensitive paths, no I/O.

**Security:** No secrets/PII; no I/O of any kind. Untrusted resumed/checkpointed states pass the
validation gate; journals are validated on fold (contiguous seq + legal transitions); event
payloads/journal detail documented JSON-safe.

**Documentation:** Package `README.md` + JSDoc; ADR-0011; ADR index; `WORKER_V2_PROGRESS.md`
(frozen Pipeline & Coordinator phase → ✅ 100%, M11 complete).

**Testing:** **36 new tests** — end-to-end diamond + Manifest runs to a succeeded run;
determinism (identical journals/states); contiguous seq; resolved `ProcessingContext`
(step-output inputs + versions + config); event derivation; dispatch/output/start preconditions;
scheduler (arming, canonical parallel order, `maxInFlight`, draining); node machine legality;
journal-fold guards (out-of-order seq, illegal transition, unknown node); retry orchestrator
(transient backoff `readyAt`, budget-exhaustion fail-fast + skip, permanent-never-retried);
timeout tracking (deadlines, `dueTimeouts`, `tick`); cancellation (drain + finalize, immediate
finalize, node self-cancel, cannot-cancel-settled); resume (terminal + partial re-fold equality,
tamper rejection); replay (semantic table, retry seed reuses outputs, replay/rebuild/regenerate);
validation (consistent accept, dependency/pipeline-id/incomplete-success rejections). `pnpm
verify` green (**446 total**, 20 packages).

**Breaking Changes:** None.

**Migration Notes:** None. No processors execute yet — an infrastructure adapter (a later phase)
supplies the effect loop (dispatch → `processor.process` → report; feed `tick`; persist the
journal; forward events) and drives the coordinator through its public API.

**ADR References:** **ADR-0011**.

**Commit References:** _(recorded at commit — branch `worker-v2/phase-10-coordinator`)._

#### Phase Retrospective (task-phase 10)

- **Architectural decisions.** (1) The coordinator is a PURE, event-sourced reducer: the
  append-only journal is the single state-mutation path (`applyJournalEntry`), so state is always
  the fold of the journal — which makes Resume a provably-driftless re-fold (INV-7) and removes
  any second state-writer that could diverge from history. (2) No infrastructure coupling: time
  is injected, retry backoff is a future `readyAt`, timeouts are pure offsets applied by `tick`,
  and the boundary checker proves zero runtime/storage/queue/network deps — adapters drive the
  coordinator, the coordinator drives nothing. (3) Reuse over re-derivation: the run machine is
  the Control Plane's `RUN_MACHINE`, retry semantics are processing's shared `planFailureAction`,
  ordering is `orderStepGraph`, and the context is `makeProcessingContext` — the same
  reuse-not-duplicate philosophy the manifest applied to processing (ADR-0010). (4) The core
  binds a pipeline (drives ANY pipeline) and consumes a Manifest through the lossless
  `toPipeline` bridge — orchestration stays completely separate from processing.
- **ADRs.** ADR-0011 (accepted), incl. rejected alternatives (stateful in-place coordinator,
  coordinator-executes-processors, timer/scheduler engine, bespoke retry vocabulary,
  journal-inside-state).
- **Scope adjustments.** None against the task scope. This completes the frozen Pipeline &
  Coordinator phase's engine half (the declarative half landed in task-phase 6). Mapping note:
  concrete DRIVING adapters (single-process/distributed/queue-backed) and a concrete
  `CapabilityNegotiator` are deliberately NOT built — the coordinator is designed so they attach
  without changing its public API. Fail-fast is the failure policy; per-branch partial completion
  is a future additive option. `maxInFlight` is advisory scheduling data, not enforced concurrency.
- **Remaining risks.** The effect loop lives in a future adapter — until one exists, no processor
  runs (RSK-1 stays: background processing paused). One-active-run (INV-6) is enforced by the
  Control Plane's Run Registry, which the driving adapter must consult before starting a run;
  the coordinator drives a single bound run. Replay is semantics + seed, not a full replay UX.
- **Reusable abstractions.** The event-sourced reducer pattern (journal = single mutation path →
  free resume) is the template for any future stateful-but-deterministic subsystem; the
  `applyJournalEntry` fold + `validateExecutionState` gate mirror the house
  compile→gate→canonicalize pattern for STATE rather than values; `ExecutionGraph` +
  `computeReadyQueue` give any DAG a deterministic scheduler; the coordinator's journal + events
  are the exact data the Observability phase (Phase 10) records for run-graph/timeline/cost.

### v0.0.0 — 2026-07-23 — Manifest Platform (task-phase 9)

> Delivers the frozen Manifest phase (M9 — Manifest Ready): the immutable, deterministic,
> content-addressable representation of EXECUTABLE WORK derived from Blueprints — the render
> contract (INV-1) and the INV-3 enabler. Consumes Blueprints; produces work DESCRIPTIONS
> only. No execution, no scheduling, no rendering.

**Added:**
- **`@workerv2/manifest`** — the Manifest Platform:
  - **Manifest model + contracts** — `Manifest` (schema version + album id + the source
    blueprint's content hash as PROVENANCE + id-sorted work nodes) and `WorkNode`: a DAG
    node that EXPLICITLY declares consumed artifacts (named slots → content-addressed
    `ArtifactInputBinding`s) and produced output slots, the processor by registry NAME
    (data, never code), required runtime capabilities, JSON-safe config, and declarative
    policies. **Processing Framework contracts REUSED, not duplicated**: node ids are
    `StepId`s, bindings/capabilities/retry/timeout/cancellation/failure are
    `@workerv2/processing`'s own types.
  - **Manifest compiler** — `compileManifest(blueprint, options)`: the canonical
    blueprint-intent → processing-intent translation. One `surface.render` node per surface
    (cover + each spread), consuming the BLUEPRINT ITSELF as a content-addressed artifact
    (key = its own hash — ADR-0008 makes "blueprint as artifact" free) plus that surface's
    placed images, producing one `page`; one `album.assemble` node consuming every page
    output (semantic surface order preserved in config) producing the final `album`. Stable
    DERIVED node ids (`render:<surfaceId>`, `assemble:album`). Optional uniform declarative
    policy overrides. Output routed through the full validation gate, then canonicalized,
    hashed, deep-frozen → `CompiledManifest { manifest, hash, canonical, trace? }`.
  - **Processing graph + dependency graph** — validation reuses `orderStepGraph` (M11
    acyclicity); `orderManifest` exposes the canonical total order + parallel stages;
    `terminalNodes` names the deliverables.
  - **Artifact bindings** — explicit per node (`consumes`/`produces`); M7 proves every
    step-output binding resolves to a DECLARED output of an EXPLICIT dependency (no dangling
    bindings); `consumedArtifacts` (deduped, sorted external content addresses — includes
    the blueprint) and `producedOutputs` give the platform-level views. Self-contained: an
    engine needs the manifest + the artifact store, nothing else.
  - **Manifest validation** — `validateManifest(unknown)` (invariants M1–M11): schema
    version, album id, blueprint provenance hash shape, unique/sorted node ids, node shape,
    strictly-ascending dependsOn/produces/requires, binding consistency, policies validated
    by the REUSED processing validators, acyclic graph. Nodes/policies are REBUILT from the
    known vocabulary — unknown keys are dropped and can never reach the identity.
  - **Canonical serialization** — `serializeManifest`/`parseManifest` (canonical JSON; full
    gate on parse; byte-stable round-trips; incoming key order/whitespace irrelevant).
  - **Manifest hashing** — `hashManifest` = `sha256:<hex>` over canonical UTF-8; identity
    depends ONLY on canonical manifest content; byte-compatible with artifact (ADR-0006) and
    blueprint (ADR-0008) addressing.
  - **Manifest versioning** — `MANIFEST_SCHEMA_VERSION` participates in canonical content (a
    schema bump changes every identity, by design); parse rejects unsupported versions.
  - **Manifest diff** — `diffManifests`: per-stable-node-id added/removed/changed (canonical
    node comparison), sorted + frozen + symmetric; `identical` also covers the envelope.
  - **Identity-neutral traces** — the `trace` compile option and `attachTrace` put
    provenance (e.g. future resolver-chain traces) on the `CompiledManifest` WRAPPER only —
    attachable/replaceable without ever affecting canonical form or hash (test-proven).
  - **Processing bridge** — `toPipelineSpec`/`toPipeline`: a lossless structural mapping
    into a validated `ProcessingPipeline` via `definePipeline` (pipeline id embeds the
    manifest hash), proving by construction that every manifest is consumable by the
    declarative processing model; `compileExecutionPlan` over the bridged pipeline yields
    the same stages as `orderManifest` (test-proven).
- **ADR-0010** — manifest shape/translation/self-containment/trace decisions (+ rejected
  alternatives: standalone vocabulary, pipeline-as-manifest, embedded blueprint content,
  hashed traces, per-image nodes).

**Changed:** workspace wiring (tsconfig/vitest/boundaries + lockfile) for `manifest`.
Nothing else — blueprint/processing/product are untouched.

**Removed:** Nothing (purely additive).

**Performance:** Pure in-memory compile/validate/hash; linear passes + sorts at manifest
scale; sha256 over a canonical string per identity computation. No perf-sensitive paths.

**Security:** No secrets/PII; no I/O. Untrusted manifests pass the full invariant gate
before existing as values; unknown keys are structurally dropped (nothing smuggled toward
engines); artifact references validated to content-address shape; policies bounded by the
processing validators' ceilings.

**Documentation:** Package `README.md` + JSDoc; ADR-0010; ADR index; `WORKER_V2_PROGRESS.md`
(frozen Manifest phase → done, M9 complete).

**Testing:** **40 new tests** — compiler (canonical translation structure: per-surface
render nodes, blueprint-as-artifact bindings, assemble wiring + semantic surface order,
stable ids, cover-less variant, determinism/recompile identity, deep-freeze, default +
override policies, invalid-override rejection); traces (compile-time + `attachTrace`,
identity/canonical invariance); validation invariants M1–M11 individually violated
(incl. dangling bindings, undeclared outputs, binding-without-dependsOn, non-JSON config,
cyclic graph); serialization (byte-stable round-trip, key-order/whitespace independence,
unknown-key dropping, unparseable JSON); identity (format, content-only, semantic-change
sensitivity, wrapper consistency); graph views (stages, consumed artifacts incl. blueprint,
produced outputs, terminal nodes); processing bridge (lossless mapping, execution-plan
stage equality); diff (identical/added/removed/changed/symmetry/envelope-only).
`pnpm verify` green (**410 total**, 19 packages).

**Breaking Changes:** None.

**Migration Notes:** None. The render engine (frozen Phase 8) is the future consumer: it
binds `surface.render`/`album.assemble` and consumes a manifest alone (INV-3). The
coordinator (frozen Phase 9 remainder) consumes manifests through the pipeline bridge.

**ADR References:** **ADR-0010**.

**Commit References:** _(recorded at commit — branch `worker-v2/phase-9-manifest`)._

#### Phase Retrospective (task-phase 9)

- **Architectural decisions.** (1) The manifest REUSES the Processing Framework's contracts
  (ids, bindings, policies, capabilities, DAG ordering) instead of duplicating them — retry/
  cancellation semantics stay single-sourced, and the pipeline bridge becomes a lossless
  structural mapping proven by `definePipeline` + `compileExecutionPlan`. (2) The canonical
  translation binds the BLUEPRINT ITSELF as a consumed artifact (key = its content hash),
  making the manifest self-contained (INV-3) without duplicating blueprint content inside
  it. (3) Identity = canonical manifest content only; the validation gate REBUILDS values
  from the known vocabulary so unknown keys can never reach the hash; provenance traces ride
  the compiled WRAPPER (`attachTrace`) and are identity-neutral by construction. (4) Stable
  derived node ids (`render:<surface>`, `assemble:album`) — the fourth application of the
  house pattern — keep the diff model trustworthy across recompilations.
- **ADRs.** ADR-0010 (accepted), incl. rejected alternatives (standalone policy vocabulary,
  pipeline-as-manifest, embedded blueprint subtrees, hashed traces, per-image prep nodes).
- **Scope adjustments.** None against the task scope. The translation vocabulary is
  deliberately minimal (2 processors, `page`/`album` outputs) — richer work shapes
  (thumbnails, previews, per-image derivations, pre-press variants) are additive node kinds
  behind a schema-version bump, per ADR-0010.
- **Remaining risks.** The render engine must honor the processor-name + config contract
  (`config.surface`/`config.surfaces`) — mitigated by the constants being exported as the
  shared vocabulary; per-node policy overrides are uniform for now (per-processor
  differentiation is a compile-option extension); manifest version-registry freezing waits
  for runs pinning versions (INV-11 bridge exists in control-plane).
- **Reusable abstractions.** The compile→gate→canonicalize→hash→freeze pattern is now the
  proven house style (blueprint → product → manifest); the identity-neutral wrapper
  (`CompiledManifest.trace`) is the template for attaching provenance to ANY content-addressed
  value; `orderStepGraph` proved reusable as a cross-package DAG validator; the
  bridge-to-pipeline technique (embed the content hash in the pipeline id) gives any future
  work-producing platform an execution path for free.

### v0.0.0 — 2026-07-23 — Product Platform (task-phase 8)

> Delivers the frozen Product phase's DEFINITION + RESOLUTION core (Rec 2/4/15): the
> immutable, versioned, content-addressable product definition system that resolves products
> into `BlueprintSource` inputs for the Blueprint Platform. No rendering, no layout, no
> execution, no storage.

**Added:**
- **`@workerv2/product`** — the Product Platform:
  - **Product model** — `ProductDefinition`: stable lowercase-token id + semver + name +
    dimensions (mm) + page-count offering + `hasCover` + material OPTION AXES (closed,
    validated vocabularies with defaults) + constraints + capabilities. Immutable: any change
    is a NEW version; (id, version) names a definition, the content hash addresses it.
  - **Product validation** — `validateProduct(unknown)` (invariants P1–P10: schema version,
    token id, semver, bounded name/dimensions, strictly-ascending page counts, canonical
    option/constraint/capability order, referential integrity of constraints) — the ONLY way
    a definition exists. `defineProduct` = the validating constructor: canonicalizes every
    NON-semantic ordering, stamps the schema version, routes through the gate, deep-freezes.
  - **Product catalog** — `ProductCatalog`: an immutable, VERSIONED value (own semver;
    products in canonical (id, version) order; C1–C5 gate + `defineCatalog` constructor).
    Multiple versions of a product coexist; `getProduct` resolves exact-or-latest via the
    deterministic `compareSemver`; `listProducts` yields stable (id, version, hash) refs.
  - **Canonical serialization + hashing** — `serializeProduct`/`parseProduct` +
    `serializeCatalog`/`parseCatalog` (canonical JSON; incoming key order/whitespace never
    trusted — full gate on parse; byte-stable round-trips) and `hashProduct`/`hashCanonical`
    (`sha256:<hex>` over canonical UTF-8 — byte-compatible with artifact (ADR-0006) and
    blueprint (ADR-0008) addressing, so a canonical definition stored as an artifact gets a
    key equal to its own hash).
  - **Product constraints** — declarative constraint DATA (`requires-option` /
    `excludes-option` coupling + `max-placements-per-spread` / `max-texts-per-spread` limits)
    with a pure interpreter: `resolveSelection` (defaults applied, vocabulary + coupling
    verified) and `spreadLimits` (strictest wins).
  - **Product capabilities** — `ProductCapability` declarations structurally IDENTICAL to the
    runtime's `CapabilityRequirement` / processing's `StepCapabilityRequirement` (no import —
    consumable by any engine); pure helpers (`missingCapabilities`, `requiredCapabilityNames`).
  - **Product versioning** — deterministic `compareSemver` total order; `productVersionRef`
    (id + version + hash); `productVersionPins` bridging to the control plane's `VersionSet`
    (INV-11) so a run pins the product it resolved.
  - **Product resolver + resolver chain + resolver contracts** — `resolveProduct(catalog,
    request, chain)`: catalog lookup → selection resolution → the chain (each `SourceResolver`
    is a PURE, named + versioned transformation of the draft source; order is SEMANTIC;
    provenance recorded) → structural re-copy (drops unknown keys, shares nothing) → the
    PRODUCT GATE the chain cannot escape (cover presence, page-count sum, per-spread limits,
    albumId untouched) → deep-frozen `ProductResolution { product, productHash, selection,
    resolvers, source, pins }`. **Resolution produces `BlueprintSource` — never a
    `Blueprint`** — and makes NO layout/rendering decision (frames pass through untouched,
    test-proven byte-identical).
  - **Compatibility model** — `CompatibilityMatrix`: a versioned, first-match rule matrix
    binding product (id/version or `*`) → compatible processing-profile ids (OPAQUE tokens —
    the profile registry is a later deliverable), required runtime capabilities, and
    blueprint schema versions. `checkCompatibility` → deterministic verdict with exact
    per-facet reasons; matrix is canonical, serializable, content-hashable.
- **ADR-0009** — Product Platform identity/resolution/compatibility decisions (+ rejected
  alternatives: mutable records, resolution-to-Blueprint, blueprint→product dependency,
  constraints-as-code, semver-range matching).

**Changed:** workspace wiring (tsconfig/vitest/boundaries + lockfile) for `product`. Nothing
else — `@workerv2/blueprint` is untouched (verified: no reverse import; boundary-enforced).

**Removed:** Nothing (purely additive).

**Performance:** Pure in-memory validation/resolution/hashing; linear passes + sorts at
catalog scale; sha256 over a canonical string per identity computation. No perf-sensitive paths.

**Security:** No secrets/PII; no I/O. Untrusted definitions/catalogs/matrices pass full
invariant gates before existing as values; resolution structurally re-copies content (unknown
keys dropped — nothing smuggled toward the compiler); resolver chains are re-verified against
the product so third-party resolvers cannot bypass product rules.

**Documentation:** Package `README.md` + JSDoc; ADR-0009; ADR index; `WORKER_V2_PROGRESS.md`
(frozen Product phase → definition + resolution core done).

**Testing:** **67 new tests** — validating constructors (canonicalization, freeze, equivalent
inputs → identical definitions), invariants P1–P10 + C1–C5 individually violated, catalog
resolution (exact/latest, numeric semver ordering, duplicate rejection), serialization
(byte-stable round-trips, key-order/whitespace independence), identity (format, content-only,
semantic-change sensitivity), versioning (compareSemver, refs, INV-11 pins), constraints
(defaults, requires/excludes, strictest limit), resolution (happy path, **compiles through the
unchanged blueprint compiler deterministically**, frame pass-through, caller-mutation
isolation, unknown-key dropping, cover/page-sum/limit enforcement, chain order semantics +
provenance, chain-cannot-escape-gate, resolver failure propagation, chain metadata rejection),
compatibility (first-match, wildcard, per-facet reasons, round-trip, hashing). `pnpm verify`
green (**370 total**).

**Breaking Changes:** None.

**Migration Notes:** None. Nothing consumes product resolutions yet — future consumers: the
frozen Blueprint phase's layout/template/theme resolvers (they implement `SourceResolver`),
the manifest phase, and runs pinning product versions via `VersionSet`.

**ADR References:** **ADR-0009**.

**Commit References:** _(recorded at commit — branch `worker-v2/phase-8-product`)._

#### Phase Retrospective (task-phase 8)

- **Architectural decisions.** (1) Dual identity: (id, version) NAMES an immutable definition;
  the sha256 content hash ADDRESSES it — pins stay honest because a pinned version can never
  silently change meaning. (2) Resolution produces `BlueprintSource`, never a `Blueprint`, and
  the dependency points product → blueprint only — the compiler remains the single validation
  authority and blueprint identity stays independent of catalog internals. (3) Constraints and
  compatibility are DATA with pure interpreters, so definitions/matrices stay serializable,
  hashable, and diffable. (4) The resolver chain re-verifies its final output against the
  product (same one-gate philosophy as the blueprint compiler): a third-party resolver cannot
  produce an out-of-contract source. (5) Capability shapes stay structurally identical to the
  runtime's negotiation contract without importing it (same technique as processing).
- **ADRs.** ADR-0009 (accepted), incl. rejected alternatives (mutable catalog records,
  resolution-to-Blueprint, inverted dependency, constraints-as-code, semver-range matching).
- **Scope adjustments.** None against the task scope. Mapping note: this is the frozen Product
  phase's definition + resolution core; the processing-profile REGISTRY (Rec 7), pricing
  versions, and vendor-profile data (WBS 6.2.1–6.2.3) are NOT built — the compatibility matrix
  already references profile ids as opaque tokens, so the registry lands additively later.
- **Remaining risks.** The constraint vocabulary is minimal (option coupling + per-spread
  limits) — richer rules are additive constraint kinds behind a product schema-version bump;
  `compareSemver` is a deterministic total order, not full SemVer precedence (documented);
  material taxonomy lives per-definition (no global registry) until vendor-profile work needs
  one.
- **Reusable abstractions.** The validating-constructor + single-gate + canonical-order
  pattern (third use: blueprint → catalog → matrix) is now the house style for versioned
  value systems; `SourceResolver` is the extension seam every future layout/template/theme
  resolver implements; `hashCanonical` gives any canonical value content addressing;
  `productVersionPins` is the template for bridging platform versions into `VersionSet`.

### v0.0.0 — 2026-07-23 — Blueprint Platform (task-phase 7)

> Delivers the frozen Blueprint phase's MODEL + COMPILER (Rec 3's "blueprint" half): the
> immutable, deterministic, content-addressable representation of everything that must be
> produced for an album. No rendering, no execution, no storage.

**Added:**
- **`@workerv2/blueprint`** — the Blueprint Platform:
  - **Model + graph** — a typed containment TREE: `album` root → optional `cover` + ordered
    `spread`s → `placement`s (content-addressed artifact + normalized frame) and `text`s.
    Artifact-centric throughout (`StorageKey` identities; file paths structurally rejected).
  - **Stable identifiers** — every node id is DERIVED from structure (`album`, `cover`,
    `spread:NNNN`, `<parent>:placement:<slot>`, `<parent>:text:NNNN`) and validation enforces
    the derivation (I7) — ids can never be random or drift, making diffs meaningful.
  - **Declarative compiler** — `compileBlueprint(source)`: consumes a domain-shaped source,
    computes no layout, makes no rendering decisions; canonicalizes placement order by slot
    (declaration order NON-semantic) while spread/text order stays SEMANTIC; routes its own
    output through the full validation gate; returns a deep-frozen
    `CompiledBlueprint { blueprint, hash, canonical }`.
  - **Validation (invariants I1–I10)** — `validateBlueprint(unknown)`: supported schema
    version, valid album id, unique + sorted node ids, exactly one album root, **no dangling
    references**, containment is a tree with full reachability, stable ids, contiguous spread
    indexes (cover first), unique+sorted placement slots (placements before texts), normalized
    frames, bounded text. The ONLY way a `Blueprint` value exists.
  - **Canonical serialization** — `serializeBlueprint` (canonical JSON: sorted keys, semantic
    array order) + `parseBlueprint` (never trusts incoming form — full gate; round-trip
    byte-stable). `canonicalJson` promoted to `@workerv2/utils` (additive).
  - **Hashing / identity** — `hashBlueprint` = `sha256:<hex>` over canonical UTF-8 bytes;
    identity depends ONLY on canonical content; byte-compatible with artifact addressing
    (ADR-0006) — storing a canonical blueprint as an artifact yields key === hash (test-proven
    cross-check; no storage import).
  - **Versioning** — `BLUEPRINT_SCHEMA_VERSION` participates in canonical content (a schema
    bump changes every identity, by design); parse rejects unsupported versions.
  - **Diff model** — `diffBlueprints`: per-stable-id added/removed/changed (canonical node
    comparison), sorted + frozen + symmetric-by-construction.
  - **Graph helpers** — `walkBlueprint` (deterministic DFS), `referencedArtifacts` (deduped,
    sorted), `totalPages`.
- **`@workerv2/utils`** — `canonicalJson` (deterministic serialization primitive, additive).
- **ADR-0008** — blueprint identity/ordering/validation decisions (+ rejected alternatives).

**Changed:** workspace wiring (tsconfig/vitest/boundaries) for `blueprint`; utils index exports
`canonicalJson`.

**Removed:** Nothing (purely additive).

**Performance:** Pure in-memory compile/validate/hash; linear passes + one sort; sha256 over a
canonical string per identity computation. No perf-sensitive paths.

**Security:** No secrets/PII; no I/O; artifact references validated to content-address shape;
untrusted serialized blueprints pass the full invariant gate before existing as values.

**Documentation:** Package `README.md` + JSDoc; ADR-0008; ADR index; `WORKER_V2_PROGRESS.md`
(frozen Blueprint phase → model + compiler done).

**Testing:** **42 new tests** — compiler happy path (stable-id graph, canonical children
order, no-cover variant), determinism (recompile identity; placement-order invariance;
spread-order sensitivity), deep-freeze immutability, source rejections (album id, title,
no-spreads, duplicate slots, malformed artifact key, slot token, frame bounds, pages, text
size); canonical serialization (repeat-stability, round-trip, key-order/whitespace
independence, unparseable JSON); identity (format, content-only, semantic-change sensitivity,
**artifact-platform byte-compatibility** incl. store round-trip); validation invariants I1–I10
individually violated on hand-built inputs; diff (identical/added/removed/changed/symmetry);
graph traversals (DFS order, artifact dedupe+sort, page totals); `canonicalJson` unit tests in
utils. `pnpm verify` green (**303 total**).

**Breaking Changes:** None.

**Migration Notes:** None. Nothing consumes blueprints yet — the manifest phase and the
resolvers (frozen Blueprint phase remainder) are the future consumers/producers.

**ADR References:** **ADR-0008**.

**Commit References:** _(recorded at commit — branch `worker-v2/phase-7-blueprint`)._

#### Phase Retrospective (task-phase 7)

- **Architectural decisions.** (1) Identity = sha256 of canonical JSON — content-addressable
  by construction, byte-compatible with artifact addressing so "blueprint as artifact" is free
  later (compatibility proven by test, not import — the package has zero storage dependency).
  (2) Stable ids are DERIVED from structure and enforced by validation — stability is a
  theorem, not a convention, which is what makes the per-id diff model trustworthy.
  (3) Ordering split explicitly: semantic (spread/text sequence) vs canonical (placement
  slots, node list) — equivalent sources always hash identically, meaningful reorderings
  always differ. (4) One validation gate; the compiler validates its own output — an
  invariant-violating blueprint is unrepresentable.
- **ADRs.** ADR-0008 (accepted), incl. rejected alternatives (UUID identities, author-chosen
  ids, storage-package dependency, order-insensitive hashing).
- **Scope adjustments.** None against the task scope. Mapping note: this is the frozen
  Blueprint phase's model + compiler; the resolver chain (layout/template/theme) and catalogs
  are NOT built — they are future additive PRODUCERS of `BlueprintSource`, and blueprint/
  template/theme version freezing into the version registry lands with them.
- **Remaining risks.** Node vocabulary is deliberately minimal (no stickers/QR/styling yet) —
  additive kinds require a schema-version bump which changes all identities (by design, but a
  migration moment); frames forbid bleed overflow until pre-press requirements arrive; schema
  N-1 parse support is undefined until a 2.0.0 exists.
- **Reusable abstractions.** `canonicalJson` (utils — any canonical-form need),
  `validateBlueprint` (the gate future resolvers compile against), `BlueprintSource` (the
  resolver-chain output contract), the diff model (Run Explorer / replay blast-radius
  analysis later), `referencedArtifacts` (manifest building + retention/GC analysis),
  blueprint-as-artifact (identity-equal storage) for the manifest/render phases.

---

### v0.0.0 — 2026-07-23 — Processing Framework (task-phase 6)

> Delivers the DECLARATIVE half of the frozen Pipeline phase (INV-5): the generic processing
> model later rendering, PDF, image, and manufacturing pipelines execute. Pure data + pure
> functions — no execution engine, no scheduling, no business logic.

**Added:**
- **`@workerv2/processing`** — the framework-independent declarative processing model:
  - **Step model (artifact-centric)** — `ProcessingStep`/`ProcessingStepSpec`: processor by
    NAME + compatible version range (engine-resolved later), named input slots bound via
    `fromArtifact(key)` (content address) or `fromStepOutput(stepId, output)` (symbolic upstream
    reference), declared output slots, capability requirements, per-step policies, JSON-safe config.
  - **Pipeline model** — `definePipeline(spec)`: the ONLY constructor. Validates ids/semver/slot
    names/policies, unique step ids, unknown/self/duplicate dependencies, step-output inputs
    reference **declared** outputs of steps the consumer **explicitly** dependsOn, and the
    dependency graph is a **DAG**. Deep-frozen; deterministic.
  - **Dependency-graph validation** — `orderStepGraph`: Kahn + lexicographic tie-breaking;
    longest-chain **stages** (mutually independent within a stage); canonical stage-monotonic
    flat order; unknown/self-dep/cycle rejection.
  - **Execution-plan model** — `compileExecutionPlan(pipeline)`: **total** (pipelines only exist
    validated) + deterministic; `ExecutionPlan` (order/stages/`PlannedStep`s) deep-frozen;
    declaration-order invariant (tested).
  - **Processing Context** — `makeProcessingContext`: immutable per-attempt data — RESOLVED
    artifact identities, expected output slots, config, frozen version pins (INV-11), injected
    `startedAt`, engine-owned `CancellationSignal` (not frozen; `NEVER_CANCELLED` neutral value).
  - **Retry model** — `RetryPolicy` (none/fixed/exponential + caps) validated declaratively;
    `delayBeforeAttempt` = pure math (no waiting).
  - **Timeout model** — `TimeoutPolicy` (attempt + overall budgets) validated; enforced by an
    engine later.
  - **Cancellation model** — `CancellationPolicy` (unsupported/cooperative/abortive + grace) +
    the read-only `CancellationSignal` contract.
  - **Failure model** — `FailureKind` (transient/permanent/timeout/cancelled), frozen
    `StepFailure` records, `FailurePolicy` (onPermanent locked to 'fail'), and the SHARED pure
    decision function `planFailureAction` → retry (with computed delay/next attempt) / fail /
    cancelled — so failure semantics can never drift between engines.
  - **Processor contracts** — `Processor` (context → explicit `ProcessorOutcome`),
    `ProcessorDescriptor`, `ProcessorResolver`, `validateProcessorOutputs` (exact-slot-match
    conformance shared by all engines).
  - **Capability requirements** — `StepCapabilityRequirement`, structurally IDENTICAL to the
    runtime's reserved `CapabilityRequirement` negotiation contract (compile-time-proven in
    tests) **without** a runtime dependency — engines feed step requirements straight into a
    future `CapabilityNegotiator`.
- **ADR-0007** — declarative processing framework decisions (+ rejected alternatives).

**Changed:** workspace wiring (tsconfig/vitest/boundaries) for `processing`.

**Removed:** Nothing (purely additive).

**Performance:** Pure in-memory validation/compilation; Kahn is O(V+E); no perf-sensitive paths.

**Security:** No secrets/PII; config/failure contexts documented JSON-safe; no new external
surface; no I/O of any kind.

**Documentation:** Package `README.md` + JSDoc; ADR-0007; ADR index; `WORKER_V2_PROGRESS.md`
(frozen Phase 9 → declarative model done).

**Testing:** **48 new tests** — retry/timeout/cancellation/failure policy validation +
deterministic delay math + the `planFailureAction` decision table; pipeline validation (happy
path, defaults, deep-freeze, determinism, capability/version carry-through, and 12 rejection
classes incl. cycles, undeclared outputs, missing dependsOn); graph/stage determinism
(declaration-order invariance, longest-chain staging); plan compilation (staging, immutability,
repeat + order invariance); context construction (freeze/defaults/live signal/spec isolation);
processor contracts (output conformance, contract-only implementability); runtime structural
compatibility (compile-time). `pnpm verify` green (**261 total**).

**Breaking Changes:** None.

**Migration Notes:** None. No execution engine exists yet — nothing consumes pipelines at run
time until the coordinator phase; all current consumers are definition-time.

**ADR References:** **ADR-0007**.

**Commit References:** _(recorded at commit — branch `worker-v2/phase-6-processing`)._

#### Phase Retrospective (task-phase 6)

- **Architectural decisions.** (1) The model is engine-neutral by construction: no runtime
  dependency — capability requirements are structurally compatible with the runtime's
  negotiation seam instead of imported, so local/distributed/replay engines all consume
  pipelines unchanged. (2) Artifact-centric I/O: steps bind content addresses or symbolic
  upstream outputs — with the write-once store (ADR-0006) this makes re-execution naturally
  idempotent. (3) Invalid pipelines are unrepresentable: one validating constructor
  (`definePipeline`), making plan compilation total and deterministic. (4) Declarative policies
  with exactly ONE shared interpretation point (`planFailureAction`) — semantics fixed now,
  execution later.
- **ADRs.** ADR-0007 (accepted), incl. rejected alternatives (runtime dependency, shipping a
  local executor, execution-time validation, file-path I/O).
- **Scope adjustments.** None against the task scope. Mapping note: this is the frozen Phase 9's
  declarative half delivered early as its own package; coordinator/scheduling/recovery/replay
  stay in the frozen Pipeline phase. Version-range MATCHING is deliberately not implemented
  (declared, opaque) — negotiation belongs to the engine per the runtime's reserved seam.
- **Remaining risks.** The engine will reveal whether the plan's stage model needs richer
  scheduling metadata (priorities, resource hints) — additive if so; `CancellationSignal` is
  poll-based (cooperative) — sufficient for INV-7-idempotent steps, revisit if push semantics
  are ever needed; capability negotiation semantics (range grammar) still undefined until the
  negotiator lands.
- **Reusable abstractions.** `orderStepGraph` (any DAG with deterministic staging),
  `planFailureAction`/`delayBeforeAttempt` (any retrying subsystem), `ProcessingContext` +
  `Processor` contracts (every processing platform: image, render/PDF, manufacturing),
  `validateProcessorOutputs` (engine conformance), `StepCapabilityRequirement` (negotiation
  input), the diamond-pipeline test fixture (engine tests later).

---

### v0.0.0 — 2026-07-23 — Artifact Platform (task-phase 5)

> Completes the content-addressed **byte** store deferred by ADR-0004/0005 — the last open piece
> of the frozen Storage & Immutable Artifact Platform. **M5 is now fully complete.**

**Added:**
- **`@workerv2/artifact-store`** — the concrete Artifact Platform on the Phase 3 storage contracts:
  - **Content addressing** — `Sha256ContentAddressing` (`sha256:<hex-digest>`), `hashBytes`/
    `formatStorageKey`/`digestOf`; deterministic, pinned by the published empty-content sha256
    test vector. Identity derives from bytes alone (INV-10) — backend-independent by construction.
  - **Replaceable backend seam** — `BlobStore` (`InMemoryBlobStore` reference): a deliberately dumb
    byte KV BELOW every guarantee, so a durable object store (e.g. R2) is a drop-in (WBS 5.1.1).
    Defensive copies isolate stored bytes from caller mutation.
  - **Write-once artifact store** — `ContentAddressedArtifactStore` (implements the new
    `StreamingArtifactStore`): `put` rejects mis-addressed content (`IntegrityError`) AND
    overwrites (`StorageError`, INV-2); `putContent`/`putStream` derive the key and are
    **idempotent** for byte-identical content (INV-7).
  - **Streaming interfaces** — `putStream` (incremental hashing; chunking never changes identity),
    `getStream` (bounded 64 KiB chunks), zero-byte stream handled.
  - **Integrity verification** — `Sha256IntegrityVerifier` (pure `Result`-based verify) +
    `getVerified` (read-time corruption guard).
  - **Artifact registry** — `InMemoryArtifactRegistry`: write-once content-address → descriptor
    index; conflicting re-registration rejected, identical re-registration a no-op (INV-7),
    descriptors deep-frozen; `byRun` lineage query.
  - **Provenance** — `describeArtifact(data, provenance, contentType?)`: single assembly point so
    key/digest/size can never disagree with the content; time injected via `provenance.createdAt`.
  - **Artifact validation** — `validateArtifactDescriptor` + `artifactDescriptorValidator`
    (untrusted-input boundary: shape + key⇄digest consistency + value-object parsing).
  - **Facade** — `ArtifactPlatform` (implements the Phase-3 `StorageAdapter`; backend injected).
- **`@workerv2/infra-contracts`** — byte-level artifact contracts (additive): `ArtifactByteStream`,
  `StreamingArtifactStore`, `ArtifactKind`/`ARTIFACT_KINDS`, `ArtifactProvenance` (Run + step +
  frozen version pins + source-asset lineage + injected `createdAt`), `ArtifactDescriptor`,
  `ArtifactRegistry`, `IntegrityVerifier`, and `IntegrityError`.
- **Reusable contract suite** — `runArtifactStoreContract(name, factory)`
  (`packages/artifact-store/test/contract/`): the compliance suite any future durable
  `StreamingArtifactStore` backend must pass.
- **ADR-0006** — content-addressed Artifact Platform decisions (+ rejected alternatives).

**Changed:** workspace wiring (tsconfig/vitest/boundaries) for `artifact-store`; `infra-contracts`
index/errors export the new contracts.

**Removed:** Nothing (purely additive).

**Performance:** Hashing is single-pass/incremental; reads return copies (immutability over micro-cost —
reference engine). `putStream` buffers in memory while hashing (a durable backend can spool);
registry queries are linear scans (index later if needed).

**Security:** No secrets/PII. Integrity-at-write + verified reads make corruption and mis-addressed
writes detectable; write-once semantics make tampering additive-only; validation guards untrusted
registry rows before they are trusted.

**Documentation:** Package `README.md` + JSDoc; ADR-0006; ADR index; `WORKER_V2_PROGRESS.md`
(frozen Phase 3 → ✅ 100%, M5 complete).

**Testing:** **50 new tests** — addressing determinism + known-vector + distinctness; the reusable
store contract (write-once, integrity-at-write, absent-key, streaming equivalence, idempotent
re-put); putContent idempotency; **backend-independence of identity** (two backends, same key);
byte-level immutability under caller mutation; corruption → `IntegrityError`; streaming round-trips
+ empty + large-chunked; registry write-once/idempotent/frozen/lineage; descriptor validation
(accept + 15 rejection branches); integrity verifier; platform end-to-end
(describe → put → register → verify → byRun). `pnpm verify` green (**213 total**).

**Breaking Changes:** None.

**Migration Notes:** None. The reference engine is in-memory; a durable `BlobStore`/registry
implements the same seams later — proven via `runArtifactStoreContract` — with no change above.

**ADR References:** **ADR-0006**.

**Commit References:** _(recorded at commit — branch `worker-v2/phase-5-artifact-platform`)._

#### Phase Retrospective (task-phase 5)

- **Architectural decisions.** (1) One addressing scheme (`sha256:<hex>`), namespaced into the key
  so future algorithms are additive. (2) The replaceable-backend seam is a *dumb* `BlobStore` with
  every guarantee (addressing, write-once, integrity, streaming) implemented ABOVE it — that is
  what makes artifact identity provably backend-independent. (3) Write-once split into two write
  modes: strict `put` (explicit key; rejects mismatch + overwrite) vs idempotent content-derived
  writes (`putContent`/`putStream`) — retry-safe by construction, no overwrite possible since
  identical bytes ⇒ identical identity. (4) Artifacts are first-class immutable objects: descriptor
  assembly lives in exactly one place (`describeArtifact`), provenance (Run / VersionSet pins /
  Processing Step / lineage / injected time) is typed and validated, and the registry is write-once
  with structural-idempotence.
- **ADRs.** ADR-0006 (accepted), recording the four decisions above plus rejected alternatives
  (UUID-addressed keys; strict-reject of identical re-writes; free-form provenance).
- **Scope adjustments.** None against the task scope. The task's "Phase 5" maps onto the frozen
  Phase 3 byte store (per the numbering note carried since task-phase 4) — completing M5 rather
  than starting the frozen Image Platform. WBS 5.2.2's *event wiring* (artifact writes → audited
  asset transitions) is deferred to the first producing pipeline, since both halves (Control-Plane
  transitions, artifact substrate) now exist and only a producer can connect them meaningfully.
- **Remaining risks.** Durable backends (BlobStore/registry/persistence) are still process-local —
  mitigated by the reusable contract suite; `putStream` buffers while hashing (spooling is a
  backend concern); registry lookups are linear (fine at reference scale); unreferenced-artifact
  archival/GC semantics reserved.
- **Reusable abstractions.** `BlobStore` (any byte backend), `runArtifactStoreContract` (backend
  compliance suite), `Sha256ContentAddressing`/`IntegrityVerifier` (any subsystem needing stable
  content identity), `ArtifactProvenance`/`ArtifactDescriptor`/`ArtifactRegistry` (render/image/
  manufacturing phases all attach lineage through these), `describeArtifact` (single descriptor
  assembly), `ArtifactByteStream` (platform-neutral streaming primitive).

---

### v0.0.0 — 2026-07-23 — Persistence Engine (task-phase 4)

> Completes the State Store deferred by ADR-0002/0004 — part of the frozen Storage phase (M5),
> **not** the frozen Product Platform.

**Added:**
- **`@workerv2/persistence`** — the concrete in-memory **State Store** on the Phase 3 contracts:
  - **Storage primitive** — generic, domain-ignorant `RecordTable<T>` (`InMemoryRecordTable`),
    isolating storage from persistence models so backends are interchangeable.
  - **Optimistic locking** — `TableTransaction` (versioned rows + identity map) → `ConcurrencyError`.
  - **Repositories** — `TransactionalAlbum/Asset/RunRepository`, returning domain aggregates via
    the explicit mappers (DTOs never escape; reconstruction via the domain so invariants hold).
  - **Unit of Work** — `InMemoryUnitOfWork` (atomic commit/rollback across repositories + audit +
    run-registry + artifact metadata) + `StateStore.transaction(...)` + `asPersistenceAdapter()`.
  - **Run Registry** — durable one-active-run enforcement (INV-6): domain pre-check + commit-time guard.
  - **Audit persistence** (append-only, INV-9) + **write-once artifact-metadata** persistence (INV-2/10).
  - **Infrastructure validation** — `validateAlbum/Asset/RunRecord` (unknown → DTO) + `Validator` objects.
- **`@workerv2/control-plane`** — domain-owned **reconstitution API**: `Album/Asset/Run.reconstitute(snapshot)`
  (rebuild from persisted state, no events, invariants enforced) + `*Snapshot` types.
- **`@workerv2/infra-contracts`** — concrete **inbound** mappers (`recordToAlbum/Asset/Run/Audit`)
  + ready-made `RecordMapper` objects (`albumMapper` …), completing the anti-corruption layer.
- **ADR-0005** — in-memory persistence engine + domain reconstitution.

**Changed:** workspace wiring (tsconfig/vitest/boundaries) for `persistence`; `infra-contracts` mapper module gained the inbound half; control-plane aggregates gained `reconstitute`.

**Removed:** Nothing (purely additive).

**Performance:** In-memory, single-process; optimistic-lock validation is O(changed rows). Reference engine — durable backends tune later.

**Security:** No secrets/PII; DTOs/records JSON-safe. Domain stays persistence-independent (verified — no persistence import in `control-plane`).

**Documentation:** Package `README.md` + JSDoc; ADR-0005; `WORKER_V2_PROGRESS.md` updated (Phase 3 storage → engine done, 85%).

**Testing:** **21 new tests** — save/load round-trips, **optimistic concurrency** (stale-update + insert-conflict), rollback atomicity, corrupt-record → `PersistenceError`, **Run Registry INV-6** (block + release + different-albums), audit append + rollback, artifact write-once, infra validation, domain reconstitution, and **serialization-symmetry** (save → load → save). `pnpm verify` green (**163 total**).

**Breaking Changes:** None.

**Migration Notes:** None. The engine is in-memory (process-local); a durable backend implements the same contracts later without changes above the `RecordTable` seam.

**ADR References:** **ADR-0005** (in-memory reference engine; reconstitution owned by the domain; storage isolated from models).

**Commit References:** _(recorded at commit — branch `worker-v2/phase-4-persistence`)._

---

### v0.0.0 — 2026-07-22 — Phase 3 · Infrastructure Contracts & Persistence Foundation

**Added:**
- **`@workerv2/infra-contracts`** — the abstraction layer between the pure domain and future
  infrastructure (contracts + DTOs + outbound mappers + infra events; **no** concrete storage/DB):
  - **Repositories** — `Repository<T,Id>` + `AlbumRepository`/`AssetRepository`/`RunRepository`
    (return domain objects only), `RunStateQuery` (read side of INV-6), append-only `AuditSink` (INV-9).
  - **Unit of Work / Transactions** — generic `UnitOfWork` (transactional `RepositoryFactory`),
    `Transaction`, `TransactionManager.withUnitOfWork(...)`.
  - **Repository factory** — `RepositoryToken` + `repositoryToken()`; tokens `ALBUM_/ASSET_/RUN_REPOSITORY`.
  - **DTOs** — `AlbumRecord`/`AssetRecord`/`RunRecord`/`AuditRecordDto` (flat, JSON-safe persistence models).
  - **Mappers (anti-corruption layer)** — `RecordMapper<D,R>` contract + concrete **outbound**
    mappers (`albumToRecord`/`assetToRecord`/`runToRecord`/`auditToRecord`). Inbound is contract-only.
  - **Storage contracts** — write-once, content-addressed `ArtifactStore` (INV-2/INV-10),
    `StorageKey`, `ContentAddressing`, `StorageAdapter`.
  - **Adapter seams** — `PersistenceAdapter`, `StorageAdapter`.
  - **Infra technical events** — `INFRA_EVENTS` + `makeInfraEvent` (INV-12) + `TechnicalEventSink`.
  - **Validation contracts** — `Validator<T>` + `valid`/`invalid`.
- **Runtime:** interfaces-only capability **version-negotiation** hooks
  (`CapabilityRequirement`/`Offer`/`NegotiationResult`/`CapabilityNegotiator`) — additive.
- **ADR-0004** — Phase 3 delivers infrastructure contracts, not implementations.

**Changed:** workspace wiring (tsconfig/vitest/boundaries) for `infra-contracts`; runtime index re-exports the negotiation contracts.

**Removed:** Nothing (purely additive).

**Performance:** Pure contracts + deterministic mappers/factories; no perf-sensitive paths.

**Security:** No secrets/PII; DTOs/events JSON-safe; no new external surface. Domain stays infrastructure-independent (verified — no infra import in `control-plane`).

**Documentation:** Package `README.md` + JSDoc on every public export; ADR-0004; `WORKER_V2_PROGRESS.md` updated (Phase 3 → contracts done, M5).

**Testing:** **19 new tests** — outbound mappers, infra events + validation, and the persistence/storage contracts exercised via in-memory **test doubles** (repositories, unit of work, transaction manager, write-once artifact store) + a reference capability negotiator. `pnpm verify` green (**142 tests total**).

**Breaking Changes:** None.

**Migration Notes:** None. Concrete persistence/storage adapters + domain reconstitution (inbound mappers) are deferred to a later phase (ADR-0002 + ADR-0004).

**ADR References:** **ADR-0004** (contracts-not-implementations; deferred concrete store + reconstitution; negotiation hooks).

**Commit References:** _(recorded at commit — branch `worker-v2/phase-3-infra-contracts`)._

---

### v0.0.0 — 2026-07-22 — Phase 2 · Worker Runtime Platform

**Added:**
- **`@workerv2/runtime`** — the generic hosting framework (no domain behavior, no jobs, no coordinator):
  - **`Runtime`** — build with injected `now`/`nextId` (deterministic); `create()` validates the
    dependency graph and fails fast; `start()`/`stop()` are **idempotent** and drive services in
    deterministic dependency order.
  - **Lifecycle** — `RUNTIME_MACHINE` (`created → starting → running → stopping → stopped`, `+ failed`).
  - **Service registry + dependency graph** — `ServiceRegistry`, `orderServices` (Kahn's algorithm,
    name-sorted tie-breaking; rejects missing deps + cycles).
  - **Capability registry** — `CapabilityRegistry` (de-duplicated, name-sorted).
  - **Plugin framework** — `Plugin`/`PluginContext`/`applyPlugins` (additive registration of
    services + capabilities + DI bindings; no concrete plugins — those are Phase 16).
  - **DI integration** — `createRuntimeContainer` + `LoggerToken`/`ConfigToken`/`MetadataToken`.
  - **Runtime metadata** — immutable `RuntimeMetadata`; **config** — `readRuntimeConfig` (injected env).
  - **Health integration** — `buildRuntimeHealth` over `@workerv2/health`.
  - **Technical events** — `TechnicalEventBus` (sync, isolated listeners) + `RUNTIME_EVENTS` (INV-12).
- Workspace wiring for the new package; **ADR-0003** (runtime dependency boundary + plugin-framework scope).

**Changed:** `worker/tsconfig.json`, `worker/vitest.config.ts`, `worker/scripts/check-boundaries.mjs` extended for `runtime`.

**Removed:** Nothing (purely additive).

**Performance:** In-memory hosting; deterministic startup ordering; no perf-sensitive paths.

**Security:** No secrets/PII; event payloads JSON-safe; runtime introduces no new external surface.

**Documentation:** Package `README.md` + JSDoc on every public export; ADR-0003; `WORKER_V2_PROGRESS.md` updated (Phase 2 → Done, M4).

**Testing:** **23 new tests** (config/metadata, lifecycle machine, dependency graph, registries, plugins, event bus, and end-to-end `Runtime` start/stop/idempotency/health/failure). `pnpm verify` green (**123 tests total**).

**Breaking Changes:** None.

**Migration Notes:** None. The runtime hosts nothing yet (no services/plugins ship in-tree); it is the framework later phases plug into.

**ADR References:** **ADR-0003** — Runtime dependency boundary & plugin framework scope. (Runtime depends on `control-plane` for generic contracts only; framework now, concrete plugins Phase 16.)

**Commit References:** _(recorded at commit — branch `worker-v2/phase-2-runtime`)._

---

### v0.0.0 — 2026-07-22 — Phase 1 · Control Plane & Domain Lifecycles

**Added:**
- **`@workerv2/control-plane`** — the pure Control Plane **domain** (framework-independent,
  immutable, deterministic, no I/O; depends only on `contracts`/`utils`/`errors`):
  - **Value objects** — branded ids (`AlbumId`/`AssetId`/`RunId`/`ActorId`/`EventId`/`AuditId`),
    `Timestamp` (injected; no `Date.now`), `Actor`, `DomainContext`.
  - **State machines** — generic `defineStateMachine` engine + `ALBUM_MACHINE` (Rec 13),
    `ASSET_MACHINE` (Rec 14), `RUN_MACHINE`; illegal edges return `TransitionError` via `Result`.
  - **Aggregates** — immutable `Album`, `Asset`, `Run`; every op returns a new aggregate +
    `DomainEvent` + `AuditRecord`. `Run` freezes a `VersionSet` for its whole life (INV-11).
  - **Events** — separate `DomainEvent` / `TechnicalEvent` families with `kind` discriminator +
    guards (INV-12).
  - **Audit** — `AuditRecord` + `recordTransition` (INV-9).
  - **Version registry model** — `VersionSet` (validated, immutable, `require()` gate) +
    `VERSION_COMPONENTS`.
  - **Policy** — `canStartRun` (one active run per album, INV-6).
- Workspace wiring for the new package (tsconfig paths, vitest alias, boundary ALLOWED map).
- **ADR-0002** — records the domain-first / persistence-deferred scope decision.

**Changed:** `worker/tsconfig.json`, `worker/vitest.config.ts`, `worker/scripts/check-boundaries.mjs` extended for `control-plane`.

**Removed:** Nothing (purely additive).

**Performance:** Pure in-memory domain; no perf-sensitive paths.

**Security:** No secrets/PII; audit `metadata` + event `payload` documented as JSON-safe.

**Documentation:** Package `README.md` + JSDoc on every public export; ADR-0002; `WORKER_V2_PROGRESS.md` updated (Phase 1 → Done, M3).

**Testing:** **50 new domain tests** (value objects, state machine, lifecycles, events, audit, version-set, policy, aggregates) — determinism, immutability, and invariant compliance asserted. `pnpm verify` green (**100 tests total**).

**Breaking Changes:** None.

**Migration Notes:** None. Domain has no persistence; the deferred State Store / Run Registry (ADR-0002) arrive in Phase 2.

**ADR References:** **ADR-0002** — Control Plane: domain model first, persistence deferred.

**Commit References:** _(recorded at commit — branch `worker-v2/phase-1-control-plane`)._

---

### v0.0.0 — 2026-07-22 — Phase 0 · Foundation & Contracts

**Added:**
- Isolated `worker/` **pnpm workspace** (own root) with shared strict TypeScript (`tsconfig.base.json` + solution `tsconfig.json`), ESLint (flat) + Prettier, Vitest, and `.gitignore`.
- **10 product-agnostic foundation packages** (`@workerv2/*`), one capability each:
  `contracts` (shared types / neutral home), `utils` (Result + invariants + object helpers),
  `errors` (typed error taxonomy), `config` (config framework + env validation, injected
  validator), `logger` (Logger abstraction + console/noop), `metrics` (Metrics abstraction +
  noop/in-memory), `health` (check registry), `flags` (feature-flag framework), `di`
  (DI container foundation), `build-info` (version + build metadata).
- **Authoritative boundary/cycle checker** `scripts/check-boundaries.mjs` (dependency direction,
  declared-deps, acyclic package graph — zero deps).
- **CI workflow** `.github/workflows/worker-v2-ci.yml` (install → typecheck → boundaries → lint → format → test).
- **ADR system** `docs/architecture/adr/` (README + `0000` template + **ADR-0001** — foundation scope & layout).
- Reserved (empty) `worker/apps/`, `worker/ops/`, and the DX-generator seam in `worker/scripts/`.

**Changed:**
- `worker/README.md` updated from the Phase −1 placeholder to document the foundation workspace.

**Removed:** Nothing (Phase 0 is purely additive on top of the Phase −1 clean slate).

**Performance:** No perf-sensitive code. Vitest suite runs in <1s.

**Security:** Product-agnostic foundation; no secrets/PII. Error `context` + log `fields` documented as JSON-safe / secret-free (Playbook §4.3.2).

**Documentation:** Per-package `README.md` + JSDoc on every public export; ADR-0001; `WORKER_V2_PROGRESS.md` updated (Phase 0 → Done, M2, stats).

**Testing:** **50 Vitest tests** across all 10 packages, every exported component covered. Full gate `pnpm verify` (typecheck + boundaries + lint + format + test) green.

**Breaking Changes:** None.

**Migration Notes:** None. First `worker/` install requires `cd worker && pnpm install` (pnpm v11 build allowlist includes `esbuild`).

**ADR References:** **ADR-0001** — Worker V2 foundation scope & repository layout (records that Phase 0 delivers generic *foundations* while later phases retain their product-wired *platforms*).

**Commit References:** _(recorded at commit — branch `worker-v2/phase-0-foundation`)._

---

### v0.0.0 — 2026-07-22 — Phase −1 · Worker Reset

**Added:**
- `worker/README.md` — placeholder marking the emptied worker area, awaiting the Phase 0 foundation.
- `docs/architecture/execution/PHASE_-1_EXECUTION_PLAN.md` — Phase −1 execution plan.
- `docs/architecture/execution/PHASE_-1_DEPENDENCY_INVENTORY.md` — WBS 1.1.1 deliverable (V1 surface, coupling, behaviors to re-home).
- Git tag `worker-v1-final` — rollback anchor at `d325f28` (complete V1 tree).

**Changed:**
- Root `tsconfig.json` — removed the now-dead `"worker"` entry from `exclude`.

**Removed:**
- The entire legacy **Worker V1** `worker/` tree: boot (`index.ts`), queue wiring (`queue.ts`), 6 jobs (`image-hardening`, `album-pdf`, `cover-thumbnail`, `blueprint-thumbnail`, `pdf-recovery`, `r2-cleanup`), libs (`image.ts`, `observability.ts`), infra (`env.ts`, `r2.ts`, `supabase.ts`, `health-server.ts`), and V1-specific toolchain/config (`package.json`, lockfiles, `pnpm-workspace.yaml`, `tsconfig.json`, `.env.example`, `.puppeteerrc.cjs`).

**Performance:** N/A (removal only).

**Security:** No secret/PII exposure; no security surface added. App-side data plane and secrets untouched.

**Documentation:** `WORKER_V2_PROGRESS.md` updated (Phase −1 → Done, M1 complete, stats/activity). Execution plan + dependency inventory authored.

**Testing:** App typecheck `npx tsc --noEmit` → exit 0. Verified: no legacy V1 file remains; no `src/**` import of `worker/`; no `worker` reference left in root `tsconfig.json`; CI/lint/package config unchanged (valid by preservation).

**Breaking Changes:** Background processing is paused until Worker V2 is delivered (enqueued jobs have no consumer). Intended reset consequence; no data loss. Tracked as risk RSK-1 in `WORKER_V2_PROGRESS.md`.

**Migration Notes:** None. Database (`pgboss` schema, `photos`/`album_pdfs` columns) intentionally untouched — reconciled in a later phase (no ad-hoc migration; Playbook SC-7).

**ADR References:** None (no architecture change; the reset is prescribed by the frozen Phase Plan).

**Commit References:** _(recorded at commit — branch `worker-v2/phase--1-worker-reset`)._

---

## Release History

_No releases yet._

<!-- Tagged releases (semantic Platform Version) recorded here, newest first. -->

---

## Change Entry Template

```
### <Platform Version> — <YYYY-MM-DD> — Phase <N> <Name>

**Added:**        —
**Changed:**      —
**Removed:**      —
**Fixed:**        —
**Performance:**  —
**Security:**     —
**Documentation:**—
**Testing:**      —
**Breaking Changes:** None
**Migration Notes:**  None
**ADR References:**   —
**Commit References:**—
```

---

## Versioning Policy

Semantic versioning `MAJOR.MINOR.PATCH`:
- **MAJOR** — incompatible public-contract change (ADR-gated).
- **MINOR** — backward-compatible capability added.
- **PATCH** — backward-compatible fix.

Worker V2 tracks **independent version streams** (see `WORKER_V2_PHASES.md` §5 — the Version Matrix).
Each is versioned and frozen per run (INV-11); a behaviour change requires a version bump + a changelog entry.

| Version stream | Scope | Frozen by |
|---|---|---|
| **Platform Version** | The overall Worker V2 release (tags, this changelog). | Release |
| **Worker Runtime Version** | Runtime host, DI, capability/handler contract. | Phase 2 |
| **Manifest Version** | Manifest schema (the render contract). | Phase 7 |
| **Blueprint Version** | Blueprint + template + theme resolution. | Phase 6 |
| **Image Engine Version** | Image validation/canonicalization/derivatives. | Phase 5 |
| **PDF Engine Version** | Render/PDF engine. | Phase 8 |
| **Product Version** | Product catalog + materials + pricing. | Phase 4 |
| **Theme Version** | Theme catalog. | Phase 6 |
| **Processing Profile Version** | Classic/Premium/Luxury/Archive/Draft render params. | Phase 4 |

> Component version bumps are recorded in the relevant phase's Implementation entry and reflected in
> each run's Version Matrix. The Platform Version advances only at a tagged release.

---

_This document is updated after every completed implementation phase / release._
