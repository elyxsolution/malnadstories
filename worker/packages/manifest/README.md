# @workerv2/manifest

The Worker V2 **Manifest Platform** — the immutable, deterministic, **content-addressable**
description of EXECUTABLE WORK derived from a Blueprint. Pure data + pure functions: the
platform compiles, validates, serializes, hashes, and diffs manifests; it never executes,
schedules, renders, or stores anything.

> **Scope (task-phase 9 / the frozen Manifest phase).** Manifest model + contracts,
> declarative compiler (blueprint intent → processing intent), processing/dependency graph,
> explicit artifact bindings, validation (invariants M1–M11), canonical serialization,
> hashing/identity, schema versioning, diff model, processing bridge. **Not here:**
> coordinator/queue/scheduling, worker execution, rendering, image processing, PDF
> generation, vendor integrations.

## Boundaries

Depends on the foundation leaves + `@workerv2/control-plane` (album id) +
`@workerv2/infra-contracts` (`StorageKey`) + `@workerv2/blueprint` (the compiler CONSUMES
blueprints) + `@workerv2/processing` (**reused contracts** — node ids are `StepId`s,
bindings are `ArtifactInputBinding`s, and the retry/timeout/cancellation/failure/capability
models are the processing framework's own; the DAG ordering reuses `orderStepGraph`). No
storage/runtime dependency; hashing is local sha256, byte-compatible with artifact and
blueprint addressing.

## Design

- **Model = a DAG of work nodes.** Each `WorkNode` explicitly declares the artifacts it
  **consumes** (content-addressed bindings or upstream node outputs) and the outputs it
  **produces**, the processor by registry NAME (data, never code), required runtime
  capabilities, and declarative policies. Stable DERIVED ids (`render:cover`,
  `render:spread:NNNN`, `assemble:album`) make the diff model meaningful.
- **The canonical translation.** `compileManifest(blueprint)`: one `surface.render` node per
  surface — consuming the blueprint ITSELF as a content-addressed artifact (key = its own
  hash, ADR-0008) plus that surface's placed images — and one `album.assemble` node
  consuming every `page` output in semantic order. Self-contained: an engine needs the
  manifest + artifact store, nothing else (INV-3 enabler).
- **One validation gate.** `validateManifest` (M1–M11: schema version, album id, blueprint
  provenance hash, unique/sorted ids, canonical orderings, no dangling references/bindings,
  binding-to-declared-output consistency, policy validity via the PROCESSING validators,
  acyclic dependency graph). The compiler routes its own output through it; unknown keys are
  dropped, so nothing outside the schema reaches the identity.
- **Identity = canonical content only.** `serializeManifest` (canonical JSON) →
  `hashManifest` (`sha256:<hex>`). Provenance traces (e.g. future resolver-chain traces)
  attach to the `CompiledManifest` WRAPPER (`attachTrace`) — never to the manifest value —
  so they can never affect identity (test-proven).
- **Processing bridge.** `toPipeline(compiled)` maps work nodes to steps LOSSLESSLY (the
  types are shared) through `definePipeline` — proving by construction that every manifest
  is consumable by the declarative processing model and any future engine.
- **Graph views.** `orderManifest` (canonical total order + parallel stages, reusing the
  processing algorithm), `consumedArtifacts` (deduped, sorted external inputs),
  `producedOutputs`, `terminalNodes` (the final deliverables).
