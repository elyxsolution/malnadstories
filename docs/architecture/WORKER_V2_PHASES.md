# Worker V2 — Engineering Execution Plan & Phase Blueprint

> **Document type:** Engineering Backlog & Execution Blueprint (Planning Only)
> **Status:** Authoritative execution plan — the phase decomposition every implementation phase follows
> **Governs:** *How and in what order* Worker V2 is built, phase by phase, subsystem by subsystem
> **Subordinate to:** The Worker V2 Architecture Design Specification (ADS) — the architectural source of truth
> **Companion to:** `WORKER_V2_IMPLEMENTATION_GUIDE.md` — the execution *discipline* (principles, gates, workflow)
> **Extends the ADS with:** The 25 architecture-review recommendations recorded in §2 (additive, never replacing the ADS)
> **Owner:** Principal Software Architect / Technical Program Manager, Worker V2

---

## Table of Contents

1. [How to Read This Document](#1-how-to-read-this-document)
2. [Incorporated Architecture Review Recommendations](#2-incorporated-architecture-review-recommendations)
3. [Architectural Invariants (Permanent Laws)](#3-architectural-invariants-permanent-laws)
4. [Platform Framing — Premium Album Manufacturing Platform](#4-platform-framing--premium-album-manufacturing-platform)
5. [Version Freezing & The Version Matrix](#5-version-freezing--the-version-matrix)
6. [Revised Phase Roadmap Overview](#6-revised-phase-roadmap-overview)
7. [Phase Definitions](#7-phase-definitions)
   - [Phase −1 — Worker Reset](#phase-1--worker-reset)
   - [Phase 0 — Foundation & Contracts](#phase-0--foundation--contracts)
   - [Phase 1 — Control Plane & Domain Lifecycles](#phase-1--control-plane--domain-lifecycles)
   - [Phase 2 — Worker Runtime Platform](#phase-2--worker-runtime-platform)
   - [Phase 3 — Storage & Immutable Artifact Platform](#phase-3--storage--immutable-artifact-platform)
   - [Phase 4 — Product Platform](#phase-4--product-platform)
   - [Phase 5 — Image Processing Platform](#phase-5--image-processing-platform)
   - [Phase 6 — Blueprint Platform](#phase-6--blueprint-platform)
   - [Phase 7 — Manifest Platform](#phase-7--manifest-platform)
   - [Phase 8 — Render Engine & PDF Platform](#phase-8--render-engine--pdf-platform)
   - [Phase 9 — Pipeline & Coordinator Platform](#phase-9--pipeline--coordinator-platform)
   - [Phase 10 — Observability, Cost Accounting & Metrics Platform](#phase-10--observability-cost-accounting--metrics-platform)
   - [Phase 11 — Security & Compliance Hardening](#phase-11--security--compliance-hardening)
   - [Phase 12 — Performance, Budgets & Scale Readiness](#phase-12--performance-budgets--scale-readiness)
   - [Phase 13 — Manufacturing & Vendor Platform (Foundations + Reserved Seams)](#phase-13--manufacturing--vendor-platform-foundations--reserved-seams)
   - [Phase 14 — Integration & End-to-End Validation](#phase-14--integration--end-to-end-validation)
   - [Phase 15 — Production Cutover](#phase-15--production-cutover)
   - [Phase 16 — Reserved Future Platforms (Additive Roadmap)](#phase-16--reserved-future-platforms-additive-roadmap)
8. [Cross-Phase Dependency Diagram](#8-cross-phase-dependency-diagram)
9. [Critical Path](#9-critical-path)
10. [Parallel Work Opportunities](#10-parallel-work-opportunities)
11. [Review Gates](#11-review-gates)
12. [Quality Gates](#12-quality-gates)
13. [Phase Exit Criteria](#13-phase-exit-criteria)
14. [Architecture Validation Checklist](#14-architecture-validation-checklist)
15. [Testing Progression](#15-testing-progression)
16. [Documentation Progression](#16-documentation-progression)
17. [Suggested Commit Strategy](#17-suggested-commit-strategy)
18. [Suggested Branch Strategy](#18-suggested-branch-strategy)
19. [Suggested Implementation Order](#19-suggested-implementation-order)
20. [Subsystem-to-Phase Ownership Matrix](#20-subsystem-to-phase-ownership-matrix)
21. [Final Consistency Review](#21-final-consistency-review)

---

## 1. How to Read This Document

This document is the **engineering backlog and execution blueprint** for Worker V2. It converts the
`WORKER_V2_IMPLEMENTATION_GUIDE.md` (which sets execution *discipline*) into a concrete,
phase-by-phase plan (which sets execution *content and order*).

- **Authority.** The ADS remains the architectural source of truth. This plan may **sequence,
  decompose, and schedule** the architecture; it may not **change** it. Any decomposition here that
  appears to alter architecture is a defect in this document, to be corrected against the ADS.
- **Recommendations are additive.** §2 records 25 architecture-review recommendations that *extend*
  the ADS. They are woven into the phases below. Where a recommendation designates future work, this
  plan **reserves** a phase, a seam, and a "Future Extensions" slot for it so that it remains
  **additive** — never a later redesign.
- **Every phase owns exactly one primary subsystem** (§20 proves this), ends with a **measurable
  milestone** (item 22 of each phase), and is complete only when it satisfies the shared Definition
  of Done and Quality Gates.
- **Reserved ≠ built.** Several subsystems (plugins, multi-vendor manufacturing, replay platform, run
  explorer, mobile, quality scoring, DX generators, full business analytics) are **reserved** —
  their seams and contracts are designed within the core phases, but their full implementation is
  deferred to Phase 16 and explicitly out of the core-delivery critical path.
- **Estimates are relative.** Complexity, risk, and duration are relative ratings to guide attention
  and sequencing, refined during per-phase planning; they are not calendar commitments.

---

## 2. Incorporated Architecture Review Recommendations

The following 25 recommendations extend the ADS and are folded into the plan. Each is mapped to the
phase(s) that own it. "Owned" = built/frozen there; "Seam" = its extension point is reserved there.

| # | Recommendation | Primary Home | Seam / Reserved In |
|---|---|---|---|
| 1 | Treat as a **Premium Album Manufacturing Platform** (mindset) | §4 (framing) + all phases | — |
| 2 | Dedicated **Product Platform** (catalog, dimensions, cover/paper/binding/lamination, vendor profiles, pricing versions) | Phase 4 | Vendor exec → Phase 13 |
| 3 | **Blueprint Platform** — separate Blueprint compilation from Manifest (Compiler → Layout → Template → Theme → Manifest Builder) | Phase 6 → Phase 7 | — |
| 4 | **Freeze product-related versions** (Product/Blueprint/Template/Theme/Sticker-Pack/Font-Pack/Processing-Profile/Vendor-Profile) | §5 + each producing phase | Version registry: Phase 1 |
| 5 | **Architectural Invariants** as permanent laws + review checkpoints | §3 + §14 | Enforced every phase |
| 6 | Reserve **Plugin Architecture** (AI enhance, OCR, video, vendor dispatch, translation, face detect) | Phase 2 (runtime seam) | Full: Phase 16 |
| 7 | **Processing Profiles** (Classic/Premium/Luxury/Archive/Draft) own render params | Phase 4 (define) | Consumed: Phases 5, 8 |
| 8 | Reserve **Cost Accounting** (CPU/mem/duration/storage/R2 reads/writes/est. cost) per run | Phase 10 | Hooks: Phases 2, 9 |
| 9 | **Version Matrix** planning (runtime/manifest/image/pdf/blueprint/template/fonts/products/themes/profiles/vendor) | §5 + Phase 10 (recording) | Registry: Phase 1 |
| 10 | Reserve **Performance Budgets** per subsystem | Phase 12 (enforce) | Declared: every phase (item 22 area) |
| 11 | **Print Vendor abstraction** (multi-vendor) | Phase 13 | — |
| 12 | **Manufacturing Pipeline** (Print-Ready→Vendor→Printing→Binding→Packaging→Dispatch→Delivered) | Phase 13 | Lifecycle states: Phase 1 |
| 13 | **Album Lifecycle** (Draft→Building→Submitted→Processing→Needs-Fix→Ready→Ordered→Manufacturing→Delivered→Archived) | Phase 1 | Manufacturing tail: Phase 13 |
| 14 | **Asset Lifecycle** (Incoming→Verified→Canonical→Derivative→Referenced→Archived→Deleted) | Phase 1 (states) + Phase 3/5 (transitions) | — |
| 15 | **Product Catalog** subsystem | Phase 4 | — |
| 16 | **Worker Runtime** architecture — Runtime separated from Roles (plugins, capability registry, lifecycle, DI) | Phase 2 | Plugin exec: Phase 16 |
| 17 | Reserve **Processing Graph visualization** / Run Explorer | Phase 10 (data model) | Full UI: Phase 16 |
| 18 | **Replay Platform** — differentiate Retry / Replay / Rebuild / Regenerate | Phase 9 (semantics/seam) | Full platform: Phase 16 |
| 19 | Separate **Technical Events** and **Domain Events** | Phase 1 | — |
| 20 | Expand **ADR planning** — reserve ADRs for rejected alternatives | Phase 0 (ADR infra) + §16 | Ongoing |
| 21 | Reserve **Developer Experience** (pipeline generator, plugin generator, scaffolding) | Phase 16 | Hooks: Phase 0 |
| 22 | Reserve **Album Quality Scoring** | Phase 16 | Signals: Phases 5, 6 |
| 23 | Reserve **Vendor Validation Profiles** | Phase 13 | — |
| 24 | Reserve **Mobile Platform** planning | Phase 16 | Contracts: Phase 1/7 |
| 25 | Reserve **Business Metrics** (albums/day, pages/day, vendor throughput, processing cost, avg time, revenue/album) | Phase 10 (technical) + Phase 16 (analytics) | — |

---

## 3. Architectural Invariants (Permanent Laws)

These are the **permanent architectural laws** of Worker V2. They hold in every phase, are never
traded away for expedience, and are **explicit review checkpoints** in every phase's Review
Checklist (§14 aggregates them). A change that would violate an invariant is a **Stop-and-ADR**
event (Implementation Guide §18) — implementation halts until the ADS is amended by an accepted ADR.

| ID | Invariant | Meaning |
|---|---|---|
| **INV-1** | **The Manifest is immutable.** | Once built, a manifest is never mutated; corrections produce a new, versioned manifest. |
| **INV-2** | **Artifacts are immutable.** | Every produced artifact is write-once; new outputs get new identities, never overwrites. |
| **INV-3** | **The Renderer never queries the domain database.** | The render engine's only input is a validated manifest; it holds no domain/DB/session access. |
| **INV-4** | **Workers never communicate directly.** | All coordination flows through the Control Plane / queue; no worker-to-worker channels. |
| **INV-5** | **Pipelines remain declarative.** | A pipeline is data describing steps + dependencies; orchestration interprets it — no imperative pipelines. |
| **INV-6** | **One active run per album.** | At most one processing run is active for an album at any time; concurrency is serialized by the Control Plane. |
| **INV-7** | **All handlers are idempotent.** | Every job handler can run repeatedly (retry/duplicate/crash-recovery) with no side-effect drift. |
| **INV-8** | **The Control Plane is the source of truth.** | Run/album/asset state and lineage live in the Control Plane; nothing else is authoritative. |
| **INV-9** | **All transitions are audited.** | Every lifecycle/state transition emits an immutable audit record. |
| **INV-10** | **No mutable storage keys.** | Storage keys are content/identity-addressed and never rewritten in place. |
| **INV-11** | **Versions are frozen at run start.** | A run pins the full version set (§5) at inception; a run never mixes versions mid-flight. |
| **INV-12** | **Technical and Domain events are separate.** | Operational/technical events and business/domain events are distinct streams with distinct contracts (Rec 19). |

> Any phase that introduces a subsystem must demonstrate — in its Review Checklist and tests — that
> it upholds every invariant relevant to it. Invariants are not aspirational; they are gates.

---

## 4. Platform Framing — Premium Album Manufacturing Platform

Worker V2 is designed and built as a **Premium Album Manufacturing Platform**, not a generic
image-processing service (Rec 1). This framing changes emphasis throughout the plan:

- **The product is a manufactured physical album**, not a rendered file. The render artifact is one
  station on a manufacturing line that ends in a printed, bound, packaged, delivered object.
- **Product definition is first-class.** Dimensions, cover/paper/binding/lamination, and vendor
  capabilities are domain data (Product Platform, Phase 4), not constants buried in render code.
- **Quality, cost, and provenance are outputs**, not afterthoughts. Every run should ultimately be
  explainable in terms of what it made, what it cost, which frozen versions produced it, and how
  good the result was.
- **Vendors are pluggable manufacturers.** The plan reserves a print-vendor abstraction and a
  manufacturing pipeline so the platform can grow from one vendor to many without redesign
  (Phase 13).

This mindset is why the roadmap elevates the **Control Plane**, **Product Platform**, and
**Blueprint Platform** to first-class phases rather than treating everything as "the worker."

---

## 5. Version Freezing & The Version Matrix

Determinism and reproducibility (Implementation Guide §3) require that a run is executed against a
**frozen, fully-specified set of versions** (Rec 4, Rec 9, INV-11).

### 5.1 Frozen Version Set

At run inception the Control Plane pins a complete **Version Set**, which includes at minimum:

`Worker Runtime · Manifest Schema · Image Engine · PDF/Render Engine · Blueprint · Template · Theme ·
Font Pack · Sticker Pack · Processing Profile · Product · Vendor Profile`

### 5.2 Ownership of Each Version

Each version is **defined and frozen by the phase that owns its producing subsystem**, and
**recorded** centrally by the Control Plane (Phase 1) and surfaced by Observability (Phase 10):

| Version | Frozen by (phase) |
|---|---|
| Worker Runtime | Phase 2 |
| Manifest Schema | Phase 7 |
| Image Engine + Processing Profile application | Phase 5 (profile defined Phase 4) |
| PDF / Render Engine | Phase 8 |
| Blueprint / Template / Theme | Phase 6 |
| Font Pack / Sticker Pack | Phase 6 (catalog) / Phase 4 (product linkage) |
| Product / Vendor Profile / Pricing | Phase 4 (vendor exec Phase 13) |

### 5.3 The Version Matrix

The **Version Matrix** is the recorded cross-product of "which version of every subsystem produced
this run's outputs." Its **registry/discipline** is established in Phase 1; its **recording and
surfacing** is delivered in Phase 10. Every run carries its Version Matrix immutably, enabling exact
reproduction (rebuild) and precise blast-radius analysis when any version changes.

---

## 6. Revised Phase Roadmap Overview

The original 13-step roadmap is **re-decomposed** for architectural clarity (as invited by the
task). Each phase now represents **one complete subsystem**. Purely-future capabilities are
consolidated into a single **reserved** phase (Phase 16) so the core roadmap stays honest about what
is actually built.

| Phase | Name | Primary Subsystem | Milestone |
|---|---|---|---|
| **−1** | Worker Reset | Clean slate (V1 deleted) | M1 — Clean Slate |
| **0** | Foundation & Contracts | Repo/build/CI + shared-contract skeleton + ADR infra | M2 — Foundation Ready |
| **1** | Control Plane & Domain Lifecycles | Control Plane (source of truth, lifecycles, events, audit, version registry) | M3 — Control Plane Ready |
| **2** | Worker Runtime Platform | Runtime (roles/capability/DI/plugin seam, idempotent handlers) | M4 — Runtime Ready |
| **3** | Storage & Immutable Artifact Platform | Artifact store (content-addressed, immutable, asset lifecycle) | M5 — Artifact Platform Ready |
| **4** | Product Platform | Product catalog, materials, processing profiles, pricing/vendor profiles + versions | M6 — Product Platform Ready |
| **5** | Image Processing Platform | Image pipeline (ingest→canonical→derivative), profile-driven | M7 — Image Platform Ready |
| **6** | Blueprint Platform | Blueprint compiler + layout/template/theme resolvers | M8 — Blueprint Ready |
| **7** | Manifest Platform | Manifest builder, schema, validation, immutability | M9 — Manifest Ready |
| **8** | Render Engine & PDF Platform | Deterministic renderer from manifest | M10 — Renderer Ready |
| **9** | Pipeline & Coordinator Platform | Declarative pipelines, run orchestration, replay semantics | M11 — Pipeline Ready |
| **10** | Observability, Cost Accounting & Metrics | Logs/metrics/traces + cost + version matrix + business-metric seam | M12 — Observable & Costed |
| **11** | Security & Compliance Hardening | Security audit of the whole platform | M13 — Hardened |
| **12** | Performance, Budgets & Scale Readiness | Performance budgets + scale seams | M14 — Performant & Scale-Ready |
| **13** | Manufacturing & Vendor Platform | Print-vendor abstraction + manufacturing pipeline + vendor validation | M15 — Manufacturing-Ready (Foundations) |
| **14** | Integration & End-to-End Validation | Whole-system property proofs | M16 — Validated |
| **15** | Production Cutover | Rollout + V1 retirement + rollback rehearsal | M17 — Production Ready |
| **16** | Reserved Future Platforms | Plugins, replay, run explorer, DX, quality scoring, mobile, analytics | M18 — Extension Roadmap Ratified |

> **Rationale for the re-decomposition.** The review elevates three subsystems the original roadmap
> under-weighted: the **Control Plane** (source of truth + lifecycles + events, now Phase 1, ahead
> of storage), the **Product Platform** (new Phase 4), and the **Blueprint Platform** (new Phase 6,
> cleanly separated from the Manifest in Phase 7). Worker Runtime is separated from worker roles
> (Phase 2). Observability now explicitly absorbs Cost Accounting and the Version Matrix. A single
> **reserved** phase (16) keeps all "future/additive" capabilities visible without pretending they
> are core deliverables.

---

## 7. Phase Definitions

> Each phase lists all 22 required elements. Prose is intentionally tight so the plan stays
> followable. "Architecture Sections Referenced" cites ADS sections by role; exact section numbers
> are resolved against the ADS during per-phase planning.

---

### Phase −1 — Worker Reset

1. **Purpose.** Establish a clean slate by fully retiring Worker V1 so exactly one processing platform exists going forward.
2. **Objectives.** Inventory every V1 dependency; confirm nothing live depends on V1; delete V1 handlers, queue wiring, and dead paths under version control.
3. **Deliverables.** V1 removed from the working tree; a documented dependency inventory; a rollback tag capturing the last V1 state.
4. **Subsystems Covered.** None built; legacy retirement only.
5. **Architecture Sections Referenced.** ADS migration/cutover context; Implementation Guide §4.2 (why V1 is deleted).
6. **Dependencies.** None (entry point).
7. **Repository Areas Affected.** Existing `worker/` tree; app-side enqueue call sites that target V1 jobs.
8. **Expected Folder Structure (conceptual).** Post-reset: an emptied worker area awaiting the V2 foundation; no V2 folders yet.
9. **Core Components.** N/A (removal).
10. **Interfaces.** Temporary: identify the app→worker enqueue contract points that V2 will re-home.
11. **Public Contracts.** None introduced; note contracts V1 exposed so V2 can re-provide them intentionally.
12. **Internal Contracts.** None.
13. **Major Risks.** Deleting V1 before confirming no live dependency; losing implicit behavior V1 provided. *Mitigation:* dependency inventory + rollback tag before deletion.
14. **Acceptance Criteria.** Repo builds with V1 absent; no references to V1 handlers remain; rollback tag exists.
15. **Testing Strategy.** Build/compile verification; grep-level absence checks; confirm no test depends on V1.
16. **Definition of Done.** Guide DoD clauses relevant to removal met; clean build; documented inventory + tag.
17. **Review Checklist.** No dead V1 code; no dual paths; rollback tag verified; invariants unaffected.
18. **Future Extensions.** None.
19. **Estimated Complexity.** Trivial.
20. **Estimated Risk.** Low.
21. **Estimated Duration.** Very Low (~2%).
22. **Milestone Produced.** **M1 — Clean Slate.**

---

### Phase 0 — Foundation & Contracts

1. **Purpose.** Lay the buildable, testable, reviewable foundation and the shared-contract skeleton every later phase depends on.
2. **Objectives.** Stand up repo structure, build tooling, CI, linting, test harness; define the shared-contract skeleton (types/interfaces placeholders) and DI seam conventions; establish the ADR system.
3. **Deliverables.** Green CI on an empty-but-structured tree; contract/interface skeleton; ADR directory + template; coding/versioning conventions doc.
4. **Subsystems Covered.** Repository platform + shared-contracts skeleton + ADR infrastructure.
5. **Architecture Sections Referenced.** ADS repository/architecture-overview + contracts sections; Implementation Guide §5, §13, §14.
6. **Dependencies.** Phase −1.
7. **Repository Areas Affected.** Root tooling; new platform packages/apps skeleton; docs/architecture; ADR directory.
8. **Expected Folder Structure (conceptual).** Separation of *apps* (deployable) from *packages* (libraries); a neutral *contracts* home; *docs*, *scripts*, *ops* areas. Exact names fixed here per ADS.
9. **Core Components.** Build/test/lint configuration; contract skeleton package; ADR tooling; DX hooks placeholder (Rec 21 seam).
10. **Interfaces.** Interface/DI conventions defined (naming, boundary rules) — not yet implemented per subsystem.
11. **Public Contracts.** The *shape* of the shared-contracts package (versioning policy, stability rules).
12. **Internal Contracts.** Repo conventions: module boundaries, dependency direction rules.
13. **Major Risks.** A weak contract skeleton forcing churn later. *Mitigation:* invest in contract stability policy; ADR-gate contract changes.
14. **Acceptance Criteria.** CI green; contract skeleton compiles and is importable; ADR-000 (template/decision-log) exists; conventions documented.
15. **Testing Strategy.** Meta-tests: build passes, lint passes, sample test runs; contract skeleton type-checks.
16. **Definition of Done.** Guide DoD met; green build; documentation/ADR infra in place; no placeholder TODOs.
17. **Review Checklist.** Boundaries match ADS; dependency direction enforced; contract stability policy explicit; invariants documented as checkpoints.
18. **Future Extensions.** DX generators/scaffolding (Rec 21) reserved to Phase 16; hooks left here.
19. **Estimated Complexity.** Moderate.
20. **Estimated Risk.** Low–Medium.
21. **Estimated Duration.** Medium (~10%).
22. **Milestone Produced.** **M2 — Foundation Ready.**

---

### Phase 1 — Control Plane & Domain Lifecycles

1. **Purpose.** Build the **source of truth** (INV-8): the Control Plane that owns run/album/asset state, lifecycle transitions, the event model, audit, the one-active-run guarantee, and the version registry.
2. **Objectives.** Model and enforce the **Album Lifecycle** (Rec 13) and **Asset Lifecycle** (Rec 14) states; separate **Technical vs Domain Events** (Rec 19, INV-12); implement audited transitions (INV-9); enforce **one active run per album** (INV-6); stand up the **version registry** for version freezing (Rec 4/9, INV-11).
3. **Deliverables.** Control Plane data model + transition engine; lifecycle state machines (album, asset, run); dual event streams; audit log; version-registry service; one-active-run enforcement.
4. **Subsystems Covered.** Control Plane; Domain lifecycles; Event model; Audit; Version registry.
5. **Architecture Sections Referenced.** ADS control-plane, state-machine, event, audit, and versioning sections.
6. **Dependencies.** Phase 0.
7. **Repository Areas Affected.** Control-plane package; contracts (lifecycle/event/version schemas); persistence for state/audit.
8. **Expected Folder Structure (conceptual).** A control-plane package (state machines, event bus contracts, audit, version registry) with its contracts published in the shared-contracts area.
9. **Core Components.** Transition engine; lifecycle definitions; technical-event + domain-event buses; audit writer; run registry (one-active-run); version registry.
10. **Interfaces.** `StateStore`, `TransitionEngine`, `EventPublisher` (technical/domain), `AuditSink`, `VersionRegistry`, `RunRegistry` — all behind abstractions (INV, DI).
11. **Public Contracts.** Lifecycle state enums + legal transitions; event schemas (technical/domain); version-set schema; audit-record schema.
12. **Internal Contracts.** Transition validation rules; run-lock semantics; version-freeze-at-start rule (INV-11).
13. **Major Risks.** Wrong lifecycle/event modeling rippling everywhere; weak run-lock. *Mitigation:* model review + property tests on transitions and locking.
14. **Acceptance Criteria.** Illegal transitions rejected; every transition audited; concurrent run attempts serialize to one; a run pins a complete version set; technical/domain events are separable.
15. **Testing Strategy.** State-machine property tests (no illegal transition); concurrency tests for one-active-run; audit-completeness tests; event-separation tests.
16. **Definition of Done.** Guide DoD; INV-6/8/9/11/12 demonstrably enforced; contracts frozen + versioned.
17. **Review Checklist.** INV-6, INV-8, INV-9, INV-11, INV-12 upheld; lifecycles match ADS; events cleanly separated; version registry complete.
18. **Future Extensions.** Manufacturing lifecycle tail (Phase 13); run-explorer data model (Phase 10); replay semantics (Phase 9) build on these transitions.
19. **Estimated Complexity.** High.
20. **Estimated Risk.** High.
21. **Estimated Duration.** High.
22. **Milestone Produced.** **M3 — Control Plane Ready.**

---

### Phase 2 — Worker Runtime Platform

1. **Purpose.** Build the **Worker Runtime** as distinct from worker **roles** (Rec 16): a runtime owning lifecycle, dependency injection, a **capability registry**, and a reserved **plugin seam** (Rec 6), running **idempotent handlers** (INV-7).
2. **Objectives.** Separate runtime (how a worker boots/lives/injects) from roles (what a worker does); implement the capability registry + DI container; define the idempotent handler contract; expose cost-accounting + performance hooks; reserve the plugin registration seam.
3. **Deliverables.** Runtime bootstrap; DI container; capability registry; handler lifecycle (claim→execute→ack with idempotency); plugin-seam interfaces; runtime version freeze.
4. **Subsystems Covered.** Worker Runtime; Handler lifecycle; Capability registry; Plugin seam (reserved).
5. **Architecture Sections Referenced.** ADS worker-runtime, handler, plugin, and DI sections.
6. **Dependencies.** Phase 1 (workers report to Control Plane; INV-4 — no worker-to-worker comms).
7. **Repository Areas Affected.** Runtime package; handler-contract package; capability registry; plugin-seam contracts.
8. **Expected Folder Structure (conceptual).** A runtime package (bootstrap, DI, registry, handler base) separate from role definitions that will be filled by later processing phases.
9. **Core Components.** Runtime bootstrap; DI container; capability registry; idempotent-handler base; queue-consumer abstraction; hook points for cost/perf.
10. **Interfaces.** `Handler`, `Capability`, `RuntimeContext`, `PluginRegistrar` (reserved), `QueueConsumer` (abstraction; INV-4/5).
11. **Public Contracts.** Handler contract (idempotency, result shape, error semantics); capability descriptor; plugin registration contract (reserved).
12. **Internal Contracts.** DI wiring rules; runtime lifecycle; hook invocation order.
13. **Major Risks.** Runtime/role coupling leaking; non-idempotent handler contract. *Mitigation:* enforce idempotency in the base contract + tests; keep roles empty here.
14. **Acceptance Criteria.** A trivial no-op handler runs under the runtime; capabilities resolve via registry; DI injects dependencies; plugin seam compiles unused; runtime version frozen.
15. **Testing Strategy.** Idempotency tests on the handler base (double-invoke = same effect); DI resolution tests; registry tests; INV-4 (no direct worker comms) verified structurally.
16. **Definition of Done.** Guide DoD; INV-4/7 enforced; runtime version registered; plugin seam documented as reserved.
17. **Review Checklist.** INV-4, INV-7 upheld; runtime≠roles separation clean; plugin seam additive-only; hooks present but inert.
18. **Future Extensions.** Full Plugin Architecture (Rec 6) → Phase 16; DX plugin generator (Rec 21) → Phase 16.
19. **Estimated Complexity.** High.
20. **Estimated Risk.** Medium–High.
21. **Estimated Duration.** High.
22. **Milestone Produced.** **M4 — Runtime Ready.**

---

### Phase 3 — Storage & Immutable Artifact Platform

1. **Purpose.** Provide the **content-addressed, immutable artifact store** (INV-2, INV-10) behind a storage abstraction, and implement **Asset Lifecycle** transitions for stored objects (Rec 14).
2. **Objectives.** Content/identity-addressed keys (no mutable keys, INV-10); write-once artifacts (INV-2); storage abstraction (DI); asset-lifecycle transitions (Incoming→Verified→Canonical→Derivative→Referenced→Archived→Deleted) wired to the Control Plane.
3. **Deliverables.** Storage abstraction; artifact writer/reader; content-addressing scheme; immutability guarantees; asset-lifecycle integration.
4. **Subsystems Covered.** Artifact storage; Content addressing; Asset lifecycle (storage side).
5. **Architecture Sections Referenced.** ADS storage/artifact/asset-lifecycle sections.
6. **Dependencies.** Phases 1 (lifecycle states/audit), 2 (runtime consumes storage).
7. **Repository Areas Affected.** Storage package; artifact contracts; asset-lifecycle transitions.
8. **Expected Folder Structure (conceptual).** A storage package with a provider abstraction and an immutable-artifact API; content-addressing utilities; asset-state adapters.
9. **Core Components.** `ArtifactStore` (write-once); content-address hasher; provider adapter (private object storage); asset-state transition adapter.
10. **Interfaces.** `ArtifactStore`, `StorageProvider`, `ContentAddress`, `AssetRef`.
11. **Public Contracts.** Artifact identity/addressing scheme; immutability guarantees; asset-ref contract.
12. **Internal Contracts.** Key derivation; write-once enforcement; archival/deletion semantics.
13. **Major Risks.** Addressing/immutability mistakes surfacing later as corruption or overwrite. *Mitigation:* write-once enforcement tests; no-overwrite assertions.
14. **Acceptance Criteria.** Identical content → identical address; a written artifact cannot be overwritten; asset transitions are audited; deletion respects referenced-state rules.
15. **Testing Strategy.** Content-addressing determinism tests; write-once/overwrite-refusal tests; asset-lifecycle transition tests.
16. **Definition of Done.** Guide DoD; INV-2/10 enforced; asset lifecycle integrated + audited.
17. **Review Checklist.** INV-2, INV-10 upheld; no mutable keys; abstraction clean (DI); asset transitions audited.
18. **Future Extensions.** Vendor/manufacturing artifacts (Phase 13) reuse this store; archive tiers reserved.
19. **Estimated Complexity.** Moderate.
20. **Estimated Risk.** Medium.
21. **Estimated Duration.** Medium.
22. **Milestone Produced.** **M5 — Artifact Platform Ready.**

---

### Phase 4 — Product Platform

1. **Purpose.** Establish the **Product Platform** (Rec 2, 15): the domain catalog of what is manufactured — album products, dimensions, cover/paper/binding/lamination, vendor profiles, pricing versions — and the **Processing Profiles** (Rec 7) that own rendering parameters.
2. **Objectives.** Model the product catalog and material options; define **Processing Profiles** (Classic/Premium/Luxury/Archive/Draft) as the owners of render/processing parameters; capture **vendor profiles** and **pricing versions**; freeze **Product/Processing-Profile/Vendor-Profile/Pricing versions** (Rec 4).
3. **Deliverables.** Product catalog model; material taxonomy; processing-profile definitions; vendor-profile records; pricing-version records; product version registry entries.
4. **Subsystems Covered.** Product catalog; Materials; Processing profiles; Vendor profiles (data); Pricing versions.
5. **Architecture Sections Referenced.** ADS product/catalog/pricing/processing-profile sections.
6. **Dependencies.** Phases 0 (contracts), 1 (version registry).
7. **Repository Areas Affected.** Product package; product contracts; processing-profile contracts; pricing/vendor-profile data.
8. **Expected Folder Structure (conceptual).** A product package (catalog, materials, profiles, pricing, vendor-profile definitions) with contracts published for downstream (blueprint/render) consumption.
9. **Core Components.** Catalog service; material/option registry; processing-profile registry; pricing-version store; vendor-profile store.
10. **Interfaces.** `ProductCatalog`, `ProcessingProfileRegistry`, `PricingVersion`, `VendorProfile`.
11. **Public Contracts.** Product descriptor; material options; processing-profile descriptor (render params); pricing-version schema; vendor-profile schema.
12. **Internal Contracts.** Catalog validation; profile→parameter mapping; version-freeze on selection.
13. **Major Risks.** Baking render params into code instead of profiles; unversioned pricing. *Mitigation:* profiles own params (Rec 7); pricing/product versions frozen (Rec 4).
14. **Acceptance Criteria.** A product resolves to concrete dimensions/materials + a processing profile; a run can pin product/profile/pricing/vendor versions; no render parameter is hardcoded outside a profile.
15. **Testing Strategy.** Catalog resolution tests; profile-parameter mapping tests; version-freeze tests; pricing-version selection tests.
16. **Definition of Done.** Guide DoD; profiles own render params; product/profile/pricing/vendor versions registered; INV-11 respected.
17. **Review Checklist.** Rec 2/7/15 satisfied; versions frozen (Rec 4); no hardcoded render logic; contracts stable.
18. **Future Extensions.** Vendor **execution** + validation profiles (Phase 13); album quality scoring signals (Phase 16).
19. **Estimated Complexity.** High.
20. **Estimated Risk.** High (contract-central).
21. **Estimated Duration.** High.
22. **Milestone Produced.** **M6 — Product Platform Ready.**

---

### Phase 5 — Image Processing Platform

1. **Purpose.** Build the deterministic, idempotent **image pipeline**: ingest → validate → sanitize → canonicalize → derive, driven by **Processing Profiles**, moving assets through the **Asset Lifecycle**.
2. **Objectives.** Safe input validation (format/magic-byte/bomb guards); canonical (master) + derivative generation; determinism; profile-driven parameters (Rec 7); asset-lifecycle transitions (Incoming→Verified→Canonical→Derivative); cost/perf hooks; freeze **Image Engine version**.
3. **Deliverables.** Image handler(s) on the runtime; validation stage; canonicalization; derivative generation; profile application; asset transitions; image-engine version.
4. **Subsystems Covered.** Image ingestion; Validation/sanitization; Canonical + derivative assets; Asset lifecycle (processing side).
5. **Architecture Sections Referenced.** ADS image-processing/asset sections.
6. **Dependencies.** Phases 2 (runtime), 3 (storage/artifacts), 4 (processing profiles).
7. **Repository Areas Affected.** Image package; image handler role; asset transitions; storage writes.
8. **Expected Folder Structure (conceptual).** An image package (validation, canonicalization, derivatives) exposing an image role that runs on the runtime and writes immutable artifacts.
9. **Core Components.** Validator; canonicalizer; derivative generator; profile applier; asset-state updater; cost/perf recorder hooks.
10. **Interfaces.** `ImageValidator`, `Canonicalizer`, `DerivativeGenerator`, `ProcessingProfile` (consumed).
11. **Public Contracts.** Canonical/derivative asset descriptors; validation result contract.
12. **Internal Contracts.** Determinism rules (no ambient nondeterminism); rejection semantics; idempotent re-processing.
13. **Major Risks.** Non-determinism or unsafe input entering the pipeline. *Mitigation:* deterministic re-encode; strict validation; idempotency + reproducibility tests.
14. **Acceptance Criteria.** Same input+profile → byte-identical canonical/derivatives; malicious/spoofed/bomb inputs rejected safely; re-processing is idempotent; assets transition + audit correctly.
15. **Testing Strategy.** Determinism/reproducibility tests; malicious-input corpus; idempotency tests; profile-variation tests; perf-hook smoke.
16. **Definition of Done.** Guide DoD; INV-2/7/10 upheld; image-engine version frozen; profiles drive params.
17. **Review Checklist.** Determinism proven; INV-7 idempotency; safe inputs; profile-driven; asset transitions audited.
18. **Future Extensions.** Plugin stages (AI enhance/OCR/face-detect/video — Rec 6) as additive runtime plugins (Phase 16); quality-scoring signals (Phase 16).
19. **Estimated Complexity.** High.
20. **Estimated Risk.** High.
21. **Estimated Duration.** High.
22. **Milestone Produced.** **M7 — Image Platform Ready.**

---

### Phase 6 — Blueprint Platform

1. **Purpose.** Build the **Blueprint Platform** (Rec 3): compile a blueprint through a resolver chain into a fully-resolved plan that the Manifest Builder (Phase 7) turns into a manifest. **Blueprint compilation is separated from manifest generation.**
2. **Objectives.** Implement the chain **Blueprint → Blueprint Compiler → Layout Resolver → Template Resolver → Theme Resolver** (stopping *before* manifest build); freeze **Blueprint/Template/Theme (+ font/sticker pack) versions** (Rec 4); keep resolvers pure/deterministic.
3. **Deliverables.** Blueprint model; blueprint compiler; layout/template/theme resolvers; resolved-plan output contract; blueprint/template/theme versions; font/sticker pack catalog linkage.
4. **Subsystems Covered.** Blueprint; Blueprint Compiler; Layout/Template/Theme resolvers; Font/Sticker pack catalog.
5. **Architecture Sections Referenced.** ADS blueprint/compiler/resolver/template/theme sections.
6. **Dependencies.** Phases 1 (versions), 4 (product → drives blueprint), 5 (canonical assets referenced).
7. **Repository Areas Affected.** Blueprint package; resolver modules; template/theme/font/sticker catalogs; resolved-plan contract.
8. **Expected Folder Structure (conceptual).** A blueprint package with a compiler and discrete resolver stages, emitting a resolved plan; catalogs for templates/themes/font+sticker packs.
9. **Core Components.** Blueprint compiler; layout resolver; template resolver; theme resolver; catalog readers; version pinning.
10. **Interfaces.** `BlueprintCompiler`, `LayoutResolver`, `TemplateResolver`, `ThemeResolver`, `ResolvedPlan` (output).
11. **Public Contracts.** Blueprint schema; resolved-plan schema (input to Manifest Builder); template/theme/pack descriptors.
12. **Internal Contracts.** Resolver purity/determinism; version-pin propagation; resolution ordering (layout→template→theme).
13. **Major Risks.** Blurring blueprint/manifest boundaries; non-deterministic resolution. *Mitigation:* hard separation (compiler stops at resolved plan); deterministic resolver tests.
14. **Acceptance Criteria.** A blueprint compiles deterministically to a resolved plan; resolver chain order enforced; versions pinned; **no manifest logic present** in this phase.
15. **Testing Strategy.** Deterministic compilation tests; per-resolver unit tests; version-pin propagation tests; boundary test (no manifest coupling).
16. **Definition of Done.** Guide DoD; blueprint/template/theme versions frozen; clean separation from manifest; INV-11 respected.
17. **Review Checklist.** Rec 3 chain honored; resolvers deterministic + pure; versions frozen; no manifest bleed-through.
18. **Future Extensions.** Additional resolvers as plugins; quality-scoring hooks; advanced theming (Phase 16).
19. **Estimated Complexity.** High.
20. **Estimated Risk.** High.
21. **Estimated Duration.** High.
22. **Milestone Produced.** **M8 — Blueprint Ready.**

---

### Phase 7 — Manifest Platform

1. **Purpose.** Build the **Manifest Builder** and manifest contract: convert a resolved plan into a **validated, immutable, versioned manifest** (INV-1) that is the render engine's sole input.
2. **Objectives.** Define the **Manifest Schema** and freeze its version; implement the builder (resolved-plan → manifest); enforce validation + immutability (INV-1); guarantee the manifest is self-contained (no live-state references — supports INV-3).
3. **Deliverables.** Manifest schema; manifest builder; manifest validator; immutability guarantees; manifest version.
4. **Subsystems Covered.** Manifest schema; Manifest builder; Manifest validation.
5. **Architecture Sections Referenced.** ADS manifest/schema/validation sections.
6. **Dependencies.** Phase 6 (resolved plan); Phases 3–5 (asset references), 1 (versions).
7. **Repository Areas Affected.** Manifest package; manifest contracts; validation; version registry entry.
8. **Expected Folder Structure (conceptual).** A manifest package (schema, builder, validator) with the schema published as the highest-leverage shared contract.
9. **Core Components.** Manifest builder; schema definition; validator; immutability wrapper; version stamp.
10. **Interfaces.** `ManifestBuilder`, `Manifest` (immutable), `ManifestValidator`.
11. **Public Contracts.** **The Manifest Schema** — the render contract (versioned, ADR-gated to change).
12. **Internal Contracts.** Builder mapping rules; validation invariants; immutability enforcement.
13. **Major Risks.** An unstable/under-specified manifest rippling into every consumer. *Mitigation:* freeze + version the schema; ADR-gate changes; exhaustive validation.
14. **Acceptance Criteria.** A resolved plan builds a valid manifest; invalid manifests are rejected; a manifest is immutable and self-contained; manifest version frozen; no domain/DB references inside a manifest.
15. **Testing Strategy.** Schema-validation tests (valid/invalid corpus); immutability tests; self-containment tests (no external refs); version-stamp tests.
16. **Definition of Done.** Guide DoD; INV-1 enforced; manifest version frozen; schema documented as the render contract.
17. **Review Checklist.** INV-1 immutability; self-contained (enables INV-3); schema versioned; validation exhaustive.
18. **Future Extensions.** Manifest capability flags for plugins/mobile contracts (Rec 24) reserved additively.
19. **Estimated Complexity.** High.
20. **Estimated Risk.** High.
21. **Estimated Duration.** High.
22. **Milestone Produced.** **M9 — Manifest Ready.**

---

### Phase 8 — Render Engine & PDF Platform

1. **Purpose.** Build the **deterministic render engine** that consumes a manifest alone (INV-3) and produces an **immutable artifact** (INV-2), reproducible byte-for-byte.
2. **Objectives.** Manifest-only rendering (no domain DB — INV-3); deterministic output; PDF/print artifact production; reproducibility guarantee; declared **performance budget**; freeze **Render/PDF Engine version**.
3. **Deliverables.** Render engine; PDF platform; reproducibility harness; render-engine version; render performance budget (declared).
4. **Subsystems Covered.** Render engine; PDF/print artifact production; reproducibility.
5. **Architecture Sections Referenced.** ADS render-engine/PDF/determinism sections.
6. **Dependencies.** Phase 7 (manifest) — **hard**; Phase 3 (artifact store).
7. **Repository Areas Affected.** Render package; PDF engine; artifact writes; reproducibility tests.
8. **Expected Folder Structure (conceptual).** A render package that takes a manifest and emits an immutable artifact via the storage layer; no coupling to app/domain code.
9. **Core Components.** Manifest interpreter; layout/paint pipeline; PDF/print writer; reproducibility checker; perf-budget recorder.
10. **Interfaces.** `Renderer` (manifest→artifact), `ArtifactStore` (consumed).
11. **Public Contracts.** Render output artifact descriptor; render-engine version.
12. **Internal Contracts.** Determinism rules; manifest-only access (INV-3); page/geometry mapping.
13. **Major Risks.** Hidden non-determinism; reproducibility violations surfacing late. *Mitigation:* byte-equality reproducibility tests as first-class gates; ban all domain access.
14. **Acceptance Criteria.** Same manifest → byte-identical artifact; renderer performs **no** domain/DB access (INV-3); artifact is immutable (INV-2); render meets its declared budget; version frozen.
15. **Testing Strategy.** Reproducibility (byte-equality) tests; INV-3 isolation tests (no DB reachable); artifact-immutability tests; golden-manifest suite; budget checks.
16. **Definition of Done.** Guide DoD; INV-2/3 enforced; reproducibility proven; render version + budget recorded.
17. **Review Checklist.** INV-2, INV-3 upheld; determinism proven; no live-UI/domain dependency; budget declared.
18. **Future Extensions.** Alternate render backends behind the same interface; plugin render stages (Phase 16).
19. **Estimated Complexity.** Very High.
20. **Estimated Risk.** Very High.
21. **Estimated Duration.** Very High.
22. **Milestone Produced.** **M10 — Renderer Ready.**

---

### Phase 9 — Pipeline & Coordinator Platform

1. **Purpose.** Wire Phases 1–8 into one **declarative pipeline** (INV-5) orchestrated by the coordinator, honoring **one active run per album** (INV-6), full **idempotency** (INV-7), a **processing dependency graph**, and **replay semantics** (Rec 18).
2. **Objectives.** Declarative pipeline definition + interpreter (INV-5); run orchestration end-to-end (image→blueprint→manifest→render); dependency-graph execution; crash recovery; differentiate **Retry / Replay / Rebuild / Regenerate** (Rec 18 semantics + seam); cost/perf accounting hooks.
3. **Deliverables.** Pipeline definition schema; coordinator/orchestrator; dependency-graph engine; recovery logic; replay-semantics contract (retry/replay/rebuild/regenerate); run-graph data (for Run Explorer seam).
4. **Subsystems Covered.** Pipeline definitions; Coordinator/orchestration; Dependency graph; Replay semantics (seam).
5. **Architecture Sections Referenced.** ADS pipeline/coordinator/orchestration/replay sections.
6. **Dependencies.** Phases 1–8 (orchestrates all producing subsystems).
7. **Repository Areas Affected.** Pipeline package; coordinator; run-graph model; replay contracts.
8. **Expected Folder Structure (conceptual).** A pipeline package (declarative definitions + interpreter) and a coordinator that drives runs against the Control Plane and runtime.
9. **Core Components.** Pipeline interpreter; step scheduler; dependency-graph resolver; recovery/resume; replay dispatcher (retry/replay/rebuild/regenerate).
10. **Interfaces.** `Pipeline` (declarative), `Coordinator`, `RunGraph`, `ReplayRequest`.
11. **Public Contracts.** Pipeline definition schema; run-graph schema; replay-operation semantics.
12. **Internal Contracts.** Step scheduling; idempotent resume; version-freeze at run start (INV-11); one-active-run coordination (INV-6).
13. **Major Risks.** Idempotency/recovery gaps under concurrency/failure; imperative pipeline creep. *Mitigation:* declarative-only enforcement; chaos/crash tests; idempotent resume tests.
14. **Acceptance Criteria.** A run executes the full graph to a rendered artifact; crashes resume without drift (INV-7); pipelines are declarative (INV-5); one active run per album (INV-6); replay operations are distinct and correct.
15. **Testing Strategy.** End-to-end run tests; crash/resume + duplicate-delivery idempotency tests; dependency-graph correctness; replay-semantics tests.
16. **Definition of Done.** Guide DoD; INV-5/6/7/11 upheld; replay semantics defined; run-graph data emitted.
17. **Review Checklist.** INV-5, INV-6, INV-7, INV-11 upheld; declarative pipelines; replay differentiated; recovery proven.
18. **Future Extensions.** Full **Replay Platform** + **Run Explorer** UI (Rec 17/18) → Phase 16; DX pipeline generator (Rec 21) → Phase 16.
19. **Estimated Complexity.** High.
20. **Estimated Risk.** High.
21. **Estimated Duration.** High.
22. **Milestone Produced.** **M11 — Pipeline Ready.**

---

### Phase 10 — Observability, Cost Accounting & Metrics Platform

1. **Purpose.** Make the platform fully **observable and costed**: logs/metrics/traces correlated end-to-end, **Cost Accounting** per run (Rec 8), the recorded **Version Matrix** (Rec 9), a **Run Explorer data model** (Rec 17 seam), and **Business Metrics** technical foundations (Rec 25).
2. **Objectives.** Structured logging, metrics, tracing across all subsystems; per-run cost accounting (CPU/mem/duration/storage/R2 reads/writes/estimated cost); Version-Matrix recording + surfacing; run-graph/timeline data for Run Explorer; technical business-metric counters (albums/day, pages/day, processing time/cost).
3. **Deliverables.** Observability layer (logs/metrics/traces); cost-accounting recorder + per-run cost record; Version-Matrix records; run-explorer data model; business-metric counters (technical).
4. **Subsystems Covered.** Observability; Cost accounting; Version matrix (recording); Run-explorer data; Business metrics (technical).
5. **Architecture Sections Referenced.** ADS observability/metrics/cost/version-matrix sections.
6. **Dependencies.** Phases 1–9 (instruments the whole platform).
7. **Repository Areas Affected.** Observability package; cost package; metrics; version-matrix recording; run-graph persistence.
8. **Expected Folder Structure (conceptual).** An observability package (log/metric/trace), a cost package, and metric/version-matrix recorders consumed via the runtime + coordinator hooks placed earlier.
9. **Core Components.** Log/metric/trace emitters; correlation (request/run/job id); cost recorder; version-matrix writer; business-metric aggregator.
10. **Interfaces.** `Logger`, `Metrics`, `Tracer`, `CostRecorder`, `VersionMatrixRecorder`.
11. **Public Contracts.** Log/metric/trace schemas; cost-record schema; version-matrix schema; run-graph/timeline schema.
12. **Internal Contracts.** Correlation-id propagation; cost-hook contract; metric taxonomy (technical vs business).
13. **Major Risks.** Blind spots; cost mis-attribution. *Mitigation:* correlate everything; validate cost hooks against real runs.
14. **Acceptance Criteria.** Every run is traceable end-to-end; each run exposes a cost record; the Version Matrix is recorded per run; run-graph data is queryable; technical business metrics are collected.
15. **Testing Strategy.** Correlation tests; cost-accounting accuracy tests; version-matrix completeness tests; metric emission tests.
16. **Definition of Done.** Guide DoD; observability complete; cost + version matrix recorded; business-metric counters live.
17. **Review Checklist.** INV-9 (audited transitions surfaced); cost complete; version matrix recorded; tech/business metrics separated (INV-12 spirit).
18. **Future Extensions.** **Run Explorer** visualization (Rec 17) + **Business Analytics** dashboards (Rec 25) → Phase 16.
19. **Estimated Complexity.** Moderate.
20. **Estimated Risk.** Low–Medium.
21. **Estimated Duration.** Medium.
22. **Milestone Produced.** **M12 — Observable & Costed.**

---

### Phase 11 — Security & Compliance Hardening

1. **Purpose.** Audit and harden the whole platform's security surface — inputs, artifacts, secrets, boundaries — to completion.
2. **Objectives.** Boundary validation everywhere; secret handling review; input-safety re-audit (image + manifest boundaries); least-privilege for runtime/storage; PII/data-handling review; artifact access controls.
3. **Deliverables.** Security audit report; hardening changes; secret-handling verification; access-control verification.
4. **Subsystems Covered.** Security (cross-cutting audit); Access control; Secret handling.
5. **Architecture Sections Referenced.** ADS security/threat-model sections; project security rules (`CLAUDE.md`).
6. **Dependencies.** Phases 1–10 (hardens a real system).
7. **Repository Areas Affected.** All packages (audit); security-specific utilities.
8. **Expected Folder Structure (conceptual).** Security utilities + audited boundaries across existing packages; no new subsystem tree.
9. **Core Components.** Boundary validators; secret access review; access-control checks; artifact-access gating.
10. **Interfaces.** No new primary interfaces; hardening of existing ones.
11. **Public Contracts.** Unchanged (hardening is behavior-preserving); any change is ADR-gated.
12. **Internal Contracts.** Validation-at-boundary guarantees; secret-handling rules.
13. **Major Risks.** An unhardened boundary or mishandled secret. *Mitigation:* threat-model-driven checklist; security review sign-off.
14. **Acceptance Criteria.** Every external input is validated at its boundary; no secret is exposed; artifact/storage access is least-privilege; audit report closed with no open highs.
15. **Testing Strategy.** Security tests (malicious inputs, access attempts); secret-exposure checks; boundary-validation tests.
16. **Definition of Done.** Guide DoD; security review passed; no open high-severity findings.
17. **Review Checklist.** Boundaries validated; secrets safe; least-privilege; invariants intact under adversarial input.
18. **Future Extensions.** Plugin sandboxing (Phase 16) reserved.
19. **Estimated Complexity.** Moderate.
20. **Estimated Risk.** Medium.
21. **Estimated Duration.** Medium.
22. **Milestone Produced.** **M13 — Hardened.**

---

### Phase 12 — Performance, Budgets & Scale Readiness

1. **Purpose.** Enforce **Performance Budgets** per subsystem (Rec 10) and validate the **scale seams** the ADS defines.
2. **Objectives.** Formalize per-subsystem performance budgets (declared in earlier phases, enforced here); measure against budgets; identify + document scale bottlenecks; validate scale seams (shared queue/rate-limit/worker-horizontal seams) without premature build-out.
3. **Deliverables.** Budget definitions + enforcement; performance test results; scale-readiness report; documented bottlenecks + seams.
4. **Subsystems Covered.** Performance budgets; Scale seams (validation).
5. **Architecture Sections Referenced.** ADS performance/scale sections.
6. **Dependencies.** Phases 1–10 (measures a real, instrumented system).
7. **Repository Areas Affected.** Performance tests; budget config; scale-seam docs.
8. **Expected Folder Structure (conceptual).** Performance/benchmark suites + budget definitions consumed by CI; scale docs in ops.
9. **Core Components.** Budget definitions; benchmark harness; scale-seam validators.
10. **Interfaces.** `PerformanceBudget` (declared per subsystem); benchmark reporting.
11. **Public Contracts.** Budget schema; performance-report schema.
12. **Internal Contracts.** Budget-check thresholds; regression policy.
13. **Major Risks.** Late-discovered bottleneck; premature scale complexity. *Mitigation:* design seams, measure, document — build only what the ADS scopes.
14. **Acceptance Criteria.** Each subsystem has a budget and meets it (or documents an accepted deviation); scale seams validated; bottlenecks documented with mitigation paths.
15. **Testing Strategy.** Benchmarks vs budgets; load/soak within scope; regression guards on hot paths.
16. **Definition of Done.** Guide DoD; budgets enforced; scale-readiness report accepted.
17. **Review Checklist.** Budgets declared + met; no premature scale build; seams documented.
18. **Future Extensions.** Horizontal worker scale-out; shared-store rate-limit/queue (documented, deferred).
19. **Estimated Complexity.** Moderate.
20. **Estimated Risk.** Medium.
21. **Estimated Duration.** Medium.
22. **Milestone Produced.** **M14 — Performant & Scale-Ready.**

---

### Phase 13 — Manufacturing & Vendor Platform (Foundations + Reserved Seams)

1. **Purpose.** Establish the **Print Vendor abstraction** (Rec 11), the **Manufacturing Pipeline** lifecycle (Rec 12), and **Vendor Validation Profiles** (Rec 23) — foundations + seams so the platform grows from render-artifact to manufactured-album without redesign.
2. **Objectives.** Define the print-vendor provider abstraction (multi-vendor); model the manufacturing lifecycle (Print-Ready→Vendor→Printing→Binding→Packaging→Dispatch→Delivered) as the tail of the Album Lifecycle (Rec 13/Phase 1); define vendor validation profiles (pre-flight vendor checks); provide a minimal/mock vendor implementation + seam for real vendors.
3. **Deliverables.** Vendor provider interface; manufacturing lifecycle states + transitions (Control-Plane-backed); vendor validation profile model; mock vendor; dispatch seam.
4. **Subsystems Covered.** Print-vendor abstraction; Manufacturing pipeline; Vendor validation profiles.
5. **Architecture Sections Referenced.** ADS manufacturing/vendor/fulfillment sections.
6. **Dependencies.** Phases 1 (lifecycle), 3 (print-ready artifacts), 4 (vendor profiles/pricing), 9 (orchestration).
7. **Repository Areas Affected.** Manufacturing package; vendor provider abstraction; lifecycle-tail transitions; validation profiles.
8. **Expected Folder Structure (conceptual).** A manufacturing package (vendor abstraction, lifecycle transitions, validation) with a mock provider and a reserved registry for real vendors.
9. **Core Components.** `VendorProvider` registry; manufacturing state machine; vendor validation runner; dispatch seam; mock vendor.
10. **Interfaces.** `VendorProvider` (submit/track/validate), `ManufacturingRun`, `VendorValidationProfile`.
11. **Public Contracts.** Vendor provider contract; manufacturing lifecycle states; validation-profile schema.
12. **Internal Contracts.** Lifecycle-tail transition rules; vendor selection; validation gating.
13. **Major Risks.** Coupling manufacturing to a single vendor; leaking manufacturing state into render. *Mitigation:* provider abstraction; keep manufacturing independent of render internals; INV-8 (Control Plane authoritative).
14. **Acceptance Criteria.** A print-ready artifact can enter a (mock) manufacturing run through the lifecycle; vendor is abstracted (swap = one adapter); validation profiles gate dispatch; real-vendor seam is additive.
15. **Testing Strategy.** Manufacturing-lifecycle transition tests; vendor-abstraction tests (mock); validation-profile tests; audit tests (INV-9).
16. **Definition of Done.** Guide DoD; vendor abstracted; manufacturing lifecycle audited; validation profiles defined; real vendors reserved additively.
17. **Review Checklist.** Rec 11/12/23 satisfied; INV-8/9 upheld; single-vendor coupling avoided; seams additive.
18. **Future Extensions.** Real vendor integrations; automated dispatch; vendor throughput analytics (Phase 16).
19. **Estimated Complexity.** Moderate–High.
20. **Estimated Risk.** Medium.
21. **Estimated Duration.** Medium.
22. **Milestone Produced.** **M15 — Manufacturing-Ready (Foundations).**

---

### Phase 14 — Integration & End-to-End Validation

1. **Purpose.** Prove the **whole-system properties** — determinism, reproducibility, idempotency, immutability, invariant compliance — end-to-end under production-like conditions.
2. **Objectives.** Full-pipeline E2E (real album → manufactured-ready artifact); reproducibility verification (rebuild = byte-identical); idempotency under duplication/crash; load/soak; invariant audit across the assembled platform.
3. **Deliverables.** E2E test suite; reproducibility verification report; load/soak results; invariant-compliance audit.
4. **Subsystems Covered.** None new; whole-system validation.
5. **Architecture Sections Referenced.** ADS testing-strategy/E2E sections; §3 invariants; §14 checklist.
6. **Dependencies.** Phases 1–13.
7. **Repository Areas Affected.** E2E test suites; test fixtures; CI integration stage.
8. **Expected Folder Structure (conceptual).** An end-to-end test area exercising the assembled platform through public contracts only.
9. **Core Components.** E2E harness; reproducibility checker; load/soak drivers; invariant auditor.
10. **Interfaces.** Exercises public contracts only (no internal reach-in).
11. **Public Contracts.** Verified, not defined.
12. **Internal Contracts.** N/A (black-box validation).
13. **Major Risks.** Whole-system property failures found only here. *Mitigation:* property tests existed per-phase; this is confirmation, not first discovery.
14. **Acceptance Criteria.** Full pipeline passes E2E; rebuild is byte-identical; idempotency holds under adversarial retries/crashes; all invariants pass audit; load/soak within budgets.
15. **Testing Strategy.** E2E + reproducibility + idempotency + load/soak + full invariant checklist run.
16. **Definition of Done.** Guide DoD; all whole-system properties proven; no open criticals.
17. **Review Checklist.** Every invariant (INV-1…12) verified end-to-end; reproducibility proven; budgets met.
18. **Future Extensions.** Continuous E2E in CI; expanded chaos testing.
19. **Estimated Complexity.** Moderate–High.
20. **Estimated Risk.** Medium.
21. **Estimated Duration.** Medium.
22. **Milestone Produced.** **M16 — Validated.**

---

### Phase 15 — Production Cutover

1. **Purpose.** Roll Worker V2 into production with a rehearsed rollback, confirm V1 retirement, and go live.
2. **Objectives.** Controlled rollout; rollback rehearsal (demonstrated before go-live); confirm no V1 remnants; production observability/alerting live; runbooks finalized.
3. **Deliverables.** Cutover runbook (executed); rollback rehearsal evidence; production go-live; retirement confirmation.
4. **Subsystems Covered.** None new; operational cutover.
5. **Architecture Sections Referenced.** ADS deployment/cutover sections; Implementation Guide §13.4 (rollback).
6. **Dependencies.** Phases 1–14.
7. **Repository Areas Affected.** Ops/runbooks; deployment config; alerting config.
8. **Expected Folder Structure (conceptual).** Ops area with cutover + rollback runbooks and deployment/alerting configuration.
9. **Core Components.** Deployment procedure; rollback procedure; production health/alerting; retirement checklist.
10. **Interfaces.** Operational, not code.
11. **Public Contracts.** Production SLOs/alerts.
12. **Internal Contracts.** Cutover/rollback steps.
13. **Major Risks.** Cutover regression without rehearsed rollback. *Mitigation:* rehearse rollback first; milestone-tagged rollback anchor.
14. **Acceptance Criteria.** V2 live in production; rollback demonstrated; V1 confirmed fully retired; alerting active; runbooks accurate.
15. **Testing Strategy.** Cutover dry-run; rollback rehearsal; production smoke + monitoring validation.
16. **Definition of Done.** Guide DoD; go-live achieved; rollback proven; retirement confirmed.
17. **Review Checklist.** Rollback rehearsed; no V1 remnants; observability/alerting live; runbooks correct.
18. **Future Extensions.** Progressive rollout tooling; automated rollback.
19. **Estimated Complexity.** Moderate.
20. **Estimated Risk.** Medium–High.
21. **Estimated Duration.** Low.
22. **Milestone Produced.** **M17 — Production Ready.**

---

### Phase 16 — Reserved Future Platforms (Additive Roadmap)

> **This phase is reserved, not built during core delivery.** It exists so that every "future"
> recommendation has a named home and a guarantee of **additivity** (built on the seams reserved in
> earlier phases — no redesign). It is off the core critical path. Each capability becomes its own
> full phase when scheduled.

1. **Purpose.** Ratify the additive roadmap for post-core platforms so they extend, never rework, Worker V2.
2. **Objectives.** Confirm each reserved capability's seam exists and is additive: **Plugin Architecture** (Rec 6: AI enhance, OCR, video, vendor dispatch, translation, face detection); **Replay Platform** (Rec 18: full retry/replay/rebuild/regenerate UX + tooling); **Run Explorer / Processing-Graph visualization** (Rec 17); **Developer Experience** generators + scaffolding (Rec 21); **Album Quality Scoring** (Rec 22); **Mobile Platform** (Rec 24); **Business Analytics** dashboards (Rec 25).
3. **Deliverables.** A ratified extension roadmap; seam-verification per capability; per-capability future-phase stubs (planning only).
4. **Subsystems Covered.** Reserved: plugins, replay platform, run explorer, DX tooling, quality scoring, mobile, analytics.
5. **Architecture Sections Referenced.** ADS extensibility/plugin/future-work sections.
6. **Dependencies.** Seams from Phases 2 (plugins), 9 (replay/run-graph), 10 (run-explorer/analytics data), 5/6 (quality signals), 1/7 (mobile contracts), 0 (DX hooks).
7. **Repository Areas Affected.** Reserved package namespaces; no core changes required to adopt.
8. **Expected Folder Structure (conceptual).** Reserved package areas that plug into existing registries/seams; nothing removed or reshaped in core.
9. **Core Components.** Per capability (future): plugin registrations; replay tooling; run-explorer UI; generators; scoring engine; mobile contracts; analytics.
10. **Interfaces.** Consume existing reserved seams (`PluginRegistrar`, `ReplayRequest`, `RunGraph`, cost/metric records) — additively.
11. **Public Contracts.** Future contracts must not break frozen core contracts (manifest, pipeline, lifecycle).
12. **Internal Contracts.** Additive-only rule; ADR per new capability.
13. **Major Risks.** A future capability tempting a core redesign. *Mitigation:* additivity gate + ADR; seams validated in Phase 14.
14. **Acceptance Criteria.** Each reserved capability has a verified additive seam and a planning stub; no core contract requires change to adopt any of them.
15. **Testing Strategy.** Seam-additivity verification (a stub plugin/replay/etc. compiles against existing seams).
16. **Definition of Done.** Roadmap ratified; seams verified additive; ADRs reserved for each (incl. rejected alternatives, Rec 20).
17. **Review Checklist.** Additive-only; no core redesign implied; seams real; ADRs reserved.
18. **Future Extensions.** These *are* the future extensions.
19. **Estimated Complexity.** Variable (per capability).
20. **Estimated Risk.** Deferred.
21. **Estimated Duration.** Not in core timeline.
22. **Milestone Produced.** **M18 — Extension Roadmap Ratified.**

---

## 8. Cross-Phase Dependency Diagram

```
Phase -1 Worker Reset
   │
   ▼
Phase 0 Foundation & Contracts ─────────────────────────────────────────┐ (contracts/DI/ADR to all)
   │                                                                     │
   ▼                                                                     │
Phase 1 Control Plane & Lifecycles ──────────────┐ (state/events/audit/versions to all)
   │                                             │
   ▼                                             │
Phase 2 Worker Runtime ──────────────┐           │
   │                                 │           │
   ▼                                 │           │
Phase 3 Storage & Artifacts          │           │
   │        │                        │           │
   │        └──────────┐             │           │
   ▼                   ▼             ▼           ▼
Phase 4 Product ──► Phase 5 Image Processing (runtime+storage+profiles)
   │                   │
   │                   ▼
   └──────────► Phase 6 Blueprint (product + canonical assets + versions)
                       │
                       ▼
               Phase 7 Manifest (resolved plan → immutable manifest)
                       │
                       ▼
               Phase 8 Render Engine (manifest → immutable artifact)  [INV-3]
                       │
                       ▼
               Phase 9 Pipeline & Coordinator (orchestrates 1–8; replay seam)
                       │
        ┌──────────────┼───────────────┐
        ▼              ▼               ▼
Phase 10 Observability/  Phase 11     Phase 12
   Cost/Version-Matrix   Security     Performance/Budgets/Scale
        └──────────────┬───────────────┘
                       ▼
        Phase 13 Manufacturing & Vendor (foundations + reserved)
                       │
                       ▼
        Phase 14 Integration & E2E Validation
                       │
                       ▼
        Phase 15 Production Cutover
                       │
                       ▼
        Phase 16 Reserved Future Platforms (additive; off critical path)
```

---

## 9. Critical Path

The **critical path** to production is the render-to-manufacture spine; everything else either feeds
it or hardens it:

```
-1 → 0 → 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → (10 ∥ 11 ∥ 12) → 13 → 14 → 15
```

- **Longest-pole subsystems:** Phase 5 (Image), Phase 6 (Blueprint), Phase 7 (Manifest), and above
  all **Phase 8 (Render Engine)** — the single highest-complexity/highest-risk unit.
- **Non-negotiable serial links:** 6→7→8→9 (resolved plan → manifest → render → orchestration) and
  1 before everything (source of truth) are strict; they cannot be parallelized or reordered.
- Phase 16 is **not** on the critical path.

---

## 10. Parallel Work Opportunities

Parallelism is possible only where subsystems do not share a producing dependency:

| Can run in parallel | Rationale |
|---|---|
| **Phase 3 (Storage)** ∥ early **Phase 4 (Product)** | Storage and product-catalog modeling are independent once Phase 1 exists. |
| **Phase 4 (Product)** ∥ **Phase 2 (Runtime)** late work | Product is pure domain modeling; runtime is execution machinery. |
| **Phase 10 / 11 / 12** (Observability / Security / Performance) | All harden the *assembled* system after Phase 9; independent axes, coordinated at the join. |
| **Contract authoring** for Phases 6–8 | Manifest/blueprint/resolved-plan *contracts* can be drafted (behind ADR review) ahead of implementation, while respecting freeze rules. |
| **Documentation & runbook drafting** | Can proceed alongside implementation of the phase they describe. |

> Everything on the 6→7→8→9 spine is strictly serial and must **not** be parallelized — the manifest
> contract must be frozen before the renderer consumes it (INV-1, INV-3).

---

## 11. Review Gates

Every phase passes four independent reviews before it closes (Implementation Guide §12):

1. **Architecture Review** — conforms to ADS; upholds all relevant invariants (§3); has authority to Stop-and-ADR.
2. **Code Review** — quality, clarity, no dead code/shortcuts, correct error handling.
3. **Testing Review** — tests are meaningful, cover determinism/idempotency/reproducibility claims, and pass.
4. **Documentation Review** — living documents, contracts, runbooks updated as of this phase.

Additional gate for contract-central phases (0,1,4,6,7,9): **Contract Review** — any shared-contract
change is ADR-gated and versioned.

---

## 12. Quality Gates

All must pass for a phase to close (mirrors Implementation Guide §11, extended for this plan):

| Gate | Requirement |
|---|---|
| G1 Build | Clean build, no tolerated warnings. |
| G2 Tests | All pass; determinism/idempotency/reproducibility tests pass where claimed. |
| G3 Behavioral coverage | Every introduced behavior has a meaningful test. |
| G4 Architecture conformance | Matches ADS; deviations have accepted ADRs. |
| G5 Contract stability | Shared contracts unchanged or versioned + ADR-backed. |
| G6 Observability | Logs/metrics/traces exist + correlate for the subsystem. |
| G7 Security | Boundary validation + secret handling satisfied. |
| G8 Documentation | Living docs + affected architecture/runbooks updated. |
| G9 No shortcuts | No TODOs, dead code, hacks, or partial subsystems. |
| G10 Reproducibility | Artifact/render phases: outputs immutable + reproducible. |
| **G11 Invariant compliance** | Every relevant invariant (§3) demonstrably upheld. |
| **G12 Version freeze** | Any version this phase owns is registered + frozen (§5). |

---

## 13. Phase Exit Criteria

A phase **exits** (is Done) only when **all** hold:

1. All 22 phase elements are satisfied and its milestone is produced.
2. All Quality Gates (§12) pass, including invariant compliance (G11) and version freeze (G12).
3. All four (or five) Review Gates (§11) are signed off.
4. Its **one primary subsystem** is complete — no partial subsystem (Implementation Guide §4.3).
5. Living documents updated: `WORKER_V2_PROGRESS.md` reflects completion; `WORKER_V2_CHANGELOG.md` records the change; milestone tagged.
6. No open high-severity risks introduced by the phase remain unmitigated.
7. The integration branch is green with the phase merged.

---

## 14. Architecture Validation Checklist

Run at every phase's Architecture Review; a single "No" is a Stop-and-ADR event.

- [ ] Conforms to the ADS; no silent deviation (Implementation Guide §18).
- [ ] **INV-1** Manifest immutable (where touched).
- [ ] **INV-2** Artifacts immutable.
- [ ] **INV-3** Renderer never queries the domain DB.
- [ ] **INV-4** No worker-to-worker communication.
- [ ] **INV-5** Pipelines remain declarative.
- [ ] **INV-6** One active run per album.
- [ ] **INV-7** All handlers idempotent.
- [ ] **INV-8** Control Plane is source of truth.
- [ ] **INV-9** All transitions audited.
- [ ] **INV-10** No mutable storage keys.
- [ ] **INV-11** Versions frozen at run start.
- [ ] **INV-12** Technical and Domain events separated.
- [ ] Dependency direction correct (dependency inversion; DI at boundaries).
- [ ] Version(s) this phase owns are frozen + registered (§5).
- [ ] Reserved seams (plugins/replay/run-explorer/vendor/mobile) remain **additive**, not entangled.
- [ ] Exactly one primary subsystem owned by this phase (§20).

---

## 15. Testing Progression

Testing depth compounds across phases; earlier guarantees are never allowed to regress.

| Phase(s) | Testing emphasis added (carried forward thereafter) |
|---|---|
| −1, 0 | Build/lint/meta tests; contract type-checks. |
| 1 | State-machine property tests; concurrency (one-active-run); audit completeness; event separation. |
| 2 | Handler idempotency; DI resolution; capability registry; INV-4 structural checks. |
| 3 | Content-addressing determinism; write-once refusal; asset-lifecycle transitions. |
| 4 | Catalog resolution; profile→param mapping; version-freeze. |
| 5 | Image determinism/reproducibility; malicious-input corpus; idempotent re-processing. |
| 6 | Deterministic compilation; per-resolver units; version-pin propagation; boundary (no manifest bleed). |
| 7 | Manifest validation (valid/invalid corpus); immutability; self-containment. |
| 8 | **Byte-equality reproducibility**; INV-3 isolation; artifact immutability; golden manifests; budgets. |
| 9 | Full-run E2E; crash/resume + duplicate idempotency; dependency-graph; replay semantics. |
| 10 | Correlation; cost accuracy; version-matrix completeness; metric emission. |
| 11 | Security/adversarial-input; secret-exposure; access control. |
| 12 | Benchmarks vs budgets; load/soak; hot-path regression guards. |
| 13 | Manufacturing-lifecycle transitions; vendor-abstraction (mock); validation profiles. |
| 14 | Whole-system E2E + reproducibility + idempotency + load/soak + full invariant audit. |
| 15 | Cutover dry-run; rollback rehearsal; production smoke. |
| 16 | Seam-additivity verification (stub plug-ins compile against existing seams). |

---

## 16. Documentation Progression

Docs move with code; the following are updated in the phase indicated (Implementation Guide §14):

| Document | Update cadence |
|---|---|
| **ADS + ADRs** | ADRs authored whenever architecture is clarified/changed; **rejected alternatives** captured as ADRs (Rec 20). Ongoing. |
| **`WORKER_V2_PROGRESS.md`** | End of every phase (and materially mid-phase). |
| **`WORKER_V2_CHANGELOG.md`** | Every phase; milestone-tagged. |
| **Contract docs** (manifest, pipeline, lifecycle, events, product, blueprint) | In the same change that defines/freezes the contract (Phases 0,1,4,6,7,9). |
| **Runbooks** | Written with the capability (Phases 9–13), correct before reliance; finalized Phase 15. |
| **Developer Notes** | Whenever non-obvious rationale arises. |
| **Version Matrix docs** | Established Phase 1; recorded/surfaced Phase 10. |

---

## 17. Suggested Commit Strategy

- **Small, coherent commits** — one logical change each; tree stays buildable (Implementation Guide §13.2).
- **Contract/ADR-driven changes** get isolated commits referencing the ADR.
- **Subsystem checkpoint commit** when a subsystem within a phase reaches Done + gated.
- **Phase-close commit** lands the completed phase on the integration branch *with living documents updated in the same commit*.
- **Milestone tag** (annotated) at each phase's milestone state (M1…M18).
- Commit trailers per project convention; commits/pushes only when the human owner directs.

---

## 18. Suggested Branch Strategy

- **Integration branch** always green, always reflecting completed + gated phases only.
- **Phase branches** (`worker-v2/phase-NN-<name>`) cut from integration; carry one phase to Done.
- **Subsystem branches** (short-lived) for larger phases, merged into the phase branch; never straight to integration until the phase is Done.
- **Contract changes** on dedicated branches, reviewed as ADR-level events.
- **Milestone tags** on the integration branch anchor rollback (Implementation Guide §13.4).
- Reverts via new revert commits; no history rewriting on shared branches.

---

## 19. Suggested Implementation Order

Follow the critical path, exploiting the sanctioned parallelism (§10):

```
1.  Phase -1  Worker Reset
2.  Phase 0   Foundation & Contracts
3.  Phase 1   Control Plane & Lifecycles
4.  Phase 2   Worker Runtime            ┐ (Phase 3 & early Phase 4 may run alongside)
5.  Phase 3   Storage & Artifacts       │
6.  Phase 4   Product Platform          ┘
7.  Phase 5   Image Processing
8.  Phase 6   Blueprint            ┐ strictly serial spine
9.  Phase 7   Manifest            │  (6 → 7 → 8 → 9)
10. Phase 8   Render Engine       │
11. Phase 9   Pipeline & Coordinator ┘
12. Phases 10 / 11 / 12  Observability ∥ Security ∥ Performance (parallel, join before 13)
13. Phase 13  Manufacturing & Vendor (foundations + reserved)
14. Phase 14  Integration & E2E Validation
15. Phase 15  Production Cutover
16. Phase 16  Reserved Future Platforms (scheduled later, additive, off critical path)
```

---

## 20. Subsystem-to-Phase Ownership Matrix

Proves the requirement that **every subsystem belongs to exactly one primary phase** (seams/consumers noted separately).

| Subsystem | Primary Phase (owns) | Consumed / Seam In |
|---|---|---|
| Clean slate / V1 retirement | −1 | — |
| Repo/build/CI + shared contracts + ADR infra | 0 | All |
| Control Plane (source of truth) | 1 | All |
| Domain lifecycles (album, asset, run) | 1 | 3, 5, 13 (transitions) |
| Event model (technical vs domain) | 1 | 10 |
| Audit | 1 | 10, all |
| Version registry / freeze discipline | 1 | 5 (§5 recording: 10) |
| Worker Runtime (runtime≠roles, DI, capability) | 2 | 5, 8, 13 (roles) |
| Plugin seam | 2 | 16 (full) |
| Storage / immutable artifacts / content addressing | 3 | 5, 8, 13 |
| Asset lifecycle (storage side) | 3 | 5 (processing side) |
| Product catalog + materials | 4 | 6 |
| Processing profiles | 4 | 5, 8 |
| Pricing versions / vendor profiles (data) | 4 | 13 (execution) |
| Image processing pipeline | 5 | 6 |
| Blueprint + compiler + layout/template/theme resolvers | 6 | 7 |
| Font/sticker pack catalog | 6 | 4 (product linkage) |
| Manifest builder + schema + validation | 7 | 8 |
| Render engine / PDF platform | 8 | 9 |
| Pipeline definitions + coordinator + dependency graph | 9 | 10 (run-graph) |
| Replay semantics | 9 | 16 (full platform) |
| Observability (logs/metrics/traces) | 10 | All |
| Cost accounting | 10 | (hooks: 2, 9) |
| Version Matrix recording | 10 | (registry: 1) |
| Run-explorer data model | 10 | 16 (UI) |
| Business metrics (technical) | 10 | 16 (analytics) |
| Security hardening | 11 | All |
| Performance budgets + scale seams | 12 | All (declared per phase) |
| Print-vendor abstraction | 13 | 16 (real vendors) |
| Manufacturing pipeline (lifecycle tail) | 13 | 1 (states) |
| Vendor validation profiles | 13 | — |
| Whole-system validation | 14 | — |
| Production cutover | 15 | — |
| Plugins / Replay platform / Run Explorer / DX / Quality Scoring / Mobile / Analytics | 16 (reserved) | seams: 2,9,10,5/6,1/7,0 |

No subsystem appears as a primary owner in more than one phase. ✔

---

## 21. Final Consistency Review

A closing self-audit of this plan against the task's completion criteria:

1. **Duplication removed.** Cross-cutting concerns (observability, cost, security, performance) are each owned by exactly one phase (10/11/12) and merely *hooked* earlier — not re-specified per phase.
2. **Dependencies verified.** The dependency diagram (§8), critical path (§9), and implementation order (§19) are mutually consistent; the 6→7→8→9 spine is strictly serial; Phase 1 precedes all producing subsystems; Phase 16 is off the critical path.
3. **Every subsystem has exactly one primary phase.** Proven by the ownership matrix (§20); seams/consumers are annotated, not double-owned.
4. **Every phase produces a measurable milestone.** M1…M18, one per phase (item 22 of each phase; roadmap table §6).
5. **All 25 recommendations placed.** Mapped in §2 to primary homes and seams; the four "mindset/cross-cutting" ones (1,5,9,10) are handled via framing (§4), invariants (§3), the version matrix (§5), and budgets (Phase 12).
6. **Invariants are enforceable.** §3 defines them; §12 (G11) and §14 make them gates in every phase.
7. **Additivity guaranteed.** All reserved capabilities (Phase 16) sit on seams reserved in earlier phases; §14 checks additivity; no future capability requires a core redesign.
8. **Realistically followable to production without redesign.** The plan freezes contracts and versions at the right phases, serializes the render spine, hardens the assembled system, and validates whole-system properties before cutover — so the path from Phase −1 to Phase 15 requires no architectural rework, only execution.

> **Conclusion.** This plan can be followed end-to-end, from Worker Reset to Production Cutover, with
> future platforms arriving additively — all under the ADS as the architectural source of truth.

---

*End of Worker V2 Engineering Execution Plan & Phase Blueprint. Planning only — no implementation.
The next planning artifacts (e.g. `WORKER_V2_TASKS.md`, progress/changelog documents) are
intentionally NOT created here.*
