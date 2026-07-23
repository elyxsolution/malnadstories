# ADR-0011 — Deterministic execution Coordinator (event-sourced reducer, no infrastructure)

- **Status:** Accepted
- **Date:** 2026-07-23
- **Phase:** 9 (Pipeline & Coordinator Platform — the Coordinator/engine remainder; task-phase 10)
- **Deciders:** Chief Software Architect, Worker V2

## Context

Task-phase 6 delivered the DECLARATIVE half of the frozen Pipeline phase (`@workerv2/processing`
— steps, pipelines, plans, policies, `planFailureAction`, `ProcessingContext`, processor
contracts) with no engine. This task-phase builds the **Coordinator**: the deterministic
orchestrator that consumes a Manifest and manages execution state, scheduling, retries,
timeouts, cancellation, progress, and events — WITHOUT performing any processing (no processor
execution, rendering, PDF, image, storage, queue, network, or timers; time injected).

Decisions needed: (1) the coordinator's execution model and how it changes state; (2) how it
stays free of all infrastructure coupling while still being drivable by single-process,
distributed, or queue-backed adapters; (3) how determinism, resume, and replay are guaranteed;
(4) what the coordinator binds to (a Manifest specifically, or the general pipeline).

## Decision

**1. The coordinator is a pure, event-sourced reducer; the Execution Journal is the single
state-mutation path.** Every command validates preconditions, decides a list of `JournalEntry`s,
and folds them into the next `ExecutionState` through the ONE function `applyJournalEntry`
(which enforces contiguous sequence + legal run/node transitions). State is therefore always the
fold of the journal. The payoff is decisive: **Resume** (INV-7) is literally re-folding a
persisted journal — the reconstructed state is provably identical, and a tampered journal is
rejected rather than yielding a nonsense state; there is no second state-writing code path that
could diverge from the recorded history.

**2. No infrastructure coupling — the coordinator DECIDES and RECORDS; an engine ACTS.** It
holds no mutable state, arms no timer, and performs no I/O. Time is INJECTED into every command
(`ctx.at: Timestamp`); retry backoff is a FUTURE `readyAt` and timeouts are pure offsets of an
injected start time, surfaced by `dueTimeouts(now)` and applied by `tick(now)`. The dependency
graph is bound as pure topology (`ExecutionGraph`); execution state is a separate serializable
value; scheduling (`computeReadyQueue`) is a pure query over graph + state + `now`, walking the
processing framework's canonical Kahn order — so **scheduling is deterministic for identical
manifests**. The boundary checker confirms the package depends on NO runtime/persistence/
storage/artifact-store/queue/network. Infrastructure adapters DRIVE the coordinator through its
stable public API; it changes for none of them.

**3. Determinism, retry, and events reuse the frozen processing model instead of re-deriving
it.** Node ids are Manifest node ids (`StepId`); the retry orchestrator reuses the shared
`planFailureAction`, so retry/timeout/cancellation semantics can never drift from the pipeline
model; the ready queue reuses `orderStepGraph`'s ordering; `dispatch` builds the run's
`ProcessingContext` via `makeProcessingContext` with inputs RESOLVED from recorded upstream
outputs. Published `ExecutionEvent`s are DERIVED from journal entries (`execution.<kind>`), so
the event stream can never disagree with the recorded history, and they stay distinct from the
Control Plane's domain events (INV-12).

**4. The coordinator binds to a validated pipeline; a Manifest is consumed through its lossless
bridge.** The core binds an `ExecutionGraph` compiled from a `ProcessingPipeline`, so it can
drive ANY pipeline (image, render, manufacturing) unchanged. `coordinatorFromManifest` bridges a
compiled Manifest via `toPipeline` (ADR-0010) — keeping orchestration completely separate from
processing execution while making "consume a Manifest" first-class. **Replay** semantics (Rec
18) are data (`describeReplay`) plus a seed (`seedReplay`): `retry` reuses succeeded outputs and
re-runs only the rest; `replay`/`rebuild` seed a clean run on the SAME frozen versions (the
Version Matrix is the reproduction guarantee); `regenerate` is a documented seam (a new manifest
needs a new coordinator).

## Options Considered

1. **Event-sourced pure reducer bound to a pipeline + Manifest bridge (chosen).**
2. **A stateful coordinator object that owns the run and mutates in place.** Rejected: mutable
   orchestration state is the exact V1 problem; it defeats determinism, makes resume a bespoke
   checkpoint mechanism, and cannot be driven identically by different adapters.
3. **The coordinator executes processors (accepts a `ProcessorResolver` and calls `process`).**
   Rejected: the phase brief forbids processor execution here — that welds orchestration to a
   runtime and to I/O. The coordinator instead BUILDS the `ProcessingContext` and can VALIDATE
   that processors resolve, but never runs them; an engine/adapter does.
4. **A timer/scheduler-driven engine (arm timeouts, sleep for backoff).** Rejected: timers are
   infrastructure and non-deterministic. Injected time + `readyAt`/deadline offsets + `tick`
   give identical behaviour with zero timers, and let a queue-backed adapter decide WHEN to feed
   the next `now`.
5. **A bespoke coordinator retry/timeout vocabulary.** Rejected: it would drift from the
   processing model. Reusing `planFailureAction`/`RetryPolicy`/`TimeoutPolicy` keeps one source
   of truth (same reasoning as the manifest reusing processing contracts, ADR-0010).
6. **State carries its own journal inside it.** Rejected: it bloats the checkpoint and
   duplicates history. Keeping state as the small fold and the journal as the separate log makes
   both serializable and makes resume a clean re-fold.

## Consequences

- **Positive:** a run is now orchestratable end-to-end to a rendered artifact by any adapter,
  deterministically and idempotently; crashes resume from the journal with no drift; the
  scheduler, retry, timeout, cancellation, progress, event, resume, replay, and validation
  models are all pure and testable in isolation; INV-5 (declarative), INV-6 (one-active-run is
  the Control Plane's; the coordinator drives a single run), INV-7 (idempotent resume), INV-8
  (run state reuses `RUN_MACHINE`), INV-11 (frozen `VersionSet` bound at creation) hold.
- **Negative / trade-offs:** the coordinator does not itself run processors, wait, persist, or
  publish — an infrastructure adapter (a later phase) must supply the effect loop (dispatch →
  `processor.process` → report; feed `tick`; store the journal; forward events). `maxInFlight`
  is advisory scheduling data, not enforced concurrency. Fail-fast is the failure policy
  (a terminal node failure skips the rest); per-branch partial completion is a future option.
- **Follow-ups / remaining risks:** a concrete `CapabilityNegotiator` (the runtime's reserved
  seam) and the single-process/distributed adapters are later work; the Observability phase
  (Phase 10) records the run graph/timeline and cost from the coordinator's journal + events;
  one-active-run enforcement lives in the Control Plane's Run Registry, which the driving adapter
  consults before starting a run.

## Compliance

Framework-independent, immutable (deep-frozen states/entries/plans), deterministic (no clock/
timers/randomness/env/IO — verified by grep + the boundary checker; the only `new Date` is pure
arithmetic on an injected timestamp), event-sourced (single `applyJournalEntry` mutation path),
Manifest-node-id-addressed. Orchestrates work; executes none. Reuses the frozen Processing model
and the Control Plane run machine rather than duplicating them. Upholds INV-5/6/7/8/9(journal)/11.
