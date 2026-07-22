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
