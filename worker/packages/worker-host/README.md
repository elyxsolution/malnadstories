# @workerv2/worker-host

The Worker V2 **Worker Host** — the single **composition root**. It wires every previously-built
platform into a complete, executable album-generation pipeline and drives it end to end.

> **Scope (task-phase 18).** Composition root + dependency composition + service registry + processor
> registration + backend registration + artifact-store wiring + repository wiring + execution
> bootstrap + run executor + end-to-end integration harness. It introduces **no** new business logic,
> rendering algorithm, document format, or orchestration semantics — it is purely wiring.

```
Control Plane → Coordinator → Execution Adapter → registered Processors → registered Backend
              → Artifact Store → Document → PDF Export → PDF Artifact
```

## What it does

- **Constructs & injects everything** — one `ContentAddressedStore` (the SDK `ArtifactGateway` **and**
  the image-backend `ArtifactBytesPort`), the image backend(s), the processor registry, the
  capability negotiator, the persistence repositories. Full DI: **no global singletons, no ambient
  services, no hidden state**. Two hosts are completely isolated.
- **Registers every completed processor** under one resolver: `image.validate`, `image.decode`,
  `image.metadata`, `image.exif-orientation`, `image.color-normalize`, `image.format-normalize`,
  `surface.render` (composition adapter), `album.assemble` (document adapter), `document.export.pdf`.
  Each stays independently deployable + testable; the host only registers them.
- **Registers image backends** in a `BackendRegistry` and selects one by **configuration** (never by
  processor logic). The deterministic reference backend is canonical; a native/GPU backend is a
  drop-in — swapping it changes **only** the host wiring.
- **Executes complete Runs** — `WorkerHost.run(blueprint)` compiles the Blueprint → Manifest, builds
  the Coordinator, drives it through the Execution Adapter (the `surface.render` + `album.assemble`
  nodes), then applies the PDF exporter to the assembled Document, producing the final PDF Artifact.
- **Surfaces observational diagnostics** — execution summary, processor execution order, produced
  artifacts, duration, retry info, and validation failures. Diagnostics are **observational only**;
  nothing here feeds back into execution.

## What it does not

Implement rendering, PDF generation, image processing, or business logic; modify Coordinator or
Processor SDK behavior; or introduce new orchestration semantics. The composition root only
constructs, registers, and drives.

## Determinism

Given an identical Blueprint + seeded page-source Artifacts + host config, a run always produces the
**same Artifact identities** (content-addressed). A deterministic monotonic clock drives the run, so
the recorded dispatch order + duration are meaningful while the run stays reproducible; artifact
identity never depends on the clock.

## The adapter processors

`surface.render` and `album.assemble` are **thin composition-root bindings** of the Manifest's
processor names to existing engines — `surface.render` drives the `CompositionEngine` (ADR-0016),
`album.assemble` drives the Document Builder (ADR-0017). They contain **no** rendering algorithm or
document format; registering these names is what lets the Coordinator execute the manifest.

## Boundaries

As the ONLY composition root, it depends "outward" on every platform it wires (control-plane,
coordinator, execution-adapter, runtime, processing, processor-sdk, manifest, blueprint,
artifact-store, persistence, image-backend, image-processors, composition, document, pdf-export) plus
the foundation leaves. **Nothing depends on this package** — the dependency direction stays acyclic,
and no other package performs any wiring. Enforced by `scripts/check-boundaries.mjs`.
