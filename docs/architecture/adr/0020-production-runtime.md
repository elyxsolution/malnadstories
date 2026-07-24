# ADR-0020 — Production Runtime: durable infrastructure, lifecycle & recovery as composition

- **Status:** Accepted
- **Date:** 2026-07-24
- **Phase:** 15 (Production Cutover — operational runtime; task-phase 19)
- **Deciders:** Chief Software Architect, Worker V2

## Context

The Worker Host (ADR-0019) drives a real album Blueprint → PDF Artifact end to end, but over
in-memory infrastructure. This task-phase makes Worker V2 production-ready: durable stores, a worker
lifecycle with graceful shutdown, restart recovery, health, structured logging, metrics, and
external configuration — while operating reliably under real workloads.

Hard constraints from the objective: this is operational infrastructure ONLY — no new
business/rendering features and NO change to processing semantics. It must NOT modify Coordinator /
Processor / Manifest / rendering / export behavior or introduce business logic. Durable
implementations "should replace only the host wiring; core packages remain unchanged." Configuration
stays external to core. Health/logging/metrics are observational only and must never influence
execution. Recovery must reuse existing Coordinator semantics. Determinism + artifact identities must
be preserved. Every operational service must remain replaceable via DI.

Decisions needed: (1) how durable stores replace in-memory ones without changing core packages;
(2) whether any prior package must change; (3) how restart recovery reuses the Coordinator; (4) how
health/logging/metrics stay observational; (5) how "durable" is implemented in a pure, testable way.

## Decision

**1. A separate operational package; the only prior-package change is additive DI seams on the
composition root.** `@workerv2/worker-runtime` holds all operational concerns. Durable stores are
injected into the `WorkerHost` through NEW, optional override fields (`store` / `journalStore` /
`eventSink`) whose defaults keep the exact Phase-18 in-memory behavior — a behavior-preserving,
additive change to the composition root (not a core package, not a semantics change). No
Coordinator / Processor / Manifest / rendering / export code is touched. (The host also gained an
optional `policies` param on `prepare`/`run` to thread the config's retry overrides into the manifest
compiler — again additive + default-preserving.)

**2. Durable stores are drop-ins behind a synchronous `StorageBackend` seam.**
`PersistentArtifactStore` (content-addressed via the artifact platform's `hashBytes` — SAME sha256
addressing as the in-memory store, so identities are byte-identical), `DurableJournalStore`
(persists the append-only journal per run), and `PersistentEventSink` all sit over a tiny
SYNCHRONOUS `StorageBackend`. Keeping it synchronous lets the artifact store expose the host's
`put(bytes) → key` API unchanged while persisting durably. Two references ship: an in-memory backend
(shareable across runtime instances to MODEL a restart) and a filesystem backend (genuine
cross-restart durability); a real object-store/KV backend plugs in here, nothing above it changing.

**3. Restart recovery reuses the Coordinator's own resume.** A small durable `RunRecordStore` maps a
run id → its (content-addressed) blueprint key. On restart a fresh runtime reads the record, re-reads
the blueprint from the durable artifact store, re-prepares the IDENTICAL coordinator, loads the
durable journal, and calls `coordinator.resume(runId, entries)` — the journal re-folds into the same
state (INV-7, driftless), and if the run was interrupted it drives to completion from there.
Content-addressed artifacts are REUSED, not regenerated. No new recovery/orchestration semantics.

**4. Health, logging, and metrics are observational only.** Health is a read-only projection of the
lifecycle phase + storage/backend probes; structured logs (Run ID · Node ID · Processor · Duration ·
Outcome · Artifact IDs) and metrics (durations / artifact counts / retries / failures / processor
timings / backend usage) are emitted AROUND execution from the post-run diagnostics — nothing here
feeds back into the Coordinator or the driver. All three are injectable interfaces with
recording/no-op references; a real deployment injects HTTP endpoints / a log shipper / a metrics
adapter.

**5. Configuration is external + injectable; determinism is preserved.** `RuntimeConfig` (storage,
backend selection, worker limits, retry overrides, diagnostics, feature flags) lives entirely in the
runtime with a defaults resolver and an env-var loader — never in a core package. Because artifact
identities are content-addressed (independent of the store implementation and the injected clock),
the SAME input yields the SAME artifacts whether run in-memory or durably, and across a restart.

## Options Considered

1. **A separate runtime package + additive DI seams on the host (chosen).**
2. **Bake durable stores into the host / core packages.** Rejected: it couples core packages to a
   storage technology, violates "core packages remain unchanged," and makes the stores un-swappable.
   Injection through the host's seams keeps every implementation replaceable.
3. **Re-implement the whole composition in the runtime (never touch the host).** Rejected: it would
   duplicate all of Phase-18's wiring; the host's DI seams are the intended replacement point, and the
   change to add them is additive + default-preserving.
4. **A new, runtime-specific recovery/resume mechanism.** Rejected: recovery must reuse the
   Coordinator's resume (a driftless journal re-fold). The runtime only persists enough to
   reconstruct the coordinator + reload the journal.
5. **Let health/metrics gate execution (e.g. pause on degraded storage).** Rejected: the objective
   requires them observational only; gating would make execution depend on operational signals and
   risk determinism. Operational reaction is the orchestrator's/operator's concern, outside execution.
6. **An async storage backend.** Rejected as the default: it would force the host's `put` API async
   and ripple into the composition root. A synchronous backend (fs sync APIs are fine) keeps the host
   API unchanged; an async object-store adapter can buffer/write-through behind the same seam.

## Consequences

- **Positive:** Worker V2 now runs over durable infrastructure with a real lifecycle, graceful
  shutdown, restart recovery, health, structured logging, and metrics — all injectable + replaceable;
  determinism + artifact identities are preserved (test-proven across a simulated restart); the only
  prior-package touch is additive, default-preserving DI seams (grep + boundary verified); no core
  package or processing semantics changed; nothing depends on the runtime.
- **Negative / trade-offs:** the shipped durable backends are in-memory (restart-simulating) +
  filesystem — a networked object-store/KV backend is the production drop-in behind the same seam;
  the single-process driver runs a whole album synchronously, so "interruption" is modelled by
  re-folding a persisted (complete) journal rather than a mid-run crash (the resume path handles a
  partial journal identically); recovery reconstructs the coordinator from a re-read blueprint (the
  record stores the pointer, the artifact store the bytes); one-active-run (INV-6) gating via the
  Control Plane Run Registry remains reserved.
- **Operational considerations:** deploy with `storage.kind = 'filesystem'` (or a real backend
  behind `StorageBackend`); expose `runtime.health()` as readiness/liveness endpoints; inject a real
  structured logger + metrics adapter; on boot, iterate `recoverableRuns()` and `recover()` each; size
  worker limits (`maxSweeps`/`maxInFlight`) + retry overrides via config; back the store/journal with
  a durable, replicated backend before multi-instance operation; the in-process journal
  read-modify-write append is fine at album scale but a real backend should offer append semantics.

## Compliance

Strict TypeScript; full runtime + integration tests (27 new; `pnpm verify` green — 706 total, 29
packages). Replaces in-memory stores with durable implementations via DI only (host + core packages
unchanged except additive, default-preserving seams). Supports startup / dependency init / processor
+ backend registration / graceful shutdown / restart recovery; external injectable configuration;
observational readiness/liveness/dependency/storage/backend health; structured logging + optional
metrics that never influence execution; recovery via the Coordinator's own resume; deterministic
execution + artifact identities preserved across a restart (test-proven). No Coordinator / Processor
/ Manifest / rendering / export change; no business logic (grep + boundary verified). Boundaries: the
runtime depends outward on the platforms it composes; nothing depends on it.
