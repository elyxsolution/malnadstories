# Worker V2 — Master Implementation Guide

> **Document type:** Enterprise Engineering Execution Plan
> **Status:** Authoritative — implementation bible for Worker V2
> **Audience:** Every engineer, reviewer, and program manager contributing to Worker V2
> **Relationship to the ADS:** Derived from, and strictly subordinate to, the Worker V2 Architecture Design Specification (ADS)
> **Owner:** Principal Software Architect / Technical Program Manager, Worker V2
> **Applies to:** All phases from Worker Reset (Phase −1) through Production Cutover

---

## Table of Contents

1. [Project Overview](#1-project-overview)
   - [1.1 Purpose](#11-purpose)
   - [1.2 Vision](#12-vision)
   - [1.3 Scope](#13-scope)
   - [1.4 Goals](#14-goals)
   - [1.5 Non-Goals](#15-non-goals)
   - [1.6 Success Criteria](#16-success-criteria)
2. [Architecture Alignment](#2-architecture-alignment)
   - [2.1 The ADS Is the Architectural Source of Truth](#21-the-ads-is-the-architectural-source-of-truth)
   - [2.2 Relationship Between This Guide and the ADS](#22-relationship-between-this-guide-and-the-ads)
   - [2.3 The Non-Violation Principle](#23-the-non-violation-principle)
   - [2.4 Precedence and Conflict Resolution](#24-precedence-and-conflict-resolution)
3. [Guiding Principles](#3-guiding-principles)
   - [3.1 Architecture Before Implementation](#31-architecture-before-implementation)
   - [3.2 Deterministic Systems](#32-deterministic-systems)
   - [3.3 Immutable Artifacts](#33-immutable-artifacts)
   - [3.4 Idempotent Processing](#34-idempotent-processing)
   - [3.5 Manifest-First Rendering](#35-manifest-first-rendering)
   - [3.6 Dependency Inversion](#36-dependency-inversion)
   - [3.7 Small Iterative Implementation](#37-small-iterative-implementation)
   - [3.8 Testing First](#38-testing-first)
   - [3.9 Observability First](#39-observability-first)
   - [3.10 No Shortcuts](#310-no-shortcuts)
   - [3.11 Production-Grade Quality](#311-production-grade-quality)
4. [Implementation Philosophy](#4-implementation-philosophy)
   - [4.1 Why We Are Rebuilding From Scratch](#41-why-we-are-rebuilding-from-scratch)
   - [4.2 Why Worker V1 Will Be Deleted](#42-why-worker-v1-will-be-deleted)
   - [4.3 Why Every Subsystem Must Be Completed Before Moving On](#43-why-every-subsystem-must-be-completed-before-moving-on)
   - [4.4 Why Each Phase Ends With Testing](#44-why-each-phase-ends-with-testing)
   - [4.5 Why No Partial Architecture Is Acceptable](#45-why-no-partial-architecture-is-acceptable)
5. [Repository Strategy](#5-repository-strategy)
   - [5.1 Philosophy](#51-philosophy)
   - [5.2 Logical Domains](#52-logical-domains)
   - [5.3 Packages, Apps, and Shared Contracts](#53-packages-apps-and-shared-contracts)
   - [5.4 Documentation, Testing, Scripts, and Ops](#54-documentation-testing-scripts-and-ops)
6. [Execution Rules](#6-execution-rules)
7. [Phase Roadmap Overview](#7-phase-roadmap-overview)
8. [Dependency Graph](#8-dependency-graph)
9. [Milestones](#9-milestones)
10. [Definition of Done](#10-definition-of-done)
11. [Quality Gates](#11-quality-gates)
12. [Review Process](#12-review-process)
13. [Git Strategy](#13-git-strategy)
14. [Documentation Strategy](#14-documentation-strategy)
15. [Living Documents](#15-living-documents)
16. [Implementation Workflow](#16-implementation-workflow)
17. [Risk Management](#17-risk-management)
18. [Architecture Compliance](#18-architecture-compliance)
19. [Final Recommendations](#19-final-recommendations)
- [Appendix A — Execution Reference Tables](#appendix-a--execution-reference-tables)
  - [A.1 Overall Implementation Timeline](#a1-overall-implementation-timeline)
  - [A.2 Estimated Complexity per Phase](#a2-estimated-complexity-per-phase)
  - [A.3 Estimated Risk per Phase](#a3-estimated-risk-per-phase)
  - [A.4 Recommended Review Frequency](#a4-recommended-review-frequency)
  - [A.5 Recommended Commit Frequency](#a5-recommended-commit-frequency)
  - [A.6 Recommended Testing Frequency](#a6-recommended-testing-frequency)

---

## 1. Project Overview

### 1.1 Purpose

Worker V2 is a ground-up rebuild of the Malnad Stories background processing platform — the
system responsible for turning customer-uploaded photographs and album layouts into safe,
immutable, print-quality artifacts. The current worker (V1) grew organically as two loosely
coupled job handlers (image hardening and Puppeteer-driven preview-PDF rendering) bolted onto a
shared pg-boss queue. It has served the MVP well, but it was never designed as a platform: its
rendering path re-drives the customer-facing web application, its artifacts are not
content-addressed or immutable, its processing is not provably idempotent, and its
observability is incidental rather than designed.

The purpose of this guide is to convert the Worker V2 **Architecture Design Specification (ADS)**
— the 26-section architectural source of truth, including its ADRs, phase definitions, and
subsystem designs — into a disciplined, sequenced, enterprise-grade **implementation roadmap**.
This document does not design the system; the ADS already did. This document governs *how the
system gets built*: the order of work, the standards each unit of work must meet, the gates it
must pass, and the evidence it must produce before the next unit of work begins.

### 1.2 Vision

Worker V2 will be a **deterministic, manifest-driven artifact factory**. Given the same inputs,
it will always produce byte-identical outputs. Every artifact it emits will be immutable and
addressable. Every job it processes will be idempotent and safely retryable. Rendering will be
driven exclusively by a validated, self-contained **manifest** — never by re-executing the
application UI — so that correctness can be reasoned about, tested, and reproduced in isolation.

The platform will be built to be operated: observable by default, secure by default, and
recoverable by default. When Worker V2 is complete, the engineering organization should be able
to answer, for any artifact, three questions with certainty: *What produced this? Can we
reproduce it exactly? Was it processed safely?*

### 1.3 Scope

**In scope for Worker V2:**

- The complete background worker runtime, job lifecycle, and processing coordinator.
- The image ingestion, validation, sanitization, and derivative-generation pipeline.
- The manifest system: manifest schema, manifest construction, and the manifest-first rendering contract.
- The deterministic render engine that consumes manifests to produce print/preview artifacts.
- The immutable artifact and storage abstraction layer.
- Observability (logging, metrics, tracing), operability (health, runbooks), and security hardening for all of the above.
- The controlled retirement of Worker V1 and cutover to Worker V2.

**Boundary with the main application:** Worker V2 is a backend platform. The customer-facing
Next.js application and its data-access boundaries (RLS, service-role writes, Drizzle admin
access) remain governed by the existing project rules in `CLAUDE.md`. Worker V2 interacts with
those boundaries through defined contracts only; it does not redesign them.

### 1.4 Goals

1. **Determinism** — identical inputs yield identical, reproducible artifacts.
2. **Immutability** — artifacts, once produced, are never mutated in place.
3. **Idempotency** — every job can be retried any number of times without side-effect drift.
4. **Manifest-first rendering** — rendering depends only on a validated manifest, never on live UI state.
5. **Operability** — the platform is observable, alertable, and recoverable from day one.
6. **Testability** — every subsystem is independently testable, with the render path reproducible offline.
7. **Clean architecture** — dependency inversion and clear seams so components can evolve independently.
8. **Zero-regression cutover** — Worker V2 replaces V1 with no loss of correctness for existing flows.

### 1.5 Non-Goals

- **No new product features.** Worker V2 is an architectural rebuild of existing responsibilities, not a feature expansion.
- **No changes to the application's security model, RLS policies, or data-access rules** beyond the contracts Worker V2 must consume.
- **No pre-press color science / ICC / bleed-DPI finalization** unless the ADS explicitly scopes it into a Worker V2 phase; otherwise it remains a downstream concern.
- **No premature horizontal-scale infrastructure** beyond what the ADS specifies; scale seams are designed, not prematurely built.
- **No partial or "good enough for now" subsystems.** Anything started within a phase is finished within that phase.

### 1.6 Success Criteria

Worker V2 is considered successful when **all** of the following hold:

- The full artifact pipeline (ingest → sanitize → manifest → render → immutable artifact) runs end to end in production for real orders.
- Rendering is provably reproducible: re-running a job from its manifest produces a byte-identical artifact.
- Every job is idempotent under retry, duplication, and crash-recovery, verified by tests.
- Worker V1 is fully deleted from the codebase, with no dead code or dual-path ambiguity.
- Every subsystem meets the project-wide Definition of Done (§10) and has passed all Quality Gates (§11).
- Observability is live: logs, metrics, and traces are correlated by request/job identifiers, and alerts fire on defined failure conditions.
- The cutover runbook has been executed, and rollback has been demonstrated to be possible.

---

## 2. Architecture Alignment

### 2.1 The ADS Is the Architectural Source of Truth

The **Worker V2 Architecture Design Specification (ADS)** — comprising all 26 sections, its
Architecture Decision Records (ADRs), its phase definitions, and its subsystem designs
(worker architecture, coordinator, render engine, image processing, pipelines, manifest system,
storage/artifacts, observability, security, testing strategy, and risk analysis) — is the single
authoritative description of *what* Worker V2 is and *why* it is shaped that way.

This Implementation Guide is authoritative on *how and in what order* the ADS is realized. It has
no authority to change the architecture. Where this guide appears to describe structure, it is
restating the ADS for execution purposes, not redefining it.

### 2.2 Relationship Between This Guide and the ADS

| Question | Authoritative Source |
|---|---|
| *What* are the components and how do they relate? | ADS |
| *Why* was a design decision made? | ADS + its ADRs |
| *In what order* is the system built? | This guide (§7, §8) |
| *What standard* must each unit of work meet? | This guide (§10, §11) |
| *How* is each phase reviewed, gated, and committed? | This guide (§12, §13, §16) |
| *When* does the architecture change? | Only via a new ADR (see §2.3, §18) |

### 2.3 The Non-Violation Principle

Implementation must **never** violate the architectural principles, boundaries, or decisions
defined in the ADS. If, during implementation, an engineer discovers that the architecture is
impractical, incomplete, or contradicted by reality, the correct response is **not** to deviate
silently. The correct response is to **stop**, raise the issue, and author a new **ADR** that
records the problem, the options, and the decision. Only once that ADR is accepted does the ADS
(and therefore the allowed implementation) change. Code is never the place where architecture is
quietly rewritten.

### 2.4 Precedence and Conflict Resolution

When two sources appear to conflict, precedence is resolved in this fixed order:

1. **The ADS and its accepted ADRs** — highest authority on architecture.
2. **This Implementation Guide** — authority on execution process.
3. **Project rules in `CLAUDE.md`** — authority on the surrounding application's conventions and security boundaries.
4. **Living phase documents** (progress, changelog, runbooks) — record of what has actually happened.

A conflict between (1) and any lower source is always resolved in favor of (1), or escalated into
a new ADR if (1) itself is found wanting.

---

## 3. Guiding Principles

These principles are the non-negotiable engineering values of Worker V2. They are restated from
the spirit of the ADS and are binding on every phase.

### 3.1 Architecture Before Implementation

No code is written before its governing architecture is understood and its phase is planned. If
the design is unclear, the resolution is design work and an ADR — never speculative code.

### 3.2 Deterministic Systems

The platform is designed so that identical inputs always produce identical outputs. Sources of
non-determinism (wall-clock time, random ordering, ambient environment, network variability) are
isolated, injected, or eliminated. Determinism is a testable property, not an aspiration.

### 3.3 Immutable Artifacts

Every artifact the platform produces is written once and never modified in place. Corrections
produce **new** artifacts with new identities; they never overwrite history. This makes the
system auditable and reproducible.

### 3.4 Idempotent Processing

Every job can be executed more than once — because of retries, duplicate delivery, or crash
recovery — without producing divergent or corrupt results. Idempotency is designed into the job
contract, not patched in after a bug.

### 3.5 Manifest-First Rendering

Rendering consumes a **validated, self-contained manifest** as its only source of truth. The
render engine never reaches back into live application state, UI, or session context. The
manifest fully describes the artifact to be produced, which is what makes rendering deterministic,
testable in isolation, and reproducible.

### 3.6 Dependency Inversion

High-level policy does not depend on low-level detail; both depend on abstractions. Storage,
queueing, rendering backends, and external providers sit behind interfaces. This keeps subsystems
independently testable and replaceable, and prevents the render/coordination logic from being
welded to any single vendor or runtime.

### 3.7 Small Iterative Implementation

Work proceeds in small, reviewable, individually-correct increments — but always within a
completed subsystem boundary (see §4.3). Small does not mean partial; it means each step is
finished, tested, and correct on its own.

### 3.8 Testing First

Tests express intended behavior before or alongside the code that satisfies them. A subsystem is
not "done" and then tested; it is built to a testable contract, and its tests are part of the
deliverable. No phase closes with failing or skipped tests.

### 3.9 Observability First

Logging, metrics, and tracing are designed into each subsystem as it is built, not retrofitted.
Every job and request is correlatable end to end. If a subsystem cannot be observed in production,
it is not finished.

### 3.10 No Shortcuts

No TODO placeholders in merged code. No temporary hacks. No commented-out dead code. No "we'll fix
it later." Later does not come; the shortcut becomes the architecture. Shortcuts are rejected at
review.

### 3.11 Production-Grade Quality

Everything built is built as if it is going to production tomorrow, because the intent is that it
will. There is no "prototype tier" of code in Worker V2. The standard is uniform and high across
every phase.

---

## 4. Implementation Philosophy

### 4.1 Why We Are Rebuilding From Scratch

Worker V1 is an MVP-era design. Its rendering path re-drives the live customer application through
a headless browser; its artifacts are neither content-addressed nor immutable; its idempotency is
best-effort rather than guaranteed; and its observability is incidental. These are not defects to
be patched — they are structural properties that conflict with the determinism, immutability,
idempotency, and manifest-first goals the ADS establishes. Attempting to incrementally reshape V1
into V2 would mean carrying its assumptions forward and constantly fighting them. A clean rebuild,
governed by the ADS, is faster to correctness and far cheaper to reason about than an in-place
retrofit of an architecture that was never intended to support these properties.

### 4.2 Why Worker V1 Will Be Deleted

Two workers cannot coexist as the "real" one. If V1 remains in the tree "just in case," it becomes
a silent fallback, a source of divergent behavior, a maintenance tax, and a place where the old
assumptions leak back in. Worker V2 is a replacement, not an addition. V1 is therefore removed
deliberately and completely in **Phase −1 (Worker Reset)**, before V2 construction begins, so that
there is exactly one processing platform and no ambiguity about which path is authoritative.
Deletion is a design decision, executed under version control so the history is preserved and
recoverable, but the working tree carries only V2.

### 4.3 Why Every Subsystem Must Be Completed Before Moving On

Worker V2 is a pipeline of tightly-reasoned subsystems (storage/artifacts, image processing,
manifest, render engine, coordinator). A half-built subsystem is worse than an unstarted one: it
invites downstream work to build on assumptions that are not yet guaranteed, and it hides its
incompleteness behind an interface that looks finished. The rule is therefore absolute — a
subsystem is finished (built, tested, observable, documented, reviewed) before any subsystem that
depends on it begins. This prevents the accumulation of "80% done" components whose remaining 20%
is where all the real risk lives.

### 4.4 Why Each Phase Ends With Testing

A phase that ends without passing tests has not proven anything; it has only produced code. The
end-of-phase test gate is how a phase converts *"we wrote it"* into *"we know it works and stays
working."* Because later phases build directly on earlier ones, an untested earlier phase would
propagate uncertainty forward and make every later failure ambiguous (is the bug here, or
inherited?). Ending every phase with a green, meaningful test suite keeps the foundation trusted
at all times.

### 4.5 Why No Partial Architecture Is Acceptable

The properties Worker V2 promises — determinism, immutability, idempotency, manifest-first
rendering — are **whole-system** properties. They are not additive features you can ship half of.
A pipeline that is deterministic in four stages and non-deterministic in the fifth is simply
non-deterministic. Partial architecture therefore does not deliver partial value; it delivers no
value on the property that matters, while costing full effort. Worker V2 is built to be complete
per-subsystem and complete per-property, or it is not built at all.

---

## 5. Repository Strategy

> This section defines **philosophy only**. Exact folder names, package boundaries, and file
> layouts are deferred to the phase (Foundation) that establishes them, in conformance with the
> ADS. The purpose here is to fix the *principles* that layout must satisfy.

### 5.1 Philosophy

The repository must make the architecture legible. Someone opening the tree should be able to see
the subsystem boundaries the ADS defines without reading a single line of implementation. Physical
structure follows logical architecture: each subsystem has a clear home, shared contracts have a
neutral home that no subsystem "owns," and cross-cutting concerns (observability, security,
configuration) are consistent everywhere rather than reinvented per subsystem.

### 5.2 Logical Domains

At the philosophical level, the tree will separate:

- **Executable services** (the things that run) from **libraries** (the things they are built from).
- **Shared contracts** (schemas, types, interfaces — the manifest contract above all) from the **implementations** that satisfy them, so that dependency inversion is expressed physically.
- **Product/application code** (the existing Next.js app, governed by `CLAUDE.md`) from **Worker V2 platform code**, with a small, explicit set of contracts crossing that boundary.
- **Operational assets** (scripts, runbooks, ops tooling) from **product logic**.

### 5.3 Packages, Apps, and Shared Contracts

- **Apps** are deployable units with an entry point and a lifecycle.
- **Packages** are versioned, independently testable libraries consumed by apps and by each other, always through their public interface.
- **Shared contracts** — the manifest schema and the interface definitions between subsystems — are the highest-leverage code in the repository. They are treated as a first-class, carefully-reviewed asset, because everything downstream depends on their stability. Contract changes are ADR-worthy events, not casual edits.

### 5.4 Documentation, Testing, Scripts, and Ops

- **Documentation** lives beside the architecture it describes and is updated in the same phase as the code (see §14).
- **Testing** is organized so that each subsystem's tests are discoverable next to (or clearly mapped to) that subsystem, and so that the reproducible, offline render tests are first-class citizens.
- **Scripts** encode repeatable operations (setup, migration application, artifact reproduction checks) so that no critical operation lives only in someone's shell history.
- **Ops** assets (runbooks, health/alerting configuration, cutover and rollback procedures) are versioned with the code, so the way the system is operated evolves in lockstep with the system.

---

## 6. Execution Rules

These rules are binding on every contributor and every phase. Violations block a phase from
closing.

1. **Never skip a phase.** Phases exist because of dependencies (§8). Skipping one builds on unguaranteed foundations.
2. **Never merge incomplete work.** A subsystem is whole or it is not merged (§4.3).
3. **Every phase must pass tests.** No phase closes with failing, skipped, or `xfail` tests standing in for real coverage.
4. **Every phase updates documentation.** Code and its docs move together; stale docs are a defect (§14).
5. **Every phase ends with review.** No phase self-certifies (§12).
6. **Every phase must compile / build cleanly.** No warnings-as-noise culture; the build is green and honest.
7. **No TODO placeholders in merged code.** Unfinished intent is tracked in the progress document, not smuggled into source.
8. **No temporary hacks.** If it is not the intended design, it does not merge. If the intended design is unclear, that is an ADR, not a hack.
9. **No dead code.** Unused code, dual paths, and "just in case" scaffolding are removed. The tree reflects the live architecture only.
10. **No silent architecture drift.** Any deviation from the ADS stops work and triggers an ADR (§2.3, §18).
11. **No un-observable subsystem ships.** If it cannot be logged, measured, and traced, it is not done (§3.9).
12. **No non-deterministic render path merges.** Determinism regressions are treated as build-breaking defects (§3.2, §3.5).

---

## 7. Phase Roadmap Overview

> High-level roadmap only. Detailed task lists are produced per-phase, at the start of that phase,
> and are **not** part of this guide. The phase set and its ordering are derived from the ADS plus
> the dependency reasoning in §8.

| Phase | Name | Theme (one line) |
|---|---|---|
| **Phase −1** | **Worker Reset** | Delete Worker V1 completely; establish a clean slate with one authoritative processing platform. |
| **Phase 0** | **Foundation** | Repository structure, tooling, build, CI, base configuration, and the shared-contract skeleton. |
| **Phase 1** | **Core Platform** | Worker runtime, job lifecycle, queue abstraction, and the coordinator skeleton behind interfaces. |
| **Phase 2** | **Storage & Immutable Artifacts** | Content-addressed, immutable artifact layer and the storage abstraction it sits behind. |
| **Phase 3** | **Image Processing Pipeline** | Ingest → validate → sanitize → derive; deterministic, idempotent image handling. |
| **Phase 4** | **Manifest System** | Manifest schema, construction, validation, and the manifest-first rendering contract. |
| **Phase 5** | **Render Engine** | Deterministic renderer that consumes a manifest and emits an immutable artifact — no live-UI dependency. |
| **Phase 6** | **Coordinator & Orchestration** | End-to-end pipeline orchestration, dependency resolution, idempotency, and recovery. |
| **Phase 7** | **Observability & Operability** | Logging, metrics, tracing, health, alerting, and runbooks across all subsystems. |
| **Phase 8** | **Security Hardening** | Threat-model-driven hardening of inputs, artifacts, secrets, and boundaries. |
| **Phase 9** | **Performance & Scale Readiness** | Throughput, resource discipline, and the scale seams the ADS defines (designed, not prematurely built). |
| **Phase 10** | **Integration & End-to-End Validation** | Full-pipeline E2E, reproducibility verification, and load/soak validation. |
| **Phase 11** | **Production Cutover** | Controlled rollout, V1 retirement confirmation, rollback rehearsal, and go-live. |

> Observability (Phase 7) and Security (Phase 8) are called out as discrete phases to guarantee a
> dedicated hardening pass, **but** their principles are applied continuously from Phase 0 onward
> (§3.9, §3.10). The dedicated phases are where the cross-cutting concerns are audited to
> completion, not where they first appear.

---

## 8. Dependency Graph

The ordering in §7 is not arbitrary; each phase produces a guarantee that later phases consume.

```
Phase -1 (Reset)
     │  clean slate, single platform
     ▼
Phase 0 (Foundation)
     │  build/CI/contracts skeleton
     ▼
Phase 1 (Core Platform) ──────────────┐
     │  runtime, job lifecycle,        │ interfaces / DI seams
     │  coordinator skeleton           │
     ▼                                 │
Phase 2 (Storage & Artifacts)         │
     │  immutable, addressable output  │
     ▼                                 │
Phase 3 (Image Pipeline) ─────────────┤ consumes storage + runtime
     │  safe, deterministic inputs     │
     ▼                                 │
Phase 4 (Manifest System) ────────────┤ consumes image outputs + contracts
     │  validated render contract      │
     ▼                                 │
Phase 5 (Render Engine) ──────────────┘ consumes manifest + storage
     │  deterministic artifact
     ▼
Phase 6 (Coordinator & Orchestration)
     │  wires 1–5 into one idempotent pipeline
     ▼
Phase 7 (Observability)  ─┐
Phase 8 (Security)        ─┤ harden the whole, audited to completion
Phase 9 (Performance)     ─┘
     ▼
Phase 10 (Integration & E2E)
     │  proves whole-system properties
     ▼
Phase 11 (Production Cutover)
```

**Why this order is mandatory:**

- **Reset before Foundation** — you cannot lay a clean foundation next to a live legacy worker; the slate must be clean first (§4.2).
- **Foundation before everything** — build, CI, and the shared-contract skeleton are what make every later phase reviewable and testable.
- **Core Platform before subsystems** — the runtime, job lifecycle, and DI seams are the sockets every subsystem plugs into.
- **Storage before Image and Render** — both produce artifacts; the immutable, addressable storage contract must exist before anything writes to it.
- **Image before Manifest** — the manifest describes an artifact assembled from processed (sanitized, derived) images; those inputs must be real and stable first.
- **Manifest before Render** — the render engine's *only* input is the manifest (§3.5); the contract must be complete and validated before the consumer is built.
- **Render before Coordinator** — the coordinator orchestrates a pipeline whose terminal stage is rendering; that stage must exist to be orchestrated.
- **Cross-cutting hardening (7–9) after the pipeline exists** — you harden, instrument, and tune a real system, not a hypothetical one; but the *principles* were applied from Phase 0.
- **Integration before Cutover** — whole-system properties (reproducibility, idempotency under load) are proven end-to-end before any production traffic depends on them.

---

## 9. Milestones

Milestones are externally-meaningful checkpoints. Each aggregates the completion of one or more
phases and represents a state the program can report on and stand behind.

| # | Milestone | Reached when | Phases |
|---|---|---|---|
| M0 | **Architecture Ready** | The ADS is accepted and this guide is in force; the roadmap and contracts skeleton are agreed. | ADS + Phase 0 |
| M1 | **Clean Slate** | Worker V1 is fully deleted; the repository has exactly one (nascent) processing platform. | Phase −1 |
| M2 | **Worker Platform Ready** | Runtime, job lifecycle, coordinator skeleton, and DI seams exist, tested and observable. | Phase 1 |
| M3 | **Artifact Platform Ready** | Immutable, content-addressed artifacts can be written and retrieved through the storage abstraction. | Phase 2 |
| M4 | **Image Platform Ready** | The image pipeline deterministically and idempotently produces sanitized inputs + derivatives. | Phase 3 |
| M5 | **Manifest Ready** | The manifest schema, builder, and validation are complete; the render contract is frozen and versioned. | Phase 4 |
| M6 | **Renderer Ready** | The render engine deterministically produces a byte-reproducible artifact from a manifest alone. | Phase 5 |
| M7 | **Pipeline Ready** | The coordinator runs the full pipeline end to end, idempotently and recoverably. | Phase 6 |
| M8 | **Operable & Hardened** | Observability, security, and performance passes are complete and audited. | Phases 7–9 |
| M9 | **Validated** | Full E2E, reproducibility, and load/soak validation pass against production-like conditions. | Phase 10 |
| M10 | **Production Ready** | Cutover executed, rollback rehearsed, V1 retirement confirmed, go-live achieved. | Phase 11 |

---

## 10. Definition of Done

The **project-wide Definition of Done (DoD)** applies to every unit of work in every phase. Work
that does not satisfy every clause is, by definition, not done — regardless of how complete it
appears.

A unit of work is **Done** only when:

1. **Code quality** — it is clean, idiomatic, free of dead code, free of TODO/hack placeholders, and consistent with the surrounding conventions and the ADS.
2. **Architecture compliance** — it conforms to the ADS; any deviation is backed by an accepted ADR (§18).
3. **Documentation** — all affected docs (architecture notes, runbooks, contract docs, living documents) are updated in the same change (§14).
4. **Testing** — unit and, where the phase requires, integration tests exist, are meaningful, and pass; determinism/idempotency are tested where the subsystem claims them.
5. **Logging** — the subsystem emits structured, correlatable logs at the right levels; no silent failures.
6. **Metrics** — the subsystem exposes the metrics needed to understand its health and throughput.
7. **Tracing** — work is correlatable end to end via request/job identifiers.
8. **Security** — inputs are validated at the boundary, secrets are handled correctly, and the change does not widen the attack surface without justification.
9. **Review** — it has passed the required reviews (§12), with reviewer sign-off recorded.
10. **Performance** — it meets the performance expectations set for its phase, or its deviation is documented and accepted.
11. **Reproducibility** (render/artifact work) — the output is immutable and, where applicable, reproducible from its inputs/manifest.
12. **Green build** — the full build and test suite is green on the integration branch after merge.

---

## 11. Quality Gates

Quality Gates are **mandatory, objective checks** that must all pass before a phase is declared
complete. A gate is binary: it passes or the phase does not close. Gates are enforced in review
and, wherever possible, in CI.

| Gate | Requirement |
|---|---|
| **G1 — Build** | The project builds cleanly with no errors and no tolerated warnings. |
| **G2 — Tests** | All tests pass; no skipped/xfail tests substitute for required coverage; determinism/idempotency tests pass where claimed. |
| **G3 — Coverage of behavior** | Every behavior the phase introduces is exercised by at least one meaningful test (behavioral coverage, not a raw percentage fetish). |
| **G4 — Architecture conformance** | A reviewer confirms the work matches the ADS; deviations have accepted ADRs. |
| **G5 — Contract stability** | Shared contracts (manifest schema, interfaces) are unchanged, or changes are versioned and ADR-backed. |
| **G6 — Observability** | Logs, metrics, and traces exist and are correlatable for the phase's subsystem. |
| **G7 — Security** | Boundary validation, secret handling, and input safety are reviewed and satisfied. |
| **G8 — Documentation** | Living documents and affected architecture/runbook docs are updated. |
| **G9 — No shortcuts** | No TODOs, no dead code, no temporary hacks, no partial subsystems. |
| **G10 — Reproducibility** | For artifact/render phases: outputs are immutable and reproducible from inputs. |

---

## 12. Review Process

Every phase is reviewed along four independent axes. A single reviewer may cover multiple axes on
small phases, but each axis must be explicitly satisfied and recorded — review is never implicit.

### 12.1 Architecture Review

Confirms the work conforms to the ADS: correct boundaries, correct dependency direction, no
violated principles, contracts respected. This review has the authority to **stop** a phase and
demand an ADR if it detects drift (§18).

### 12.2 Code Review

Confirms code quality: correctness, clarity, idiom, absence of dead code and shortcuts,
appropriate error handling, and adherence to conventions. Reviewers verify the *how*, not just the
*what*.

### 12.3 Testing Review

Confirms the tests are meaningful and sufficient: they exercise real behavior, they cover the
determinism/idempotency claims, they would fail if the behavior regressed, and they pass. A phase
with green-but-vacuous tests fails this review.

### 12.4 Documentation Review

Confirms that the living documents, architecture notes, contract docs, and any runbooks are
updated and accurate as of this phase. Documentation drift is treated as an incomplete phase.

---

## 13. Git Strategy

### 13.1 Branching

- Work proceeds on **phase branches** cut from the integration branch; a phase branch carries one phase's work to completion.
- Larger phases may use short-lived **subsystem branches** merged into the phase branch, but a phase branch never merges to the integration branch until the phase is Done (§10) and all gates pass (§11).
- The integration branch is always green and always reflects completed, gated work only.

### 13.2 Commits

- Commits are **small, coherent, and self-describing**: one logical change per commit, with a message that explains intent, not just mechanics.
- No commit leaves the tree un-buildable on purpose; each commit is a sane checkpoint.
- Commit messages reference the phase and, where relevant, the ADR or living-document entry they satisfy.
- Commit trailers follow the project convention (`Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`), and commits/pushes happen only when the human owner directs them.

### 13.3 Tagging

- Each **milestone** (§9) is marked with an annotated tag, so the exact state at "Renderer Ready," "Pipeline Ready," etc. is permanently retrievable.
- Tags are the anchors the rollback philosophy relies on.

### 13.4 Rollback Philosophy

- Because artifacts are immutable and Worker V1's deletion is captured in history, rollback is **retrieval, not reconstruction**: any prior good state (a milestone tag) can be checked out and rebuilt exactly.
- The cutover (Phase 11) is designed with an explicit, rehearsed rollback path; going live is never a one-way door until rollback has been demonstrated.
- Reverting merged work is done via new revert commits (preserving history), not history rewriting on shared branches.

---

## 14. Documentation Strategy

Documentation is a deliverable, not an afterthought. The strategy is simple and strict: **the docs
that describe the live system are always current as of the integration branch.** Specifically:

- **Architecture docs** (the ADS and its ADRs) are the source of truth and are only changed through the ADR process (§18).
- **Contract docs** (the manifest schema and interface contracts) are updated in the same change that alters the contract, and never lag the code.
- **Runbooks** for operating, recovering, and cutting over the system are written as the corresponding capability is built (Phases 6–11) and are correct before that capability is relied upon.
- **Living documents** (§15) are updated every phase, as part of the phase, and are covered by the Documentation Review (§12.4).
- **Developer notes** capture the non-obvious "why" that would otherwise be lost — the reasoning that is true but not derivable from the code.

A change that alters behavior without updating the documentation that describes it is an
**incomplete change** and does not pass its gates.

---

## 15. Living Documents

The following documents exist throughout implementation and are maintained continuously. Each has
a single, clear responsibility.

| Document | Responsibility |
|---|---|
| **`WORKER_V2_PROGRESS.md`** | The single source of truth for *where we are*: current phase, phase status, what is Done vs in-flight, open risks, and the next planned unit of work. Updated at the end of every phase (and materially, mid-phase). This is the program's heartbeat. |
| **`WORKER_V2_CHANGELOG.md`** | The chronological, human-readable record of *what changed and when*, phase by phase. Milestone-tagged. The narrative complement to git history. |
| **ADR directory** | The immutable record of *architectural decisions*: context, options, decision, consequences. New architectural facts enter the system **only** here (§2.3, §18). ADRs are append-only; superseded ADRs are marked superseded, never deleted. |
| **Architecture docs** | The ADS itself and derived architecture references — the authoritative description of the system as designed. |
| **Runbooks** | Operational procedures: how to run, recover, monitor, cut over, and roll back the platform. Written with the capability, correct before reliance. |
| **Developer Notes** | The captured "why" — non-obvious rationale, gotchas, and context that keeps future engineers from re-learning hard lessons. |

> **Scope note for this task:** This guide *defines* the living documents and their
> responsibilities. It does **not** create them. Creating `WORKER_V2_PROGRESS.md`,
> `WORKER_V2_CHANGELOG.md`, or the ADR directory is a subsequent step, to be done when
> implementation formally begins — not now.

---

## 16. Implementation Workflow

Every phase follows the same lifecycle. The workflow is uniform precisely so that quality is
uniform.

```
        ┌─────────────┐
        │  Planning   │  Phase-specific task list drawn from the ADS; scope + DoD confirmed.
        └──────┬──────┘
               ▼
        ┌─────────────┐
        │Implementation│ Small, coherent increments within the completed-subsystem rule (§4.3).
        └──────┬──────┘
               ▼
        ┌─────────────┐
        │ Unit Tests  │  Behavior proven in isolation; determinism/idempotency asserted.
        └──────┬──────┘
               ▼
        ┌─────────────────┐
        │Integration Tests│ Subsystem proven against its real dependencies / contracts.
        └──────┬──────────┘
               ▼
        ┌─────────────┐
        │Documentation│  Living docs, contracts, runbooks, developer notes updated.
        └──────┬──────┘
               ▼
        ┌─────────────┐
        │   Review    │  Architecture + Code + Testing + Documentation reviews (§12).
        └──────┬──────┘
               ▼
        ┌─────────────┐
        │   Commit    │  Merge to integration branch; quality gates (§11) enforced.
        └──────┬──────┘
               ▼
        ┌──────────────────┐
        │ Update Progress  │  WORKER_V2_PROGRESS.md + CHANGELOG updated; milestone tagged if reached.
        └──────┬───────────┘
               ▼
        ┌─────────────┐
        │ Next Phase  │  Only once the current phase is fully Done and gated.
        └─────────────┘
```

No stage is skipped. A phase that reaches "Commit" with a failing review returns to Implementation;
it does not proceed to the next phase on a promise.

---

## 17. Risk Management

Risk is managed continuously, not discovered at the end. The ADS's risk analysis is the baseline;
this guide governs how risk is handled *during execution*.

1. **Every phase names its risks.** Phase planning explicitly lists the phase's top risks and their mitigations. Unnamed risk is unmanaged risk.
2. **Risks live in the progress document.** Open risks, their severity, and their status are tracked in `WORKER_V2_PROGRESS.md`, not in individual memories.
3. **High-risk work is front-loaded and de-risked with spikes.** Where a phase carries architectural uncertainty, a time-boxed, throwaway investigation resolves it *before* committed implementation — and its conclusion, if architectural, becomes an ADR.
4. **Determinism, idempotency, and reproducibility risks are treated as first-class.** These are the properties most likely to be quietly violated and most expensive to fix late; they get dedicated tests and dedicated reviewer attention.
5. **Cutover risk is retired by rehearsal.** The Phase 11 rollback path is demonstrated before go-live; production cutover is never the first time the rollback is exercised.
6. **A realized risk stops the line.** When a risk materializes into a real architectural problem, work stops on the affected path and the ADR process (§18) resolves it before implementation resumes.

---

## 18. Architecture Compliance

Architecture compliance is the mechanism that keeps the built system faithful to the designed
system over months of implementation.

### 18.1 Continuous Checking

Every implementation decision is checked against the ADS as it is made — in design, in code, and
again in Architecture Review (§12.1). Compliance is not a final audit; it is a constant condition.

### 18.2 The Stop-and-ADR Rule

If any implementation decision **would violate the ADS** — a boundary, a principle, a contract, or
a recorded decision — implementation on that path **stops immediately**. It does not proceed under
a local exception, a comment, or a "temporary" deviation. The engineer raises the conflict, and an
**ADR** is authored capturing the context, the options considered, and the decision. Only when
that ADR is accepted — thereby updating the architecture of record — does implementation resume,
now compliant with the amended architecture.

### 18.3 Why This Rule Is Absolute

The value of the ADS is precisely that it is trustworthy: any engineer can rely on it describing
the real system. The moment code is allowed to silently diverge, the ADS becomes fiction and the
real architecture becomes "whatever the code happens to do" — which is exactly the state Worker V1
is in and Worker V2 exists to escape. The Stop-and-ADR rule is the single discipline that keeps
that from happening again.

---

## 19. Final Recommendations

Before implementation begins, the following recommendations are put on record.

1. **Freeze the contracts early and change them rarely.** The manifest schema and inter-subsystem interfaces are the highest-leverage, highest-blast-radius code in the platform. Invest disproportionately in getting them right in Phases 0 and 4, and treat every subsequent change as an ADR-level event.
2. **Execute Phase −1 decisively.** Delete Worker V1 completely and early. A lingering legacy path is the most likely source of long-term confusion and regression.
3. **Protect determinism and idempotency as sacred.** Write the tests that would catch their regression *first*, and never let a phase close with those tests weak. These are the properties customers and operators will implicitly depend on.
4. **Build observability and security in from Phase 0.** The dedicated phases (7–8) should be *audits that find little*, because the concerns were applied continuously — not rescue missions.
5. **Keep phases finishable.** If a phase's scope is growing unbounded, that is a planning signal, not a license to ship it partial. Re-plan the phase boundary; never relax the completed-subsystem rule.
6. **Let the living documents do their job.** A current `WORKER_V2_PROGRESS.md` is worth more than any status meeting. Keep it honest, keep it current, and let it be the single answer to "where are we?"
7. **Rehearse the ending before you need it.** Cutover and rollback are rehearsed, tagged, and documented before go-live. The goal is a boring production launch.
8. **When in doubt, stop and write an ADR.** The most expensive mistakes in a rebuild are the silent deviations. The discipline of §18 is cheap; its absence is not.

---

## Appendix A — Execution Reference Tables

> These tables are **planning aids**, not commitments. Durations are relative estimates expressed
> in engineering effort, not calendar dates; complexity and risk are relative ratings to guide
> attention, review depth, and sequencing. They are expected to be refined per phase during phase
> planning, and they never override the ADS.

### A.1 Overall Implementation Timeline

Effort is expressed in relative "phase-effort units" so the *shape* of the program is clear
without pretending to a false calendar precision.

| Phase | Name | Relative Effort | Cumulative Share |
|---|---|---|---|
| −1 | Worker Reset | Very Low | ~2% |
| 0 | Foundation | Medium | ~10% |
| 1 | Core Platform | High | ~22% |
| 2 | Storage & Immutable Artifacts | Medium | ~30% |
| 3 | Image Processing Pipeline | High | ~42% |
| 4 | Manifest System | High | ~54% |
| 5 | Render Engine | Very High | ~70% |
| 6 | Coordinator & Orchestration | High | ~82% |
| 7 | Observability & Operability | Medium | ~88% |
| 8 | Security Hardening | Medium | ~92% |
| 9 | Performance & Scale Readiness | Medium | ~96% |
| 10 | Integration & End-to-End Validation | Medium | ~99% |
| 11 | Production Cutover | Low | 100% |

> Interpretation: the center of gravity is Phases 3–6 (image pipeline through orchestration), with
> the render engine (Phase 5) as the single heaviest unit. Plan reviewer bandwidth and buffer
> accordingly.

### A.2 Estimated Complexity per Phase

| Phase | Name | Complexity | Primary Complexity Drivers |
|---|---|---|---|
| −1 | Worker Reset | Trivial | Ensuring nothing live depends on V1 before deletion. |
| 0 | Foundation | Moderate | Contract skeleton, build/CI, DI seam design. |
| 1 | Core Platform | High | Job lifecycle correctness, coordinator skeleton, abstraction boundaries. |
| 2 | Storage & Artifacts | Moderate | Content-addressing, immutability guarantees, storage abstraction. |
| 3 | Image Pipeline | High | Format safety, determinism, derivative correctness, idempotency. |
| 4 | Manifest System | High | Schema design, validation, versioning, contract stability. |
| 5 | Render Engine | Very High | Deterministic, reproducible rendering from manifest with no live-UI dependency. |
| 6 | Coordinator & Orchestration | High | End-to-end idempotency, dependency resolution, crash recovery. |
| 7 | Observability | Moderate | End-to-end correlation, meaningful metrics, alert tuning. |
| 8 | Security | Moderate | Threat-model coverage, boundary validation, secret handling. |
| 9 | Performance & Scale | Moderate | Throughput, resource discipline, scale-seam validation. |
| 10 | Integration & E2E | Moderate–High | Whole-system property proofs (reproducibility, load, soak). |
| 11 | Production Cutover | Moderate | Zero-regression rollout, rollback rehearsal, V1 retirement. |

### A.3 Estimated Risk per Phase

| Phase | Name | Risk | Dominant Risk |
|---|---|---|---|
| −1 | Worker Reset | Low | Removing V1 before confirming nothing live depends on it. |
| 0 | Foundation | Low–Medium | A weak contract skeleton that forces churn later. |
| 1 | Core Platform | Medium–High | Wrong abstraction boundaries; expensive to unwind downstream. |
| 2 | Storage & Artifacts | Medium | Immutability/addressing mistakes that surface as corruption later. |
| 3 | Image Pipeline | High | Non-determinism or unsafe input handling entering the pipeline. |
| 4 | Manifest System | High | An unstable or under-specified contract rippling into every consumer. |
| 5 | Render Engine | Very High | Hidden non-determinism; reproducibility violations that are subtle and late-surfacing. |
| 6 | Coordinator & Orchestration | High | Idempotency/recovery gaps under real concurrency and failure. |
| 7 | Observability | Low–Medium | Blind spots that hide production failures. |
| 8 | Security | Medium | An unhardened boundary or mishandled secret. |
| 9 | Performance & Scale | Medium | Discovering a scale bottleneck late; premature scale complexity. |
| 10 | Integration & E2E | Medium | Whole-system property failures found only at the end. |
| 11 | Production Cutover | Medium–High | Cutover regression without a rehearsed rollback. |

### A.4 Recommended Review Frequency

| Context | Review Cadence |
|---|---|
| Within a phase | Continuous — every merged increment is reviewed (§12) before it lands on the phase branch. |
| End of phase | Mandatory full four-axis review (architecture, code, testing, documentation) before the phase closes. |
| High-complexity / high-risk phases (1, 3, 4, 5, 6) | Add an early **mid-phase architecture checkpoint** to catch drift before it compounds. |
| Contract changes (manifest / interfaces) | Reviewed as an ADR-level event, regardless of size. |
| Milestone reached | A milestone-level review confirming the aggregate guarantee holds before tagging. |

### A.5 Recommended Commit Frequency

| Context | Commit Cadence |
|---|---|
| Normal implementation | Frequent, small, coherent commits — one logical change each; the tree stays buildable. |
| Contract or ADR-driven change | A dedicated commit referencing the ADR, isolated from unrelated work. |
| End of a subsystem within a phase | A checkpoint commit marking the subsystem Done and gated. |
| Phase close | A commit that lands the completed phase on the integration branch, with living documents updated in the same change. |
| Milestone | Annotated tag on the integration branch at the milestone state (§13.3). |

### A.6 Recommended Testing Frequency

| Context | Testing Cadence |
|---|---|
| Every increment | Unit tests written with the code; run locally before every commit. |
| Every merge | Full test suite green on the integration branch (enforced by G1/G2). |
| Every subsystem | Integration tests against real contracts/dependencies before the subsystem is Done. |
| Determinism / idempotency / reproducibility | Dedicated tests present from the phase that introduces the claim, and run on every build thereafter (regression guard). |
| End of phase | Complete unit + integration pass, plus any phase-specific property tests, all green as a gate. |
| Phases 10–11 | Full end-to-end, reproducibility, and load/soak validation against production-like conditions. |

---

*End of Worker V2 Master Implementation Guide. This document governs execution only; the ADS
governs architecture. Implementation begins when the program formally initiates Phase −1 — not
before.*
