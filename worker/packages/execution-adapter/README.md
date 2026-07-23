# @workerv2/execution-adapter

The Worker V2 **Execution Adapter** — the infrastructure layer that **drives** the pure
`@workerv2/coordinator`. The coordinator decides; this adapter performs the effects: it resolves
processors, negotiates capabilities, invokes `Processor.process()`, feeds outcomes back into the
coordinator, persists the journal through a replaceable interface, and publishes execution
events through a replaceable sink.

> **Scope (task-phase 11 / the Coordinator's driving layer).** Execution driver, effect loop,
> processor dispatcher, processor resolver, capability negotiator, execution session, tick
> driver, journal-persistence interface, event-sink interface, adapter contracts, execution
> validation. **Not here:** processors themselves, rendering, PDF generation, image processing,
> storage/DB/queue/network/R2 implementation, business logic.

## The boundary that matters

- **The coordinator stays pure.** This package imports it and never modifies it. Every decision
  (what is ready, whether to retry, when a run settles) is the coordinator's; the adapter only
  chooses **when** to feed the next injected `now` and performs the side effects. Driven by a
  `manualClock`, the whole adapter is deterministic — a test proves the persisted journal is
  byte-identical to what the pure coordinator produces, so **coordinator decisions are
  unchanged**.
- **All side effects live behind replaceable interfaces.** Time (`Clock`), waiting (`Waiter`),
  persistence (`JournalStore`), and publication (`EventSink`) are seams. The package ships small,
  dependency-free reference implementations; a production host injects its own. There is **no**
  transport, database, queue, network, or R2 here.
- **The adapter implements no work.** Processors are **injected** by the caller (image, render,
  assemble — built in their own phases) and held in the resolver. The adapter's only contact with
  "the work" is calling the injected contract and handing the outcome back.

## Design

- **Effect loop** (`pump`) — one small, sequential sweep at an injected `now`: tick due timeouts,
  ask the coordinator which nodes are dispatchable, and for each (in canonical order) negotiate →
  resolve → dispatch → invoke → report. **Execution driver** (`runToCompletion` / `executeRun`)
  starts a pending run and pumps until it settles, waiting out retry backoff between sweeps.
- **Processor Dispatcher** (`invokeProcessor`) — the single call site of `Processor.process()`.
  Returns the `ProcessorOutcome` unchanged, except a processor that **throws** is normalized into
  a `transient` `StepFailure` so the loop always gets in-band data and the retry policy decides.
- **Processor Resolver** (`InMemoryProcessorRegistry implements ProcessorResolver`) — maps a
  registry name (+ optional version) to an injected processor. Exact-or-wildcard version policy.
- **Capability Negotiator** (`DefaultCapabilityNegotiator`) — the concrete implementation of the
  runtime's reserved `CapabilityNegotiator` seam. Negotiation runs **before dispatch**; an unmet
  capability becomes a permanent step failure (the coordinator's fail-fast then takes over).
- **Execution Session** (`ExecutionSession`) — one run's stateful holder and the **only** place a
  coordinator step's side effects are applied: advance the held state, **persist** the journal
  entries, **publish** the events (persist-then-publish, since the journal is the source of
  truth). A coordinator rejection (an out-of-sequence command) surfaces as an `AdapterError`.
- **Tick Driver** (`tickIfDue` / `nextWakeAt`) — advances injected time: drives a `tick` when a
  timeout budget has elapsed, and reports the earliest future wake instant (retry backoff /
  timeout) so a host resumes without polling. No timer is armed.
- **Adapter contracts** (`Clock`, `Waiter`, `JournalStore`, `EventSink`) + references
  (`systemClock`, `manualClock`, `immediateWaiter`, `clockAdvancingWaiter`,
  `InMemoryJournalStore`, `InMemoryEventSink`, `noopEventSink`, `publisherSink`).
- **Execution validation** (`validateExecutable`) — the pre-flight gate: every node's processor
  resolves and every node's capabilities negotiate, turning a mis-wired host into an up-front
  error instead of a mid-run failure.

## Boundaries

Depends on `@workerv2/coordinator` (the pure driver target), `@workerv2/processing` (processor /
context / policy contracts), `@workerv2/runtime` (the reserved capability-negotiation contracts),
`@workerv2/control-plane` (`RunId`/`Timestamp`), `@workerv2/infra-contracts` (`StorageKey`), and
the foundation leaves. Nothing depends on this package — it is a top-level driver. It contains
**no** processor, renderer, PDF/image code, or storage/DB/queue/network implementation.

## Designed for more adapters

The single-process reference driver here and any future distributed or queue-backed adapter drive
the coordinator through the **same** public API — the coordinator never changes. A distributed
adapter would swap the `JournalStore`/`EventSink`/`Waiter` for durable/queue-backed
implementations and parallelize dispatch across workers; the decision core stays identical.
