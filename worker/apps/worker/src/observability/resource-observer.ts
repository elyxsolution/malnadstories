import type { WorkerLogger } from './logging.js';
import type { MetricsProvider } from './metrics.js';
import { WORKER_METRICS } from './metric-names.js';
import { errorMessage } from './model.js';

/**
 * RESOURCE OBSERVER — the observability seam of the Resource Manager.
 *
 * The Resource Manager owns expensive, long-lived resources (Chromium today). Before this phase its
 * lifecycle was completely invisible: a browser could crash and be silently rebuilt on every job
 * with no counter, no log, and no way for an operator to know. The manager is NOT redesigned to fix
 * that — it gains one OPTIONAL observer that it notifies, exactly as processors notify an event
 * sink. With no observer supplied it behaves precisely as before.
 *
 * This is what makes the PDF trace read `album-pdf → … → render(acquire chromium) → upload →
 * finalize`, and what produces the browser-count/restart metrics the resource-monitoring section
 * requires.
 */

/** Lifecycle notifications from the Resource Manager. Implementations must never throw. */
export interface ResourceObserver {
  /** A resource was (re)built. `durationMs` is the creation cost — Chromium launch is seconds. */
  onCreated(name: string, durationMs: number): void;
  /** Creation failed. The acquiring caller sees the error; this records it. */
  onCreateFailed(name: string, error: unknown, durationMs: number): void;
  /** A resource was acquired. `created` distinguishes a cache hit from a (re)build. */
  onAcquired(name: string, durationMs: number, created: boolean): void;
  /** A resource was discarded — crash recovery, staleness, or shutdown. */
  onReset(name: string, reason: 'unhealthy' | 'explicit' | 'shutdown'): void;
}

/** Discards every notification (the default — keeps the manager usable with no observability). */
export class NoopResourceObserver implements ResourceObserver {
  onCreated(_name: string, _durationMs: number): void {}
  onCreateFailed(_name: string, _error: unknown, _durationMs: number): void {}
  onAcquired(_name: string, _durationMs: number, _created: boolean): void {}
  onReset(_name: string, _reason: 'unhealthy' | 'explicit' | 'shutdown'): void {}
}

/** Routes resource lifecycle into the observability layer's logs + metrics. */
export class ObservabilityResourceObserver implements ResourceObserver {
  constructor(
    private readonly logger: WorkerLogger,
    private readonly metrics: MetricsProvider,
  ) {}

  onCreated(name: string, durationMs: number): void {
    this.metrics.counter(WORKER_METRICS.resourceCreated, 1, { resource: name });
    this.logger.record('info', 'resource.created', { durationMs }, { resource: name });
  }

  onCreateFailed(name: string, error: unknown, durationMs: number): void {
    this.metrics.counter(WORKER_METRICS.resourceAcquireFailed, 1, { resource: name });
    this.logger.record(
      'error',
      'resource.create_failed',
      { durationMs },
      { resource: name, error: errorMessage(error) },
    );
  }

  onAcquired(name: string, durationMs: number, created: boolean): void {
    this.metrics.timing(WORKER_METRICS.resourceAcquireDurationMs, durationMs, { resource: name });
    // A cache hit is the overwhelmingly common case and must not flood the log — trace only.
    this.logger.record('trace', 'resource.acquired', { durationMs }, { resource: name, created });
  }

  onReset(name: string, reason: 'unhealthy' | 'explicit' | 'shutdown'): void {
    this.metrics.counter(WORKER_METRICS.resourceReset, 1, { resource: name, reason });
    // An unhealthy reset means the resource crashed mid-production — that is a warning.
    this.logger.record(
      reason === 'unhealthy' ? 'warn' : 'info',
      'resource.reset',
      {},
      { resource: name, reason },
    );
  }
}
