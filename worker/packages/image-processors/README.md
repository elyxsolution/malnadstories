# @workerv2/image-processors

The Worker V2 **Image Foundation Processors** — the first **concrete** processors, built with the
[`@workerv2/processor-sdk`](../processor-sdk), that perform **generic image normalization and
metadata extraction** while staying **independent of album rendering**. Every processor consumes
and produces immutable, **content-addressed Artifacts**, deterministically and cross-platform.

> **Scope (task-phase 13 / frozen Image phase foundation, M7 partial).** Six single-transformation
> processors over image Artifacts. **Not here:** album composition, page rendering, PDF generation,
> layout logic, storage/R2 implementations, or any native image codec. Heavy pixel transcoding is a
> native backend deferred **behind the same processor contract**.

## The six processors

| Name                     | Input slots           | Output slot | Transformation                                                                                                                                      |
| ------------------------ | --------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `image.validate`         | `image`               | `report`    | Format recognized + allowed, decodable, within byte/dimension limits **including a decompression-bomb pixel guard**. Invalid → `permanent` failure. |
| `image.decode`           | `image`               | `decoded`   | Structural decode: geometry + pixel format (bit depth, channels, colour type, alpha, ICC presence).                                                 |
| `image.metadata`         | `image`               | `metadata`  | What the file declares about itself: format, dimensions, and EXIF (orientation, capture date, make/model).                                          |
| `image.exif-orientation` | `decoded`, `metadata` | `oriented`  | The transform mapping the source EXIF orientation onto the canonical display orientation (1) + resulting dimensions.                                |
| `image.color-normalize`  | `decoded`             | `color`     | The plan to bring the raster into the canonical sRGB working space + whether a conversion is required.                                              |
| `image.format-normalize` | `decoded`             | `format`    | The canonical delivery container (alpha → PNG, else JPEG) + whether a transcode is required.                                                        |

## Design

- **Built entirely on the SDK.** Each processor is a small `execute` plus a descriptor; the SDK
  supplies the lifecycle, validation, progress/diagnostics, guards, and failure normalization. The
  factories (`createImage*Processor(deps)`) and the aggregate `createImageFoundationProcessors(deps)`
  wire them to a host's `ArtifactGateway` for registration into the execution adapter's resolver.
- **Deterministic + cross-platform by construction.** Parsing is **pure TypeScript** over the
  encoded bytes (magic-byte detection + header parsing for PNG/JPEG/GIF/BMP/WebP/TIFF, a
  bounds-checked EXIF/TIFF IFD reader, HEIC recognized best-effort). No native codec, no ambient
  time, no randomness — an output depends **only** on its input Artifacts + processor config.
- **Content-addressable outputs.** Every descriptor is produced as **canonical JSON**, so two
  logically-equal descriptors serialize byte-identically and collapse to the same content address
  (idempotent re-production, INV-2/INV-7).
- **Metadata through Artifacts, never side channels.** All extracted facts are recorded in produced
  descriptor Artifacts; nothing is written to logs-as-data or external stores.
- **No album knowledge.** The vocabulary is purely image-level (formats, orientation, colour,
  channels). There is no page, spread, blueprint, manifest, or PDF concept anywhere in the package.

## What it is not

- Not a pixel decoder/transcoder. `decode`/`color-normalize`/`format-normalize` produce the
  **structure + plan**; applying pixel transforms is a native backend added later behind the same
  `Processor` contract (the same "in-memory reference now, durable backend later" pattern the
  storage/persistence platforms use).
- Not coupled to any storage backend, transport, renderer, or file system — it touches bytes only
  through the SDK's `ArtifactGateway`.

## Boundaries

Depends on the foundation leaves + `control-plane` (value objects, via the SDK context) +
`infra-contracts` (`StorageKey`/`ArtifactKind` **contracts** only) + `processing` (the processor
contracts) + `processor-sdk` (base processor + harness). Nothing depends on this package — it
produces `Processor`s a host registers. Enforced by `scripts/check-boundaries.mjs`.
