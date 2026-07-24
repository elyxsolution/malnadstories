# @workerv2/pdf-export

The Worker V2 **PDF Export Processor** — the first concrete document exporter, built with the
Processor SDK, that converts an immutable **Document** into a **deterministic PDF Artifact**.

> **Scope (task-phase 17).** PDF export processor + PDF generator/assembly engine + page placement +
> metadata writer + PDF validation + export configuration + PDF descriptor + a test harness. It is
> completely independent of Document construction and page rendering.

```
Document → PDF Export Processor → PDF Generator → validated PDF → PDF Artifact (+ PDF Descriptor)
```

## What it does (and does not)

- **It does** consume an immutable Document (parsed from its content-addressed artifact), resolve the
  referenced Page Artifacts (decode the raster containers), assemble them into a PDF, embed document
  metadata, apply the print profile's dpi, **validate the generated PDF**, and produce an immutable
  PDF Artifact plus a deterministic PDF Descriptor — all through the SDK's Artifact gateway (never
  bypassing the Artifact Platform).
- **It does not** modify Documents, render pages, process images (it only _packs_ decoded page
  samples into PDF image XObjects — no resampling/filtering/colour transforms), compose layouts,
  introduce business logic, or perform storage/networking of its own.

## Determinism

Given an identical Document + Page Artifacts + export configuration + processor version, the PDF is
**byte-identical**. The generator is a pure-TypeScript PDF writer chosen precisely so determinism is
guaranteed rather than fought — every value a general PDF library would randomize is overridden:

- **no `CreationDate`/`ModDate`**; a fixed `Producer` (`Worker V2 PDF Exporter <version>`);
- **object numbering + ordering** are controlled here;
- the trailer **`/ID` is derived from a SHA-256 of the document body**, never random;
- all coordinates are integers; text strings are deterministic UTF-16BE hex.

`compression: 'none'` is byte-identical on every platform; `'flate'` is deterministic given the same
zlib.

## Export configuration (part of export identity)

`page size · bleed · crop marks · compression policy · metadata · PDF version`. Identical config →
identical bytes → identical Artifact. `parsePdfExportConfig` fills defaults and rejects unsupported
values; `canonicalExportConfig` is the canonical basis recorded in the descriptor.

## Validation

Rejects (never producing an Artifact): malformed Documents, missing page references, **inconsistent
page sizes**, unsupported export configuration, and an invalid generated PDF.

## PDF Descriptor

`buildPdfDescriptor` records — deterministically — the source **document identity**, the **ordered
page identities**, the **export configuration**, the **PDF version**, and the **processor version**,
for replay, auditing, and debugging. It is produced as a JSON Artifact alongside the PDF.

## Artifact identity

The PDF Artifact is content-addressed: because the bytes are a pure function of (Document, page
artifacts, export config, processor version), **equivalent exports produce identical artifacts**.

## Boundaries

Depends on the foundation leaves + `control-plane` (via the SDK context) + `infra-contracts` +
`processing` + `processor-sdk` + `document` (parse/hash the Document — **read-only**) + `image-backend`
(`decodeRaster` **only** — reading a page raster container to embed it; no resize/rotate/convert/
composite). It depends on no composition/coordinator/manifest/product package and performs no storage
of its own. Future exporters (preview images, print packages, archival formats) follow the same
architecture. Enforced by `scripts/check-boundaries.mjs`.
