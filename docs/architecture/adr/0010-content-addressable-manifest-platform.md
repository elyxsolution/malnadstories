# ADR-0010 — Content-addressable Manifest Platform (model, compiler, processing reuse)

- **Status:** Accepted
- **Date:** 2026-07-23
- **Phase:** 9 (Manifest Platform — the frozen Manifest phase)
- **Deciders:** Chief Software Architect, Worker V2

## Context

The frozen Manifest phase makes the manifest the render engine's SOLE input (INV-3) and
demands a validated, immutable, versioned value (INV-1). This task-phase builds the manifest
as the translation of blueprint INTENT into executable processing INTENT — with no execution
behavior. Decisions needed: (1) the manifest's shape and its relationship to the existing
declarative Processing Framework, (2) the canonical blueprint→work translation, (3) how the
manifest stays self-contained, and (4) where provenance traces live relative to identity.

## Decision

**1. The manifest REUSES the Processing Framework's contracts instead of duplicating them.**
Work-node ids are `StepId`s, artifact bindings are `ArtifactInputBinding`s, and the
retry/timeout/cancellation/failure/capability models are `@workerv2/processing`'s own types,
validated by ITS validators inside the manifest gate (M10) and ordered by ITS deterministic
DAG algorithm (`orderStepGraph`, M11). The payoff is the lossless bridge: `toPipeline`
maps a compiled manifest into a validated `ProcessingPipeline` via `definePipeline` with
zero structural mapping — proving by construction that every manifest is consumable by any
engine that interprets the processing model. The pipeline id embeds the manifest hash, so a
pipeline names exactly which manifest it executes.

**2. The canonical translation: one render node per surface + one assembly node.** Each
surface (cover, spread) becomes a `surface.render` work node consuming (a) the BLUEPRINT
ITSELF as a content-addressed artifact — a canonical blueprint stored as an artifact has key
= its own hash (ADR-0008), so the binding is `artifact: <blueprint hash>` — and (b) every
image artifact placed on that surface, producing one `page` output. A single
`album.assemble` node consumes every page output (semantic surface order preserved in its
config) and produces the final `album` output. Node ids are DERIVED (`render:<surfaceId>`,
`assemble:album`) — stable across recompilations, which is what makes the per-id diff model
meaningful. Processors are registry NAMES; no code, no rendering, no scheduling exists here.

**3. Self-containment = every reference is a content address or an in-manifest node id.**
Consumed inputs are explicit per node (`consumes`), produced outputs are explicit
(`produces`), and validation (M7) proves every step-output binding resolves to a declared
output of an explicit dependency — no dangling bindings, no live-state/domain/DB references.
An engine needs the manifest plus the artifact store, nothing else (the INV-3 enabler).

**4. Identity = canonical manifest content ONLY; traces ride the wrapper.** `hashManifest` =
`sha256:<hex>` over canonical JSON (byte-compatible with ADR-0006/0008 addressing). The
validation gate REBUILDS nodes from the known vocabulary, so unknown keys are dropped and
can never reach the identity. Provenance (e.g. future resolver-chain traces) attaches to the
`CompiledManifest` WRAPPER (`trace` option / `attachTrace`) — never to the manifest value —
so traces are attachable and replaceable without affecting identity (test-proven).

## Options Considered

1. **Reuse processing contracts + wrapper-level traces + per-surface translation (chosen).**
2. **A standalone manifest vocabulary with its own policy/binding models.** Rejected: the
   phase brief and INV-5 both demand one declarative processing model; duplication would let
   retry/cancellation semantics drift between manifest and pipeline consumers.
3. **Embedding a `ProcessingPipeline` directly as the manifest.** Rejected: a pipeline lacks
   the manifest envelope (album, blueprint provenance, schema version) and its constructor
   is spec-oriented; the manifest needs its own untrusted-input gate and canonical form. The
   bridge keeps both without coupling the schemas.
4. **Embedding blueprint content (surface subtrees) inside the manifest.** Rejected:
   duplicates the blueprint model and bloats identity; binding the blueprint AS an artifact
   gives the same self-containment through the store, with provenance for free.
5. **Traces inside the manifest value (hashed).** Rejected: attaching/updating provenance
   would change identity and break dedupe/reproducibility — the express requirement was the
   opposite.
6. **Per-image preparation nodes in the translation.** Rejected for now: image derivation is
   the frozen Image phase's pipeline (driven by processing profiles); the manifest consumes
   already-canonical image artifacts. Additive node kinds can extend the translation behind
   a schema-version bump.

## Consequences

- **Positive:** the render contract (frozen Phase 8's input) is now a validated, immutable,
  content-addressed value; manifests are reproducible, dedupable, diffable, storable as
  artifacts, and already executable-in-shape (pipeline bridge + execution plan verified);
  retry/timeout/cancellation/capability semantics are single-sourced in processing.
- **Negative / trade-offs:** the translation vocabulary (2 processors, page/album outputs)
  is intentionally minimal — thumbnails, previews, per-image derivations, and pre-press
  variants are ADDITIVE node kinds behind a schema-version bump; per-node policy overrides
  apply uniformly (per-processor policy differentiation is a compile-option extension).
- **Follow-ups / remaining risks:** the render engine (frozen Phase 8) must bind the
  processor names and honor `config.surface`; the coordinator (frozen Phase 9 remainder)
  interprets the bridged pipeline; manifest version-registry freezing happens when runs pin
  versions; schema-evolution policy when 2.0.0 arrives.

## Compliance

Framework-independent, immutable (deep-frozen), deterministic (no clock/randomness/env/IO),
canonically serialized, content-addressable, versioned (schema version in canonical content),
stable identifiers (derived node ids). Consumes Blueprints; produces work DESCRIPTIONS only —
no execution behavior anywhere (no timers, no scheduling, no I/O; verified by boundary +
tests). Upholds INV-1 (immutable validated manifest), INV-3 (self-containment enabler),
INV-5 (declarative work), INV-10 in spirit (content-derived identity).
