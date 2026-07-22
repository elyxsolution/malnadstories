# Worker V2 — Engineering Playbook

> **Document type:** Operational Engineering Manual (Planning Only)
> **Status:** Authoritative on *how* Worker V2 is engineered — the working manual every phase follows
> **Governs:** Implementation *behaviour* — coding, review, testing, git, release, compliance, stop conditions
> **Does NOT redefine:** architecture (ADS), execution discipline rationale (`WORKER_V2_IMPLEMENTATION_GUIDE.md`), phase content (`WORKER_V2_PHASES.md`), or work decomposition (`WORKER_V2_WBS.md`) — it references them
> **Frozen inputs:** ADS + the three planning documents above are frozen unless changed by an accepted ADR
> **Owner:** Chief Software Architect, Worker V2

---

## Table of Contents

1. [Purpose](#1-purpose)
2. [Engineering Principles](#2-engineering-principles)
3. [Architectural Invariants (Operational Enforcement)](#3-architectural-invariants-operational-enforcement)
4. [Coding Standards](#4-coding-standards)
5. [Repository Standards](#5-repository-standards)
6. [Testing Standards](#6-testing-standards)
7. [Review Process](#7-review-process)
8. [Documentation Standards](#8-documentation-standards)
9. [Implementation Workflow](#9-implementation-workflow)
10. [Git & Release Workflow](#10-git--release-workflow)
11. [Architecture Compliance](#11-architecture-compliance)
12. [Stop Conditions](#12-stop-conditions)
13. [Production Readiness Checklist](#13-production-readiness-checklist)
14. [Appendix](#14-appendix)

---

## 1. Purpose

### 1.1 What this document is

The Engineering Playbook is the **operational manual** for building Worker V2. Where the other
documents define *what* to build and *in what order*, the Playbook defines **how an engineer
actually works** on any given day: how code is structured, how it is reviewed, how it is tested,
how it is committed and released, when work must stop, and what "done" and "production ready" mean
in practice.

It is deliberately concrete. It is the document an engineer keeps open while implementing a Work
Package.

### 1.2 How it relates to the frozen planning set

| Document | Answers | The Playbook's relationship |
|---|---|---|
| **ADS** | *What* the architecture is and *why*. | The Playbook enforces it; it never restates or alters it. |
| **`WORKER_V2_IMPLEMENTATION_GUIDE.md`** | The *discipline* — principles, gates, DoD, workflow rationale. | The Playbook operationalizes it into concrete rules and checklists. |
| **`WORKER_V2_PHASES.md`** | The *phases* — one subsystem each, ordered, with milestones + invariants (§3 there). | The Playbook references phases; it does not re-enumerate them. |
| **`WORKER_V2_WBS.md`** | The *work packages* — single-capability units per phase. | The Playbook is applied *per Work Package*; it does not re-list WPs. |

### 1.3 Authority

This document **governs implementation behaviour**. When engineering behaviour is in question — how
to name an event, whether a test is sufficient, whether a change may merge — the Playbook is
authoritative. When *architecture* is in question, the ADS is authoritative and this Playbook defers
to it. A conflict between the Playbook and the ADS is resolved in favour of the ADS, or escalated to
an ADR (§8.2, §12).

### 1.4 Non-duplication rule

The Playbook does not repeat the ADS, Phase Plan, or WBS. Invariants are restated here **only in
their operational-enforcement form** (§3) — the "allowed/forbidden/validation" view an engineer
needs at the keyboard — not re-derived. Everything else references the frozen documents.

---

## 2. Engineering Principles

These ten principles are the working values. Each is stated as a rule an engineer can apply, with
the behaviour it demands.

### 2.1 Architecture First
Understand the governing ADS section and the WP's declared invariants **before** writing code. If
the design is unclear, resolve it with an ADR — never with a guess in code. *Demands:* read the ADS
section + WBS entry; confirm the invariants; only then implement.

### 2.2 Manifest First
Rendering and any artifact production consume a **validated manifest** as their sole input. Never
reach around the manifest to live state. *Demands:* if the renderer "needs" data not in the manifest,
the manifest is wrong — fix the manifest contract (ADR-gated), not the renderer.

### 2.3 Immutable Artifacts
Everything produced (manifests, images, PDFs, artifacts) is write-once. Corrections create new
identities. *Demands:* never overwrite a key; never mutate a produced artifact; new output → new
content address.

### 2.4 Idempotent Processing
Every handler survives being run again — retry, duplicate delivery, crash recovery — with no
side-effect drift. *Demands:* design the effect to be repeatable or guarded; prove it with a
double-invoke test before merge.

### 2.5 Small Vertical Changes
Ship the thinnest complete slice of a capability — end to end within its WP boundary — rather than a
broad half-built layer. *Demands:* prefer a narrow, finished, tested change over a wide, unfinished
one. Small never means partial (a WP is finished before the next depends on it).

### 2.6 Test Before Merge
No code merges without meaningful, passing tests that would fail if the behaviour regressed.
*Demands:* write the test that expresses the intent; a green-but-vacuous test is a review failure.

### 2.7 Documentation Always Updated
Code and the docs that describe it move in the **same change**. *Demands:* update contracts,
runbooks, progress, and changelog in the commit that changes behaviour — never "docs later."

### 2.8 Production Quality Only
There is no prototype tier. Every merged line is written as if it ships tomorrow. *Demands:* no
scaffolding, no "good enough for now," uniform quality across all phases.

### 2.9 Observability by Default
A subsystem that cannot be logged, measured, and traced is not finished. *Demands:* add structured
logs, metrics, and correlation as you build the capability — not in a later pass.

### 2.10 No Temporary Solutions
No TODO placeholders, no temporary hacks, no dead code, no commented-out branches in merged work.
*Demands:* if it is not the intended design, it does not merge; unfinished intent lives in the
progress document, not in source.

---

## 3. Architectural Invariants (Operational Enforcement)

The twelve permanent laws are defined in `WORKER_V2_PHASES.md` §3. This section is the **operational
enforcement view** — for each invariant: its purpose, the reason it exists, what is explicitly
**allowed** and **forbidden**, how it is **validated**, and concrete examples. A violation is a
**hard stop** (§12).

### 3.1 INV-1 — The Manifest is immutable
- **Purpose:** Guarantee a stable, reproducible render contract.
- **Reason:** If a manifest can change after creation, reproduction and audit become impossible.
- **Allowed:** Creating a new, versioned manifest for a correction.
- **Forbidden:** Mutating any field of an existing manifest; in-place "patching."
- **Validation:** Manifest type is deeply immutable; builder returns frozen structures; test asserts mutation throws / is impossible.
- **Examples:** ✅ Rebuild → manifest v2. ❌ `manifest.pages.push(...)` after build.

### 3.2 INV-2 — Artifacts are immutable
- **Purpose:** Write-once outputs that history can trust.
- **Reason:** Overwriting an artifact silently rewrites the past.
- **Allowed:** Writing a new artifact under a new content address.
- **Forbidden:** Overwriting or editing an existing artifact object.
- **Validation:** Artifact store refuses overwrite; test asserts second write to same address fails.
- **Examples:** ✅ New PDF → new key. ❌ Re-uploading over an existing preview key.

### 3.3 INV-3 — The Renderer never queries the domain database
- **Purpose:** Keep rendering deterministic and isolated.
- **Reason:** Any live-state read makes output depend on unversioned data.
- **Allowed:** Reading the manifest; reading immutable artifacts referenced by the manifest.
- **Forbidden:** Any DB/session/app-state access from the render path.
- **Validation:** Renderer package has no DB dependency in its dependency graph; isolation test runs the renderer with no DB reachable.
- **Examples:** ✅ Renderer reads manifest. ❌ Renderer fetches album row for a title.

### 3.4 INV-4 — Workers never communicate directly
- **Purpose:** Preserve the Control Plane as the single coordination authority.
- **Reason:** Direct worker-to-worker channels create hidden state and race conditions.
- **Allowed:** Coordination via the Control Plane / queue abstraction.
- **Forbidden:** One worker calling another worker directly (RPC, shared socket, in-memory handoff).
- **Validation:** No cross-worker imports/network channels; structural review + dependency check.
- **Examples:** ✅ Coordinator enqueues next step. ❌ Image worker calls the PDF worker.

### 3.5 INV-5 — Pipelines remain declarative
- **Purpose:** Pipelines are data the orchestrator interprets, not code.
- **Reason:** Imperative pipelines are unauditable and untestable as data.
- **Allowed:** Declaring steps + dependencies as validated data.
- **Forbidden:** Hardcoded imperative step sequences inside the coordinator.
- **Validation:** Pipeline definitions validate against a schema; interpreter is generic.
- **Examples:** ✅ Pipeline = step list + deps. ❌ `if step==A then callB()` chains.

### 3.6 INV-6 — One active run per album
- **Purpose:** Prevent concurrent, conflicting processing of the same album.
- **Reason:** Two active runs corrupt state and produce ambiguous artifacts.
- **Allowed:** Serialized admission; a new run after the prior completes/aborts.
- **Forbidden:** Two simultaneously-active runs for one album.
- **Validation:** Run registry enforces the lock; concurrency test proves serialization.
- **Examples:** ✅ Second submit waits/rejects. ❌ Two coordinators drive the same album at once.

### 3.7 INV-7 — All handlers are idempotent
- **Purpose:** Safe retries, duplicates, and recovery.
- **Reason:** Non-idempotent handlers drift on the inevitable re-run.
- **Allowed:** Repeatable effects; guarded effects keyed on identity.
- **Forbidden:** Effects that double on second execution.
- **Validation:** Double-invoke test asserts identical end state; dedupe keys reviewed.
- **Examples:** ✅ "Ensure derivative exists." ❌ "Append a row every run."

### 3.8 INV-8 — The Control Plane is the source of truth
- **Purpose:** One authoritative place for run/album/asset state + lineage.
- **Reason:** Multiple truths diverge.
- **Allowed:** Reading/writing state via the Control Plane.
- **Forbidden:** Authoritative state living in a worker, a cache, or an artifact.
- **Validation:** State reads/writes route through the Control Plane API; review confirms no shadow state.
- **Examples:** ✅ Run status in Control Plane. ❌ Run status inferred from an R2 listing.

### 3.9 INV-9 — All transitions are audited
- **Purpose:** Complete, immutable lineage of every state change.
- **Reason:** Un-audited transitions are unexplainable in incidents.
- **Allowed:** Transition via the engine that always writes an audit record.
- **Forbidden:** State change that bypasses audit.
- **Validation:** Transition engine emits audit atomically; test asserts no transition without a record.
- **Examples:** ✅ `submitted→processing` logs audit. ❌ Direct status update in a repo.

### 3.10 INV-10 — No mutable storage keys
- **Purpose:** Content/identity-addressed, never-rewritten storage.
- **Reason:** Mutable keys break immutability and caching guarantees.
- **Allowed:** Content-addressed keys; new key per new content.
- **Forbidden:** Reusing a key for different content.
- **Validation:** Key derivation is content/identity based; overwrite refused (see INV-2).
- **Examples:** ✅ `…/<hash>.jpg`. ❌ `…/latest.jpg` overwritten each run.

### 3.11 INV-11 — Versions are frozen at run start
- **Purpose:** A run executes against one coherent version set.
- **Reason:** Mixed versions mid-run destroy reproducibility.
- **Allowed:** Pinning the full Version Set at inception; using it throughout the run.
- **Forbidden:** Picking up a newer version of any component mid-run.
- **Validation:** Coordinator freezes the version set at run start; recorded in the Version Matrix; test asserts stability across steps.
- **Examples:** ✅ Rebuild uses the recorded version set. ❌ Step 3 uses a newer template than step 1.

### 3.12 INV-12 — Technical and Domain events are separate
- **Purpose:** Distinct operational vs business event streams.
- **Reason:** Mixing them couples ops tooling to business logic and vice versa.
- **Allowed:** Two typed streams with distinct contracts.
- **Forbidden:** Emitting business meaning on the technical stream or vice versa.
- **Validation:** Separate publishers/schemas; review confirms correct stream per event.
- **Examples:** ✅ `job.retried` (technical) vs `album.processed` (domain). ❌ One "events" bag for both.

---

## 4. Coding Standards

Worker-V2-specific standards. General language style is assumed; these are the rules that protect
the architecture.

### 4.1 Structural standards

- **4.1.1 Repository Pattern.** All persistence access goes through repository interfaces. Domain/logic code depends on the interface, never on a driver or query builder directly.
- **4.1.2 Dependency Injection.** Dependencies are injected via the runtime container (WBS `4.1.2`). No hidden singletons, no direct construction of infrastructure inside domain code.
- **4.1.3 Pure Domain Layer.** Domain logic (lifecycles, resolvers, manifest building, pricing) is pure and side-effect-free; all I/O is pushed to the edges behind interfaces.
- **4.1.4 Infrastructure Isolation.** Storage, queue, DB, vendor, and rendering back-ends live behind abstractions; swapping an implementation must not touch domain code.
- **4.1.5 No Circular Dependencies.** The module graph is a DAG. Dependencies point from concrete → abstract, edges → core; a cycle is a build failure to fix, not tolerate.
- **4.1.6 No Shared Mutable State.** No module-level mutable globals; state lives in the Control Plane or is passed explicitly.
- **4.1.7 No Hidden Side Effects.** A function's effects are evident from its signature/contract. No surprise writes, no ambient logging that changes control flow.
- **4.1.8 Explicit Interfaces.** Every subsystem exposes a small, explicit public interface (its "public contract" in the WBS). Everything else is internal.
- **4.1.9 Configuration-Driven Behaviour.** Behaviour that varies is driven by validated configuration or Processing Profiles — never by hardcoded constants scattered in logic (render params belong to profiles; see WBS `6.2.1`).

### 4.2 Versioning & determinism

- **4.2.1 Strict Versioning.** Any component in the Version Set (see `WORKER_V2_PHASES.md` §5) is explicitly versioned; consumers pin the version; a change bumps the version. Never silently change behaviour under a stable version.
- **4.2.2 Determinism Discipline.** No wall-clock, randomness, locale, or environment leakage into deterministic paths (image, blueprint, manifest, render). Inject a clock/seed where needed; forbid ambient sources.

### 4.3 Events, logging, errors

- **4.3.1 Event Naming.** Events are `domain.past_tense` for domain events and `technical.past_tense` for technical events, on their respective streams (INV-12). Examples: `album.processed`, `job.retried`. Names are stable contracts — renaming is an ADR-level change.
- **4.3.2 Logging Conventions.** Structured logs only (key/value), with the correlation id (request/run/job) attached. Levels: `error` (actionable failure), `warn` (degraded/over-budget), `info` (lifecycle milestones), `debug` (diagnostic). Never log secrets, raw payloads, credentials, or PII (see §13).
- **4.3.3 Error Handling.** Distinguish **permanent** errors (reject, do not retry) from **transient** errors (throw → retry). Errors carry context (ids, not payloads). Never swallow an error silently; never convert a permanent failure into a false success.
- **4.3.4 Retry Policy.** Transient failures retry with bounded attempts + backoff, defined declaratively per step/handler. Retries must be safe because handlers are idempotent (INV-7). A retried job never double-applies effects.
- **4.3.5 Replay Policy.** Respect the distinct semantics defined in the Phase Plan (Rec 18 / WBS `11.2.4`): **Retry** (same attempt, transient), **Replay** (re-run recorded run), **Rebuild** (reproduce from frozen versions → byte-identical), **Regenerate** (new run, potentially new versions). Never conflate them in code or naming.
- **4.3.6 Idempotency Rules.** Every effectful handler defines its **idempotency key** and its "already-done" check. The default posture is "ensure X exists/holds," not "do X." Re-running to completion is always safe.

### 4.4 Domain-object rules

- **4.4.1 Manifest Rules.** Manifests are built only by the Manifest Builder, validated before use, immutable (INV-1), self-contained (no external live references), and versioned. Nothing else constructs or edits a manifest.
- **4.4.2 Artifact Rules.** Artifacts are written only through the artifact store, write-once (INV-2), content-addressed (INV-10). Reads are by address; no "latest" mutable pointer.
- **4.4.3 Blueprint Rules.** Blueprint compilation is separate from manifest generation (Rec 3): resolvers are pure/deterministic and version-pinned, and the compiler stops at a resolved plan. No manifest logic leaks into the blueprint layer, and vice versa.
- **4.4.4 Plugin Rules.** Plugins (reserved, WBS `4.3.1`/`18.1.1`) are **additive only**: they register through the plugin seam, obey all invariants (especially INV-4, INV-7), never mutate core contracts, and are sandboxed. A plugin that requires a core contract change is not a plugin — it is an ADR.

---

## 5. Repository Standards

### 5.1 Branch structure
- **Integration branch** is always green and reflects only completed, gated work.
- **Phase branches**: `worker-v2/phase-NN-<slug>` carry one phase to Done.
- **Work-package branches** (short-lived): `worker-v2/wp-<wbs-id>-<slug>` merge into the phase branch.
- **ADR branches**: `worker-v2/adr-<nnnn>-<slug>` for architecture-affecting changes.
- **Hotfix branches**: `worker-v2/hotfix-<slug>` off the released tag (see §10.6).

### 5.2 Commit conventions
- One logical change per commit; the tree stays buildable at each commit.
- **Format:** `type(scope): summary` — `type ∈ {feat, fix, refactor, test, docs, chore, perf, build}`; `scope` = WBS id or subsystem (e.g. `feat(wp-9.1.2): manifest builder`).
- Body explains **intent**; footer references the WBS id, ADR, and phase.
- Trailer per project convention: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Commit/push only when the human owner directs; branch before committing on the default branch.

### 5.3 Folder & module ownership
- Each subsystem folder has **one owning capability** (per the WBS Ownership Category). Cross-cutting capabilities have a single home module consumed elsewhere (WBS §9).
- A module change that reaches outside its ownership boundary requires the owning reviewer's sign-off.

### 5.4 Dependency & import rules
- Imports point **inward** (concrete → abstract; edges → core). Domain never imports infrastructure.
- No circular imports (enforced in CI). No importing another subsystem's internal modules — only its public interface.
- Shared contracts are imported from the contracts package only; no cross-subsystem type reach-in.

### 5.5 Naming conventions
- Interfaces name the capability (`ArtifactStore`, `LifecycleEngine`), not the implementation.
- Events per §4.3.1. Versioned components carry their version explicitly.
- Files/modules are named for the single capability they own.

### 5.6 Documentation ownership
- Each subsystem owns its contract docs + runbook. The owning engineer updates them in the same change (§8). Orphaned docs (no owner) are a review finding.

---

## 6. Testing Standards

Testing intensity per subsystem follows the WBS classification. The **minimum required** test types
per area are below. Determinism, idempotency, and reproducibility tests are **mandatory** wherever
the subsystem claims those properties, and they run on every build thereafter (no regression).

### 6.1 Required tests by subsystem

| Subsystem | Required testing |
|---|---|
| **Runtime** | Handler idempotency (double-invoke), DI resolution, capability registry, INV-4 structural checks. |
| **Control Plane** | State-machine property tests (no illegal transition), one-active-run concurrency (INV-6), audit-completeness (INV-9), event-separation (INV-12), version-freeze (INV-11). |
| **Repositories** | Contract tests against the interface; boundary validation; failure/transient behaviour. |
| **Infrastructure** | Abstraction conformance (provider swap), config validation, storage write-once (INV-2) + content-addressing determinism (INV-10). |
| **Blueprints** | Deterministic compilation; per-resolver purity; version-pin propagation; no manifest bleed-through. |
| **Manifest** | Schema validation (valid/invalid corpus), immutability (INV-1), self-containment (enables INV-3). |
| **Renderer** | **Golden image / byte-equality reproducibility**, INV-3 isolation (no DB reachable), artifact immutability (INV-2), budget checks. |
| **Image Engine** | Determinism/reproducibility, malicious-input corpus, idempotent re-processing, profile-variation. |
| **PDF Engine** | Golden-PDF reproducibility, page/geometry correctness, budget. |
| **Coordinator** | End-to-end run, crash/resume + duplicate idempotency (INV-7), dependency-graph correctness, replay-semantics distinctness. |
| **Manufacturing** | Lifecycle-tail transitions + audit, vendor-abstraction (mock), validation-profile gating, independence from `orders.status`. |
| **Observability** | Correlation propagation, cost-accounting accuracy, version-matrix completeness, metric emission, tech/business separation. |

### 6.2 Required test categories (platform-wide)

- **6.2.1 Every public contract** has contract tests (valid + invalid + boundary inputs).
- **6.2.2 Golden image tests** for the renderer/PDF: a fixed manifest → a checked-in expected artifact; drift fails the build.
- **6.2.3 Load tests** validate throughput + stability against declared performance budgets (WBS `14.1.2`).
- **6.2.4 Regression tests** — every fixed defect gets a test that would have caught it.
- **6.2.5 Integration tests** exercise a subsystem against its real dependencies/contracts.
- **6.2.6 Smoke tests** validate a minimal end-to-end run after build/deploy.
- **6.2.7 Failure testing** — inject transient/permanent failures; assert correct retry/reject/audit behaviour.
- **6.2.8 Recovery testing** — kill mid-run; assert idempotent resume with no drift (INV-7).

### 6.3 Test rules
- A test must fail if its behaviour regresses; green-but-vacuous tests fail testing review (§7.3).
- Reproducibility/idempotency tests, once added, are permanent — deleting or weakening one is an ADR-level decision.
- No skipped/`xfail` test stands in for required coverage.

---

## 7. Review Process

Every Work Package passes the reviews below before it merges to its phase branch; a phase passes all
of them before closing. Reviews are recorded (who signed off, on what). See the merge checklist
(§14.3).

### 7.1 Architecture Review
Confirms conformance to the ADS, correct dependency direction, and that all applicable invariants
(§3) are upheld. **Has the authority to Stop-and-ADR** (§12). Mandatory for any WP touching a public
contract or a versioned component.

### 7.2 Code Review
Confirms code quality: single-capability scope, clarity, idiom, no dead code/hacks/TODOs, correct
error/retry/idempotency handling, explicit interfaces, no hidden side effects.

### 7.3 Testing Review
Confirms tests are meaningful, cover the WP's determinism/idempotency/reproducibility claims, and
would fail on regression. Verifies required test categories (§6) for the subsystem are present and
green.

### 7.4 Performance Review
Confirms the WP meets its declared performance budget (or has an accepted, documented deviation).
Mandatory for hot-path WPs (image, render, coordinator) and any WP that moves the critical path.

### 7.5 Security Review
Confirms boundary validation, secret handling (no secrets in logs/traces/artifacts), least-privilege
access, and safe input handling. Mandatory for any WP handling external input or credentials.

### 7.6 Documentation Review
Confirms contract docs, runbooks, progress, and changelog are updated **in the same change**. Stale
or missing docs = incomplete WP.

### 7.7 Release Review
Performed before a milestone tag / production cutover: confirms the Production Readiness Checklist
(§13) is satisfied and the release + rollback runbooks are correct and rehearsed.

---

## 8. Documentation Standards

### 8.1 When documents are updated
- **In the same change as the behaviour.** Contract docs, runbooks, `WORKER_V2_PROGRESS.md`, and `WORKER_V2_CHANGELOG.md` update in the commit that changes behaviour — never deferred.
- `WORKER_V2_PROGRESS.md` is updated at the end of every phase and materially mid-phase; `WORKER_V2_CHANGELOG.md` on every phase close, milestone-tagged. *(These living documents are created when implementation begins — not by this planning task.)*

### 8.2 ADR creation rules
- An ADR is **required** whenever a decision changes architecture, a public contract, a versioned component's behaviour, an invariant's interpretation, or introduces/retires a subsystem.
- ADRs are **append-only**: superseded ADRs are marked `Superseded by ADR-NNNN`, never deleted.
- ADRs record **rejected alternatives** (Phase Plan Rec 20) — the options considered and why they lost.
- An ADR must be **accepted** before the implementation it authorizes may proceed. Format/flow live in the ADR system (WBS `2.3.1`).

### 8.3 Runbook rules
- A capability that is operated in production (coordinator, recovery, cutover, manufacturing, alerting) ships a runbook **before** it is relied upon.
- Runbooks are step-by-step and are validated (dry-run/rehearsal) before go-live (§10.5, §13).

### 8.4 Architecture updates
- The ADS changes **only** via an accepted ADR (§8.2). No code change silently redefines architecture; if reality contradicts the ADS, stop and write an ADR (§12).

### 8.5 Progress & changelog updates
- Progress reflects true status: what is Done vs in-flight, open risks, next WP. Honesty over optimism.
- Changelog is the human-readable narrative of what changed each phase, complementing git history.

---

## 9. Implementation Workflow

The exact lifecycle for **every** implementation phase and, at finer grain, every Work Package. No
stage is skipped; a failed stage returns to an earlier stage — it never advances on a promise.

```
   Validate ADS            (confirm the governing ADS section + invariants for this WP/phase)
        ↓
   Validate WBS            (confirm the WP scope, dependencies, contracts, classification)
        ↓
   Implement              (smallest complete vertical slice within the WP boundary)
        ↓
   Unit Tests             (behaviour proven in isolation; determinism/idempotency asserted)
        ↓
   Integration Tests      (proven against real dependencies/contracts)
        ↓
   Performance Validation (meets declared budget, or documents an accepted deviation)
        ↓
   Documentation          (contracts, runbooks, progress, changelog — same change)
        ↓
   Review                 (architecture · code · testing · performance · security · documentation)
        ↓
   Commit                 (merge to phase branch; quality gates enforced in CI)
        ↓
   Stop                   (WP done; update progress; only then start the next WP/phase)
```

- **Entry precondition:** the previous phase is Done (Phase Plan ordering); the WP's dependencies are complete.
- **Exit precondition:** all reviews signed off, all gates green, progress updated, no shortcut left behind.
- **"Stop" is deliberate:** finishing a WP is a checkpoint, not a runway to silently continue into the next.

---

## 10. Git & Release Workflow

### 10.1 Branch strategy
Per §5.1: integration ← phase ← work-package branches; ADR and hotfix branches as needed. Integration
is always releasable-green.

### 10.2 Commit message format
Per §5.2: `type(scope): summary` + intent body + WBS/ADR/phase footer + co-author trailer.

### 10.3 Tagging
- Annotated tag at every **milestone** (M1…M18) on the integration branch — the rollback anchors.
- Release tags follow §10.4.

### 10.4 Versioning
- The platform release version is separate from the internal component versions in the Version Set (Phase Plan §5). Release versioning is **semantic**: `MAJOR.MINOR.PATCH`.
- A component version bump (manifest schema, render engine, etc.) that changes behaviour is ADR-gated and reflected in the changelog + Version Matrix.

### 10.5 Rollback philosophy
- Rollback is **retrieval, not reconstruction**: because artifacts are immutable (INV-2) and milestones are tagged, any prior good state is checked out and rebuilt exactly.
- No production cutover is a one-way door until its rollback path has been **rehearsed** (WBS `17.1.2`, §13).
- Reverts on shared branches are new revert commits — never history rewriting.

### 10.6 Hotfix strategy
- A production hotfix branches off the released tag, carries the **minimal** fix + a regression test, passes the same reviews (§7) at expedited cadence, ships, and is **merged back** to integration immediately (no divergence).
- A hotfix that would change architecture or a public contract is not a hotfix — it stops and takes the ADR path (§12).

---

## 11. Architecture Compliance

Compliance is checked continuously and **enforced before merge**. A single failing check blocks the
merge and, if it implies an architecture change, triggers a Stop condition (§12).

### 11.1 Mandatory pre-merge compliance checks
Every WP, before merging to its phase branch, must pass:

**Architecture Compliance Checklist**
- [ ] Conforms to the governing ADS section; no silent deviation.
- [ ] Every applicable invariant (INV-1…12) is upheld and tested.
- [ ] Owns exactly one capability; scope matches its WBS entry.
- [ ] Dependency direction correct; module graph remains a DAG (no cycles).
- [ ] Domain layer pure; infrastructure isolated behind interfaces (DI).
- [ ] Public contract unchanged, or changed via an accepted ADR + version bump.
- [ ] Versioned components are pinned; version freeze respected (INV-11).
- [ ] No shared mutable state; no hidden side effects.
- [ ] Events on the correct stream with correct naming (INV-12, §4.3.1).
- [ ] Observability present (structured logs + metrics + correlation).
- [ ] No secrets/PII in logs, traces, or artifacts.
- [ ] Reserved seams (plugins/replay/run-graph/DX) remain additive and inert.
- [ ] No TODOs, dead code, or temporary hacks.
- [ ] Docs (contracts/runbooks/progress/changelog) updated in the same change.

---

## 12. Stop Conditions

When any of the following is detected, implementation on the affected path **stops immediately**.
Work does not continue under a local exception, a comment, or a "temporary" workaround. Each has a
required action.

| # | Stop condition | Required action |
|---|---|---|
| **SC-1** | **Architecture change is required.** | Stop. Open an ADR (§8.2) capturing context, options (incl. rejected), and decision. Resume only after acceptance. |
| **SC-2** | **A new subsystem appears** (work implies a capability not in the WBS). | Stop. Do not smuggle it into an existing WP. Raise it; an ADR + WBS/Phase-Plan amendment (ADR-gated) defines its home before work continues. |
| **SC-3** | **An architectural invariant is violated** (or cannot be upheld). | Stop. Treat as a defect. Either fix to comply, or, if the invariant itself is wrong, ADR to change it (rare, high scrutiny). Never merge a violation. |
| **SC-4** | **A public contract changes unexpectedly.** | Stop. Contract changes are ADR-gated + versioned. Revert the unsanctioned change or formalize it via ADR + version bump + downstream review. |
| **SC-5** | **Version freeze is broken** (a run mixes versions / a component changed behaviour under a stable version). | Stop. Restore the freeze (INV-11). Bump the version if behaviour truly changed; record in the Version Matrix + changelog. |
| **SC-6** | **A security issue is discovered.** | Stop feature work on the path. Contain, assess severity, remediate, add a regression test, run Security Review (§7.5). High-severity issues gate the phase. |
| **SC-7** | **An unexpected data migration is required.** | Stop. A migration is not an incidental code change: design it, review it (architecture + security), sequence it against deploy (code-first vs SQL-first) per the ADS/rules, and document it. Never migrate ad hoc mid-WP. |

> **General rule:** a Stop condition is cheap to honour and expensive to ignore. Stopping and writing
> an ADR is always the correct response to architectural uncertainty (Implementation Guide §18).

---

## 13. Production Readiness Checklist

A subsystem/release is **Production Ready** only when **every** box is checked. This is the concrete
bar behind the milestone "Production Ready" (M17) and the Release Review (§7.7).

### 13.1 Code
- [ ] Meets all coding standards (§4); no dead code/TODOs/hacks.
- [ ] Single-capability modules; clean dependency graph (no cycles).
- [ ] Configuration-driven; no scattered magic constants; render params in profiles.

### 13.2 Architecture
- [ ] Architecture Compliance Checklist (§11.1) passes.
- [ ] All applicable invariants upheld + tested.
- [ ] Public contracts stable + versioned; any change ADR-backed.

### 13.3 Security
- [ ] Boundary validation on every external input.
- [ ] No secrets/PII in logs, traces, artifacts.
- [ ] Least-privilege access to storage/artifacts/runtime.
- [ ] Security Review passed; no open high-severity findings.

### 13.4 Testing
- [ ] Required test categories for the subsystem (§6) present + green.
- [ ] Golden image/PDF + reproducibility tests pass (byte-identical rebuild).
- [ ] Idempotency + recovery tests pass (crash/duplicate → no drift).
- [ ] Regression tests exist for all known defects.

### 13.5 Performance
- [ ] Meets declared performance budgets (or documented, accepted deviation).
- [ ] Load/soak validated; stable under sustained load within budget.

### 13.6 Logging
- [ ] Structured logs at correct levels; correlation id on every entry.
- [ ] No noisy/secret/PII logging; failures are actionable.

### 13.7 Metrics
- [ ] Health + throughput metrics emitted; taxonomy documented.
- [ ] Per-run cost record produced (cost accounting).

### 13.8 Tracing
- [ ] End-to-end correlation across app + worker by request/run/job id.
- [ ] Version Matrix recorded per run.

### 13.9 Documentation
- [ ] Contract docs current; runbooks written + validated.
- [ ] Progress + changelog updated; ADRs current (incl. rejected alternatives).

### 13.10 Deployment
- [ ] Cutover runbook executed/rehearsed; deploy is repeatable.
- [ ] Config + secrets provisioned correctly per environment.

### 13.11 Disaster Recovery
- [ ] Rollback rehearsed and demonstrated (retrieval to a milestone tag).
- [ ] Recovery/resume proven for interrupted runs.
- [ ] Immutable artifacts + audit enable point-in-time reconstruction.

### 13.12 Monitoring
- [ ] Production alerting live on defined failure conditions.
- [ ] Dashboards for health, throughput, cost, and errors available.
- [ ] On-call/runbook path defined for each alert.

---

## 14. Appendix

> Quick-reference checklists. They distill the sections above for daily use; the section text is
> authoritative where a checklist is terse.

### 14.1 Engineering Glossary
- **ADS** — Architecture Design Specification (architecture source of truth).
- **WP / WBS** — Work Package / Work Breakdown Structure (single-capability unit / its catalog).
- **Invariant (INV-n)** — a permanent architectural law (§3); violation = hard stop.
- **Manifest** — the immutable, validated, self-contained render contract.
- **Artifact** — an immutable, content-addressed output (image, PDF, etc.).
- **Blueprint** — pre-manifest description compiled (via resolvers) into a resolved plan.
- **Resolved Plan** — the blueprint compiler's output; input to the Manifest Builder.
- **Processing Profile** — named bundle owning render/processing parameters (Classic/Premium/Luxury/Archive/Draft).
- **Version Set / Version Matrix** — the frozen component versions pinned per run / their recorded cross-product.
- **Control Plane** — the source of truth for run/album/asset state + lineage.
- **Run** — one processing execution for an album; ≤1 active per album (INV-6).
- **Retry / Replay / Rebuild / Regenerate** — the four distinct re-execution semantics (§4.3.5).
- **Technical vs Domain events** — operational vs business event streams (INV-12).
- **Stop-and-ADR** — halt work, write an ADR, resume only after acceptance.

### 14.2 Review Checklist (per WP)
- [ ] Architecture · [ ] Code · [ ] Testing · [ ] Performance (if hot-path) · [ ] Security (if input/secrets) · [ ] Documentation — each signed off and recorded.

### 14.3 Merge Checklist
- [ ] CI green (build + lint + tests, no skips).
- [ ] Architecture Compliance Checklist (§11.1) passes.
- [ ] Required tests for the subsystem present + green (§6).
- [ ] Docs updated in the same change (§8.1).
- [ ] Commit format + WBS/ADR/phase references correct (§5.2).
- [ ] No shortcut/TODO/dead code; scope = one capability.

### 14.4 Phase Completion Checklist
- [ ] All WPs in the phase are Done + merged.
- [ ] All Quality Gates pass (Implementation Guide §11; incl. invariant compliance + version freeze).
- [ ] All Review Gates signed off (§7).
- [ ] The phase's single subsystem is complete (no partial subsystem).
- [ ] Progress + changelog updated; milestone tagged.
- [ ] No open high-severity risk introduced by the phase.

### 14.5 Release Checklist
- [ ] Production Readiness Checklist (§13) fully satisfied.
- [ ] Release Review (§7.7) passed.
- [ ] Cutover + rollback runbooks rehearsed.
- [ ] Milestone/release tag applied; changelog finalized.

### 14.6 ADR Checklist
- [ ] Context + problem stated.
- [ ] Options considered, incl. **rejected alternatives** with rationale.
- [ ] Decision + consequences recorded.
- [ ] Affected documents (ADS/Phase/WBS/Playbook) identified.
- [ ] Status set (Proposed/Accepted/Superseded); index updated.
- [ ] Accepted **before** the authorized implementation proceeds.

### 14.7 Architecture Validation Checklist
- [ ] All applicable invariants upheld (§3).
- [ ] Dependency direction correct; DAG intact.
- [ ] Domain pure; infrastructure isolated.
- [ ] Contracts stable/versioned; changes ADR-gated.
- [ ] Reserved seams additive + inert.
- [ ] No silent architecture drift (else Stop-and-ADR).

### 14.8 Testing Checklist
- [ ] Unit + integration for the WP's behaviour.
- [ ] Determinism / idempotency / reproducibility where claimed.
- [ ] Golden image/PDF where rendering is involved.
- [ ] Failure + recovery tests.
- [ ] Regression test for every fixed defect.
- [ ] No skipped/vacuous tests substituting for coverage.

### 14.9 Operational Readiness Checklist
- [ ] Structured logs + metrics + tracing live and correlated.
- [ ] Cost + Version Matrix recorded per run.
- [ ] Alerting + dashboards active; each alert has a runbook.
- [ ] Rollback + recovery rehearsed.
- [ ] Runbooks validated and current.

---

## Final Validation

- **Complements, does not duplicate.** This Playbook defines *how engineers work* (standards,
  process, checklists). It references the ADS (architecture), the Implementation Guide (discipline
  rationale), the Phase Plan (phases/milestones/invariants), and the WBS (work packages) rather than
  restating them. Invariants appear here only in operational-enforcement form (§3).
- **References are explicit.** Invariants → `WORKER_V2_PHASES.md` §3; version set → Phase Plan §5;
  work packages → `WORKER_V2_WBS.md`; DoD/quality-gate rationale → `WORKER_V2_IMPLEMENTATION_GUIDE.md`.
- **Fit to guide months of work.** It gives an engineer, on any day, a concrete answer to: how to
  structure code, when to stop, how to test, how to review, how to commit and release, and what
  "production ready" means — the operational bar for the entire build.

> **This is the final planning artifact before implementation begins.** Implementation starts only
> when the program formally initiates Phase −1 under these standards.

---

*End of Worker V2 Engineering Playbook. Planning only — no implementation. Task, progress, and
implementation artifacts are intentionally NOT created here.*
