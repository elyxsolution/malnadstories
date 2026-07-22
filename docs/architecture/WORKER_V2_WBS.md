# Worker V2 — Work Breakdown Structure (WBS)

> **Document type:** Engineering Work Breakdown Structure (Planning Only)
> **Purpose:** Bridge the Phase Plan and the future implementation backlog by decomposing every
> phase into single-capability, independently-reviewable Work Packages
> **This is NOT a task list.** It organizes *work*, not *tasks*. Each Work Package later expands
> into one or more implementation tasks.
> **Subordinate to:** the ADS (architecture source of truth) → `WORKER_V2_IMPLEMENTATION_GUIDE.md`
> (execution discipline) → `WORKER_V2_PHASES.md` (phase decomposition)
> **Owner:** Principal Engineering Manager / Principal Architect, Worker V2

---

## Table of Contents

1. [Purpose of the WBS](#1-purpose-of-the-wbs)
2. [Relationship to the ADS, Implementation Guide, and Phase Plan](#2-relationship-to-the-ads-implementation-guide-and-phase-plan)
3. [WBS Design Principles](#3-wbs-design-principles)
4. [Reading a Work Package (Template & Legend)](#4-reading-a-work-package-template--legend)
5. [Hierarchical Work Breakdown](#5-hierarchical-work-breakdown)
   - [WBS 1 — Phase −1 · Worker Reset](#wbs-1--phase-1--worker-reset)
   - [WBS 2 — Phase 0 · Foundation & Contracts](#wbs-2--phase-0--foundation--contracts)
   - [WBS 3 — Phase 1 · Control Plane & Domain Lifecycles](#wbs-3--phase-1--control-plane--domain-lifecycles)
   - [WBS 4 — Phase 2 · Worker Runtime Platform](#wbs-4--phase-2--worker-runtime-platform)
   - [WBS 5 — Phase 3 · Storage & Immutable Artifact Platform](#wbs-5--phase-3--storage--immutable-artifact-platform)
   - [WBS 6 — Phase 4 · Product Platform](#wbs-6--phase-4--product-platform)
   - [WBS 7 — Phase 5 · Image Processing Platform](#wbs-7--phase-5--image-processing-platform)
   - [WBS 8 — Phase 6 · Blueprint Platform](#wbs-8--phase-6--blueprint-platform)
   - [WBS 9 — Phase 7 · Manifest Platform](#wbs-9--phase-7--manifest-platform)
   - [WBS 10 — Phase 8 · Render Engine & PDF Platform](#wbs-10--phase-8--render-engine--pdf-platform)
   - [WBS 11 — Phase 9 · Pipeline & Coordinator Platform](#wbs-11--phase-9--pipeline--coordinator-platform)
   - [WBS 12 — Phase 10 · Observability, Cost Accounting & Metrics](#wbs-12--phase-10--observability-cost-accounting--metrics)
   - [WBS 13 — Phase 11 · Security & Compliance Hardening](#wbs-13--phase-11--security--compliance-hardening)
   - [WBS 14 — Phase 12 · Performance, Budgets & Scale Readiness](#wbs-14--phase-12--performance-budgets--scale-readiness)
   - [WBS 15 — Phase 13 · Manufacturing & Vendor Platform](#wbs-15--phase-13--manufacturing--vendor-platform)
   - [WBS 16 — Phase 14 · Integration & End-to-End Validation](#wbs-16--phase-14--integration--end-to-end-validation)
   - [WBS 17 — Phase 15 · Production Cutover](#wbs-17--phase-15--production-cutover)
   - [WBS 18 — Phase 16 · Reserved Future Platforms](#wbs-18--phase-16--reserved-future-platforms)
6. [Global WBS Dependency Graph](#6-global-wbs-dependency-graph)
7. [Critical Path](#7-critical-path)
8. [Parallel Execution Opportunities](#8-parallel-execution-opportunities)
9. [Cross-Cutting Work Packages](#9-cross-cutting-work-packages)
10. [Infrastructure Work Packages](#10-infrastructure-work-packages)
11. [Runtime Work Packages](#11-runtime-work-packages)
12. [Platform Work Packages](#12-platform-work-packages)
13. [Manufacturing Work Packages](#13-manufacturing-work-packages)
14. [Future Reserved Work Packages](#14-future-reserved-work-packages)
15. [Architectural Review Checklist](#15-architectural-review-checklist)
16. [WBS Consistency Checklist](#16-wbs-consistency-checklist)
17. [Recommendations Before Task Generation](#17-recommendations-before-task-generation)
18. [Self-Review](#18-self-review)

---

## 1. Purpose of the WBS

This Work Breakdown Structure decomposes the 18 Worker V2 phases into **Work Packages (WPs)** — the
smallest unit of *organized work* above an implementation task. A Work Package owns **exactly one
capability**, is **independently reviewable**, and **later expands into one or more implementation
tasks**. The WBS answers "*what discrete, ownable pieces of work make up each phase, how do they
relate, and how important/risky/parallel is each?*" — **before** any task is written.

It exists to prevent the two failure modes of a large platform rewrite: (a) capabilities that are
never explicitly owned and silently fall through the cracks, and (b) tasks generated ad hoc without
a stable organizing structure. The WBS is the stable structure the backlog will grow from.

---

## 2. Relationship to the ADS, Implementation Guide, and Phase Plan

| Layer | Document | Answers |
|---|---|---|
| Architecture (source of truth) | **ADS** | *What* the system is and *why*. |
| Execution discipline | **`WORKER_V2_IMPLEMENTATION_GUIDE.md`** | *How* we build (principles, gates, workflow, DoD). |
| Phase decomposition | **`WORKER_V2_PHASES.md`** | *In what order*, one subsystem per phase, with milestones. |
| **Work decomposition (this doc)** | **`WORKER_V2_WBS.md`** | *Which ownable work packages* make up each phase. |
| Task backlog (future) | `WORKER_V2_TASKS.md` (**not created here**) | *Concrete tasks* derived from each WP. |

Precedence flows top-down: the WBS may **decompose** the Phase Plan; it may not **re-architect** it.
Every WP cites its **Related Phase** (exactly one primary phase) and the **Architectural Invariants**
it must uphold (from `WORKER_V2_PHASES.md` §3). A WP that seems to require an architecture change is a
**Stop-and-ADR** event, not a WBS edit.

---

## 3. WBS Design Principles

1. **Hierarchical, never flat.** Phase → Capability Group → Work Package → Future Task Area. WBS IDs encode the hierarchy (`3.2.1`).
2. **One capability per Work Package.** No WP mixes unrelated responsibilities (e.g., DI and configuration are *separate* WPs).
3. **Independently reviewable.** Each WP can be reviewed and accepted on its own merits.
4. **Expandable into tasks.** Each WP names **Future Task Areas** — the seeds of its eventual implementation tasks.
5. **Invariant-aware.** Each WP declares which Architectural Invariants (INV-1…12) apply and must be honored.
6. **Reuse identified.** Genuinely reusable capabilities (Logging, Metrics, Storage, Configuration, Validation, Version Registry, Lifecycle Engine, Plugin Registry) are built once and consumed widely (§9–§11).
7. **Cross-cutting isolated.** Security, Observability, Testing, Documentation, Error Handling, Configuration, Versioning are owned by a home WP and *consumed*, not re-specified per phase (§9).
8. **Future work reserved, not entangled.** Future WPs (§14) live on reserved seams and never sit on the core implementation path.
9. **Classified for planning.** Every WP is tagged Mandatory/Recommended/Future, effort, risk, importance, testing intensity, ownership, and critical-path/parallel status.
10. **Exactly one primary phase per WP.** Consumers/seams are annotated but never re-own a WP.

---

## 4. Reading a Work Package (Template & Legend)

Each Work Package is rendered in this compact block. All 24 required fields are present.

> **[WBS x.y.z] Name** — *Class* · Owner: *Ownership Category*
> - **Purpose / Scope / Responsibilities** — why it exists, what's in/out of scope, what it does.
> - **Inputs → Outputs** — what it consumes and produces.
> - **Dependencies** — upstream WPs/phases it needs.
> - **Invariants** — applicable INV IDs.
> - **ADS · Phase · Repo** — related ADS area, primary phase, repository areas affected.
> - **Interfaces** — Public (conceptual) | Internal (conceptual).
> - **Deliverables** — expected outputs of the WP.
> - **Future** — reserved extensions (additive only).
> - **Class:** Effort · Risk · Importance · Testing · Parallelization · Critical-path.
> - **Done when** — completion criteria.

**Legend**
- **Class (Rec 13):** `Mandatory` · `Recommended` · `Future`.
- **Effort (Rec 14):** Very Small · Small · Medium · Large · Very Large.
- **Risk (Rec 15):** Low · Medium · High · Critical.
- **Importance (Rec 16):** Core · Supporting · Infrastructure · Future.
- **Testing (Rec 17):** Minimal · Standard · Heavy · Mission-Critical.
- **Ownership (Rec 18):** Platform · Runtime · Image Engine · PDF · Infrastructure · Control Plane · Product Platform · Blueprint Platform · Manufacturing · Observability · Developer Experience.
- **Parallelization (Rec 12):** Serial · Parallelizable · Fully-parallel.
- **Critical-path (Rec 10):** Yes / No.
- **Invariants** reference `WORKER_V2_PHASES.md` §3 (INV-1 … INV-12).

---

## 5. Hierarchical Work Breakdown

---

### WBS 1 — Phase −1 · Worker Reset

**Capability Group 1.1 — Legacy Retirement**

> **[WBS 1.1.1] V1 Dependency Inventory** — *Mandatory* · Owner: Infrastructure
> - **Purpose/Scope/Responsibilities:** Enumerate every live dependency on Worker V1 (enqueue call sites, job names, implicit behaviors) before any deletion; scope = discovery only.
> - **Inputs → Outputs:** Existing `worker/` + app enqueue sites → dependency inventory doc.
> - **Dependencies:** None.
> - **Invariants:** — (none active; discovery).
> - **ADS · Phase · Repo:** Migration/cutover · Phase −1 · `worker/`, app enqueue sites.
> - **Interfaces:** Public: none | Internal: catalog of V1 contract points.
> - **Deliverables:** Inventory of V1 dependencies + behaviors to re-home.
> - **Future:** None.
> - **Class:** Very Small · Low · Infrastructure · Minimal · Parallelizable · Critical-path: Yes.
> - **Done when:** Every V1 dependency is identified and classified (re-home vs drop).

> **[WBS 1.1.2] V1 Removal** — *Mandatory* · Owner: Infrastructure
> - **Purpose/Scope/Responsibilities:** Delete V1 handlers, queue wiring, and dead paths so exactly one platform remains; scope = removal only, no V2 code.
> - **Inputs → Outputs:** Inventory (1.1.1) → clean tree with V1 absent.
> - **Dependencies:** 1.1.1.
> - **Invariants:** —.
> - **ADS · Phase · Repo:** Cutover · Phase −1 · `worker/`, app enqueue sites.
> - **Interfaces:** Public: none | Internal: none.
> - **Deliverables:** V1-free working tree; green build.
> - **Future:** None.
> - **Class:** Very Small · Low · Infrastructure · Minimal · Serial · Critical-path: Yes.
> - **Done when:** No V1 references remain; build passes; no dual paths.

> **[WBS 1.1.3] Rollback Anchor** — *Mandatory* · Owner: Infrastructure
> - **Purpose/Scope/Responsibilities:** Capture the last V1 state as an annotated tag for recoverability.
> - **Inputs → Outputs:** Pre-deletion state → milestone/rollback tag.
> - **Dependencies:** 1.1.1.
> - **Invariants:** —.
> - **ADS · Phase · Repo:** Cutover/rollback · Phase −1 · git tags.
> - **Interfaces:** Public: tag as recovery anchor | Internal: none.
> - **Deliverables:** Verified rollback tag.
> - **Future:** None.
> - **Class:** Very Small · Low · Infrastructure · Minimal · Parallelizable · Critical-path: No.
> - **Done when:** Tag exists and restores a buildable V1 state.

**Phase Summary (WBS 1).** Critical WPs: 1.1.1, 1.1.2. Parallel: 1.1.1 ∥ 1.1.3. Blocking: 1.1.1 blocks 1.1.2. **Milestone: M1 — Clean Slate.**

---

### WBS 2 — Phase 0 · Foundation & Contracts

**Capability Group 2.1 — Build & Delivery Infrastructure**

> **[WBS 2.1.1] Repository & Build Tooling** — *Mandatory* · Owner: Infrastructure
> - **Purpose/Scope/Responsibilities:** Establish repo structure (apps/packages/contracts/docs/scripts/ops), package manager, TS/build config, lint/format; scope excludes any subsystem logic.
> - **Inputs → Outputs:** Clean slate → structured, buildable skeleton.
> - **Dependencies:** WBS 1.
> - **Invariants:** — (foundation).
> - **ADS · Phase · Repo:** Repository/architecture-overview · Phase 0 · root, packages/apps skeleton.
> - **Interfaces:** Public: package boundary conventions | Internal: build config.
> - **Deliverables:** Buildable skeleton; module-boundary rules.
> - **Future:** DX generators (§14) hook here.
> - **Class:** Medium · Low · Infrastructure · Standard · Serial · Critical-path: Yes.
> - **Done when:** Tree builds; boundaries enforced; conventions documented.

> **[WBS 2.1.2] CI/CD Pipeline** — *Mandatory* · Owner: Infrastructure
> - **Purpose/Scope/Responsibilities:** Continuous build, lint, and test enforcement gate for every phase.
> - **Inputs → Outputs:** Build tooling (2.1.1) → green CI enforcing gates.
> - **Dependencies:** 2.1.1.
> - **Invariants:** —.
> - **ADS · Phase · Repo:** CI/quality-gates · Phase 0 · ci config, ops.
> - **Interfaces:** Public: gate contract (build/test/lint) | Internal: pipeline steps.
> - **Deliverables:** CI enforcing Quality Gates G1–G3 minimally.
> - **Future:** Perf-budget + E2E stages added later (Phases 12/14).
> - **Class:** Small · Low · Infrastructure · Standard · Parallelizable · Critical-path: Yes.
> - **Done when:** CI blocks red builds/tests; runs on every branch.

**Capability Group 2.2 — Contracts & Conventions**

> **[WBS 2.2.1] Shared Contracts Skeleton** — *Mandatory* · Owner: Platform
> - **Purpose/Scope/Responsibilities:** Stand up the neutral shared-contracts package + stability/versioning policy; scope = skeleton + policy, not concrete schemas.
> - **Inputs → Outputs:** Build tooling → importable contracts package + stability rules.
> - **Dependencies:** 2.1.1.
> - **Invariants:** INV-11 (version discipline seed).
> - **ADS · Phase · Repo:** Contracts · Phase 0 · contracts package.
> - **Interfaces:** Public: contract package shape + change policy | Internal: type organization.
> - **Deliverables:** Contracts skeleton; ADR-gate policy for contract changes.
> - **Future:** All concrete contracts (lifecycle/manifest/pipeline) attach here.
> - **Class:** Medium · Medium · Core · Standard · Serial · Critical-path: Yes.
> - **Done when:** Package type-checks; change-control policy documented.

> **[WBS 2.2.2] DI & Interface Conventions** — *Mandatory* · Owner: Platform
> - **Purpose/Scope/Responsibilities:** Define dependency-inversion conventions and boundary/interface rules used by every subsystem; scope = conventions, not the DI container (that is 4.1.2).
> - **Inputs → Outputs:** Contracts skeleton → documented DI/boundary rules.
> - **Dependencies:** 2.2.1.
> - **Invariants:** INV-3, INV-4 (boundary isolation groundwork).
> - **ADS · Phase · Repo:** Dependency-inversion · Phase 0 · docs, contracts.
> - **Interfaces:** Public: interface/naming conventions | Internal: boundary rules.
> - **Deliverables:** DI/interface convention guide.
> - **Future:** —.
> - **Class:** Small · Low · Core · Minimal · Parallelizable · Critical-path: Yes.
> - **Done when:** Conventions ratified and referenced by later phases.

**Capability Group 2.3 — Decision & DX Infrastructure**

> **[WBS 2.3.1] ADR System** — *Mandatory* · Owner: Developer Experience
> - **Purpose/Scope/Responsibilities:** Establish the ADR directory, template, and index; reserve ADRs for **rejected alternatives** (Rec 20).
> - **Inputs → Outputs:** Repo → ADR infra + ADR-000.
> - **Dependencies:** 2.1.1.
> - **Invariants:** Enables Stop-and-ADR (all).
> - **ADS · Phase · Repo:** ADR/governance · Phase 0 · docs/architecture/adr.
> - **Interfaces:** Public: ADR format + acceptance flow | Internal: index.
> - **Deliverables:** ADR system + template + decision log.
> - **Future:** Rejected-alternative ADRs accumulate over time.
> - **Class:** Very Small · Low · Infrastructure · Minimal · Fully-parallel · Critical-path: No.
> - **Done when:** ADR-000 exists; process documented.

> **[WBS 2.3.2] DX Hooks (Reserved Seam)** — *Recommended* · Owner: Developer Experience
> - **Purpose/Scope/Responsibilities:** Reserve seams (scaffolding entry points) for future generators without building them (Rec 21).
> - **Inputs → Outputs:** Repo conventions → reserved generator seam.
> - **Dependencies:** 2.1.1, 2.2.2.
> - **Invariants:** —.
> - **ADS · Phase · Repo:** Extensibility · Phase 0 · scripts (reserved).
> - **Interfaces:** Public: none active | Internal: reserved.
> - **Deliverables:** Documented seam only.
> - **Future:** Pipeline/plugin generators (§14 / WBS 18).
> - **Class:** Very Small · Low · Future · Minimal · Fully-parallel · Critical-path: No.
> - **Done when:** Seam documented; no active generator code.

**Phase Summary (WBS 2).** Critical WPs: 2.1.1, 2.2.1, 2.2.2. Parallel: 2.1.2, 2.3.1, 2.3.2 alongside contracts. Blocking: 2.1.1 → all. **Milestone: M2 — Foundation Ready.**

---

### WBS 3 — Phase 1 · Control Plane & Domain Lifecycles

**Capability Group 3.1 — State & Lifecycle Core**

> **[WBS 3.1.1] State Store** — *Mandatory* · Owner: Control Plane
> - **Purpose/Scope/Responsibilities:** Authoritative persistence for run/album/asset state behind an abstraction; scope = storage of state, not transition rules (3.1.2).
> - **Inputs → Outputs:** Foundation → `StateStore` with durable state.
> - **Dependencies:** WBS 2.
> - **Invariants:** INV-8.
> - **ADS · Phase · Repo:** Control-plane/persistence · Phase 1 · control-plane package.
> - **Interfaces:** Public: `StateStore` | Internal: persistence adapter.
> - **Deliverables:** State persistence + abstraction.
> - **Future:** Read-model projections for Run Explorer (§14).
> - **Class:** Medium · Medium · Core · Heavy · Serial · Critical-path: Yes.
> - **Done when:** State persists/reads authoritatively; abstraction swappable.

> **[WBS 3.1.2] Lifecycle Engine** *(reusable)* — *Mandatory* · Owner: Control Plane
> - **Purpose/Scope/Responsibilities:** Generic transition engine enforcing legal state transitions; reused by album/asset/run + manufacturing lifecycles.
> - **Inputs → Outputs:** State store + lifecycle definitions → validated, audited transitions.
> - **Dependencies:** 3.1.1.
> - **Invariants:** INV-6, INV-8, INV-9.
> - **ADS · Phase · Repo:** State-machine · Phase 1 · control-plane package.
> - **Interfaces:** Public: `TransitionEngine` | Internal: rule evaluation.
> - **Deliverables:** Reusable transition engine.
> - **Future:** Manufacturing lifecycle tail (WBS 15) plugs in.
> - **Class:** Large · High · Core · Mission-Critical · Serial · Critical-path: Yes.
> - **Done when:** Illegal transitions rejected; every transition audited.

> **[WBS 3.1.3] Album/Asset/Run Lifecycle Definitions** — *Mandatory* · Owner: Control Plane
> - **Purpose/Scope/Responsibilities:** Concrete state sets + legal transitions for Album (Rec 13), Asset (Rec 14), and Run lifecycles.
> - **Inputs → Outputs:** Lifecycle engine → concrete lifecycle definitions.
> - **Dependencies:** 3.1.2.
> - **Invariants:** INV-6, INV-9.
> - **ADS · Phase · Repo:** Lifecycles · Phase 1 · control-plane contracts.
> - **Interfaces:** Public: lifecycle enums + legal transitions | Internal: definition tables.
> - **Deliverables:** Album/Asset/Run lifecycle contracts.
> - **Future:** Manufacturing states appended in WBS 15.
> - **Class:** Medium · Medium · Core · Heavy · Serial · Critical-path: Yes.
> - **Done when:** All three lifecycles defined + validated by the engine.

> **[WBS 3.1.4] Run Registry (One-Active-Run)** — *Mandatory* · Owner: Control Plane
> - **Purpose/Scope/Responsibilities:** Enforce at most one active run per album under concurrency.
> - **Inputs → Outputs:** State store → serialized run admission.
> - **Dependencies:** 3.1.1, 3.1.3.
> - **Invariants:** INV-6, INV-8.
> - **ADS · Phase · Repo:** Run-management · Phase 1 · control-plane package.
> - **Interfaces:** Public: `RunRegistry` | Internal: locking.
> - **Deliverables:** One-active-run enforcement.
> - **Future:** Replay coordination (WBS 11) builds on this.
> - **Class:** Medium · High · Core · Mission-Critical · Serial · Critical-path: Yes.
> - **Done when:** Concurrent run attempts serialize to exactly one.

**Capability Group 3.2 — Events, Audit & Versioning**

> **[WBS 3.2.1] Event Model (Technical vs Domain)** — *Mandatory* · Owner: Control Plane
> - **Purpose/Scope/Responsibilities:** Two distinct event streams/contracts — technical/operational vs domain/business (Rec 19); scope = event contracts + publication, not consumers.
> - **Inputs → Outputs:** Transitions → published technical + domain events.
> - **Dependencies:** 3.1.2.
> - **Invariants:** INV-12.
> - **ADS · Phase · Repo:** Events · Phase 1 · control-plane contracts.
> - **Interfaces:** Public: `EventPublisher` (tech/domain), event schemas | Internal: dispatch.
> - **Deliverables:** Separated event streams + schemas.
> - **Future:** Analytics/business consumers (§14).
> - **Class:** Medium · Medium · Core · Heavy · Parallelizable · Critical-path: Yes.
> - **Done when:** Tech/domain events are cleanly separable and typed.

> **[WBS 3.2.2] Audit Subsystem** *(reusable/cross-cutting)* — *Mandatory* · Owner: Control Plane
> - **Purpose/Scope/Responsibilities:** Immutable audit record for every transition (INV-9); consumed platform-wide.
> - **Inputs → Outputs:** Transitions/events → append-only audit trail.
> - **Dependencies:** 3.1.2.
> - **Invariants:** INV-9.
> - **ADS · Phase · Repo:** Audit · Phase 1 · control-plane package.
> - **Interfaces:** Public: `AuditSink` | Internal: append-only store.
> - **Deliverables:** Audit trail + query surface.
> - **Future:** Surfaced by Observability (WBS 12).
> - **Class:** Small · Medium · Core · Heavy · Parallelizable · Critical-path: Yes.
> - **Done when:** No transition occurs without an audit record.

> **[WBS 3.2.3] Version Registry** *(reusable)* — *Mandatory* · Owner: Control Plane
> - **Purpose/Scope/Responsibilities:** Register and freeze the full Version Set at run start (Rec 4/9, INV-11); scope = registry + freeze, recording surfaced later (WBS 12).
> - **Inputs → Outputs:** Producing subsystems' versions → frozen per-run Version Set.
> - **Dependencies:** 3.1.1.
> - **Invariants:** INV-11.
> - **ADS · Phase · Repo:** Versioning · Phase 1 · control-plane package.
> - **Interfaces:** Public: `VersionRegistry`, version-set schema | Internal: freeze logic.
> - **Deliverables:** Version registry + freeze-at-start.
> - **Future:** Version Matrix recording (WBS 12).
> - **Class:** Medium · Medium · Core · Heavy · Parallelizable · Critical-path: Yes.
> - **Done when:** A run pins a complete, immutable version set at inception.

**Phase Summary (WBS 3).** Critical WPs: 3.1.2, 3.1.3, 3.1.4, 3.2.3. Parallel: 3.2.1/3.2.2/3.2.3 after the engine. Blocking: 3.1.1 → 3.1.2 → everything. **Milestone: M3 — Control Plane Ready.**

---

### WBS 4 — Phase 2 · Worker Runtime Platform

**Capability Group 4.1 — Runtime Core**

> **[WBS 4.1.1] Runtime Bootstrap & Lifecycle** — *Mandatory* · Owner: Runtime
> - **Purpose/Scope/Responsibilities:** Boot/live/shutdown of a worker process, separate from roles (Rec 16); scope = runtime lifecycle only.
> - **Inputs → Outputs:** Foundation + Control Plane → running runtime host.
> - **Dependencies:** WBS 2, WBS 3.
> - **Invariants:** INV-4.
> - **ADS · Phase · Repo:** Worker-runtime · Phase 2 · runtime package.
> - **Interfaces:** Public: `RuntimeHost` | Internal: lifecycle hooks.
> - **Deliverables:** Runtime host; runtime version registered.
> - **Future:** Plugin lifecycle (WBS 18).
> - **Class:** Medium · Medium · Core · Heavy · Serial · Critical-path: Yes.
> - **Done when:** Runtime boots, hosts a no-op role, shuts down cleanly.

> **[WBS 4.1.2] Dependency Injection Container** *(reusable)* — *Mandatory* · Owner: Runtime
> - **Purpose/Scope/Responsibilities:** Wire dependencies into handlers via DI; scope = container only (conventions from 2.2.2).
> - **Inputs → Outputs:** DI conventions → working container.
> - **Dependencies:** 2.2.2, 4.1.1.
> - **Invariants:** INV-3, INV-4.
> - **ADS · Phase · Repo:** DI · Phase 2 · runtime package.
> - **Interfaces:** Public: `Container`/resolution API | Internal: binding registry.
> - **Deliverables:** DI container.
> - **Future:** Plugin-provided bindings (WBS 18).
> - **Class:** Medium · Medium · Core · Heavy · Serial · Critical-path: Yes.
> - **Done when:** Dependencies resolve; boundaries respected.

> **[WBS 4.1.3] Configuration** *(reusable/cross-cutting)* — *Mandatory* · Owner: Infrastructure
> - **Purpose/Scope/Responsibilities:** Typed, validated configuration loading for all subsystems; scope = config capability only.
> - **Inputs → Outputs:** Environment/config sources → validated config objects.
> - **Dependencies:** 4.1.1.
> - **Invariants:** —.
> - **ADS · Phase · Repo:** Configuration · Phase 2 · runtime/config package.
> - **Interfaces:** Public: `Config` accessors | Internal: source adapters + validation.
> - **Deliverables:** Config subsystem.
> - **Future:** Per-plugin config (WBS 18).
> - **Class:** Small · Low · Infrastructure · Standard · Parallelizable · Critical-path: Yes.
> - **Done when:** Invalid config fails fast; all subsystems read config uniformly.

**Capability Group 4.2 — Handler & Capability Model**

> **[WBS 4.2.1] Capability Registry** *(reusable)* — *Mandatory* · Owner: Runtime
> - **Purpose/Scope/Responsibilities:** Register and resolve worker capabilities/roles at runtime.
> - **Inputs → Outputs:** Capability descriptors → resolvable registry.
> - **Dependencies:** 4.1.1, 4.1.2.
> - **Invariants:** INV-4.
> - **ADS · Phase · Repo:** Capability-registry · Phase 2 · runtime package.
> - **Interfaces:** Public: `CapabilityRegistry`, descriptor | Internal: lookup.
> - **Deliverables:** Capability registry.
> - **Future:** Plugin capabilities (WBS 18).
> - **Class:** Small · Medium · Core · Heavy · Serial · Critical-path: Yes.
> - **Done when:** Capabilities register + resolve; unknown capability fails safely.

> **[WBS 4.2.2] Idempotent Handler Contract** — *Mandatory* · Owner: Runtime
> - **Purpose/Scope/Responsibilities:** Base handler contract guaranteeing idempotency, result shape, error semantics (INV-7); scope = contract + base, not concrete roles.
> - **Inputs → Outputs:** Runtime + registry → handler base contract.
> - **Dependencies:** 4.1.1, 4.2.1.
> - **Invariants:** INV-7.
> - **ADS · Phase · Repo:** Handler · Phase 2 · runtime package.
> - **Interfaces:** Public: `Handler` contract | Internal: execution wrapper.
> - **Deliverables:** Idempotent handler base + double-invoke tests.
> - **Future:** Plugin handlers (WBS 18).
> - **Class:** Medium · High · Core · Mission-Critical · Serial · Critical-path: Yes.
> - **Done when:** A double-invoked handler produces identical effect.

> **[WBS 4.2.3] Queue Consumer Abstraction** — *Mandatory* · Owner: Runtime
> - **Purpose/Scope/Responsibilities:** Abstract job consumption so workers never talk to each other directly (INV-4) and pipelines stay declarative (INV-5).
> - **Inputs → Outputs:** Queue → claimed jobs delivered to handlers.
> - **Dependencies:** 4.1.1, 4.2.2.
> - **Invariants:** INV-4, INV-5, INV-7.
> - **ADS · Phase · Repo:** Queue · Phase 2 · runtime package.
> - **Interfaces:** Public: `QueueConsumer` | Internal: claim/ack.
> - **Deliverables:** Queue consumer abstraction.
> - **Future:** Alternate queue providers behind the same interface.
> - **Class:** Medium · Medium · Core · Heavy · Serial · Critical-path: Yes.
> - **Done when:** Jobs consumed idempotently; no worker-to-worker channel exists.

**Capability Group 4.3 — Extension & Accounting Seams**

> **[WBS 4.3.1] Plugin Registry Seam** — *Future* · Owner: Runtime
> - **Purpose/Scope/Responsibilities:** Reserve the plugin registration contract (Rec 6) without executing plugins.
> - **Inputs → Outputs:** Runtime → reserved `PluginRegistrar` seam.
> - **Dependencies:** 4.1.2, 4.2.1.
> - **Invariants:** INV-4, INV-7 (plugins must comply when built).
> - **ADS · Phase · Repo:** Plugins · Phase 2 · runtime package (reserved).
> - **Interfaces:** Public: `PluginRegistrar` (reserved) | Internal: none active.
> - **Deliverables:** Compiling, unused plugin seam.
> - **Future:** Full plugin architecture (WBS 18.1).
> - **Class:** Small · Low · Future · Minimal · Fully-parallel · Critical-path: No.
> - **Done when:** Seam compiles; documented as reserved; no plugin logic present.

> **[WBS 4.3.2] Cost & Performance Hook Points** — *Recommended* · Owner: Observability
> - **Purpose/Scope/Responsibilities:** Insert inert hook points for cost/perf accounting (consumed in WBS 12/14); scope = hooks only.
> - **Inputs → Outputs:** Handler lifecycle → hook callbacks.
> - **Dependencies:** 4.2.2.
> - **Invariants:** —.
> - **ADS · Phase · Repo:** Cost/perf · Phase 2 · runtime package.
> - **Interfaces:** Public: hook interfaces | Internal: invocation points.
> - **Deliverables:** Hook points (no recorder yet).
> - **Future:** Cost accounting (WBS 12.2.1), perf budgets (WBS 14).
> - **Class:** Small · Low · Supporting · Standard · Parallelizable · Critical-path: No.
> - **Done when:** Hooks fire around handler execution; no behavior change.

**Phase Summary (WBS 4).** Critical WPs: 4.1.1, 4.1.2, 4.2.1, 4.2.2, 4.2.3. Parallel: 4.1.3, 4.3.1, 4.3.2. Blocking: 4.1.1 → 4.1.2 → 4.2.x. **Milestone: M4 — Runtime Ready.**

---

### WBS 5 — Phase 3 · Storage & Immutable Artifact Platform

**Capability Group 5.1 — Storage Foundations**

> **[WBS 5.1.1] Storage Provider Abstraction** *(reusable)* — *Mandatory* · Owner: Infrastructure
> - **Purpose/Scope/Responsibilities:** Abstract private object storage behind a provider interface (DI); scope = provider abstraction, not addressing/immutability.
> - **Inputs → Outputs:** Config + runtime → `StorageProvider`.
> - **Dependencies:** WBS 4.
> - **Invariants:** INV-10.
> - **ADS · Phase · Repo:** Storage · Phase 3 · storage package.
> - **Interfaces:** Public: `StorageProvider` | Internal: object-store adapter.
> - **Deliverables:** Storage provider abstraction.
> - **Future:** Archive tiers; multi-region.
> - **Class:** Small · Low · Infrastructure · Standard · Serial · Critical-path: Yes.
> - **Done when:** Objects put/get through the abstraction; provider swappable.

> **[WBS 5.1.2] Content Addressing** — *Mandatory* · Owner: Infrastructure
> - **Purpose/Scope/Responsibilities:** Deterministic content/identity-addressed keys; no mutable keys (INV-10).
> - **Inputs → Outputs:** Content → stable content address.
> - **Dependencies:** 5.1.1.
> - **Invariants:** INV-10.
> - **ADS · Phase · Repo:** Content-addressing · Phase 3 · storage package.
> - **Interfaces:** Public: `ContentAddress` | Internal: hashing.
> - **Deliverables:** Addressing scheme + utilities.
> - **Future:** —.
> - **Class:** Small · Medium · Core · Heavy · Serial · Critical-path: Yes.
> - **Done when:** Identical content → identical address, deterministically.

**Capability Group 5.2 — Immutable Artifacts & Asset State**

> **[WBS 5.2.1] Immutable Artifact Store** — *Mandatory* · Owner: Platform
> - **Purpose/Scope/Responsibilities:** Write-once artifact API refusing overwrite (INV-2); scope = artifact write/read.
> - **Inputs → Outputs:** Content + address → immutable artifact.
> - **Dependencies:** 5.1.1, 5.1.2.
> - **Invariants:** INV-2, INV-10.
> - **ADS · Phase · Repo:** Artifacts · Phase 3 · storage package.
> - **Interfaces:** Public: `ArtifactStore` | Internal: write-once guard.
> - **Deliverables:** Immutable artifact store.
> - **Future:** Vendor/manufacturing artifacts reuse it (WBS 15).
> - **Class:** Medium · Medium · Core · Mission-Critical · Serial · Critical-path: Yes.
> - **Done when:** A written artifact cannot be overwritten; reads are stable.

> **[WBS 5.2.2] Asset Lifecycle (Storage Side)** — *Mandatory* · Owner: Platform
> - **Purpose/Scope/Responsibilities:** Wire stored objects to Asset Lifecycle transitions (Incoming→…→Deleted) via the Control Plane (Rec 14).
> - **Inputs → Outputs:** Artifact events → audited asset-state transitions.
> - **Dependencies:** 5.2.1, 3.1.3.
> - **Invariants:** INV-9, INV-2.
> - **ADS · Phase · Repo:** Asset-lifecycle · Phase 3 · storage + control-plane.
> - **Interfaces:** Public: `AssetRef` | Internal: state adapter.
> - **Deliverables:** Storage-side asset transitions.
> - **Future:** Processing-side transitions (WBS 7).
> - **Class:** Small · Medium · Supporting · Heavy · Parallelizable · Critical-path: Yes.
> - **Done when:** Storage events drive audited asset transitions correctly.

**Phase Summary (WBS 5).** Critical WPs: 5.1.1, 5.1.2, 5.2.1. Parallel: 5.2.2 after 5.2.1. Blocking: addressing → artifact store. **Milestone: M5 — Artifact Platform Ready.**

---

### WBS 6 — Phase 4 · Product Platform

**Capability Group 6.1 — Catalog & Materials**

> **[WBS 6.1.1] Product Catalog** — *Mandatory* · Owner: Product Platform
> - **Purpose/Scope/Responsibilities:** Model album products + dimensions; resolve a product to concrete specs (Rec 2/15).
> - **Inputs → Outputs:** Catalog data → resolvable product descriptors.
> - **Dependencies:** WBS 2, 3.2.3.
> - **Invariants:** INV-11.
> - **ADS · Phase · Repo:** Product/catalog · Phase 4 · product package.
> - **Interfaces:** Public: `ProductCatalog`, product descriptor | Internal: catalog store.
> - **Deliverables:** Product catalog + product versions.
> - **Future:** Vendor-specific product variants (WBS 15).
> - **Class:** Medium · Medium · Core · Heavy · Parallelizable · Critical-path: Yes.
> - **Done when:** A product resolves to concrete dimensions/specs; versioned.

> **[WBS 6.1.2] Material Taxonomy** — *Mandatory* · Owner: Product Platform
> - **Purpose/Scope/Responsibilities:** Cover/paper/binding/lamination options as a validated taxonomy.
> - **Inputs → Outputs:** Material data → validated option sets per product.
> - **Dependencies:** 6.1.1.
> - **Invariants:** INV-11.
> - **ADS · Phase · Repo:** Materials · Phase 4 · product package.
> - **Interfaces:** Public: material/option registry | Internal: validation.
> - **Deliverables:** Material taxonomy.
> - **Future:** Vendor material capabilities (WBS 15).
> - **Class:** Small · Low · Supporting · Standard · Parallelizable · Critical-path: Yes.
> - **Done when:** Products expose valid material options only.

**Capability Group 6.2 — Profiles, Pricing & Vendor Data**

> **[WBS 6.2.1] Processing Profiles** — *Mandatory* · Owner: Product Platform
> - **Purpose/Scope/Responsibilities:** Classic/Premium/Luxury/Archive/Draft profiles that **own render/processing parameters** (Rec 7) — no hardcoded params elsewhere.
> - **Inputs → Outputs:** Profile definitions → parameter sets for Image/Render.
> - **Dependencies:** 6.1.1, 3.2.3.
> - **Invariants:** INV-11.
> - **ADS · Phase · Repo:** Processing-profiles · Phase 4 · product package.
> - **Interfaces:** Public: `ProcessingProfileRegistry`, profile descriptor | Internal: param mapping.
> - **Deliverables:** Profile registry + versions.
> - **Future:** Additional profiles; quality-scoring linkage (WBS 18).
> - **Class:** Medium · Medium · Core · Heavy · Parallelizable · Critical-path: Yes.
> - **Done when:** Image/Render read all params from profiles; profiles versioned.

> **[WBS 6.2.2] Pricing Versions** — *Recommended* · Owner: Product Platform
> - **Purpose/Scope/Responsibilities:** Versioned pricing snapshots pinned per run (Rec 4); scope = pricing data/versioning, not checkout logic.
> - **Inputs → Outputs:** Pricing data → frozen pricing versions.
> - **Dependencies:** 6.1.1, 3.2.3.
> - **Invariants:** INV-11.
> - **ADS · Phase · Repo:** Pricing · Phase 4 · product package.
> - **Interfaces:** Public: `PricingVersion` | Internal: version store.
> - **Deliverables:** Pricing-version records.
> - **Future:** Vendor-cost-aware pricing (WBS 15).
> - **Class:** Small · Medium · Supporting · Standard · Parallelizable · Critical-path: No.
> - **Done when:** A run can pin an immutable pricing version.

> **[WBS 6.2.3] Vendor Profiles (Data)** — *Recommended* · Owner: Product Platform
> - **Purpose/Scope/Responsibilities:** Vendor capability/profile **data** (not execution) — feeds Manufacturing (WBS 15).
> - **Inputs → Outputs:** Vendor data → vendor-profile records + versions.
> - **Dependencies:** 6.1.2, 3.2.3.
> - **Invariants:** INV-11.
> - **ADS · Phase · Repo:** Vendor-profile · Phase 4 · product package.
> - **Interfaces:** Public: `VendorProfile` | Internal: profile store.
> - **Deliverables:** Vendor-profile data + versions.
> - **Future:** Vendor execution + validation (WBS 15).
> - **Class:** Small · Low · Supporting · Standard · Parallelizable · Critical-path: No.
> - **Done when:** Vendor profiles exist + version-pin; no execution coupling.

**Phase Summary (WBS 6).** Critical WPs: 6.1.1, 6.1.2, 6.2.1. Parallel: 6.2.2, 6.2.3. Blocking: 6.1.1 → materials/profiles. **Milestone: M6 — Product Platform Ready.**

---

### WBS 7 — Phase 5 · Image Processing Platform

**Capability Group 7.1 — Ingest & Safety**

> **[WBS 7.1.1] Input Validation & Sanitization** *(uses Validation)* — *Mandatory* · Owner: Image Engine
> - **Purpose/Scope/Responsibilities:** Magic-byte/type/decompression-bomb validation; reject spoofed/unsafe inputs; scope = validation only.
> - **Inputs → Outputs:** Raw upload → validated-or-rejected input.
> - **Dependencies:** WBS 4, WBS 5.
> - **Invariants:** INV-7.
> - **ADS · Phase · Repo:** Image-validation · Phase 5 · image package.
> - **Interfaces:** Public: `ImageValidator` | Internal: format/bomb guards.
> - **Deliverables:** Validation stage + malicious-input corpus tests.
> - **Future:** Plugin validators (WBS 18).
> - **Class:** Medium · High · Core · Mission-Critical · Serial · Critical-path: Yes.
> - **Done when:** Spoofed/bomb inputs rejected safely; idempotent.

**Capability Group 7.2 — Canonical & Derivative Assets**

> **[WBS 7.2.1] Canonicalizer (Master)** — *Mandatory* · Owner: Image Engine
> - **Purpose/Scope/Responsibilities:** Deterministic re-encode to a canonical print master (auto-orient, strip metadata); scope = master generation.
> - **Inputs → Outputs:** Validated input + profile → canonical master artifact.
> - **Dependencies:** 7.1.1, 6.2.1.
> - **Invariants:** INV-2, INV-7, INV-10.
> - **ADS · Phase · Repo:** Canonicalization · Phase 5 · image package.
> - **Interfaces:** Public: `Canonicalizer` | Internal: encode pipeline.
> - **Deliverables:** Canonical master + reproducibility tests.
> - **Future:** AI enhancement plugin stage (WBS 18).
> - **Class:** Large · High · Core · Mission-Critical · Serial · Critical-path: Yes.
> - **Done when:** Same input+profile → byte-identical master.

> **[WBS 7.2.2] Derivative Generator** — *Mandatory* · Owner: Image Engine
> - **Purpose/Scope/Responsibilities:** Deterministic derivatives (e.g., thumbnails/previews) from the master.
> - **Inputs → Outputs:** Master + profile → derivative artifacts.
> - **Dependencies:** 7.2.1.
> - **Invariants:** INV-2, INV-7, INV-10.
> - **ADS · Phase · Repo:** Derivatives · Phase 5 · image package.
> - **Interfaces:** Public: `DerivativeGenerator` | Internal: resize/encode.
> - **Deliverables:** Derivative generation + tests.
> - **Future:** Format/AI-driven derivatives (WBS 18).
> - **Class:** Medium · Medium · Core · Heavy · Parallelizable · Critical-path: Yes.
> - **Done when:** Derivatives are deterministic + immutable.

> **[WBS 7.2.3] Asset Lifecycle (Processing Side)** — *Mandatory* · Owner: Image Engine
> - **Purpose/Scope/Responsibilities:** Drive Incoming→Verified→Canonical→Derivative transitions during processing.
> - **Inputs → Outputs:** Processing events → audited asset transitions.
> - **Dependencies:** 7.2.1, 5.2.2.
> - **Invariants:** INV-9.
> - **ADS · Phase · Repo:** Asset-lifecycle · Phase 5 · image + control-plane.
> - **Interfaces:** Public: consumes `AssetRef` | Internal: transition calls.
> - **Deliverables:** Processing-side transitions.
> - **Future:** Quality-scoring signal emission (WBS 18).
> - **Class:** Small · Medium · Supporting · Heavy · Parallelizable · Critical-path: Yes.
> - **Done when:** Processing advances asset state with full audit.

**Phase Summary (WBS 7).** Critical WPs: 7.1.1, 7.2.1, 7.2.2. Parallel: 7.2.2 ∥ 7.2.3 after master. Blocking: validation → canonicalizer → derivatives. **Milestone: M7 — Image Platform Ready.**

---

### WBS 8 — Phase 6 · Blueprint Platform

**Capability Group 8.1 — Blueprint & Compiler**

> **[WBS 8.1.1] Blueprint Model** — *Mandatory* · Owner: Blueprint Platform
> - **Purpose/Scope/Responsibilities:** Define the blueprint schema (product + album intent + asset references); scope = model, not compilation.
> - **Inputs → Outputs:** Product + album intent → blueprint.
> - **Dependencies:** WBS 6, WBS 7.
> - **Invariants:** INV-11.
> - **ADS · Phase · Repo:** Blueprint · Phase 6 · blueprint package.
> - **Interfaces:** Public: blueprint schema | Internal: model types.
> - **Deliverables:** Blueprint schema + version.
> - **Future:** Mobile-authored blueprints (WBS 18).
> - **Class:** Medium · Medium · Core · Heavy · Serial · Critical-path: Yes.
> - **Done when:** Blueprint schema defined + versioned.

> **[WBS 8.1.2] Blueprint Compiler** — *Mandatory* · Owner: Blueprint Platform
> - **Purpose/Scope/Responsibilities:** Orchestrate the resolver chain to emit a resolved plan; **stops before manifest build** (Rec 3).
> - **Inputs → Outputs:** Blueprint → resolved plan.
> - **Dependencies:** 8.1.1, 8.2.1–8.2.3.
> - **Invariants:** INV-11.
> - **ADS · Phase · Repo:** Compiler · Phase 6 · blueprint package.
> - **Interfaces:** Public: `BlueprintCompiler`, `ResolvedPlan` | Internal: resolver orchestration.
> - **Deliverables:** Deterministic compiler → resolved plan.
> - **Future:** Additional resolver stages (WBS 18).
> - **Class:** Large · High · Core · Mission-Critical · Serial · Critical-path: Yes.
> - **Done when:** Blueprint compiles deterministically; no manifest logic present.

**Capability Group 8.2 — Resolvers & Catalogs**

> **[WBS 8.2.1] Layout Resolver** — *Mandatory* · Owner: Blueprint Platform
> - **Purpose/Scope/Responsibilities:** Resolve page/spread layout deterministically; pure function.
> - **Inputs → Outputs:** Blueprint → resolved layout.
> - **Dependencies:** 8.1.1.
> - **Invariants:** INV-11.
> - **ADS · Phase · Repo:** Layout · Phase 6 · blueprint package.
> - **Interfaces:** Public: `LayoutResolver` | Internal: layout rules.
> - **Deliverables:** Layout resolver + tests.
> - **Future:** —.
> - **Class:** Medium · Medium · Core · Heavy · Parallelizable · Critical-path: Yes.
> - **Done when:** Deterministic layout resolution proven.

> **[WBS 8.2.2] Template Resolver** — *Mandatory* · Owner: Blueprint Platform
> - **Purpose/Scope/Responsibilities:** Resolve templates against the layout; version-pinned; pure.
> - **Inputs → Outputs:** Layout + template catalog → resolved templates.
> - **Dependencies:** 8.2.1, 8.2.4.
> - **Invariants:** INV-11.
> - **ADS · Phase · Repo:** Template · Phase 6 · blueprint package.
> - **Interfaces:** Public: `TemplateResolver` | Internal: template application.
> - **Deliverables:** Template resolver + template version.
> - **Future:** —.
> - **Class:** Medium · Medium · Core · Heavy · Parallelizable · Critical-path: Yes.
> - **Done when:** Deterministic, version-pinned template resolution.

> **[WBS 8.2.3] Theme Resolver** — *Mandatory* · Owner: Blueprint Platform
> - **Purpose/Scope/Responsibilities:** Resolve theme (color/typography/decoration) deterministically; pure.
> - **Inputs → Outputs:** Resolved templates + theme catalog → themed plan.
> - **Dependencies:** 8.2.2, 8.2.4.
> - **Invariants:** INV-11.
> - **ADS · Phase · Repo:** Theme · Phase 6 · blueprint package.
> - **Interfaces:** Public: `ThemeResolver` | Internal: theme application.
> - **Deliverables:** Theme resolver + theme version.
> - **Future:** Advanced theming (WBS 18).
> - **Class:** Medium · Medium · Core · Heavy · Parallelizable · Critical-path: Yes.
> - **Done when:** Deterministic, version-pinned theme resolution.

> **[WBS 8.2.4] Font & Sticker Pack Catalog** *(reusable)* — *Mandatory* · Owner: Blueprint Platform
> - **Purpose/Scope/Responsibilities:** Versioned font/sticker pack catalog consumed by resolvers; scope = catalog + versions.
> - **Inputs → Outputs:** Pack data → resolvable, versioned packs.
> - **Dependencies:** 8.1.1, 6.1.1.
> - **Invariants:** INV-11.
> - **ADS · Phase · Repo:** Catalog · Phase 6 · blueprint package.
> - **Interfaces:** Public: pack descriptors | Internal: catalog store.
> - **Deliverables:** Font/sticker pack catalog + versions.
> - **Future:** Expanded packs.
> - **Class:** Small · Low · Supporting · Standard · Parallelizable · Critical-path: Yes.
> - **Done when:** Packs resolve + version-pin.

**Phase Summary (WBS 8).** Critical WPs: 8.1.2, 8.2.1, 8.2.2, 8.2.3. Parallel: resolvers can be developed against fixtures; catalog (8.2.4) alongside. Blocking: model → resolvers → compiler. **Milestone: M8 — Blueprint Ready.**

---

### WBS 9 — Phase 7 · Manifest Platform

**Capability Group 9.1 — Manifest Contract**

> **[WBS 9.1.1] Manifest Schema** — *Mandatory* · Owner: Platform
> - **Purpose/Scope/Responsibilities:** Define THE render contract — the immutable, versioned manifest schema (INV-1); highest-leverage shared contract.
> - **Inputs → Outputs:** Resolved-plan shape → manifest schema.
> - **Dependencies:** WBS 8.
> - **Invariants:** INV-1, INV-11.
> - **ADS · Phase · Repo:** Manifest-schema · Phase 7 · contracts + manifest package.
> - **Interfaces:** Public: manifest schema (versioned) | Internal: type defs.
> - **Deliverables:** Manifest schema + frozen version.
> - **Future:** Capability flags for plugins/mobile (additive).
> - **Class:** Medium · Critical · Core · Mission-Critical · Serial · Critical-path: Yes.
> - **Done when:** Schema frozen + versioned; ADR-gated for change.

> **[WBS 9.1.2] Manifest Builder** — *Mandatory* · Owner: Platform
> - **Purpose/Scope/Responsibilities:** Convert resolved plan → self-contained, immutable manifest (supports INV-3).
> - **Inputs → Outputs:** Resolved plan → manifest.
> - **Dependencies:** 9.1.1, 8.1.2.
> - **Invariants:** INV-1, INV-11.
> - **ADS · Phase · Repo:** Manifest-builder · Phase 7 · manifest package.
> - **Interfaces:** Public: `ManifestBuilder`, `Manifest` (immutable) | Internal: mapping.
> - **Deliverables:** Manifest builder.
> - **Future:** —.
> - **Class:** Medium · High · Core · Mission-Critical · Serial · Critical-path: Yes.
> - **Done when:** Resolved plan builds a valid, immutable, self-contained manifest.

> **[WBS 9.1.3] Manifest Validator** *(uses Validation)* — *Mandatory* · Owner: Platform
> - **Purpose/Scope/Responsibilities:** Exhaustively validate manifests; reject invalid/non-self-contained ones.
> - **Inputs → Outputs:** Manifest → valid/invalid verdict.
> - **Dependencies:** 9.1.1.
> - **Invariants:** INV-1, INV-3.
> - **ADS · Phase · Repo:** Manifest-validation · Phase 7 · manifest package.
> - **Interfaces:** Public: `ManifestValidator` | Internal: rule set.
> - **Deliverables:** Validator + valid/invalid corpus.
> - **Future:** —.
> - **Class:** Small · High · Core · Mission-Critical · Parallelizable · Critical-path: Yes.
> - **Done when:** Invalid/external-referencing manifests are rejected.

**Phase Summary (WBS 9).** Critical WPs: 9.1.1, 9.1.2, 9.1.3 (all). Parallel: validator alongside builder against the schema. Blocking: schema → builder/validator. **Milestone: M9 — Manifest Ready.**

---

### WBS 10 — Phase 8 · Render Engine & PDF Platform

**Capability Group 10.1 — Deterministic Rendering**

> **[WBS 10.1.1] Manifest Interpreter** — *Mandatory* · Owner: PDF
> - **Purpose/Scope/Responsibilities:** Interpret a manifest as the sole render input; **no domain/DB access** (INV-3).
> - **Inputs → Outputs:** Manifest → render instructions.
> - **Dependencies:** WBS 9.
> - **Invariants:** INV-3.
> - **ADS · Phase · Repo:** Render-engine · Phase 8 · render package.
> - **Interfaces:** Public: `Renderer` entry | Internal: interpreter.
> - **Deliverables:** Manifest interpreter + isolation tests.
> - **Future:** Alternate backends behind the interface.
> - **Class:** Large · Critical · Core · Mission-Critical · Serial · Critical-path: Yes.
> - **Done when:** Rendering runs from manifest alone; no DB reachable.

> **[WBS 10.1.2] Layout/Paint Pipeline** — *Mandatory* · Owner: PDF
> - **Purpose/Scope/Responsibilities:** Deterministic geometry/paint producing the visual page content.
> - **Inputs → Outputs:** Render instructions → painted pages.
> - **Dependencies:** 10.1.1.
> - **Invariants:** INV-3.
> - **ADS · Phase · Repo:** Paint · Phase 8 · render package.
> - **Interfaces:** Public: internal to `Renderer` | Internal: paint ops.
> - **Deliverables:** Deterministic paint pipeline.
> - **Future:** Plugin render stages (WBS 18).
> - **Class:** Very Large · Critical · Core · Mission-Critical · Serial · Critical-path: Yes.
> - **Done when:** Painting is deterministic across runs.

> **[WBS 10.1.3] PDF/Print Writer** — *Mandatory* · Owner: PDF
> - **Purpose/Scope/Responsibilities:** Emit the immutable print/preview artifact (INV-2) via the artifact store.
> - **Inputs → Outputs:** Painted pages → immutable PDF/print artifact.
> - **Dependencies:** 10.1.2, 5.2.1.
> - **Invariants:** INV-2, INV-10.
> - **ADS · Phase · Repo:** PDF · Phase 8 · render package.
> - **Interfaces:** Public: artifact output descriptor | Internal: writer.
> - **Deliverables:** PDF/print writer + render-engine version.
> - **Future:** Pre-press profile (bleed/DPI/ICC) as additive params.
> - **Class:** Large · High · Core · Mission-Critical · Serial · Critical-path: Yes.
> - **Done when:** Artifact is written once, immutable, addressable.

**Capability Group 10.2 — Reproducibility**

> **[WBS 10.2.1] Reproducibility Harness** — *Mandatory* · Owner: PDF
> - **Purpose/Scope/Responsibilities:** Prove byte-identical output from a fixed manifest (golden set).
> - **Inputs → Outputs:** Manifest → repeated identical artifact bytes.
> - **Dependencies:** 10.1.3.
> - **Invariants:** INV-1, INV-2, INV-3.
> - **ADS · Phase · Repo:** Determinism · Phase 8 · render tests.
> - **Interfaces:** Public: reproducibility report | Internal: byte-diff.
> - **Deliverables:** Golden-manifest reproducibility suite.
> - **Future:** Continuous reproducibility in CI (Phase 14).
> - **Class:** Medium · High · Core · Mission-Critical · Parallelizable · Critical-path: Yes.
> - **Done when:** Same manifest → byte-identical artifact, repeatably.

**Phase Summary (WBS 10).** Critical WPs: 10.1.1, 10.1.2, 10.1.3, 10.2.1. Parallel: harness developed alongside writer. Blocking: interpreter → paint → writer → harness. **Milestone: M10 — Renderer Ready.**

---

### WBS 11 — Phase 9 · Pipeline & Coordinator Platform

**Capability Group 11.1 — Declarative Pipeline**

> **[WBS 11.1.1] Pipeline Definition Schema** — *Mandatory* · Owner: Platform
> - **Purpose/Scope/Responsibilities:** Declarative pipeline description (steps + dependencies) — data, not code (INV-5).
> - **Inputs → Outputs:** Pipeline intent → declarative pipeline definition.
> - **Dependencies:** WBS 3–10.
> - **Invariants:** INV-5.
> - **ADS · Phase · Repo:** Pipeline · Phase 9 · pipeline package.
> - **Interfaces:** Public: pipeline schema | Internal: step descriptors.
> - **Deliverables:** Pipeline definition schema.
> - **Future:** DX pipeline generator (WBS 18).
> - **Class:** Medium · Medium · Core · Heavy · Serial · Critical-path: Yes.
> - **Done when:** Pipelines are declarative data validated against a schema.

> **[WBS 11.1.2] Pipeline Interpreter & Scheduler** — *Mandatory* · Owner: Platform
> - **Purpose/Scope/Responsibilities:** Interpret pipeline definitions and schedule steps; no imperative pipelines.
> - **Inputs → Outputs:** Pipeline definition → scheduled step execution.
> - **Dependencies:** 11.1.1, 4.2.3.
> - **Invariants:** INV-5, INV-7.
> - **ADS · Phase · Repo:** Orchestration · Phase 9 · pipeline package.
> - **Interfaces:** Public: internal to coordinator | Internal: scheduler.
> - **Deliverables:** Interpreter + scheduler.
> - **Future:** —.
> - **Class:** Large · High · Core · Mission-Critical · Serial · Critical-path: Yes.
> - **Done when:** Declarative pipelines execute correctly, idempotently.

**Capability Group 11.2 — Coordination, Recovery & Replay**

> **[WBS 11.2.1] Dependency Graph Engine** — *Mandatory* · Owner: Platform
> - **Purpose/Scope/Responsibilities:** Resolve and execute the run's step dependency graph.
> - **Inputs → Outputs:** Pipeline → ordered/parallel step graph.
> - **Dependencies:** 11.1.2.
> - **Invariants:** INV-5.
> - **ADS · Phase · Repo:** Dependency-graph · Phase 9 · pipeline package.
> - **Interfaces:** Public: `RunGraph` | Internal: topological execution.
> - **Deliverables:** Dependency-graph engine + run-graph data.
> - **Future:** Run Explorer visualization (WBS 18).
> - **Class:** Medium · High · Core · Heavy · Parallelizable · Critical-path: Yes.
> - **Done when:** Graph executes respecting dependencies; graph data emitted.

> **[WBS 11.2.2] Coordinator / Orchestrator** — *Mandatory* · Owner: Control Plane
> - **Purpose/Scope/Responsibilities:** Drive a run end-to-end (image→blueprint→manifest→render) against the Control Plane; enforce one-active-run (INV-6).
> - **Inputs → Outputs:** Run request → completed run producing an artifact.
> - **Dependencies:** 11.1.2, 11.2.1, 3.1.4, 3.2.3.
> - **Invariants:** INV-6, INV-8, INV-11.
> - **ADS · Phase · Repo:** Coordinator · Phase 9 · coordinator package.
> - **Interfaces:** Public: `Coordinator` | Internal: run driver.
> - **Deliverables:** End-to-end coordinator; version freeze at run start.
> - **Future:** —.
> - **Class:** Large · Critical · Core · Mission-Critical · Serial · Critical-path: Yes.
> - **Done when:** A run completes end-to-end with versions frozen + one-active-run held.

> **[WBS 11.2.3] Recovery / Resume** — *Mandatory* · Owner: Control Plane
> - **Purpose/Scope/Responsibilities:** Resume interrupted runs without side-effect drift (INV-7).
> - **Inputs → Outputs:** Interrupted run state → correct resumption.
> - **Dependencies:** 11.2.2.
> - **Invariants:** INV-7, INV-8.
> - **ADS · Phase · Repo:** Recovery · Phase 9 · coordinator package.
> - **Interfaces:** Public: resume operation | Internal: checkpoint logic.
> - **Deliverables:** Crash-recovery/resume + idempotency tests.
> - **Future:** —.
> - **Class:** Medium · High · Core · Mission-Critical · Serial · Critical-path: Yes.
> - **Done when:** Crash/duplicate delivery resumes with no drift.

> **[WBS 11.2.4] Replay Semantics** — *Recommended* · Owner: Platform
> - **Purpose/Scope/Responsibilities:** Define + implement the semantic distinction of **Retry / Replay / Rebuild / Regenerate** (Rec 18); scope = semantics + seam, not full UX.
> - **Inputs → Outputs:** Replay request → correct operation using frozen versions.
> - **Dependencies:** 11.2.2, 3.2.3.
> - **Invariants:** INV-7, INV-11.
> - **ADS · Phase · Repo:** Replay · Phase 9 · coordinator package.
> - **Interfaces:** Public: `ReplayRequest` semantics | Internal: dispatcher.
> - **Deliverables:** Replay semantics + seam.
> - **Future:** Full Replay Platform (WBS 18).
> - **Class:** Medium · Medium · Supporting · Heavy · Parallelizable · Critical-path: No.
> - **Done when:** Each replay mode is distinct and correct (rebuild = byte-identical via frozen versions).

**Phase Summary (WBS 11).** Critical WPs: 11.1.1, 11.1.2, 11.2.1, 11.2.2, 11.2.3. Parallel: 11.2.4 optional-parallel. Blocking: schema → interpreter → coordinator. **Milestone: M11 — Pipeline Ready.**

---

### WBS 12 — Phase 10 · Observability, Cost Accounting & Metrics

**Capability Group 12.1 — Telemetry Core (cross-cutting)**

> **[WBS 12.1.1] Logging** *(reusable/cross-cutting)* — *Mandatory* · Owner: Observability
> - **Purpose/Scope/Responsibilities:** Structured, leveled, correlatable logging for all subsystems.
> - **Inputs → Outputs:** Subsystem events → structured logs.
> - **Dependencies:** WBS 4 (hooks), 3.2.2.
> - **Invariants:** INV-9 (surfaces audit context).
> - **ADS · Phase · Repo:** Observability · Phase 10 · observability package.
> - **Interfaces:** Public: `Logger` | Internal: sinks.
> - **Deliverables:** Logging layer.
> - **Future:** —.
> - **Class:** Small · Low · Infrastructure · Standard · Fully-parallel · Critical-path: No.
> - **Done when:** All subsystems log structurally with correlation ids.

> **[WBS 12.1.2] Metrics** *(reusable/cross-cutting)* — *Mandatory* · Owner: Observability
> - **Purpose/Scope/Responsibilities:** Technical metrics emission (throughput/health) with a clear taxonomy.
> - **Inputs → Outputs:** Subsystem counters → metrics.
> - **Dependencies:** WBS 4 (hooks).
> - **Invariants:** INV-12 (tech vs business separation).
> - **ADS · Phase · Repo:** Metrics · Phase 10 · observability package.
> - **Interfaces:** Public: `Metrics` | Internal: registry.
> - **Deliverables:** Metrics layer.
> - **Future:** Business analytics (WBS 18).
> - **Class:** Small · Low · Infrastructure · Standard · Fully-parallel · Critical-path: No.
> - **Done when:** Subsystems emit metrics; taxonomy documented.

> **[WBS 12.1.3] Tracing / Correlation** — *Mandatory* · Owner: Observability
> - **Purpose/Scope/Responsibilities:** End-to-end correlation via request/run/job ids across app + worker.
> - **Inputs → Outputs:** Requests/runs/jobs → correlated traces.
> - **Dependencies:** 12.1.1, 11.2.2.
> - **Invariants:** —.
> - **ADS · Phase · Repo:** Tracing · Phase 10 · observability package.
> - **Interfaces:** Public: `Tracer`/correlation ids | Internal: propagation.
> - **Deliverables:** Correlated tracing.
> - **Future:** Run Explorer (WBS 18).
> - **Class:** Medium · Medium · Supporting · Heavy · Parallelizable · Critical-path: No.
> - **Done when:** Any run is traceable end-to-end by id.

**Capability Group 12.2 — Cost, Versions & Business Signals**

> **[WBS 12.2.1] Cost Accounting** — *Recommended* · Owner: Observability
> - **Purpose/Scope/Responsibilities:** Per-run cost record: CPU/mem/duration/storage/R2 reads/writes/estimated cost (Rec 8).
> - **Inputs → Outputs:** Runtime/pipeline hooks → per-run cost record.
> - **Dependencies:** 4.3.2, 11.2.2.
> - **Invariants:** —.
> - **ADS · Phase · Repo:** Cost · Phase 10 · cost package.
> - **Interfaces:** Public: `CostRecorder`, cost-record schema | Internal: aggregation.
> - **Deliverables:** Cost accounting per run.
> - **Future:** Vendor-cost + revenue analytics (WBS 18).
> - **Class:** Medium · Medium · Supporting · Heavy · Parallelizable · Critical-path: No.
> - **Done when:** Every run exposes an accurate cost record.

> **[WBS 12.2.2] Version Matrix Recording** — *Recommended* · Owner: Observability
> - **Purpose/Scope/Responsibilities:** Record + surface each run's frozen Version Set as the Version Matrix (Rec 9).
> - **Inputs → Outputs:** Version registry (3.2.3) → recorded/queryable Version Matrix.
> - **Dependencies:** 3.2.3, 11.2.2.
> - **Invariants:** INV-11.
> - **ADS · Phase · Repo:** Version-matrix · Phase 10 · observability package.
> - **Interfaces:** Public: `VersionMatrixRecorder` | Internal: writer.
> - **Deliverables:** Version Matrix records.
> - **Future:** Blast-radius analytics.
> - **Class:** Small · Medium · Supporting · Heavy · Parallelizable · Critical-path: No.
> - **Done when:** Each run carries a complete, queryable Version Matrix.

> **[WBS 12.2.3] Run-Graph / Explorer Data Model** — *Future* · Owner: Observability
> - **Purpose/Scope/Responsibilities:** Persist run graph/timeline data for a future Run Explorer (Rec 17 seam) — data only, no UI.
> - **Inputs → Outputs:** Dependency-graph engine → persisted run-graph.
> - **Dependencies:** 11.2.1, 12.1.3.
> - **Invariants:** —.
> - **ADS · Phase · Repo:** Run-explorer · Phase 10 · observability package (data).
> - **Interfaces:** Public: run-graph schema | Internal: persistence.
> - **Deliverables:** Run-graph data model.
> - **Future:** Run Explorer UI (WBS 18).
> - **Class:** Small · Low · Future · Standard · Fully-parallel · Critical-path: No.
> - **Done when:** Run graphs are persisted + queryable; no UI built.

> **[WBS 12.2.4] Business Metrics (Technical)** — *Recommended* · Owner: Observability
> - **Purpose/Scope/Responsibilities:** Technical counters for albums/day, pages/day, processing time/cost (Rec 25) — collection only.
> - **Inputs → Outputs:** Domain events + cost → business counters.
> - **Dependencies:** 3.2.1, 12.2.1.
> - **Invariants:** INV-12.
> - **ADS · Phase · Repo:** Business-metrics · Phase 10 · observability package.
> - **Interfaces:** Public: business-metric counters | Internal: aggregation.
> - **Deliverables:** Technical business-metric collection.
> - **Future:** Analytics dashboards + revenue/vendor throughput (WBS 18).
> - **Class:** Small · Low · Supporting · Standard · Fully-parallel · Critical-path: No.
> - **Done when:** Core business counters are collected from domain events.

**Phase Summary (WBS 12).** Critical WPs: none block the render spine, but 12.1.1/12.1.3 are prerequisites for operability. Parallel: nearly all fully-parallel. Blocking: hooks (4.3.2) + events (3.2.1) upstream. **Milestone: M12 — Observable & Costed.**

---

### WBS 13 — Phase 11 · Security & Compliance Hardening

**Capability Group 13.1 — Security Audit (cross-cutting)**

> **[WBS 13.1.1] Boundary Validation Audit** — *Mandatory* · Owner: Infrastructure
> - **Purpose/Scope/Responsibilities:** Verify every external input is validated at its boundary (image + manifest + config surfaces).
> - **Inputs → Outputs:** All boundaries → validation-coverage verdict + fixes.
> - **Dependencies:** WBS 1–12.
> - **Invariants:** INV-1, INV-3, INV-7.
> - **ADS · Phase · Repo:** Security · Phase 11 · all packages (audit).
> - **Interfaces:** Public: unchanged | Internal: hardened validators.
> - **Deliverables:** Boundary-validation audit + remediations.
> - **Future:** Plugin input sandboxing (WBS 18).
> - **Class:** Medium · Medium · Supporting · Mission-Critical · Parallelizable · Critical-path: No.
> - **Done when:** No unvalidated external input path remains.

> **[WBS 13.1.2] Secret Handling** — *Mandatory* · Owner: Infrastructure
> - **Purpose/Scope/Responsibilities:** Verify secrets are never exposed/logged; least-exposure access.
> - **Inputs → Outputs:** Secret usage sites → verified-safe handling.
> - **Dependencies:** 4.1.3, 12.1.1.
> - **Invariants:** —.
> - **ADS · Phase · Repo:** Secrets · Phase 11 · config/observability.
> - **Interfaces:** Public: unchanged | Internal: redaction rules.
> - **Deliverables:** Secret-handling verification + fixes.
> - **Future:** —.
> - **Class:** Small · High · Supporting · Heavy · Parallelizable · Critical-path: No.
> - **Done when:** No secret is exposed in logs/traces/artifacts.

> **[WBS 13.1.3] Access Control / Least Privilege** — *Mandatory* · Owner: Infrastructure
> - **Purpose/Scope/Responsibilities:** Least-privilege for runtime/storage/artifact access; gate artifact reads.
> - **Inputs → Outputs:** Access surfaces → least-privilege posture.
> - **Dependencies:** 5.2.1, 4.1.1.
> - **Invariants:** INV-2, INV-8.
> - **ADS · Phase · Repo:** Access-control · Phase 11 · storage/runtime.
> - **Interfaces:** Public: unchanged | Internal: access checks.
> - **Deliverables:** Access-control verification + fixes.
> - **Future:** —.
> - **Class:** Small · Medium · Supporting · Heavy · Parallelizable · Critical-path: No.
> - **Done when:** Access is least-privilege; artifact reads are gated.

**Phase Summary (WBS 13).** Critical WPs: 13.1.1 (breadth). Parallel: all three axes parallel. Blocking: requires the assembled system (WBS 12). **Milestone: M13 — Hardened.**

---

### WBS 14 — Phase 12 · Performance, Budgets & Scale Readiness

**Capability Group 14.1 — Budgets & Scale (cross-cutting)**

> **[WBS 14.1.1] Performance Budget Framework** — *Recommended* · Owner: Platform
> - **Purpose/Scope/Responsibilities:** Formalize + enforce per-subsystem performance budgets declared across phases (Rec 10).
> - **Inputs → Outputs:** Per-subsystem budgets → enforced thresholds.
> - **Dependencies:** WBS 1–12.
> - **Invariants:** —.
> - **ADS · Phase · Repo:** Performance · Phase 12 · perf config + CI.
> - **Interfaces:** Public: `PerformanceBudget` schema | Internal: threshold checks.
> - **Deliverables:** Budget framework + enforcement.
> - **Future:** Auto-tuning.
> - **Class:** Medium · Medium · Supporting · Heavy · Parallelizable · Critical-path: No.
> - **Done when:** Each subsystem has a budget the harness enforces.

> **[WBS 14.1.2] Benchmark & Load Harness** — *Recommended* · Owner: Platform
> - **Purpose/Scope/Responsibilities:** Measure subsystems + full runs against budgets; load/soak within scope.
> - **Inputs → Outputs:** Workloads → performance results vs budgets.
> - **Dependencies:** 14.1.1, 11.2.2.
> - **Invariants:** INV-7 (idempotency under load).
> - **ADS · Phase · Repo:** Benchmarks · Phase 12 · perf tests.
> - **Interfaces:** Public: performance-report schema | Internal: drivers.
> - **Deliverables:** Benchmark/load harness + results.
> - **Future:** Continuous perf in CI.
> - **Class:** Medium · Medium · Supporting · Heavy · Parallelizable · Critical-path: No.
> - **Done when:** Budgets measured; regressions caught.

> **[WBS 14.1.3] Scale-Seam Validation** — *Recommended* · Owner: Infrastructure
> - **Purpose/Scope/Responsibilities:** Validate + document scale seams (shared queue/rate-limit/horizontal worker) without premature build-out.
> - **Inputs → Outputs:** Scale scenarios → seam-validation report.
> - **Dependencies:** 4.2.3, 14.1.2.
> - **Invariants:** INV-4, INV-6.
> - **ADS · Phase · Repo:** Scale · Phase 12 · ops docs.
> - **Interfaces:** Public: documented seams | Internal: none.
> - **Deliverables:** Scale-readiness report + documented bottlenecks.
> - **Future:** Horizontal scale-out; shared-store rate-limit/queue.
> - **Class:** Small · Medium · Infrastructure · Standard · Parallelizable · Critical-path: No.
> - **Done when:** Seams validated; bottlenecks + mitigations documented.

**Phase Summary (WBS 14).** Critical WPs: 14.1.1 (enables enforcement). Parallel: all parallel. Blocking: needs instrumented system (WBS 12). **Milestone: M14 — Performant & Scale-Ready.**

---

### WBS 15 — Phase 13 · Manufacturing & Vendor Platform

**Capability Group 15.1 — Vendor Abstraction & Lifecycle**

> **[WBS 15.1.1] Vendor Provider Abstraction** — *Recommended* · Owner: Manufacturing
> - **Purpose/Scope/Responsibilities:** `VendorProvider` interface (submit/track/validate) enabling multiple print vendors (Rec 11); scope = abstraction + registry.
> - **Inputs → Outputs:** Print-ready artifact + vendor profile → vendor submission (via provider).
> - **Dependencies:** WBS 5, WBS 6 (6.2.3), WBS 11.
> - **Invariants:** INV-8.
> - **ADS · Phase · Repo:** Vendor · Phase 13 · manufacturing package.
> - **Interfaces:** Public: `VendorProvider`, registry | Internal: adapter contract.
> - **Deliverables:** Vendor abstraction + registry.
> - **Future:** Real vendor integrations (WBS 18).
> - **Class:** Medium · Medium · Supporting · Heavy · Parallelizable · Critical-path: No.
> - **Done when:** A vendor is swappable behind one adapter.

> **[WBS 15.1.2] Manufacturing Lifecycle (Tail)** — *Recommended* · Owner: Manufacturing
> - **Purpose/Scope/Responsibilities:** Print-Ready→Vendor→Printing→Binding→Packaging→Dispatch→Delivered as the Album lifecycle tail (Rec 12), on the Lifecycle Engine.
> - **Inputs → Outputs:** Print-ready run → audited manufacturing transitions.
> - **Dependencies:** 3.1.2, 3.1.3, 15.1.1.
> - **Invariants:** INV-8, INV-9.
> - **ADS · Phase · Repo:** Manufacturing · Phase 13 · manufacturing + control-plane.
> - **Interfaces:** Public: manufacturing states | Internal: transitions.
> - **Deliverables:** Manufacturing lifecycle (audited).
> - **Future:** Automated dispatch (WBS 18).
> - **Class:** Medium · Medium · Supporting · Heavy · Parallelizable · Critical-path: No.
> - **Done when:** Manufacturing states transition + audit correctly; independent of orders.status.

**Capability Group 15.2 — Validation & Mock Execution**

> **[WBS 15.2.1] Vendor Validation Profiles** — *Recommended* · Owner: Manufacturing
> - **Purpose/Scope/Responsibilities:** Pre-flight vendor validation rules gating dispatch (Rec 23).
> - **Inputs → Outputs:** Artifact + vendor profile → pass/fail validation.
> - **Dependencies:** 15.1.1, 6.2.3.
> - **Invariants:** INV-8.
> - **ADS · Phase · Repo:** Vendor-validation · Phase 13 · manufacturing package.
> - **Interfaces:** Public: `VendorValidationProfile` | Internal: rule runner.
> - **Deliverables:** Validation profiles + gate.
> - **Future:** Vendor-specific rule packs (WBS 18).
> - **Class:** Small · Medium · Supporting · Heavy · Parallelizable · Critical-path: No.
> - **Done when:** Dispatch is gated by validation profiles.

> **[WBS 15.2.2] Mock Vendor & Dispatch Seam** — *Recommended* · Owner: Manufacturing
> - **Purpose/Scope/Responsibilities:** Deterministic mock provider + dispatch seam proving the abstraction end-to-end; real vendors reserved.
> - **Inputs → Outputs:** Vendor submission → mock tracking/lifecycle progression.
> - **Dependencies:** 15.1.1, 15.1.2.
> - **Invariants:** INV-8, INV-9.
> - **ADS · Phase · Repo:** Vendor-mock · Phase 13 · manufacturing package.
> - **Interfaces:** Public: mock provider | Internal: reserved webhook seam.
> - **Deliverables:** Mock vendor + reserved dispatch/webhook seam.
> - **Future:** Real vendor webhooks/dispatch (WBS 18).
> - **Class:** Small · Low · Supporting · Standard · Parallelizable · Critical-path: No.
> - **Done when:** Mock proves the flow; real-vendor seam is additive.

**Phase Summary (WBS 15).** Critical WPs: 15.1.1, 15.1.2. Parallel: validation + mock parallel. Blocking: abstraction → lifecycle/validation/mock. **Milestone: M15 — Manufacturing-Ready (Foundations).**

---

### WBS 16 — Phase 14 · Integration & End-to-End Validation

**Capability Group 16.1 — Whole-System Proof**

> **[WBS 16.1.1] End-to-End Harness** — *Mandatory* · Owner: Platform
> - **Purpose/Scope/Responsibilities:** Full-pipeline E2E via public contracts (album → manufacturing-ready artifact).
> - **Inputs → Outputs:** Real album inputs → completed run + artifact.
> - **Dependencies:** WBS 1–15.
> - **Invariants:** All.
> - **ADS · Phase · Repo:** E2E · Phase 14 · e2e tests.
> - **Interfaces:** Public: exercises public contracts | Internal: none.
> - **Deliverables:** E2E suite.
> - **Future:** Continuous E2E in CI.
> - **Class:** Medium · Medium · Core · Mission-Critical · Serial · Critical-path: Yes.
> - **Done when:** Full pipeline passes E2E on production-like inputs.

> **[WBS 16.1.2] Reproducibility Verification** — *Mandatory* · Owner: Platform
> - **Purpose/Scope/Responsibilities:** Verify rebuild = byte-identical across the assembled system.
> - **Inputs → Outputs:** Frozen run → identical rebuilt artifact.
> - **Dependencies:** 16.1.1, 10.2.1, 11.2.4.
> - **Invariants:** INV-1, INV-2, INV-11.
> - **ADS · Phase · Repo:** Determinism · Phase 14 · e2e tests.
> - **Interfaces:** Public: reproducibility report | Internal: byte-diff.
> - **Deliverables:** System-level reproducibility proof.
> - **Future:** —.
> - **Class:** Small · High · Core · Mission-Critical · Parallelizable · Critical-path: Yes.
> - **Done when:** Rebuild reproduces bytes exactly.

> **[WBS 16.1.3] Load / Soak Validation** — *Recommended* · Owner: Platform
> - **Purpose/Scope/Responsibilities:** Validate stability + budgets under sustained load; idempotency under adversarial retries.
> - **Inputs → Outputs:** Sustained workload → stability + budget report.
> - **Dependencies:** 16.1.1, 14.1.2.
> - **Invariants:** INV-6, INV-7.
> - **ADS · Phase · Repo:** Load/soak · Phase 14 · e2e tests.
> - **Interfaces:** Public: load report | Internal: drivers.
> - **Deliverables:** Load/soak results.
> - **Future:** —.
> - **Class:** Medium · Medium · Supporting · Heavy · Parallelizable · Critical-path: No.
> - **Done when:** System stable under load within budgets.

> **[WBS 16.1.4] Invariant Audit** — *Mandatory* · Owner: Platform
> - **Purpose/Scope/Responsibilities:** Run the full invariant checklist (INV-1…12) against the assembled platform.
> - **Inputs → Outputs:** Assembled system → invariant-compliance report.
> - **Dependencies:** 16.1.1.
> - **Invariants:** All.
> - **ADS · Phase · Repo:** Invariants · Phase 14 · e2e tests.
> - **Interfaces:** Public: compliance report | Internal: checks.
> - **Deliverables:** Invariant-compliance audit.
> - **Future:** Continuous invariant checks in CI.
> - **Class:** Small · High · Core · Mission-Critical · Parallelizable · Critical-path: Yes.
> - **Done when:** Every invariant verified end-to-end.

**Phase Summary (WBS 16).** Critical WPs: 16.1.1, 16.1.2, 16.1.4. Parallel: 16.1.3 parallel. Blocking: E2E harness first. **Milestone: M16 — Validated.**

---

### WBS 17 — Phase 15 · Production Cutover

**Capability Group 17.1 — Rollout & Retirement**

> **[WBS 17.1.1] Cutover Runbook & Procedure** — *Mandatory* · Owner: Infrastructure
> - **Purpose/Scope/Responsibilities:** Author + execute the controlled rollout procedure.
> - **Inputs → Outputs:** Validated system → production deployment.
> - **Dependencies:** WBS 16.
> - **Invariants:** All (preserved through cutover).
> - **ADS · Phase · Repo:** Deployment · Phase 15 · ops/runbooks.
> - **Interfaces:** Public: production SLOs | Internal: deploy steps.
> - **Deliverables:** Executed cutover runbook.
> - **Future:** Progressive rollout tooling.
> - **Class:** Small · Medium · Infrastructure · Heavy · Serial · Critical-path: Yes.
> - **Done when:** V2 live in production per runbook.

> **[WBS 17.1.2] Rollback Rehearsal** — *Mandatory* · Owner: Infrastructure
> - **Purpose/Scope/Responsibilities:** Demonstrate rollback **before** go-live using milestone tags.
> - **Inputs → Outputs:** Deployed state → proven rollback path.
> - **Dependencies:** 17.1.1, 1.1.3.
> - **Invariants:** INV-2 (immutable artifacts aid rollback).
> - **ADS · Phase · Repo:** Rollback · Phase 15 · ops/runbooks.
> - **Interfaces:** Public: rollback procedure | Internal: steps.
> - **Deliverables:** Rollback rehearsal evidence.
> - **Future:** Automated rollback.
> - **Class:** Small · High · Infrastructure · Mission-Critical · Serial · Critical-path: Yes.
> - **Done when:** Rollback demonstrated repeatably.

> **[WBS 17.1.3] Production Observability & Alerting** — *Mandatory* · Owner: Observability
> - **Purpose/Scope/Responsibilities:** Activate production alerting on defined failure conditions.
> - **Inputs → Outputs:** Telemetry (WBS 12) → live alerts.
> - **Dependencies:** WBS 12, 17.1.1.
> - **Invariants:** INV-9.
> - **ADS · Phase · Repo:** Alerting · Phase 15 · ops/alerting.
> - **Interfaces:** Public: alert definitions | Internal: routing.
> - **Deliverables:** Live production alerting.
> - **Future:** SLO automation.
> - **Class:** Small · Medium · Infrastructure · Heavy · Parallelizable · Critical-path: Yes.
> - **Done when:** Alerts fire on defined conditions in production.

> **[WBS 17.1.4] V1 Retirement Confirmation** — *Mandatory* · Owner: Infrastructure
> - **Purpose/Scope/Responsibilities:** Confirm no V1 remnants remain anywhere post-cutover.
> - **Inputs → Outputs:** Production + repo → retirement confirmation.
> - **Dependencies:** 17.1.1.
> - **Invariants:** —.
> - **ADS · Phase · Repo:** Retirement · Phase 15 · repo + infra.
> - **Interfaces:** Public: retirement checklist | Internal: none.
> - **Deliverables:** Retirement confirmation record.
> - **Future:** —.
> - **Class:** Very Small · Low · Infrastructure · Standard · Parallelizable · Critical-path: Yes.
> - **Done when:** V1 confirmed fully retired.

**Phase Summary (WBS 17).** Critical WPs: 17.1.1, 17.1.2, 17.1.3, 17.1.4. Parallel: alerting alongside cutover. Blocking: rehearse rollback before go-live. **Milestone: M17 — Production Ready.**

---

### WBS 18 — Phase 16 · Reserved Future Platforms

> **All WPs here are `Future` / Importance `Future`, off the critical path, and additive** — each sits
> on a seam reserved earlier (§14 maps them). Each becomes its own full phase (with its own WBS) when
> scheduled. Effort/risk are **deferred** until then.

**Capability Group 18.1 — Extensibility & Operations**

> **[WBS 18.1.1] Plugin Architecture** — *Future* · Owner: Runtime
> - **Purpose/Scope/Responsibilities:** Full plugin execution (AI enhance, OCR, video, vendor dispatch, translation, face detection) on the reserved seam (Rec 6).
> - **Inputs → Outputs:** Plugin registration → additive processing stages.
> - **Dependencies (seam):** 4.3.1, 4.1.2, 4.2.1.
> - **Invariants:** INV-4, INV-7 (plugins must comply).
> - **ADS · Phase · Repo:** Plugins · Phase 16 · reserved.
> - **Interfaces:** Public: plugin API (future) | Internal: sandbox.
> - **Deliverables (future):** Plugin runtime + sample plugins.
> - **Future Task Areas:** per-plugin capability, sandboxing, config.
> - **Class:** Deferred · Deferred · Future · Deferred · Fully-parallel · Critical-path: No.
> - **Done when (seam):** Additivity verified; no core contract change required.

> **[WBS 18.1.2] Replay Platform** — *Future* · Owner: Platform
> - **Purpose/Scope/Responsibilities:** Full Retry/Replay/Rebuild/Regenerate UX + tooling on the Phase 9 semantics (Rec 18).
> - **Dependencies (seam):** 11.2.4, 12.2.2.
> - **Invariants:** INV-7, INV-11.
> - **ADS · Phase · Repo:** Replay · Phase 16 · reserved.
> - **Interfaces:** Public: replay tooling (future) | Internal: —.
> - **Deliverables (future):** Replay platform.
> - **Future Task Areas:** replay UI, audit, bulk replay.
> - **Class:** Deferred · Deferred · Future · Deferred · Parallelizable · Critical-path: No.
> - **Done when (seam):** Builds additively on replay semantics.

> **[WBS 18.1.3] Run Explorer** — *Future* · Owner: Developer Experience
> - **Purpose/Scope/Responsibilities:** Visualize processing dependency graphs/timelines (Rec 17) over the run-graph data model.
> - **Dependencies (seam):** 12.2.3, 11.2.1.
> - **Invariants:** —.
> - **ADS · Phase · Repo:** Run-explorer · Phase 16 · reserved.
> - **Interfaces:** Public: explorer UI (future) | Internal: —.
> - **Deliverables (future):** Run Explorer UI.
> - **Future Task Areas:** graph viz, filters, drill-down.
> - **Class:** Deferred · Deferred · Future · Deferred · Fully-parallel · Critical-path: No.
> - **Done when (seam):** Consumes run-graph data without core change.

> **[WBS 18.1.4] Developer Tooling / Generators** — *Future* · Owner: Developer Experience
> - **Purpose/Scope/Responsibilities:** Pipeline generator, plugin generator, scaffolding (Rec 21) on the DX seam.
> - **Dependencies (seam):** 2.3.2, 11.1.1, 4.3.1.
> - **Invariants:** —.
> - **ADS · Phase · Repo:** DX · Phase 16 · reserved.
> - **Interfaces:** Public: generator CLIs (future) | Internal: —.
> - **Deliverables (future):** Generators + scaffolding.
> - **Future Task Areas:** templates, codegen, docs generation.
> - **Class:** Deferred · Deferred · Future · Deferred · Fully-parallel · Critical-path: No.
> - **Done when (seam):** Generators emit compliant scaffolding.

**Capability Group 18.2 — Product & Business Extensions**

> **[WBS 18.2.1] Album Quality Scoring** — *Future* · Owner: Image Engine
> - **Purpose/Scope/Responsibilities:** Score album quality from processing/blueprint signals (Rec 22).
> - **Dependencies (seam):** 7.2.3, 8.x signals.
> - **Invariants:** —.
> - **ADS · Phase · Repo:** Quality · Phase 16 · reserved.
> - **Interfaces:** Public: scoring API (future) | Internal: —.
> - **Deliverables (future):** Quality scoring engine.
> - **Future Task Areas:** signal collection, scoring model, thresholds.
> - **Class:** Deferred · Deferred · Future · Deferred · Parallelizable · Critical-path: No.
> - **Done when (seam):** Consumes emitted signals without core change.

> **[WBS 18.2.2] Mobile Platform APIs** — *Future* · Owner: Platform
> - **Purpose/Scope/Responsibilities:** Mobile-facing contracts (Rec 24) reusing manifest/lifecycle contracts.
> - **Dependencies (seam):** 3.1.3, 9.1.1.
> - **Invariants:** INV-1, INV-8.
> - **ADS · Phase · Repo:** Mobile · Phase 16 · reserved.
> - **Interfaces:** Public: mobile API (future) | Internal: —.
> - **Deliverables (future):** Mobile API layer.
> - **Future Task Areas:** auth, sync, thin contracts.
> - **Class:** Deferred · Deferred · Future · Deferred · Parallelizable · Critical-path: No.
> - **Done when (seam):** Reuses existing contracts additively.

> **[WBS 18.2.3] Business Analytics** — *Future* · Owner: Observability
> - **Purpose/Scope/Responsibilities:** Dashboards for albums/day, pages/day, vendor throughput, processing cost, avg time, revenue/album (Rec 25).
> - **Dependencies (seam):** 12.2.1, 12.2.4, 3.2.1.
> - **Invariants:** INV-12.
> - **ADS · Phase · Repo:** Analytics · Phase 16 · reserved.
> - **Interfaces:** Public: analytics dashboards (future) | Internal: —.
> - **Deliverables (future):** Business analytics.
> - **Future Task Areas:** aggregation, dashboards, revenue linkage.
> - **Class:** Deferred · Deferred · Future · Deferred · Fully-parallel · Critical-path: No.
> - **Done when (seam):** Consumes technical metrics/events without core change.

**Phase Summary (WBS 18).** Critical WPs: none (off critical path). Parallel: all. Blocking: none block core; each needs its reserved seam. **Milestone: M18 — Extension Roadmap Ratified.**

---

## 6. Global WBS Dependency Graph

```
WBS 1 (Reset)
  └─► WBS 2 (Foundation) ──────────────────────────────────► [contracts/DI/ADR to all]
        └─► WBS 3 (Control Plane) ──────────► [state/events/audit/versions to all]
              ├─► WBS 4 (Runtime) ──────────► [runtime/DI/handlers to all workers]
              │     ├─► WBS 5 (Storage) ─────► [artifacts to Image + Render + Manufacturing]
              │     │     └─► WBS 7 (Image) ──┐
              │     └─► WBS 6 (Product) ──────┤ (profiles → Image/Render; product → Blueprint)
              │                               ▼
              │                         WBS 8 (Blueprint) ─► WBS 9 (Manifest) ─► WBS 10 (Render)
              │                                                                     │
              │                                                                     ▼
              └───────────────────────────────────────────────► WBS 11 (Pipeline/Coordinator)
                                                                      │
                        ┌──────────────────────┬──────────────────────┤
                        ▼                       ▼                      ▼
                 WBS 12 (Observability)   WBS 13 (Security)   WBS 14 (Performance)
                        └──────────────────────┴──────────────────────┘
                                                │
                                                ▼
                                     WBS 15 (Manufacturing)
                                                │
                                                ▼
                                     WBS 16 (Integration/E2E)
                                                │
                                                ▼
                                     WBS 17 (Production Cutover)
                                                │
                                                ▼
                                WBS 18 (Reserved Future — additive, off-path)
```

---

## 7. Critical Path

The critical-path Work Packages (serial, gate the render-to-manufacture spine):

```
1.1.1 → 1.1.2 → 2.1.1 → 2.2.1 → 2.2.2 → 3.1.1 → 3.1.2 → 3.1.3 → (3.1.4, 3.2.3)
   → 4.1.1 → 4.1.2 → 4.2.1 → 4.2.2 → 4.2.3
   → 5.1.1 → 5.1.2 → 5.2.1
   → 6.1.1 → 6.2.1
   → 7.1.1 → 7.2.1 → 7.2.2
   → 8.1.1 → 8.2.1 → 8.2.2 → 8.2.3 → 8.1.2
   → 9.1.1 → 9.1.2 → 9.1.3
   → 10.1.1 → 10.1.2 → 10.1.3 → 10.2.1
   → 11.1.1 → 11.1.2 → 11.2.1 → 11.2.2 → 11.2.3
   → 16.1.1 → 16.1.2 → 16.1.4
   → 17.1.1 → 17.1.2 → 17.1.4
```

Highest-risk critical WPs: **3.1.2** (Lifecycle Engine), **4.2.2** (Idempotent Handler), **7.2.1**
(Canonicalizer), **8.1.2** (Blueprint Compiler), **9.1.1** (Manifest Schema), **10.1.1/10.1.2**
(Manifest Interpreter / Paint), **11.2.2** (Coordinator). These deserve the deepest review + testing.

---

## 8. Parallel Execution Opportunities

| Parallel set | Notes |
|---|---|
| **5.x (Storage) ∥ 6.x (Product)** | Independent once Control Plane exists. |
| **4.1.3 (Config), 4.3.1 (Plugin seam), 4.3.2 (Hooks)** ∥ core runtime | Non-blocking runtime extras. |
| **8.2.1 / 8.2.2 / 8.2.3 resolvers** | Developable against fixtures in parallel before the compiler wires them. |
| **9.1.3 (Validator) ∥ 9.1.2 (Builder)** | Both target the frozen schema. |
| **10.2.1 (Reproducibility) ∥ 10.1.3 (Writer)** | Harness authored alongside the writer. |
| **11.2.4 (Replay) ∥ coordinator core** | Optional, non-blocking. |
| **WBS 12 / 13 / 14** (Observability ∥ Security ∥ Performance) | Independent hardening axes after WBS 11. |
| **WBS 15 capability groups** | Validation + mock parallel to abstraction/lifecycle. |
| **All of WBS 18** | Fully parallel, off critical path, scheduled independently. |
| **Documentation & runbooks** | Authored alongside the WP they describe. |

Strictly serial (never parallelize): the **8.1.2 → 9.1.x → 10.1.x → 11.2.2** spine (compiler →
manifest → render → coordinator) — the manifest contract must freeze before its consumers.

---

## 9. Cross-Cutting Work Packages

Owned once, consumed everywhere (never re-specified per phase):

| Concern | Home WP | Consumed by |
|---|---|---|
| Configuration | 4.1.3 | All subsystems |
| Versioning / Version freeze | 3.2.3 (+ 12.2.2 recording) | All producing subsystems |
| Audit | 3.2.2 | All transitions |
| Logging | 12.1.1 | All |
| Metrics | 12.1.2 | All |
| Tracing / Correlation | 12.1.3 | All runs |
| Error Handling (contract) | 4.2.2 (handler semantics) | All handlers |
| Validation | 7.1.1 / 9.1.3 (capability reused) | Image + Manifest boundaries |
| Security | 13.1.1–13.1.3 | All boundaries |
| Testing progression | per-phase + 16.1.x | All |
| Documentation | per-phase (Guide §14) | All |
| Performance budgets | 14.1.1 | All subsystems (declared per phase) |

---

## 10. Infrastructure Work Packages

`2.1.1` Repository/Build · `2.1.2` CI/CD · `2.3.1` ADR System · `4.1.3` Configuration ·
`5.1.1` Storage Provider · `5.1.2` Content Addressing · `13.1.1–13.1.3` Security ·
`14.1.3` Scale-Seam Validation · `17.1.1` Cutover · `17.1.2` Rollback · `17.1.3` Alerting ·
`17.1.4` V1 Retirement.

---

## 11. Runtime Work Packages

`4.1.1` Runtime Bootstrap · `4.1.2` DI Container · `4.2.1` Capability Registry ·
`4.2.2` Idempotent Handler · `4.2.3` Queue Consumer · `4.3.1` Plugin Seam · `4.3.2` Cost/Perf Hooks.
*(Reusable runtime capabilities: DI Container, Capability Registry, Plugin Registry seam.)*

---

## 12. Platform Work Packages

**Control Plane:** `3.1.1`–`3.1.4`, `3.2.1`–`3.2.3`, `11.2.2`–`11.2.3`.
**Product Platform:** `6.1.1`–`6.1.2`, `6.2.1`–`6.2.3`.
**Image Engine:** `7.1.1`, `7.2.1`–`7.2.3`.
**Blueprint Platform:** `8.1.1`–`8.1.2`, `8.2.1`–`8.2.4`.
**Manifest/Platform:** `9.1.1`–`9.1.3`, `11.1.1`–`11.1.2`, `11.2.1`, `11.2.4`.
**PDF/Render:** `10.1.1`–`10.1.3`, `10.2.1`.
**Storage/Artifacts:** `5.1.1`–`5.1.2`, `5.2.1`–`5.2.2`.
**Observability:** `12.1.1`–`12.1.3`, `12.2.1`–`12.2.4`.

---

## 13. Manufacturing Work Packages

`15.1.1` Vendor Provider Abstraction · `15.1.2` Manufacturing Lifecycle (Tail) ·
`15.2.1` Vendor Validation Profiles · `15.2.2` Mock Vendor & Dispatch Seam.
*(Feeds from Product Platform `6.2.3` Vendor Profiles data; reuses Artifact store `5.2.1`.)*

---

## 14. Future Reserved Work Packages

| WP | Capability | Reserved Seam (built earlier) |
|---|---|---|
| 18.1.1 | Plugin Architecture | 4.3.1 Plugin Seam · 4.1.2 DI · 4.2.1 Registry |
| 18.1.2 | Replay Platform | 11.2.4 Replay Semantics · 12.2.2 Version Matrix |
| 18.1.3 | Run Explorer | 12.2.3 Run-Graph Data · 11.2.1 Graph Engine |
| 18.1.4 | Developer Tooling / Generators | 2.3.2 DX Hooks · 11.1.1 Pipeline Schema |
| 18.2.1 | Album Quality Scoring | 7.2.3 Asset signals · 8.x Blueprint signals |
| 18.2.2 | Mobile Platform APIs | 3.1.3 Lifecycles · 9.1.1 Manifest Schema |
| 18.2.3 | Business Analytics | 12.2.1 Cost · 12.2.4 Business Metrics · 3.2.1 Domain Events |

Every future WP maps to a **pre-built seam** — guaranteeing additive expansion with **no core
redesign**.

---

## 15. Architectural Review Checklist

Applied to every Work Package at review:

- [ ] Owns **exactly one** capability; no unrelated responsibilities mixed in.
- [ ] Maps to **exactly one** primary phase.
- [ ] Declares and upholds all applicable **Invariants** (INV-1…12).
- [ ] Inputs/Outputs and Public/Internal interfaces are clearly bounded (dependency inversion).
- [ ] Dependencies are real, acyclic, and point only upstream.
- [ ] Cross-cutting concerns are **consumed**, not re-implemented (§9).
- [ ] Future extensions are **additive** on a reserved seam, not entangled in the core path.
- [ ] Version(s) it owns are frozen/registered where applicable (INV-11).
- [ ] Classification (effort/risk/importance/testing/ownership/parallel/critical-path) is set.
- [ ] Completion criteria are objective and testable.
- [ ] Any conflict with the ADS triggers **Stop-and-ADR**, not a silent WBS edit.

---

## 16. WBS Consistency Checklist

- [x] **Every phase decomposed** — WBS 1–18 cover Phases −1…16.
- [x] **No orphaned capability** — every capability named in the Phase Plan + recommendations has a home WP (§9–§14 index them).
- [x] **No mixed responsibilities** — each WP owns one capability (DI, Config, Registry, etc. are distinct).
- [x] **One primary phase per WP** — WBS IDs are phase-scoped; consumers/seams annotated, never re-owned.
- [x] **Cross-cutting stays cross-cutting** — §9 lists single-home cross-cutting WPs consumed elsewhere.
- [x] **Future work isolated** — all Future WPs live in WBS 18 on reserved seams, off the critical path.
- [x] **Reusable WPs identified** — Lifecycle Engine, Version Registry, Audit, DI, Registry, Storage, Config, Logging, Metrics, Validation.
- [x] **Dependencies acyclic** — the global graph (§6) and critical path (§7) are a DAG.
- [x] **Each phase yields a milestone** — Phase Summaries state M1…M18.
- [x] **Naturally expands to a backlog** — each WP lists Future Task Areas / Deliverables that become tasks.

---

## 17. Recommendations Before Task Generation

1. **Freeze the contract WPs first.** `2.2.1`, `9.1.1`, `11.1.1`, and the lifecycle/event contracts (`3.1.3`, `3.2.1`) are the highest-blast-radius WPs — stabilize them (ADR-gated) before generating downstream tasks.
2. **Generate tasks phase-by-phase, not all at once.** Expand a phase's WPs into tasks only when the previous phase is Done — so tasks reflect reality, not speculation.
3. **Keep one capability per task lineage.** A task must trace to exactly one WP; if a task needs two WPs, it is two tasks.
4. **Carry the classification down.** Each task inherits its WP's invariants, ownership, testing intensity, and critical-path flag — these drive review depth.
5. **Never generate tasks for Future WPs (WBS 18) during core delivery.** They are scheduled as their own phases later; premature tasks invite entanglement.
6. **Attach acceptance to invariants.** Every task's acceptance criteria must include the WP's applicable invariants, so compliance is checked at the task level.
7. **Reserve seams explicitly in early tasks.** When implementing `4.3.1`, `11.2.4`, `12.2.3`, `2.3.2`, ensure the seam compiles unused — do not let "reserved" quietly become "forgotten."

---

## 18. Self-Review

A closing audit against the task's completion criteria:

1. **Every phase decomposed.** All 18 phases (WBS 1–18) are broken into Capability Groups → Work Packages → Future Task Areas, with a Phase Summary + milestone each. ✔
2. **No capability orphaned.** Every capability from the Phase Plan and the 20 recommendations has a named WP; the cross-cutting/infrastructure/runtime/platform/manufacturing/future indexes (§9–§14) confirm full coverage. ✔
3. **No Work Package owns unrelated responsibilities.** DI (`4.1.2`), Configuration (`4.1.3`), Capability Registry (`4.2.1`), Handler contract (`4.2.2`), and Queue (`4.2.3`) are deliberately separate; the same discipline holds across phases. ✔
4. **Exactly one primary phase per WP.** WBS IDs are phase-scoped; every consumer/seam relationship is annotated as such, never as ownership (see §12–§14). ✔
5. **Cross-cutting concerns remain cross-cutting.** §9 gives each a single home WP consumed platform-wide, never duplicated per phase. ✔
6. **Future work isolated.** All Future WPs are consolidated in WBS 18, each on a seam reserved by an earlier WP (§14), all off the critical path (§7). ✔
7. **Expands naturally into a backlog.** Each WP carries Future Task Areas / Deliverables and a classification that seed and shape its eventual tasks; §17 gives the expansion procedure. ✔
8. **Invariant-safe + DAG-consistent.** The dependency graph (§6) and critical path (§7) are acyclic; every WP declares its invariants; conflicts route to Stop-and-ADR. ✔

> **Conclusion.** The WBS completely decomposes Worker V2 into single-capability, independently
> reviewable Work Packages, preserves the architecture and its invariants, isolates future work on
> reserved seams, and is ready to expand — phase by phase — into an implementation backlog.

---

*End of Worker V2 Work Breakdown Structure. Planning only — no implementation. The task backlog
(`WORKER_V2_TASKS.md`), progress, and any implementation are intentionally NOT created here.*
