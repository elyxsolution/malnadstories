# ADR-0012 — Execution Adapter drives the pure Coordinator through replaceable seams

- **Status:** Accepted
- **Date:** 2026-07-23
- **Phase:** 9 (Pipeline & Coordinator Platform — the concrete driving adapter; task-phase 11)
- **Deciders:** Chief Software Architect, Worker V2

## Context

Task-phase 10 delivered the Coordinator as a pure, event-sourced reducer (ADR-0011): it DECIDES
and RECORDS but executes nothing. Something must actually DRIVE a run — invoke processors, feed
outcomes back, persist the journal, publish events, advance time. This task-phase builds that
**Execution Adapter** as the infrastructure layer, with a hard requirement that the Coordinator
stays completely pure and its decisions stay deterministic, and that the adapter introduce no
business behaviour, no rendering/PDF/image work, and no storage/DB/queue/network implementation.

Decisions needed: (1) where the effect/purity boundary sits and how the adapter avoids changing
the Coordinator's decisions; (2) how time, waiting, persistence, and publication are structured
so future single-process and distributed adapters share the same Coordinator API; (3) how the
adapter contacts "the work" without implementing any of it; (4) the capability-negotiation
policy (the runtime reserved the contract but deferred the algorithm).

## Decision

**1. A tiny, sequential effect loop; every decision stays the Coordinator's.** The driver
(`runToCompletion`/`pump`) does exactly four things per sweep: tick due timeouts, ask the
Coordinator which nodes are dispatchable NOW, and for each (in the Coordinator's canonical order)
negotiate → resolve → dispatch → invoke → report. It never re-orders, batches, or second-guesses
the Coordinator. Because the loop is serial and feeds injected time, the sequence of Coordinator
commands — and therefore the journal — is deterministic; a test proves the adapter-produced
journal is byte-identical to the pure Coordinator's own driver output. The adapter only chooses
WHEN to feed the next `now` and performs the effects.

**2. All side effects live behind replaceable seams; the Coordinator API never changes.** Time
(`Clock`), waiting (`Waiter`), persistence (`JournalStore`), and publication (`EventSink`) are
interfaces the adapter depends on; it ships small, dependency-free reference implementations
(`systemClock`/`manualClock`, `immediateWaiter`/`clockAdvancingWaiter`, `InMemoryJournalStore`,
`InMemoryEventSink`). The single stateful piece, `ExecutionSession`, is the ONLY place a
Coordinator step's effects are applied: advance the held state, persist the entries, publish the
events (persist-then-publish, since the journal is the source of truth). A future distributed or
queue-backed adapter swaps the seam implementations and parallelizes dispatch — driving the SAME
Coordinator through the SAME public API.

**3. The adapter implements no work and no policy.** Processors are INJECTED by the caller and
held in a name-keyed resolver (`InMemoryProcessorRegistry implements ProcessorResolver`); the
adapter's only contact with the work is `invokeProcessor`, which calls `Processor.process()` and
returns its outcome unchanged — with one robustness rule: a processor that THROWS is normalized
into a `transient` `StepFailure`, so the loop always gets in-band data and the Coordinator's retry
policy (not the adapter) decides what happens. Retry/timeout/cancellation/fail-fast all remain the
Coordinator's; the adapter adds none.

**4. Capability negotiation before dispatch, with a minimal deterministic policy.** The runtime
reserved `CapabilityNegotiator` (interfaces only); this adapter provides the concrete
`DefaultCapabilityNegotiator` and negotiates each node's required capabilities against the host's
offers BEFORE dispatch. Version policy is deliberately minimal and deterministic: undefined or `*`
matches any offered version; otherwise the offered version must equal the range exactly. Richer
semver-range grammar is an additive refinement behind the same interface. An unmet capability (or
an unresolved processor) becomes a PERMANENT step failure recorded as an attempt, so the run fails
deterministically through the Coordinator's fail-fast. A pre-flight `validateExecutable` surfaces
mis-wiring up front.

## Options Considered

1. **Sequential effect loop + replaceable seams + injected processors (chosen).**
2. **Fold the driver into the Coordinator (let it call processors).** Rejected: it would make the
   Coordinator impure and non-deterministic and weld orchestration to I/O — the exact thing ADR-0011
   avoided. The split (pure decisions vs effects) is the whole point.
3. **Parallel dispatch (Promise.all over a stage).** Rejected as the default: concurrent completion
   makes the journal's entry order nondeterministic, which would make "coordinator decisions
   unchanged" untestable. Serial is the correct reference; a distributed adapter that parallelizes
   is future work and still drives the same API.
4. **A wall-clock, `setTimeout`-based waiter shipped in the package.** Rejected: it puts a timer and
   ambient delay in the package and hurts determinism/testability. Waiting is a seam
   (`clockAdvancingWaiter` for deterministic runs; a real host supplies a one-line wall-clock
   waiter). The only ambient reference is `systemClock`, isolated and injectable.
5. **A bespoke adapter retry/timeout vocabulary or output inspection.** Rejected: that would be
   business behaviour in the adapter. All policy stays declarative in the Coordinator/processing
   model; the adapter only relays outcomes.
6. **Full semver-range negotiation now.** Rejected: over-scope. Exact-or-wildcard is deterministic
   and sufficient; richer matching is additive behind the reserved interface.

## Consequences

- **Positive:** a run now executes end-to-end (processors invoked, outcomes fed back, journal
  persisted, events published) with the Coordinator provably unchanged and deterministic; the
  concrete `CapabilityNegotiator` seam (reserved since Phase 2) is filled; persistence and
  publication are replaceable, so durable/queue-backed backends drop in without touching the
  Coordinator; resume works through the same `JournalStore.load` + `coordinator.resume`.
- **Negative / trade-offs:** the reference driver is single-process and serial (a distributed
  adapter is future work); the reference `JournalStore`/`EventSink`/`Clock` are in-memory/ambient
  (durable backends are the drop-in); retry backoff between sweeps needs a clock-advancing or
  wall-clock `Waiter` (the default returns immediately, guarded by `maxSweeps`); negotiation is
  exact-or-wildcard for now.
- **Follow-ups / remaining risks:** processors themselves (image, render/PDF, assemble) are built
  in their own phases and injected here; one-active-run (INV-6) is enforced by the Control Plane's
  Run Registry, which a host consults before creating a session; a durable `JournalStore` +
  bus-backed `EventSink` + a distributed driver are additive; observability (Phase 10) consumes the
  journal + events this adapter persists/publishes.

## Compliance

The Coordinator package is untouched (verified: no reverse dependency; adapter → coordinator
only). No processor, renderer, PDF/image code, or storage/DB/queue/network/R2 implementation
exists in the adapter (grep- and boundary-verified; the sole ambient is `systemClock`'s isolated
`new Date`, and no timer is armed). Side effects live only in `ExecutionSession` and the injected
seams; the effect loop relays Coordinator decisions unchanged (determinism test-proven). Upholds
the Phase-10 invariants by preserving them: INV-5/6/7/8/9/11 all remain the Coordinator's.
