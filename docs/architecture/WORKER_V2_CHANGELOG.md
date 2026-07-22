# Worker V2 — Changelog

> **Living document.** Records all Worker V2 changes in a semantic changelog structure.
> Complements (does not duplicate) the frozen planning suite and `WORKER_V2_PROGRESS.md`
> (which tracks *status*; this records *changes*).
> **Updated after every completed implementation phase / release.**

Sections: **[Planning](#planning)** · **[Implementation](#implementation)** · **[Release History](#release-history)**

---

## Planning

Frozen planning foundation (no code).

| Date | Document | Note |
|---|---|---|
| 2026-07-22 | Architecture Design Specification (ADS) | Architectural source of truth (26 sections + ADRs). |
| 2026-07-22 | `WORKER_V2_IMPLEMENTATION_GUIDE.md` | Execution discipline — principles, gates, DoD, workflow. |
| 2026-07-22 | `WORKER_V2_PHASES.md` | Phase plan — 18 phases, invariants, version matrix, milestones M1–M18. |
| 2026-07-22 | `WORKER_V2_WBS.md` | Work Breakdown Structure — single-capability work packages. |
| 2026-07-22 | `WORKER_V2_ENGINEERING_PLAYBOOK.md` | Operational engineering standards. |
| 2026-07-22 | `WORKER_V2_PROGRESS.md` · `WORKER_V2_CHANGELOG.md` | Living operational documents created. |

---

## Implementation

<!-- Newest first. One entry per phase (and per notable change) using the Change Entry Template. -->

### v0.0.0 — 2026-07-23 — Processing Framework (task-phase 6)

> Delivers the DECLARATIVE half of the frozen Pipeline phase (INV-5): the generic processing
> model later rendering, PDF, image, and manufacturing pipelines execute. Pure data + pure
> functions — no execution engine, no scheduling, no business logic.

**Added:**
- **`@workerv2/processing`** — the framework-independent declarative processing model:
  - **Step model (artifact-centric)** — `ProcessingStep`/`ProcessingStepSpec`: processor by
    NAME + compatible version range (engine-resolved later), named input slots bound via
    `fromArtifact(key)` (content address) or `fromStepOutput(stepId, output)` (symbolic upstream
    reference), declared output slots, capability requirements, per-step policies, JSON-safe config.
  - **Pipeline model** — `definePipeline(spec)`: the ONLY constructor. Validates ids/semver/slot
    names/policies, unique step ids, unknown/self/duplicate dependencies, step-output inputs
    reference **declared** outputs of steps the consumer **explicitly** dependsOn, and the
    dependency graph is a **DAG**. Deep-frozen; deterministic.
  - **Dependency-graph validation** — `orderStepGraph`: Kahn + lexicographic tie-breaking;
    longest-chain **stages** (mutually independent within a stage); canonical stage-monotonic
    flat order; unknown/self-dep/cycle rejection.
  - **Execution-plan model** — `compileExecutionPlan(pipeline)`: **total** (pipelines only exist
    validated) + deterministic; `ExecutionPlan` (order/stages/`PlannedStep`s) deep-frozen;
    declaration-order invariant (tested).
  - **Processing Context** — `makeProcessingContext`: immutable per-attempt data — RESOLVED
    artifact identities, expected output slots, config, frozen version pins (INV-11), injected
    `startedAt`, engine-owned `CancellationSignal` (not frozen; `NEVER_CANCELLED` neutral value).
  - **Retry model** — `RetryPolicy` (none/fixed/exponential + caps) validated declaratively;
    `delayBeforeAttempt` = pure math (no waiting).
  - **Timeout model** — `TimeoutPolicy` (attempt + overall budgets) validated; enforced by an
    engine later.
  - **Cancellation model** — `CancellationPolicy` (unsupported/cooperative/abortive + grace) +
    the read-only `CancellationSignal` contract.
  - **Failure model** — `FailureKind` (transient/permanent/timeout/cancelled), frozen
    `StepFailure` records, `FailurePolicy` (onPermanent locked to 'fail'), and the SHARED pure
    decision function `planFailureAction` → retry (with computed delay/next attempt) / fail /
    cancelled — so failure semantics can never drift between engines.
  - **Processor contracts** — `Processor` (context → explicit `ProcessorOutcome`),
    `ProcessorDescriptor`, `ProcessorResolver`, `validateProcessorOutputs` (exact-slot-match
    conformance shared by all engines).
  - **Capability requirements** — `StepCapabilityRequirement`, structurally IDENTICAL to the
    runtime's reserved `CapabilityRequirement` negotiation contract (compile-time-proven in
    tests) **without** a runtime dependency — engines feed step requirements straight into a
    future `CapabilityNegotiator`.
- **ADR-0007** — declarative processing framework decisions (+ rejected alternatives).

**Changed:** workspace wiring (tsconfig/vitest/boundaries) for `processing`.

**Removed:** Nothing (purely additive).

**Performance:** Pure in-memory validation/compilation; Kahn is O(V+E); no perf-sensitive paths.

**Security:** No secrets/PII; config/failure contexts documented JSON-safe; no new external
surface; no I/O of any kind.

**Documentation:** Package `README.md` + JSDoc; ADR-0007; ADR index; `WORKER_V2_PROGRESS.md`
(frozen Phase 9 → declarative model done).

**Testing:** **48 new tests** — retry/timeout/cancellation/failure policy validation +
deterministic delay math + the `planFailureAction` decision table; pipeline validation (happy
path, defaults, deep-freeze, determinism, capability/version carry-through, and 12 rejection
classes incl. cycles, undeclared outputs, missing dependsOn); graph/stage determinism
(declaration-order invariance, longest-chain staging); plan compilation (staging, immutability,
repeat + order invariance); context construction (freeze/defaults/live signal/spec isolation);
processor contracts (output conformance, contract-only implementability); runtime structural
compatibility (compile-time). `pnpm verify` green (**261 total**).

**Breaking Changes:** None.

**Migration Notes:** None. No execution engine exists yet — nothing consumes pipelines at run
time until the coordinator phase; all current consumers are definition-time.

**ADR References:** **ADR-0007**.

**Commit References:** _(recorded at commit — branch `worker-v2/phase-6-processing`)._

#### Phase Retrospective (task-phase 6)

- **Architectural decisions.** (1) The model is engine-neutral by construction: no runtime
  dependency — capability requirements are structurally compatible with the runtime's
  negotiation seam instead of imported, so local/distributed/replay engines all consume
  pipelines unchanged. (2) Artifact-centric I/O: steps bind content addresses or symbolic
  upstream outputs — with the write-once store (ADR-0006) this makes re-execution naturally
  idempotent. (3) Invalid pipelines are unrepresentable: one validating constructor
  (`definePipeline`), making plan compilation total and deterministic. (4) Declarative policies
  with exactly ONE shared interpretation point (`planFailureAction`) — semantics fixed now,
  execution later.
- **ADRs.** ADR-0007 (accepted), incl. rejected alternatives (runtime dependency, shipping a
  local executor, execution-time validation, file-path I/O).
- **Scope adjustments.** None against the task scope. Mapping note: this is the frozen Phase 9's
  declarative half delivered early as its own package; coordinator/scheduling/recovery/replay
  stay in the frozen Pipeline phase. Version-range MATCHING is deliberately not implemented
  (declared, opaque) — negotiation belongs to the engine per the runtime's reserved seam.
- **Remaining risks.** The engine will reveal whether the plan's stage model needs richer
  scheduling metadata (priorities, resource hints) — additive if so; `CancellationSignal` is
  poll-based (cooperative) — sufficient for INV-7-idempotent steps, revisit if push semantics
  are ever needed; capability negotiation semantics (range grammar) still undefined until the
  negotiator lands.
- **Reusable abstractions.** `orderStepGraph` (any DAG with deterministic staging),
  `planFailureAction`/`delayBeforeAttempt` (any retrying subsystem), `ProcessingContext` +
  `Processor` contracts (every processing platform: image, render/PDF, manufacturing),
  `validateProcessorOutputs` (engine conformance), `StepCapabilityRequirement` (negotiation
  input), the diamond-pipeline test fixture (engine tests later).

---

### v0.0.0 — 2026-07-23 — Artifact Platform (task-phase 5)

> Completes the content-addressed **byte** store deferred by ADR-0004/0005 — the last open piece
> of the frozen Storage & Immutable Artifact Platform. **M5 is now fully complete.**

**Added:**
- **`@workerv2/artifact-store`** — the concrete Artifact Platform on the Phase 3 storage contracts:
  - **Content addressing** — `Sha256ContentAddressing` (`sha256:<hex-digest>`), `hashBytes`/
    `formatStorageKey`/`digestOf`; deterministic, pinned by the published empty-content sha256
    test vector. Identity derives from bytes alone (INV-10) — backend-independent by construction.
  - **Replaceable backend seam** — `BlobStore` (`InMemoryBlobStore` reference): a deliberately dumb
    byte KV BELOW every guarantee, so a durable object store (e.g. R2) is a drop-in (WBS 5.1.1).
    Defensive copies isolate stored bytes from caller mutation.
  - **Write-once artifact store** — `ContentAddressedArtifactStore` (implements the new
    `StreamingArtifactStore`): `put` rejects mis-addressed content (`IntegrityError`) AND
    overwrites (`StorageError`, INV-2); `putContent`/`putStream` derive the key and are
    **idempotent** for byte-identical content (INV-7).
  - **Streaming interfaces** — `putStream` (incremental hashing; chunking never changes identity),
    `getStream` (bounded 64 KiB chunks), zero-byte stream handled.
  - **Integrity verification** — `Sha256IntegrityVerifier` (pure `Result`-based verify) +
    `getVerified` (read-time corruption guard).
  - **Artifact registry** — `InMemoryArtifactRegistry`: write-once content-address → descriptor
    index; conflicting re-registration rejected, identical re-registration a no-op (INV-7),
    descriptors deep-frozen; `byRun` lineage query.
  - **Provenance** — `describeArtifact(data, provenance, contentType?)`: single assembly point so
    key/digest/size can never disagree with the content; time injected via `provenance.createdAt`.
  - **Artifact validation** — `validateArtifactDescriptor` + `artifactDescriptorValidator`
    (untrusted-input boundary: shape + key⇄digest consistency + value-object parsing).
  - **Facade** — `ArtifactPlatform` (implements the Phase-3 `StorageAdapter`; backend injected).
- **`@workerv2/infra-contracts`** — byte-level artifact contracts (additive): `ArtifactByteStream`,
  `StreamingArtifactStore`, `ArtifactKind`/`ARTIFACT_KINDS`, `ArtifactProvenance` (Run + step +
  frozen version pins + source-asset lineage + injected `createdAt`), `ArtifactDescriptor`,
  `ArtifactRegistry`, `IntegrityVerifier`, and `IntegrityError`.
- **Reusable contract suite** — `runArtifactStoreContract(name, factory)`
  (`packages/artifact-store/test/contract/`): the compliance suite any future durable
  `StreamingArtifactStore` backend must pass.
- **ADR-0006** — content-addressed Artifact Platform decisions (+ rejected alternatives).

**Changed:** workspace wiring (tsconfig/vitest/boundaries) for `artifact-store`; `infra-contracts`
index/errors export the new contracts.

**Removed:** Nothing (purely additive).

**Performance:** Hashing is single-pass/incremental; reads return copies (immutability over micro-cost —
reference engine). `putStream` buffers in memory while hashing (a durable backend can spool);
registry queries are linear scans (index later if needed).

**Security:** No secrets/PII. Integrity-at-write + verified reads make corruption and mis-addressed
writes detectable; write-once semantics make tampering additive-only; validation guards untrusted
registry rows before they are trusted.

**Documentation:** Package `README.md` + JSDoc; ADR-0006; ADR index; `WORKER_V2_PROGRESS.md`
(frozen Phase 3 → ✅ 100%, M5 complete).

**Testing:** **50 new tests** — addressing determinism + known-vector + distinctness; the reusable
store contract (write-once, integrity-at-write, absent-key, streaming equivalence, idempotent
re-put); putContent idempotency; **backend-independence of identity** (two backends, same key);
byte-level immutability under caller mutation; corruption → `IntegrityError`; streaming round-trips
+ empty + large-chunked; registry write-once/idempotent/frozen/lineage; descriptor validation
(accept + 15 rejection branches); integrity verifier; platform end-to-end
(describe → put → register → verify → byRun). `pnpm verify` green (**213 total**).

**Breaking Changes:** None.

**Migration Notes:** None. The reference engine is in-memory; a durable `BlobStore`/registry
implements the same seams later — proven via `runArtifactStoreContract` — with no change above.

**ADR References:** **ADR-0006**.

**Commit References:** _(recorded at commit — branch `worker-v2/phase-5-artifact-platform`)._

#### Phase Retrospective (task-phase 5)

- **Architectural decisions.** (1) One addressing scheme (`sha256:<hex>`), namespaced into the key
  so future algorithms are additive. (2) The replaceable-backend seam is a *dumb* `BlobStore` with
  every guarantee (addressing, write-once, integrity, streaming) implemented ABOVE it — that is
  what makes artifact identity provably backend-independent. (3) Write-once split into two write
  modes: strict `put` (explicit key; rejects mismatch + overwrite) vs idempotent content-derived
  writes (`putContent`/`putStream`) — retry-safe by construction, no overwrite possible since
  identical bytes ⇒ identical identity. (4) Artifacts are first-class immutable objects: descriptor
  assembly lives in exactly one place (`describeArtifact`), provenance (Run / VersionSet pins /
  Processing Step / lineage / injected time) is typed and validated, and the registry is write-once
  with structural-idempotence.
- **ADRs.** ADR-0006 (accepted), recording the four decisions above plus rejected alternatives
  (UUID-addressed keys; strict-reject of identical re-writes; free-form provenance).
- **Scope adjustments.** None against the task scope. The task's "Phase 5" maps onto the frozen
  Phase 3 byte store (per the numbering note carried since task-phase 4) — completing M5 rather
  than starting the frozen Image Platform. WBS 5.2.2's *event wiring* (artifact writes → audited
  asset transitions) is deferred to the first producing pipeline, since both halves (Control-Plane
  transitions, artifact substrate) now exist and only a producer can connect them meaningfully.
- **Remaining risks.** Durable backends (BlobStore/registry/persistence) are still process-local —
  mitigated by the reusable contract suite; `putStream` buffers while hashing (spooling is a
  backend concern); registry lookups are linear (fine at reference scale); unreferenced-artifact
  archival/GC semantics reserved.
- **Reusable abstractions.** `BlobStore` (any byte backend), `runArtifactStoreContract` (backend
  compliance suite), `Sha256ContentAddressing`/`IntegrityVerifier` (any subsystem needing stable
  content identity), `ArtifactProvenance`/`ArtifactDescriptor`/`ArtifactRegistry` (render/image/
  manufacturing phases all attach lineage through these), `describeArtifact` (single descriptor
  assembly), `ArtifactByteStream` (platform-neutral streaming primitive).

---

### v0.0.0 — 2026-07-23 — Persistence Engine (task-phase 4)

> Completes the State Store deferred by ADR-0002/0004 — part of the frozen Storage phase (M5),
> **not** the frozen Product Platform.

**Added:**
- **`@workerv2/persistence`** — the concrete in-memory **State Store** on the Phase 3 contracts:
  - **Storage primitive** — generic, domain-ignorant `RecordTable<T>` (`InMemoryRecordTable`),
    isolating storage from persistence models so backends are interchangeable.
  - **Optimistic locking** — `TableTransaction` (versioned rows + identity map) → `ConcurrencyError`.
  - **Repositories** — `TransactionalAlbum/Asset/RunRepository`, returning domain aggregates via
    the explicit mappers (DTOs never escape; reconstruction via the domain so invariants hold).
  - **Unit of Work** — `InMemoryUnitOfWork` (atomic commit/rollback across repositories + audit +
    run-registry + artifact metadata) + `StateStore.transaction(...)` + `asPersistenceAdapter()`.
  - **Run Registry** — durable one-active-run enforcement (INV-6): domain pre-check + commit-time guard.
  - **Audit persistence** (append-only, INV-9) + **write-once artifact-metadata** persistence (INV-2/10).
  - **Infrastructure validation** — `validateAlbum/Asset/RunRecord` (unknown → DTO) + `Validator` objects.
- **`@workerv2/control-plane`** — domain-owned **reconstitution API**: `Album/Asset/Run.reconstitute(snapshot)`
  (rebuild from persisted state, no events, invariants enforced) + `*Snapshot` types.
- **`@workerv2/infra-contracts`** — concrete **inbound** mappers (`recordToAlbum/Asset/Run/Audit`)
  + ready-made `RecordMapper` objects (`albumMapper` …), completing the anti-corruption layer.
- **ADR-0005** — in-memory persistence engine + domain reconstitution.

**Changed:** workspace wiring (tsconfig/vitest/boundaries) for `persistence`; `infra-contracts` mapper module gained the inbound half; control-plane aggregates gained `reconstitute`.

**Removed:** Nothing (purely additive).

**Performance:** In-memory, single-process; optimistic-lock validation is O(changed rows). Reference engine — durable backends tune later.

**Security:** No secrets/PII; DTOs/records JSON-safe. Domain stays persistence-independent (verified — no persistence import in `control-plane`).

**Documentation:** Package `README.md` + JSDoc; ADR-0005; `WORKER_V2_PROGRESS.md` updated (Phase 3 storage → engine done, 85%).

**Testing:** **21 new tests** — save/load round-trips, **optimistic concurrency** (stale-update + insert-conflict), rollback atomicity, corrupt-record → `PersistenceError`, **Run Registry INV-6** (block + release + different-albums), audit append + rollback, artifact write-once, infra validation, domain reconstitution, and **serialization-symmetry** (save → load → save). `pnpm verify` green (**163 total**).

**Breaking Changes:** None.

**Migration Notes:** None. The engine is in-memory (process-local); a durable backend implements the same contracts later without changes above the `RecordTable` seam.

**ADR References:** **ADR-0005** (in-memory reference engine; reconstitution owned by the domain; storage isolated from models).

**Commit References:** _(recorded at commit — branch `worker-v2/phase-4-persistence`)._

---

### v0.0.0 — 2026-07-22 — Phase 3 · Infrastructure Contracts & Persistence Foundation

**Added:**
- **`@workerv2/infra-contracts`** — the abstraction layer between the pure domain and future
  infrastructure (contracts + DTOs + outbound mappers + infra events; **no** concrete storage/DB):
  - **Repositories** — `Repository<T,Id>` + `AlbumRepository`/`AssetRepository`/`RunRepository`
    (return domain objects only), `RunStateQuery` (read side of INV-6), append-only `AuditSink` (INV-9).
  - **Unit of Work / Transactions** — generic `UnitOfWork` (transactional `RepositoryFactory`),
    `Transaction`, `TransactionManager.withUnitOfWork(...)`.
  - **Repository factory** — `RepositoryToken` + `repositoryToken()`; tokens `ALBUM_/ASSET_/RUN_REPOSITORY`.
  - **DTOs** — `AlbumRecord`/`AssetRecord`/`RunRecord`/`AuditRecordDto` (flat, JSON-safe persistence models).
  - **Mappers (anti-corruption layer)** — `RecordMapper<D,R>` contract + concrete **outbound**
    mappers (`albumToRecord`/`assetToRecord`/`runToRecord`/`auditToRecord`). Inbound is contract-only.
  - **Storage contracts** — write-once, content-addressed `ArtifactStore` (INV-2/INV-10),
    `StorageKey`, `ContentAddressing`, `StorageAdapter`.
  - **Adapter seams** — `PersistenceAdapter`, `StorageAdapter`.
  - **Infra technical events** — `INFRA_EVENTS` + `makeInfraEvent` (INV-12) + `TechnicalEventSink`.
  - **Validation contracts** — `Validator<T>` + `valid`/`invalid`.
- **Runtime:** interfaces-only capability **version-negotiation** hooks
  (`CapabilityRequirement`/`Offer`/`NegotiationResult`/`CapabilityNegotiator`) — additive.
- **ADR-0004** — Phase 3 delivers infrastructure contracts, not implementations.

**Changed:** workspace wiring (tsconfig/vitest/boundaries) for `infra-contracts`; runtime index re-exports the negotiation contracts.

**Removed:** Nothing (purely additive).

**Performance:** Pure contracts + deterministic mappers/factories; no perf-sensitive paths.

**Security:** No secrets/PII; DTOs/events JSON-safe; no new external surface. Domain stays infrastructure-independent (verified — no infra import in `control-plane`).

**Documentation:** Package `README.md` + JSDoc on every public export; ADR-0004; `WORKER_V2_PROGRESS.md` updated (Phase 3 → contracts done, M5).

**Testing:** **19 new tests** — outbound mappers, infra events + validation, and the persistence/storage contracts exercised via in-memory **test doubles** (repositories, unit of work, transaction manager, write-once artifact store) + a reference capability negotiator. `pnpm verify` green (**142 tests total**).

**Breaking Changes:** None.

**Migration Notes:** None. Concrete persistence/storage adapters + domain reconstitution (inbound mappers) are deferred to a later phase (ADR-0002 + ADR-0004).

**ADR References:** **ADR-0004** (contracts-not-implementations; deferred concrete store + reconstitution; negotiation hooks).

**Commit References:** _(recorded at commit — branch `worker-v2/phase-3-infra-contracts`)._

---

### v0.0.0 — 2026-07-22 — Phase 2 · Worker Runtime Platform

**Added:**
- **`@workerv2/runtime`** — the generic hosting framework (no domain behavior, no jobs, no coordinator):
  - **`Runtime`** — build with injected `now`/`nextId` (deterministic); `create()` validates the
    dependency graph and fails fast; `start()`/`stop()` are **idempotent** and drive services in
    deterministic dependency order.
  - **Lifecycle** — `RUNTIME_MACHINE` (`created → starting → running → stopping → stopped`, `+ failed`).
  - **Service registry + dependency graph** — `ServiceRegistry`, `orderServices` (Kahn's algorithm,
    name-sorted tie-breaking; rejects missing deps + cycles).
  - **Capability registry** — `CapabilityRegistry` (de-duplicated, name-sorted).
  - **Plugin framework** — `Plugin`/`PluginContext`/`applyPlugins` (additive registration of
    services + capabilities + DI bindings; no concrete plugins — those are Phase 16).
  - **DI integration** — `createRuntimeContainer` + `LoggerToken`/`ConfigToken`/`MetadataToken`.
  - **Runtime metadata** — immutable `RuntimeMetadata`; **config** — `readRuntimeConfig` (injected env).
  - **Health integration** — `buildRuntimeHealth` over `@workerv2/health`.
  - **Technical events** — `TechnicalEventBus` (sync, isolated listeners) + `RUNTIME_EVENTS` (INV-12).
- Workspace wiring for the new package; **ADR-0003** (runtime dependency boundary + plugin-framework scope).

**Changed:** `worker/tsconfig.json`, `worker/vitest.config.ts`, `worker/scripts/check-boundaries.mjs` extended for `runtime`.

**Removed:** Nothing (purely additive).

**Performance:** In-memory hosting; deterministic startup ordering; no perf-sensitive paths.

**Security:** No secrets/PII; event payloads JSON-safe; runtime introduces no new external surface.

**Documentation:** Package `README.md` + JSDoc on every public export; ADR-0003; `WORKER_V2_PROGRESS.md` updated (Phase 2 → Done, M4).

**Testing:** **23 new tests** (config/metadata, lifecycle machine, dependency graph, registries, plugins, event bus, and end-to-end `Runtime` start/stop/idempotency/health/failure). `pnpm verify` green (**123 tests total**).

**Breaking Changes:** None.

**Migration Notes:** None. The runtime hosts nothing yet (no services/plugins ship in-tree); it is the framework later phases plug into.

**ADR References:** **ADR-0003** — Runtime dependency boundary & plugin framework scope. (Runtime depends on `control-plane` for generic contracts only; framework now, concrete plugins Phase 16.)

**Commit References:** _(recorded at commit — branch `worker-v2/phase-2-runtime`)._

---

### v0.0.0 — 2026-07-22 — Phase 1 · Control Plane & Domain Lifecycles

**Added:**
- **`@workerv2/control-plane`** — the pure Control Plane **domain** (framework-independent,
  immutable, deterministic, no I/O; depends only on `contracts`/`utils`/`errors`):
  - **Value objects** — branded ids (`AlbumId`/`AssetId`/`RunId`/`ActorId`/`EventId`/`AuditId`),
    `Timestamp` (injected; no `Date.now`), `Actor`, `DomainContext`.
  - **State machines** — generic `defineStateMachine` engine + `ALBUM_MACHINE` (Rec 13),
    `ASSET_MACHINE` (Rec 14), `RUN_MACHINE`; illegal edges return `TransitionError` via `Result`.
  - **Aggregates** — immutable `Album`, `Asset`, `Run`; every op returns a new aggregate +
    `DomainEvent` + `AuditRecord`. `Run` freezes a `VersionSet` for its whole life (INV-11).
  - **Events** — separate `DomainEvent` / `TechnicalEvent` families with `kind` discriminator +
    guards (INV-12).
  - **Audit** — `AuditRecord` + `recordTransition` (INV-9).
  - **Version registry model** — `VersionSet` (validated, immutable, `require()` gate) +
    `VERSION_COMPONENTS`.
  - **Policy** — `canStartRun` (one active run per album, INV-6).
- Workspace wiring for the new package (tsconfig paths, vitest alias, boundary ALLOWED map).
- **ADR-0002** — records the domain-first / persistence-deferred scope decision.

**Changed:** `worker/tsconfig.json`, `worker/vitest.config.ts`, `worker/scripts/check-boundaries.mjs` extended for `control-plane`.

**Removed:** Nothing (purely additive).

**Performance:** Pure in-memory domain; no perf-sensitive paths.

**Security:** No secrets/PII; audit `metadata` + event `payload` documented as JSON-safe.

**Documentation:** Package `README.md` + JSDoc on every public export; ADR-0002; `WORKER_V2_PROGRESS.md` updated (Phase 1 → Done, M3).

**Testing:** **50 new domain tests** (value objects, state machine, lifecycles, events, audit, version-set, policy, aggregates) — determinism, immutability, and invariant compliance asserted. `pnpm verify` green (**100 tests total**).

**Breaking Changes:** None.

**Migration Notes:** None. Domain has no persistence; the deferred State Store / Run Registry (ADR-0002) arrive in Phase 2.

**ADR References:** **ADR-0002** — Control Plane: domain model first, persistence deferred.

**Commit References:** _(recorded at commit — branch `worker-v2/phase-1-control-plane`)._

---

### v0.0.0 — 2026-07-22 — Phase 0 · Foundation & Contracts

**Added:**
- Isolated `worker/` **pnpm workspace** (own root) with shared strict TypeScript (`tsconfig.base.json` + solution `tsconfig.json`), ESLint (flat) + Prettier, Vitest, and `.gitignore`.
- **10 product-agnostic foundation packages** (`@workerv2/*`), one capability each:
  `contracts` (shared types / neutral home), `utils` (Result + invariants + object helpers),
  `errors` (typed error taxonomy), `config` (config framework + env validation, injected
  validator), `logger` (Logger abstraction + console/noop), `metrics` (Metrics abstraction +
  noop/in-memory), `health` (check registry), `flags` (feature-flag framework), `di`
  (DI container foundation), `build-info` (version + build metadata).
- **Authoritative boundary/cycle checker** `scripts/check-boundaries.mjs` (dependency direction,
  declared-deps, acyclic package graph — zero deps).
- **CI workflow** `.github/workflows/worker-v2-ci.yml` (install → typecheck → boundaries → lint → format → test).
- **ADR system** `docs/architecture/adr/` (README + `0000` template + **ADR-0001** — foundation scope & layout).
- Reserved (empty) `worker/apps/`, `worker/ops/`, and the DX-generator seam in `worker/scripts/`.

**Changed:**
- `worker/README.md` updated from the Phase −1 placeholder to document the foundation workspace.

**Removed:** Nothing (Phase 0 is purely additive on top of the Phase −1 clean slate).

**Performance:** No perf-sensitive code. Vitest suite runs in <1s.

**Security:** Product-agnostic foundation; no secrets/PII. Error `context` + log `fields` documented as JSON-safe / secret-free (Playbook §4.3.2).

**Documentation:** Per-package `README.md` + JSDoc on every public export; ADR-0001; `WORKER_V2_PROGRESS.md` updated (Phase 0 → Done, M2, stats).

**Testing:** **50 Vitest tests** across all 10 packages, every exported component covered. Full gate `pnpm verify` (typecheck + boundaries + lint + format + test) green.

**Breaking Changes:** None.

**Migration Notes:** None. First `worker/` install requires `cd worker && pnpm install` (pnpm v11 build allowlist includes `esbuild`).

**ADR References:** **ADR-0001** — Worker V2 foundation scope & repository layout (records that Phase 0 delivers generic *foundations* while later phases retain their product-wired *platforms*).

**Commit References:** _(recorded at commit — branch `worker-v2/phase-0-foundation`)._

---

### v0.0.0 — 2026-07-22 — Phase −1 · Worker Reset

**Added:**
- `worker/README.md` — placeholder marking the emptied worker area, awaiting the Phase 0 foundation.
- `docs/architecture/execution/PHASE_-1_EXECUTION_PLAN.md` — Phase −1 execution plan.
- `docs/architecture/execution/PHASE_-1_DEPENDENCY_INVENTORY.md` — WBS 1.1.1 deliverable (V1 surface, coupling, behaviors to re-home).
- Git tag `worker-v1-final` — rollback anchor at `d325f28` (complete V1 tree).

**Changed:**
- Root `tsconfig.json` — removed the now-dead `"worker"` entry from `exclude`.

**Removed:**
- The entire legacy **Worker V1** `worker/` tree: boot (`index.ts`), queue wiring (`queue.ts`), 6 jobs (`image-hardening`, `album-pdf`, `cover-thumbnail`, `blueprint-thumbnail`, `pdf-recovery`, `r2-cleanup`), libs (`image.ts`, `observability.ts`), infra (`env.ts`, `r2.ts`, `supabase.ts`, `health-server.ts`), and V1-specific toolchain/config (`package.json`, lockfiles, `pnpm-workspace.yaml`, `tsconfig.json`, `.env.example`, `.puppeteerrc.cjs`).

**Performance:** N/A (removal only).

**Security:** No secret/PII exposure; no security surface added. App-side data plane and secrets untouched.

**Documentation:** `WORKER_V2_PROGRESS.md` updated (Phase −1 → Done, M1 complete, stats/activity). Execution plan + dependency inventory authored.

**Testing:** App typecheck `npx tsc --noEmit` → exit 0. Verified: no legacy V1 file remains; no `src/**` import of `worker/`; no `worker` reference left in root `tsconfig.json`; CI/lint/package config unchanged (valid by preservation).

**Breaking Changes:** Background processing is paused until Worker V2 is delivered (enqueued jobs have no consumer). Intended reset consequence; no data loss. Tracked as risk RSK-1 in `WORKER_V2_PROGRESS.md`.

**Migration Notes:** None. Database (`pgboss` schema, `photos`/`album_pdfs` columns) intentionally untouched — reconciled in a later phase (no ad-hoc migration; Playbook SC-7).

**ADR References:** None (no architecture change; the reset is prescribed by the frozen Phase Plan).

**Commit References:** _(recorded at commit — branch `worker-v2/phase--1-worker-reset`)._

---

## Release History

_No releases yet._

<!-- Tagged releases (semantic Platform Version) recorded here, newest first. -->

---

## Change Entry Template

```
### <Platform Version> — <YYYY-MM-DD> — Phase <N> <Name>

**Added:**        —
**Changed:**      —
**Removed:**      —
**Fixed:**        —
**Performance:**  —
**Security:**     —
**Documentation:**—
**Testing:**      —
**Breaking Changes:** None
**Migration Notes:**  None
**ADR References:**   —
**Commit References:**—
```

---

## Versioning Policy

Semantic versioning `MAJOR.MINOR.PATCH`:
- **MAJOR** — incompatible public-contract change (ADR-gated).
- **MINOR** — backward-compatible capability added.
- **PATCH** — backward-compatible fix.

Worker V2 tracks **independent version streams** (see `WORKER_V2_PHASES.md` §5 — the Version Matrix).
Each is versioned and frozen per run (INV-11); a behaviour change requires a version bump + a changelog entry.

| Version stream | Scope | Frozen by |
|---|---|---|
| **Platform Version** | The overall Worker V2 release (tags, this changelog). | Release |
| **Worker Runtime Version** | Runtime host, DI, capability/handler contract. | Phase 2 |
| **Manifest Version** | Manifest schema (the render contract). | Phase 7 |
| **Blueprint Version** | Blueprint + template + theme resolution. | Phase 6 |
| **Image Engine Version** | Image validation/canonicalization/derivatives. | Phase 5 |
| **PDF Engine Version** | Render/PDF engine. | Phase 8 |
| **Product Version** | Product catalog + materials + pricing. | Phase 4 |
| **Theme Version** | Theme catalog. | Phase 6 |
| **Processing Profile Version** | Classic/Premium/Luxury/Archive/Draft render params. | Phase 4 |

> Component version bumps are recorded in the relevant phase's Implementation entry and reflected in
> each run's Version Matrix. The Platform Version advances only at a tagged release.

---

_This document is updated after every completed implementation phase / release._
