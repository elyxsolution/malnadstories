// @workerv2/worker-runtime — the Production Runtime. The OPERATIONAL layer that turns the Worker
// Host composition root into a production-ready runtime: durable artifact store + durable journal
// store + event persistence (injected into the host, replacing the in-memory defaults), external
// runtime/worker configuration, runtime bootstrap + worker lifecycle (startup → running → draining
// → stopped) with graceful shutdown + restart recovery, observational health checks, structured
// logging, optional injectable metrics, and an integration harness.
//
// A pure COMPOSITION concern: it modifies no Coordinator / Processor / Manifest / rendering / export
// behavior and introduces no business logic — it only wires durable infrastructure and drives the
// host. Deterministic execution + artifact identities are preserved. Nothing depends on this package.

// --- The runtime facade ---
export { WorkerRuntime } from './runtime.js';
export type { RuntimeRunResult } from './runtime.js';

// --- Configuration (external, injectable) ---
export {
  DEFAULT_RUNTIME_CONFIG,
  resolveRuntimeConfig,
  loadRuntimeConfigFromEnv,
  retryPolicies,
} from './config.js';
export type {
  RuntimeConfig,
  StorageConfig,
  StorageKind,
  WorkerLimits,
  RetryOverrides,
  DiagnosticsConfig,
} from './config.js';

// --- Bootstrap ---
export { bootstrapRuntime } from './bootstrap.js';
export type { BootstrapDeps, RuntimeComponents } from './bootstrap.js';

// --- Lifecycle ---
export { WorkerLifecycle } from './lifecycle.js';
export type { LifecyclePhase } from './lifecycle.js';

// --- Durable storage ---
export { InMemoryStorageBackend, FileSystemStorageBackend } from './storage/backend.js';
export type { StorageBackend } from './storage/backend.js';
export { PersistentArtifactStore } from './storage/artifact-store.js';
export { DurableJournalStore, PersistentEventSink } from './storage/journal-store.js';
export { RunRecordStore } from './storage/run-records.js';
export type { RunRecord } from './storage/run-records.js';

// --- Logging (observational) ---
export { RecordingLogger, noopLogger, jsonLineLogger } from './logging.js';
export type { StructuredLogger, RuntimeLogRecord, LogLevel } from './logging.js';

// --- Metrics (optional, injectable) ---
export { RecordingMetrics, noopMetrics } from './metrics.js';
export type { RuntimeMetrics } from './metrics.js';

// --- Health (observational) ---
export { reportHealth } from './health.js';
export type { HealthReport, HealthState, DependencyHealth, HealthInputs } from './health.js';

// --- Integration harness ---
export { makeRuntimeHarness, seedRuntimeAlbum } from './harness.js';
export type { RuntimeHarness } from './harness.js';
