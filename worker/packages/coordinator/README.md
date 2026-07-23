# @workerv2/coordinator

The Worker V2 **Coordinator Platform** — the deterministic execution coordinator that
orchestrates Manifest/Pipeline execution **without performing any processing itself**. It
consumes a Manifest (or any validated pipeline) and manages execution state, scheduling
decisions, retries, timeouts, progress, and events using the declarative policies already
frozen in `@workerv2/processing`. Pure data + pure functions: it **decides and records**; an
engine acts.

> **Scope (task-phase 10 / the frozen Phase 9 remainder — Coordinator/engine).** Execution
> State model, run + node state machines, dependency scheduler, ready queue, node lifecycle,
> retry orchestrator, timeout state tracking, cancellation propagation, progress model,
> execution journal, event publication contracts, coordinator interfaces, resume model, replay
> model, coordinator validation. **Not here:** processor execution, rendering, PDF generation,
> image processing, artifact loading, storage/persistence, queue, networking, timers.

## The one idea

The coordinator is a **pure, deterministic reducer** over an immutable `ExecutionState`,
**event-sourced** through an append-only **Execution Journal**. Every command validates its
preconditions, decides a list of journal entries, and folds them via the single state-mutation
function `applyJournalEntry`. Because that fold is the ONLY way state changes:

- **Determinism** — identical manifests + identical injected times → byte-identical journals
  and states (scheduling walks the processing framework's canonical Kahn order).
- **Resume** (INV-7) — re-folding a persisted journal reconstructs the exact prior state with
  no drift; a tampered journal (out-of-order seq, illegal transition) is rejected.
- **No infrastructure** — the coordinator holds no mutable state, arms no timer, touches no
  storage/queue/network. Time is injected into every command; retry backoff and timeouts are
  pure offsets of an injected `Timestamp`. Infrastructure adapters (single-process,
  distributed, queue-backed) DRIVE it through the stable public API — it changes for none.

## Boundaries

Depends on the foundation leaves; on `@workerv2/control-plane` (`RunId`/`Timestamp`/`VersionSet`,
the **reused** `RUN_MACHINE`, and the state-machine engine); on `@workerv2/infra-contracts`
(`StorageKey`); on `@workerv2/processing` (the **reused** declarative model — `ExecutionPlan`,
policies, the shared `planFailureAction`, `ProcessingContext`, `ProcessorResolver`,
`orderStepGraph`); and on `@workerv2/manifest` (consumes a Manifest via its lossless pipeline
bridge). It takes **no** runtime dependency (any engine drives it), and **no**
storage/persistence/artifact-store/queue/network/timers.

## Design

- **Execution State** (`ExecutionState`) — the immutable, serializable snapshot: run status (a
  Control-Plane `RunState`), per-node `NodeExecution` records keyed by Manifest node id (the
  primary execution identity), and the fold counter `seq`. Holds no topology (that is the
  `ExecutionGraph`) and no history (that is the journal).
- **Run + node state machines** — the run reuses the Control Plane's `RUN_MACHINE` (INV-8: one
  source of truth). The per-node `NODE_MACHINE` (`pending → ready → running →
succeeded|failed|cancelled|skipped`, with `running → ready` for a retry) is enforced on every
  journal fold, so illegal transitions are impossible.
- **Dependency scheduler + Ready Queue** (`computeReadyQueue`) — a pure query returning the
  deterministically-ordered `dispatchable` nodes (ready, backoff elapsed, run live, within an
  optional declarative `maxInFlight`) and the `waiting` nodes still gated by a retry `readyAt`.
- **Retry orchestrator** — reuses the processing framework's shared `planFailureAction`, so
  retry semantics can never drift from the pipeline model. A retry is a `node.retry-scheduled`
  entry whose backoff is a **future `readyAt`** (never a timer).
- **Timeout state tracking** — dispatch records `attemptDeadline`/`overallDeadline` as pure
  offsets of the injected start time; `dueTimeouts(now)` reports elapsed budgets and `tick(now)`
  converts them into `timeout` failures through the same orchestrator. No timer fires.
- **Cancellation propagation** — `requestCancellation` begins a cancel drain: un-started nodes
  are cancelled immediately, in-flight nodes settle, and the run finalizes once quiescent.
- **Progress model** (`progressOf`) — a pure projection: counts by state, terminal fraction,
  settled flags.
- **Execution Journal** — `JournalEntry`/`JournalKind` + `applyJournalEntry` (the single,
  validating, total state mutator). Every transition is recorded.
- **Event publication contracts** — `ExecutionEvent` + `ExecutionEventPublisher` (a seam an
  adapter implements). Events are DERIVED from journal entries (`execution.<kind>`), so the
  published stream and the recorded history can never disagree. Distinct from the Control
  Plane's domain events (INV-12).
- **Resume model** (`resumeFromJournal`) — re-fold a persisted journal into the exact state.
- **Replay model** (`describeReplay` / `seedReplay`) — the semantics of **Retry / Replay /
  Rebuild / Regenerate** (Rec 18) as data + a seed. `retry` reuses succeeded outputs and re-runs
  only the rest; `replay`/`rebuild` seed a clean run on the same frozen versions; `regenerate`
  is a documented seam (a new manifest needs a new coordinator).
- **Coordinator validation** (`validateExecutionState`) — the untrusted-state gate: node set
  matches the graph, the dependency rule holds, success records outputs, run status agrees with
  node states.
- **Coordinator façade** (`createCoordinator` / `coordinatorFromManifest`) — binds a run's graph
  and frozen `VersionSet` once, then exposes the pure transition/query API. `dispatch` returns
  the resolved `ProcessingContext` an engine hands its processor; `validateProcessors` accepts a
  `ProcessorResolver` to check resolvability **without ever executing** anything.
