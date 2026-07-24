# @workerv2/worker-runtime

The Worker V2 **Production Runtime** — the operational layer that turns the [Worker Host](../worker-host)
composition root into a production-ready runtime capable of operating reliably under real workloads.

> **Scope (task-phase 19).** Persistent artifact store + durable journal store + event persistence +
> worker configuration + runtime bootstrap + health checks + graceful shutdown + worker lifecycle +
> metrics interfaces + structured logging + runtime configuration + integration harness. It is a pure
> **composition concern** — no new business/rendering features and **no processing-semantics change**.

## What it does

- **Replaces in-memory stores with durable ones — via DI only.** `PersistentArtifactStore`,
  `DurableJournalStore`, and `PersistentEventSink` (over a swappable `StorageBackend`: in-memory or
  filesystem) are injected into the host through its existing override seams. The host and every core
  package are untouched. Content-addressed keys are identical whether in-memory or durable, so
  **artifact identities are preserved**.
- **Worker lifecycle + graceful shutdown.** `WorkerLifecycle` (`idle → starting → running → draining
→ stopped`) tracks in-flight runs; `shutdown()` drains before stopping and refuses to stop with work
  in flight.
- **Restart recovery.** A run's blueprint + journal + a small run record are persisted durably; a
  fresh runtime over the same backend `recover(runId)`s it — re-reading the blueprint, re-preparing
  the identical coordinator, and **re-folding the durable journal via the Coordinator's own resume**
  (no new semantics). Content-addressed artifacts are reused, not regenerated.
- **Observational health.** `readiness / liveness / dependency (storage + backend) health` — a
  read-only projection that never influences execution.
- **Structured logging + optional metrics.** Structured records (Run ID · Node ID · Processor ·
  Duration · Outcome · Artifact IDs) and metrics (execution duration, artifact counts, retries,
  failures, processor timings, backend usage) — both injectable, both **observational only**.
- **External configuration.** `RuntimeConfig` (storage, backend selection, worker limits, retry
  overrides, diagnostics, feature flags) lives entirely in the runtime; `loadRuntimeConfigFromEnv`
  shows one external source. Retry overrides flow into the manifest compiler as declarative policies.

## What it does not

Modify Coordinator / Processor / Manifest / rendering / export behavior, or introduce business logic.
It only wires durable infrastructure and drives the host. **Deterministic execution + artifact
identities are preserved.**

## Usage

```ts
const runtime = new WorkerRuntime(
  { storage: { kind: 'filesystem', root: '/data/wv2' }, backendId: 'reference' },
  { logger, metrics },
);
runtime.start();
const { result } = await runtime.run(blueprint); // → PDF Artifact, durably stored
runtime.shutdown();

// After a restart, a fresh runtime over the same durable storage:
const recovered = await new WorkerRuntime({ storage }).recover(result.runId);
```

## Boundaries

A composition concern only: depends on the foundation leaves + `control-plane` + `infra-contracts` +
`artifact-store` (content addressing) + `execution-adapter` (`JournalStore`/`EventSink` contracts) +
`coordinator` (resume) + `blueprint` (re-prepare on recovery) + `image-backend` (health probe) +
`worker-host` (the root it drives). The only change to a prior package is **additive DI seams** on
the composition root (default behavior unchanged). Nothing depends on this package. Enforced by
`scripts/check-boundaries.mjs`.
