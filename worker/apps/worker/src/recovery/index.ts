/**
 * RECOVERY FRAMEWORK — the self-healing layer. A `RecoveryCoordinator` drives a set of
 * `RecoverableProcessor`s on a `PeriodicScheduler`, emitting recovery events + metrics, and observing
 * cancellation for graceful shutdown. Domain-agnostic: processors supply the detection + repair.
 */

export { CancellationSource, CancellationError, NONE } from './cancellation.js';
export type { CancellationToken } from './cancellation.js';

export { METRICS, NoopMetricsSink, RecordingMetricsSink, LoggingMetricsSink } from './metrics.js';
export type { MetricsSink } from './metrics.js';

export type {
  RecoverableProcessor,
  RecoveryItem,
  RecoveryResult,
  RecoveryOutcome,
} from './recoverable.js';

export { RecoveryCoordinator } from './coordinator.js';
export type { RecoveryCoordinatorDeps, RecoverySummary } from './coordinator.js';

export { PeriodicScheduler } from './scheduler.js';
export type { SchedulerOptions } from './scheduler.js';
