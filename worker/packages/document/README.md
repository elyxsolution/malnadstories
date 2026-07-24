# @workerv2/document

The Worker V2 **Document Assembly Platform** — the immutable, content-addressable layer that
assembles rendered **Page Artifacts** into a complete, **format-independent** printable document
model. It is the **bridge between rendering and export**.

> **Scope (task-phase 16).** Document aggregate + builder + document manifest + page ordering + print
> metadata + print settings/profile + assembly config + validation + canonical serialization +
> sha256 identity + Document Descriptor + a test harness. **This phase deliberately generates no
> PDFs.**

## What it is (and is not)

- **It is** the immutable description of a fully rendered album ready for export: ordered page
  Artifact references, document metadata, a print profile (settings), print metadata, assembly
  configuration, and a content-addressed identity. The Document is itself just another immutable,
  content-addressed artifact within Worker V2.
- **It is not** any export format. It renders no pages, rasterizes no images, generates no PDFs or
  previews, packages no print files, performs no storage or networking, and holds no business logic.
  Future exporters (PDF, preview, print-package) are **independent processors** built on the
  Processor SDK that consume the same immutable Document — the platform is unaware of them.

```
Rendered Page Artifacts → Document Builder → immutable Document → Document Descriptor
                                                     ↓
                            (later, independent processors)  PDF / Preview / Print-Package export
```

## Design

- **Document Builder** (`buildDocument(source)`) — assembles page identities (never bytes) into a
  `Document`: applies deterministic assembly defaults, routes the candidate through the single
  **validation gate**, then computes the canonical form + hash and returns the frozen result. An
  invalid or incomplete document can never be produced.
- **Validation** (`validateDocument`) — the one gate; reconstructs a clean, canonical, deep-frozen
  document and rejects: bad schema version, incomplete metadata, invalid page ordering, **duplicate
  page indices**, non-contiguous indices, **missing/malformed page artifact references**,
  inconsistent print settings, and an inconsistent cover.
- **Canonical identity** (`hashDocument`) — `sha256:<hex>` over the canonical serialization; derived
  **exclusively** from the ordered page artifact identities, the document metadata, and the print
  configuration. Equivalent documents always hash identically; input page order and JSON key order
  never affect identity.
- **Determinism** — a Document is a pure function of page artifacts + metadata + print
  configuration. **No timestamps, no randomness, no environment-dependent behavior.**
- **Document Manifest** (`toDocumentManifest`) — the immutable, ordered listing of page Artifact
  references (index → identity), for consumers that need only the pages.
- **Document Descriptor** (`describeDocument`) — a deterministic, JSON-safe record of a document:
  identity, ordered page references, print profile, document metadata, and assembly configuration —
  for **replay, debugging, validation, auditing, and future export pipelines**.
- **Serialization symmetry** — `serialize(parse(serialize(doc))) === serialize(doc)`; the canonical
  form is recomputed on parse, never trusted.

## Boundaries

Depends **only** on the foundation leaves + `infra-contracts` (`StorageKey` — page artifact
references). It does **not** depend on `image-backend`, `composition`, `blueprint`, the coordinator,
or any PDF/export library — it references rendered pages by identity, it does not render them.
Nothing depends on this package yet — future export processors consume the immutable Document via
the Processor SDK. Enforced by `scripts/check-boundaries.mjs`.
