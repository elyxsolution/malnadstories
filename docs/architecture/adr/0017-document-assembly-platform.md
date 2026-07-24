# ADR-0017 — Document Assembly Platform: an immutable, format-independent document model

- **Status:** Accepted
- **Date:** 2026-07-24
- **Phase:** 8 (Render Engine & PDF Platform — the document-model bridge to export; task-phase 16)
- **Deciders:** Chief Software Architect, Worker V2

## Context

The Page Composition Engine (ADR-0016) produces rendered page rasters as content-addressed
Artifacts. Before any export (PDF, preview, print package) can happen, those pages must be assembled
into a single, complete description of the album — ordered, with print configuration and metadata,
and with a stable identity. This task-phase builds that layer: the **Document Assembly Platform** —
the immutable model that assembles rendered Page Artifacts into a complete printable document,
**completely independent of any output format**, serving as the bridge between rendering and export.

Constraints from the objective: consume immutable rendered Page Artifacts; assemble them into an
immutable Document; preserve page ordering; store print metadata + print settings; produce canonical
serialization + deterministic hashes; validate completeness before construction; produce a
deterministic Document Descriptor (ordered page references + print profile + document metadata +
assembly config). It must NOT render, rasterize, process images, generate PDFs/previews, package
print files, perform storage/networking, or introduce business logic. Identity must derive
exclusively from ordered page artifact identities + document metadata + print configuration;
equivalent documents must hash identically; determinism with no timestamps/randomness/environment.
**This phase intentionally generates no PDFs.**

Decisions needed: (1) what the Document model is and how it stays format-independent; (2) how it
consumes rendered pages without rendering or storage; (3) how identity + determinism are guaranteed;
(4) how completeness is validated so invalid documents never exist; (5) how future exporters plug in
without touching the model.

## Decision

**1. Mirror the frozen model-platform shape (Blueprint/Manifest).** The Document is a pure,
immutable, content-addressable value: `model.ts` (aggregate + contracts), `validate.ts` (single gate
/ invariants), `serialize.ts` (canonical JSON + parse), `identity.ts` (`sha256:<hex>` over the
canonical form), `build.ts` (the builder), plus `manifest.ts` (document manifest) and
`descriptor.ts` (document descriptor). This reuses the platform's proven determinism + content-
addressing discipline and keeps the Document byte-compatible with artifact addressing (ADR-0006) — a
canonical document stored as an artifact gets a key equal to its own hash.

**2. The Document references pages by IDENTITY; it never reads or renders them.** Each page is a
`{ index, artifact: StorageKey, kind, surfaceId? }` — a content address to a rendered page Artifact,
not the bytes. The builder consumes these references, assembles + orders them, and validates; it
performs no storage, no rendering, no rasterization. "Missing referenced page artifact" is enforced
as: every page must carry a well-formed, non-empty content-address key (the platform has no storage
to probe, by design).

**3. Format independence is structural.** The Document represents ordered pages, page artifact
references, document metadata, a print profile (settings), print metadata, assembly configuration,
and its identity — and **nothing about any export format**. The package depends only on the
foundation leaves + `infra-contracts`; it imports no PDF library, no image/composition package, no
coordinator. Future exporters (PDF/preview/print-package) are independent Processor-SDK processors
that consume the same immutable Document; the platform is unaware of them, and new formats need no
model change.

**4. Identity + determinism by canonical construction.** `hashDocument` is `sha256` over the
canonical serialization, which sorts object keys and keeps pages in their canonical index order — so
identity derives exclusively from ordered page identities + metadata + print configuration, input
page order and JSON key order are irrelevant, and equivalent documents hash identically. No
timestamps, randomness, or environment reads anywhere. The validation gate canonicalizes ordering
(pages sorted by index, metadata-map keys sorted) so even the reconstructed object form is
deterministic (replay-stable).

**5. Validation gates construction — invalid documents never exist.** The builder routes its
assembled candidate through `validateDocument`, which reconstructs a clean, deep-frozen document
(dropping unknown keys so they can never reach identity) and rejects: unsupported schema version,
incomplete metadata, invalid/non-contiguous page ordering, duplicate page indices, missing/malformed
page artifact references, inconsistent print settings, and an inconsistent cover. Failure returns a
`DocumentError`, never a partial document.

**6. A Document Descriptor (and a Document Manifest) for downstream use.** `describeDocument` emits a
deterministic, JSON-safe record (identity + ordered page references + print profile + metadata +
assembly config) for replay, debugging, validation, auditing, and future export pipelines;
`toDocumentManifest` emits the ordered page-reference listing for consumers that need only the pages.
Both are pure projections and produce no export format.

## Options Considered

1. **Immutable model platform (aggregate + builder + validation + canonical identity + descriptor),
   pages by identity, format-independent (chosen).**
2. **Fold assembly into the composition engine or a future PDF exporter.** Rejected: it would couple
   the album-level document to rendering/export, prevent multiple exporters from sharing one
   immutable Document, and violate the format-independence + single-responsibility requirements.
3. **Embed page bytes / resolve artifacts in the Document.** Rejected: that is storage + rendering
   concern; the Document must reference pages by content address only (no storage/networking) so it
   stays a pure value with a content-only identity.
4. **Include export/print-format fields (page ranges for PDF, preview scale, packaging layout).**
   Rejected: those belong to individual exporters. The Document carries a print *profile/settings*
   (how pages were prepared) + assembly config, never an export format's parameters.
5. **Let the builder accept a precomputed pageCount / trust caller ordering.** Rejected: pageCount is
   derived and cross-checked, and ordering is canonicalized + validated (contiguous, unique) so
   completeness is guaranteed rather than assumed.

## Consequences

- **Positive:** a single immutable, content-addressed Document that every future exporter (PDF,
  preview, print-package) consumes as an independent Processor-SDK processor without modifying the
  model; deterministic identity + serialization enable replay, caching, and audit; validation makes
  an invalid/incomplete document impossible; the platform is provably free of rendering / PDF /
  storage / networking / business logic (grep + boundary verified).
- **Negative / trade-offs:** "missing page artifact" is validated as a well-formed reference, not a
  storage-existence check (the platform has no storage, by design — an exporter or the coordinator
  verifies presence when it resolves the pages); the print model is a general profile/settings +
  free-form print metadata rather than a rich, vendor-specific print spec (that lives in the Product
  Platform / a future vendor profile); page `kind` is limited to cover/page (sufficient for
  assembly; richer classification can be added additively).
- **Follow-ups / remaining risks:** the actual PDF/preview/print-package **export processors** are
  the next work, built with the Processor SDK, consuming this Document (this phase deliberately
  builds none); a render/assemble stage feeds real composed page Artifacts as the document's pages;
  the Document version registers into the frozen version set when runs pin versions.

## Compliance

Framework-independent; strict TypeScript; full unit tests (25 new; `pnpm verify` green — 636 total,
26 packages). Consumes immutable rendered Page Artifacts by identity; produces an immutable,
content-addressed Document + canonical serialization + `sha256` identity + a deterministic Document
Descriptor + Document Manifest; validates completeness before construction (invalid documents never
exist). Deterministic: identity from ordered page identities + metadata + print configuration only,
no timestamps/randomness/environment (replay-proven). No rendering, no rasterization, no image
processing, no PDF generation, no previews, no print packaging, no storage, no networking, no
business logic (grep + boundary verified). Boundaries: depends only on foundation leaves +
infra-contracts; nothing depends on this package yet.
