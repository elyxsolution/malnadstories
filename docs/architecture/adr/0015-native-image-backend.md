# ADR-0015 — Native Image Backend: a replaceable, deterministic pixel-processing backend

- **Status:** Accepted
- **Date:** 2026-07-24
- **Phase:** 5 (Image Processing Platform — the pixel backend behind the foundation processors; task-phase 14)
- **Deciders:** Chief Software Architect, Worker V2

## Context

Task-phase 13 (ADR-0014) delivered the Image Foundation Processors as descriptor transformations and
**explicitly deferred the pixel transcode/rotate/convert to a native backend behind the same
contract**. This task-phase builds that backend: the replaceable pixel-processing layer future image
processors use for deterministic image transformations. The objective's constraints: a **replaceable
backend abstraction**; **deterministic outputs** (verified across supported platforms); **framework-
independent** interfaces; no album knowledge, no page rendering, no PDF, no product logic, no
coordinator dependency; the backend may decode pixels, transform images, and produce immutable
Artifacts; validate transformed outputs before producing artifacts; and allow future GPU/native
implementations behind the same contracts. The scope names "Sharp (or equivalent)" as the backend
implementation.

The central tension is the same one Worker V2 has resolved at every layer: **determinism vs. a heavy
native dependency.** `sharp`/libvips is fast but is **not byte-identical across platforms/versions**
(SIMD paths, libvips builds, rounding differ), is a native binary requiring install scripts, and
would make `pnpm verify` platform-dependent — breaking both the stated "deterministic output across
supported platforms" requirement and the frozen Image-phase invariant ("same input → byte-identical
canonical/derivatives"). Every prior platform (persistence, artifact-store, coordinator) resolved
this by shipping a pure, deterministic reference and reserving the heavy backend behind a contract.

Decisions needed: (1) what the backend contract is; (2) what the concrete backend is, given
determinism is mandatory and sharp cannot guarantee it; (3) where pixels come from without a full
native codec; (4) how the backend produces content-addressed Artifacts without depending on a store
or the SDK; (5) how "validate before produce" is enforced; (6) how future native/GPU backends plug
in.

## Decision

**1. `ImageBackend` is a small, total, pure contract.** `decode`/`encode`/`resize`/`rotate`/`crop`/
`convert`/`apply`/`validate`, each a pure function of its inputs (no ambient state, no I/O). This is
the replaceable seam; any implementation is provable against a shared **contract-test suite**
(`runImageBackendContract`) that every backend must pass.

**2. The concrete backend is a pure-TypeScript DETERMINISTIC REFERENCE; sharp is a reserved seam.**
`ReferenceImageBackend` implements every operation with fixed integer/IEEE-754 math (center-aligned
nearest/bilinear resize with `Math.round`, orthogonal-rotation pixel permutations, sub-rectangle
crop, precomputed sRGB↔linear transfer LUTs + Rec.601 luma) — byte-identical across platforms
(`info.deterministic === true`). A native/GPU (`sharp`/libvips) backend is an **additive drop-in
behind the same contract**, chosen when throughput matters and byte-determinism relaxes to "visually
equivalent." This satisfies "or equivalent" while honouring the hard determinism requirement that
sharp literally cannot meet as a byte-reproducible reference.

**3. Pixels come from a deterministic canonical container + a real uncompressed format.** The backend
decodes its own `WV2R` container (fixed byte order, uncompressed, no row padding → encoded bytes are
a pure function of pixels, the basis for content addressing) **and** real uncompressed **BMP**
(24/32-bit) in pure TS. Compressed-codec decode (JPEG/PNG/HEIC → pixels) is the native backend's job
behind `decode`; the reference proves the transformation engine end-to-end without a codec.

**4. The Pixel Gateway bridges to Artifacts through a narrow, host-wired port — not the SDK, not a
store.** `PixelGateway(backend, store)` uses `ArtifactBytesPort` (`read`/`write`), structurally
compatible with the SDK's `ArtifactGateway`, so a host wires ONE concrete content-addressed store to
both without this package depending on `processor-sdk`, `processing`, or any storage implementation.
The gateway decodes → applies the operation pipeline → **validates** → produces; identical output →
identical key (idempotent, content-addressed).

**5. Output validation gates production.** `validate` (positive integer geometry, legal
channel/colour-space pairing, exact `data` length, optional size limits) runs inside
`PixelGateway.produce` — an invalid raster is **never** encoded or produced, so no malformed pixel
Artifact can exist.

**6. Framework-independent, boundary-minimal.** The package depends only on the foundation leaves +
`infra-contracts` (`StorageKey`). No coordinator/processing/runtime/manifest/blueprint; no album,
page, PDF, or product concept anywhere.

## Options Considered

1. **Pure-TS deterministic reference backend + reserved native seam (chosen).**
2. **Bundle `sharp`/libvips as the concrete backend now.** Rejected as the reference: not
   byte-identical across platforms/versions (violates the determinism requirement + the Image-phase
   invariant), a native binary needing install scripts, and it would make `pnpm verify`
   platform-dependent. Retained as a reserved drop-in behind the same contract for throughput.
3. **Full pure-TS JPEG/PNG pixel decoder in the reference.** Rejected for this phase: a correct
   Huffman/IDCT/inflate decoder is large and error-prone; the canonical container + BMP prove the
   engine deterministically, and compressed-codec decode is exactly what the native `decode` slot is
   for.
4. **Have the gateway depend on the SDK's `ArtifactGateway` / a concrete store.** Rejected: couples a
   low-level pixel engine to the SDK/storage. A narrow structurally-compatible `ArtifactBytesPort`
   keeps the backend framework-independent; a host adapts one store to both.
5. **Arbitrary-angle rotation + full arbitrary-ICC LUTs in the reference.** Rejected for determinism
   + scope: arbitrary rotation needs interpolation choices best left to the native backend, and true
   arbitrary-ICC transforms need profile data. The reference covers orthogonal rotation + the
   sRGB/linear/gray family; the rest is reserved behind the same `convert`/transform contracts.

## Consequences

- **Positive:** a deterministic, cross-platform, dependency-free pixel engine the image processors
  can now target; every transform is byte-reproducible and content-addressable; the backend is
  provably album-/render-/PDF-/product-/coordinator-free (grep + boundary verified); a native/GPU
  backend is a proven drop-in (the contract suite is the acceptance test); output validation makes a
  malformed pixel Artifact impossible.
- **Negative / trade-offs:** the reference does not decode compressed codecs (JPEG/PNG/HEIC → pixels)
  — that awaits the native `decode` implementation; resize is nearest/bilinear only (no
  Lanczos/area — native backend territory); rotation is orthogonal only; colour conversion covers the
  sRGB/linear/gray family, not arbitrary embedded ICC profiles. All are reserved behind the existing
  contracts, none blocking.
- **Follow-ups / remaining risks:** wire the native backend (real codec decode + high-throughput
  transforms) behind `ImageBackend`, validated by `runImageBackendContract`; connect the image
  foundation processors' normalization *plans* (ADR-0014) to actual pixel work via the Pixel Gateway
  to produce sanitized masters + derivatives; register the image-engine/backend version into the
  frozen version set when runs pin versions.

## Compliance

Framework-independent; strict TypeScript; full unit tests (40 new; `pnpm verify` green — 568 total,
24 packages). Replaceable backend abstraction proven by a reusable contract suite. Deterministic +
cross-platform: pure integer/IEEE-754 math, no native codec, no ambient time/randomness/env,
byte-identical output (determinism test-proven). Consumes + produces immutable, content-addressed
raster Artifacts; output validated before production. No album knowledge, no page composition, no
PDF, no product logic, no coordinator dependency (grep + boundary verified). Boundaries: depends only
on foundation leaves + infra-contracts; nothing depends on this package yet.
