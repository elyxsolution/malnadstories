/**
 * THE TESTING LAYER — load generation, chaos injection, in-memory infrastructure and benchmarking.
 *
 * OPTIONAL AND PRODUCTION-INERT BY CONSTRUCTION. Nothing under `src/testing/` is imported by
 * `main.ts`, `bootstrap.ts`, or any processor, adapter or observability module — the dependency
 * arrow points only inward, from testing to production. There is no flag to disable, because there
 * is nothing in the running worker to disable: the bundler drops the whole subtree from
 * `dist/main.js` since no reachable module references it.
 *
 * That is why chaos is implemented as DECORATORS over the existing ports rather than as switches
 * inside the adapters. A `if (chaos)` branch in `R2ObjectStore` would ship to production and would
 * have to be trusted; a wrapper that production never constructs cannot misfire.
 *
 *   fakes/    in-memory broker (atomic fetch, visibility timeout, retry, dead-letter), object store,
 *             database and renderer — real state, so assertions mean something
 *   chaos/    FaultController + port decorators (outage, slow, timeout, crash, OOM)
 *   load/     workload generation, synthetic processors, and the multi-worker harness
 *   bench/    latency histogram + benchmark report
 */

export { FakeBroker, FakeBrokerQueue } from './fakes/fake-broker.js';
export type { DeadLetter, DeliveryRecord, FakeBrokerOptions } from './fakes/fake-broker.js';
export { FakeDatabase, FakeObjectStore, FakeRenderer } from './fakes/fake-infra.js';

export { FaultController, InjectedFault, NO_FAULTS } from './chaos/faults.js';
export type { FaultKind, FaultSpec } from './chaos/faults.js';
export {
  ChaosDatabase,
  ChaosObjectStore,
  ChaosQueue,
  ChaosRenderer,
} from './chaos/chaos-adapters.js';

export {
  CLEANUP,
  IMAGE,
  PDF,
  SyntheticProcessor,
  generateWorkload,
  isCancellation,
  mixedWorkload,
  sleep,
} from './load/workload.js';
export type { SyntheticProcessorOptions, WorkloadSpec } from './load/workload.js';

export { LoadHarness } from './load/harness.js';
export type { HarnessOptions, HarnessWorker } from './load/harness.js';

export { LatencyHistogram, formatReport, sampleMemory } from './bench/metrics.js';
export type { BenchmarkReport, LatencySummary, MemorySample } from './bench/metrics.js';
