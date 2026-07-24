# Architecture Decision Records (ADRs)

This directory is the **immutable record of architectural decisions** for Worker V2. New
architectural facts enter the system **only** here (Engineering Playbook §8.2, Implementation
Guide §18). The ADS and the frozen planning suite change only via an accepted ADR.

## Rules

- **Append-only.** ADRs are never deleted. A superseded ADR is marked
  `Status: Superseded by ADR-NNNN`; its content stays for the historical record.
- **Numbered sequentially.** `NNNN-kebab-title.md`, starting at `0001`. `0000` is the template.
- **Record rejected alternatives.** Every ADR lists the options considered and why the losers
  lost (Phase Plan Rec 20).
- **Accepted before implementation.** The work an ADR authorizes may proceed only once the ADR
  is `Accepted`.
- **One decision per ADR.** Keep them small and focused.

## When an ADR is required

Whenever a decision changes architecture, a public contract, a versioned component's behaviour,
an invariant's interpretation, or introduces/retires a subsystem — **stop and write an ADR**
(Playbook §12 Stop Conditions).

## Index

| ADR | Title | Status |
|---|---|---|
| [0000](0000-adr-template.md) | ADR template | N/A (template) |
| [0001](0001-worker-v2-foundation-scope-and-layout.md) | Worker V2 foundation scope & repository layout | Accepted |
| [0002](0002-control-plane-domain-first-persistence-deferred.md) | Control Plane: domain model first, persistence deferred | Accepted |
| [0003](0003-runtime-dependency-boundary-and-plugin-framework.md) | Runtime dependency boundary & plugin framework scope | Accepted |
| [0004](0004-phase-3-infrastructure-contracts-not-implementations.md) | Phase 3 delivers infrastructure contracts, not implementations | Accepted |
| [0005](0005-in-memory-persistence-engine-and-domain-reconstitution.md) | In-memory persistence engine + domain reconstitution API | Accepted |
| [0006](0006-content-addressed-artifact-platform.md) | Content-addressed Artifact Platform (byte store, registry, provenance) | Accepted |
| [0007](0007-declarative-processing-framework.md) | Declarative processing framework (the pipeline model without an engine) | Accepted |
| [0008](0008-content-addressable-blueprint-platform.md) | Content-addressable Blueprint Platform (model, compiler, identity) | Accepted |
| [0009](0009-immutable-product-platform.md) | Immutable Product Platform (definitions, catalogs, resolution to BlueprintSource) | Accepted |
| [0010](0010-content-addressable-manifest-platform.md) | Content-addressable Manifest Platform (model, compiler, processing reuse) | Accepted |
| [0011](0011-deterministic-execution-coordinator.md) | Deterministic execution Coordinator (event-sourced reducer, no infrastructure) | Accepted |
| [0012](0012-execution-adapter-drives-pure-coordinator.md) | Execution Adapter drives the pure Coordinator through replaceable seams | Accepted |
| [0013](0013-processor-sdk-framework.md) | Processor SDK: a rendering-independent framework for building Artifact processors | Accepted |
| [0014](0014-image-foundation-processors.md) | Image Foundation Processors: deterministic, rendering-independent image normalization | Accepted |
| [0015](0015-native-image-backend.md) | Native Image Backend: a replaceable, deterministic pixel-processing backend | Accepted |
| [0016](0016-page-composition-engine.md) | Page Composition Engine: a deterministic Blueprint → page-Artifact compositor | Accepted |
| [0017](0017-document-assembly-platform.md) | Document Assembly Platform: an immutable, format-independent document model | Accepted |
| [0018](0018-pdf-export-processor.md) | PDF Export Processor: the first concrete, deterministic document exporter | Accepted |
| [0019](0019-worker-host-composition-root.md) | Worker Host: the single composition root & end-to-end album pipeline | Accepted |
