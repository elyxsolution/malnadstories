# ADR-0014 — Image Foundation Processors: deterministic, rendering-independent image normalization

- **Status:** Accepted
- **Date:** 2026-07-24
- **Phase:** 5 (Image Processing Platform foundation — the first concrete processors; task-phase 13)
- **Deciders:** Chief Software Architect, Worker V2

## Context

The Processor SDK (ADR-0013) gives us a rendering-independent way to build processors; the
execution adapter (ADR-0012) invokes them. Nothing concrete has been built yet. This task-phase
delivers the **first concrete processors**: generic image normalization + metadata extraction, the
foundation of the frozen Image Processing Platform (M7). The hard constraints from the objective:
built with the SDK; consume + produce immutable, content-addressed Artifacts; **deterministic**
outputs depending only on input Artifacts + config; **no album knowledge**, no page rendering, no
PDF, no layout, no storage/R2 assumptions; full unit tests; boundaries enforced. The processors
may decode images, normalize formats/orientation/colour, and extract metadata — each a single,
focused transformation.

The central tension: real image processing usually means a **native codec** (sharp/libvips), which
is non-deterministic across platforms and versions, is a heavy native dependency, and would breach
the "pure, deterministic, dependency-free, in-memory-reference-now / durable-backend-later" pattern
every prior Worker V2 platform holds (persistence, artifact-store, blueprint, manifest, coordinator
all model their substance as data + pure functions and defer the heavy backend behind a contract).

Decisions needed: (1) what "decode / normalize" means without a native codec; (2) how the six
processors are shaped and how they compose; (3) how outputs stay content-addressable + deterministic;
(4) where the actual pixel work goes.

## Decision

**1. Model image work as DESCRIPTOR transformations, in pure TypeScript.** Each processor parses
the encoded container's bytes directly (magic-byte format detection + header parsing for
PNG/JPEG/GIF/BMP/WebP/TIFF; a bounds-checked EXIF/TIFF IFD reader; HEIC recognized best-effort) and
produces an immutable **descriptor Artifact** — the deterministic, structural truth about the image
(geometry, pixel format, EXIF, orientation correction, colour plan, format decision). This is
genuine, useful normalization/extraction that is byte-identical on every platform. The actual
**pixel transcode/rotate/convert is a native backend deferred behind the same `Processor`
contract** — exactly the pattern the storage and persistence platforms use (in-memory reference now;
durable/native backend later, drop-in). No native codec enters the package.

**2. Six single-transformation processors, composing as a small DAG.**
`image.validate` (raw → report; the safety + decompression-bomb gate), `image.decode` (raw →
`DecodedImage`: geometry + pixel format), `image.metadata` (raw → `ImageMetadata`: format +
dimensions + EXIF), then three normalizers that consume the upstream descriptors:
`image.exif-orientation` (`decoded` + `metadata` → `OrientedImage`), `image.color-normalize`
(`decoded` → `NormalizedColor` sRGB plan), `image.format-normalize` (`decoded` → `NormalizedFormat`
canonical container). Each does one thing; the normalizers reason over descriptors rather than
re-parsing bytes, reflecting a real processing graph.

**3. Content-addressable, deterministic outputs.** Every descriptor is produced as **canonical
JSON** (`canonicalJson`), so logically-equal descriptors serialize byte-identically and collapse to
the same content address — idempotent re-production (INV-2/INV-7). Parsing reads no ambient time,
no randomness, no environment; an output depends only on its input Artifact bytes + processor
config. A determinism test suite asserts byte-identical content addresses across independent runs.

**4. Metadata is recorded THROUGH produced Artifacts.** Extracted facts live in descriptor
Artifacts, never a side channel; the processors emit only SDK progress/diagnostics otherwise.

**5. No album/rendering/storage vocabulary.** The package's types are purely image-level (formats,
orientation, colour type, channels, ICC). It touches bytes only through the SDK's `ArtifactGateway`;
it imports no manifest/blueprint/coordinator/storage implementation.

## Options Considered

1. **Pure-TypeScript descriptor transformations + deferred native pixel backend (chosen).**
2. **Bundle `sharp`/native libvips and transcode pixels now.** Rejected: non-deterministic across
   platforms/versions (violates the determinism requirement + INV reproducibility), a heavy native
   dependency in an otherwise pure workspace, and it would couple the first processors to a specific
   codec rather than a contract. The native path is still available later behind the same contract.
3. **One monolithic `image.process` processor.** Rejected: violates "keep each processor focused on
   a single transformation," blocks independent reuse/testing, and hides the real dependency DAG.
4. **Extract metadata into the Control Plane / a side table.** Rejected: metadata must be recorded
   through produced Artifacts (content-addressed, immutable), not a mutable side channel.
5. **Emit normalized image BYTES from the normalizers now (e.g. rewrite the EXIF orientation tag
   losslessly).** Rejected: rewriting the orientation tag without rotating pixels is semantically
   wrong, and true pixel rotation needs a codec. The normalizers emit the correct *plan*; the pixel
   apply is the deferred backend.

## Consequences

- **Positive:** the platform gains real, deterministic, cross-platform image validation + metadata
  extraction + normalization planning with zero native dependencies; each processor is tiny (a
  descriptor + `execute`) thanks to the SDK; outputs are content-addressable and idempotent; the
  package is provably album-/render-/storage-agnostic (grep + boundary verified); a host registers
  all six via `createImageFoundationProcessors(deps)` into the adapter's resolver.
- **Negative / trade-offs:** the descriptors describe pixel work that a later **native backend**
  must actually perform (transcode/rotate/convert) — the normalizers produce plans, not pixels, so
  an end-to-end "sanitized master + thumbnail" still awaits that backend; header parsing is
  best-effort for HEIC (recognized; `ispe` box read when present) and does not cover every exotic
  sub-format; the decompression-bomb guard uses declared header dimensions (correct for these
  formats, where dimensions are not attacker-inflatable post-hoc without also inflating bytes).
- **Follow-ups / remaining risks:** the native pixel backend (canonicalize to a print master +
  derivatives) is the next Image-phase increment, implemented behind the same `Processor` contract +
  wired to the real content-addressed `ArtifactGateway`; asset-lifecycle transitions (Incoming →
  Verified → Canonical → Derivative) wire in when a producing pipeline runs these processors under
  the coordinator; the Image Engine version (`IMAGE_ENGINE_VERSION`) is registered into the frozen
  version set when runs pin versions.

## Compliance

Built with `@workerv2/processor-sdk`; strict TypeScript; full unit tests (42 new; `pnpm verify`
green — 528 total, 23 packages). Consumes + produces immutable, content-addressed Artifacts
(canonical JSON). Deterministic + cross-platform: pure byte parsing, no native codec, no ambient
time/randomness/env — outputs depend only on input Artifacts + config (determinism test-proven).
No album knowledge, no page composition, no PDF, no layout, no storage/R2 implementation, no
file-path API (grep + boundary verified). Each processor is a single transformation. Boundaries
enforced: depends only on foundation leaves + control-plane + infra-contracts CONTRACTS + processing
+ processor-sdk; nothing depends on this package.
