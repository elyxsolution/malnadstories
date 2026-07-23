# @workerv2/image-backend

The Worker V2 **Native Image Backend** — the replaceable, framework-independent **pixel-processing
backend** future image processors use for **deterministic** image transformations, plus the **Pixel
Gateway** that turns transformed pixels into immutable, **content-addressed raster Artifacts**.

> **Scope (task-phase 14 / frozen Image phase pixel backend).** Backend contracts + Pixel Gateway +
> a pure-TypeScript deterministic **reference backend** (decode / resize / rotate / crop / ICC-family
> colour convert / output validation) + a reusable backend contract-test harness. **Not here:** album
> composition, page rendering, PDF generation, product logic, or any coordinator awareness.

## Design

- **Replaceable backend abstraction.** `ImageBackend` is a small, total, pure interface
  (`decode`/`encode`/`resize`/`rotate`/`crop`/`convert`/`apply`/`validate`). Any implementation can
  be swapped in and proven against the shared **contract-test suite** (`runImageBackendContract`).
- **Deterministic reference backend.** `ReferenceImageBackend` is pure TypeScript: no native codec,
  no SIMD, no ambient rounding, no randomness, no I/O. Given the same input pixels + operations it
  produces **byte-identical** output on every platform (`info.deterministic === true`). This is the
  invariant-preserving default the frozen plan requires (same input → byte-identical derivatives).
- **Reserved native/GPU seam.** A `sharp`/libvips or GPU backend is a **drop-in behind the same
  contracts** — added when throughput matters and byte-determinism can be relaxed to "visually
  equivalent." It is intentionally **not** the reference, because native codecs are not byte-identical
  across platforms/versions and so cannot satisfy the determinism requirement.
- **Pixel Gateway.** `PixelGateway(backend, store)` composes a backend with a narrow, host-wired
  `ArtifactBytesPort` (structurally compatible with the SDK's `ArtifactGateway`). It decodes bytes,
  applies a declarative operation pipeline, **validates the output**, and only then produces a
  content-addressed raster Artifact. Identical output → identical key (idempotent).
- **Deterministic raster IO.** The canonical `WV2R` container is a fixed-byte-order, uncompressed,
  padding-free wrapper around raw 8-bit pixels, so a raster's encoded bytes are a pure function of
  its pixels — the basis for content addressing. The backend also decodes real **uncompressed BMP**
  (24/32-bit) in pure TS.

## Operations

| Op                                          | Determinism                                                         |
| ------------------------------------------- | ------------------------------------------------------------------- |
| `resize` (nearest / bilinear, exact target) | center-aligned sampling + `Math.round` on IEEE-754 — byte-identical |
| `rotate` (90 / 180 / 270°)                  | lossless pixel permutation — exact                                  |
| `crop` (x, y, w, h)                         | pure sub-rectangle copy — exact                                     |
| `convert` (channels + sRGB↔linear / gray)   | precomputed transfer LUTs + Rec.601 luma — byte-identical           |

Arbitrary-angle rotation, higher bit depths, and full arbitrary-ICC-profile LUTs (AdobeRGB, CMYK,
embedded profiles) are the **native backend's** domain, reserved behind the same `convert`/transform
contracts — the reference covers the sRGB / linear / gray family.

## Boundaries

Depends **only** on the foundation leaves + `infra-contracts` (`StorageKey`). It does **not** depend
on `processor-sdk`, `processing`, `coordinator`, `manifest`, `blueprint`, or `runtime` — the backend
is a low-level pixel engine, not a processor or an orchestrator, and it carries no album / render /
PDF / product logic. A host wires one concrete content-addressed store to both this package's
`ArtifactBytesPort` and the SDK's `ArtifactGateway`. Nothing depends on this package yet — future
image processors consume it via the Pixel Gateway. Enforced by `scripts/check-boundaries.mjs`.
