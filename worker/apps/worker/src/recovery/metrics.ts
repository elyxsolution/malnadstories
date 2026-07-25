import type { StructuredLogger } from '@workerv2/worker-runtime';

/**
 * PIPELINE METRICS — a generic counter + observation sink introduced in Phase I-3, before the
 * Observability layer existed.
 *
 * STATUS AFTER PHASE I-4: this interface is retained as a stable port, but it is no longer a SECOND
 * metrics path. The observability layer supplies `MetricsProviderSink`, which implements this
 * interface over the one `MetricsProvider`, so every sample — whatever era of code emitted it —
 * reaches the same backend. Nothing in the worker constructs a metrics sink of its own any more:
 * recovery and cleanup were refactored to emit events instead, and the counters below are now
 * DERIVED from those events under the `WORKER_METRICS` vocabulary.
 *
 * The names are kept for compatibility with anything already built against them; new instrumentation
 * should use `observability/metric-names.ts`.
 */

export interface MetricsSink {
  /** Increment a counter (default +1). */
  increment(name: string, value?: number, tags?: Readonly<Record<string, string>>): void;
  /** Record an observation (duration ms, batch size, …). */
  observe(name: string, value: number, tags?: Readonly<Record<string, string>>): void;
}

/** Well-known metric names — a stable vocabulary future dashboards can rely on. */
export const METRICS = {
  jobsRecovered: 'recovery.jobs_recovered',
  jobsAbandoned: 'recovery.jobs_abandoned',
  jobsAlreadyHealed: 'recovery.jobs_already_healed',
  staleDetected: 'recovery.stale_detected',
  retriesAttempted: 'recovery.retries_attempted',
  retriesSkipped: 'recovery.retries_skipped',
  recoveryDurationMs: 'recovery.duration_ms',
  sweepDurationMs: 'recovery.sweep_duration_ms',
  orphanObjectsRemoved: 'cleanup.orphan_objects_removed',
  cleanupDurationMs: 'cleanup.duration_ms',
} as const;

/** Discards every metric (tests / opt-out). */
export class NoopMetricsSink implements MetricsSink {
  increment(): void {
    /* no-op */
  }
  observe(): void {
    /* no-op */
  }
}

/** In-memory sink for assertions. Counters key on name + sorted tags. */
export class RecordingMetricsSink implements MetricsSink {
  private readonly counters = new Map<string, number>();
  readonly observations: Array<{
    name: string;
    value: number;
    tags?: Readonly<Record<string, string>>;
  }> = [];

  increment(name: string, value = 1, tags?: Readonly<Record<string, string>>): void {
    const key = metricKey(name, tags);
    this.counters.set(key, (this.counters.get(key) ?? 0) + value);
  }
  observe(name: string, value: number, tags?: Readonly<Record<string, string>>): void {
    this.observations.push(tags === undefined ? { name, value } : { name, value, tags });
  }
  counter(name: string, tags?: Readonly<Record<string, string>>): number {
    return this.counters.get(metricKey(name, tags)) ?? 0;
  }
}

/** Emits metrics to the structured logger at debug (a real backend replaces this). */
export class LoggingMetricsSink implements MetricsSink {
  constructor(private readonly logger: StructuredLogger) {}
  increment(name: string, value = 1, tags?: Readonly<Record<string, string>>): void {
    this.logger.log({
      level: 'debug',
      message: 'metric.increment',
      detail: { name, value, ...(tags ?? {}) },
    });
  }
  observe(name: string, value: number, tags?: Readonly<Record<string, string>>): void {
    this.logger.log({
      level: 'debug',
      message: 'metric.observe',
      detail: { name, value, ...(tags ?? {}) },
    });
  }
}

function metricKey(name: string, tags?: Readonly<Record<string, string>>): string {
  if (tags === undefined) return name;
  const suffix = Object.keys(tags)
    .sort()
    .map((k) => `${k}=${tags[k]}`)
    .join(',');
  return suffix.length === 0 ? name : `${name}{${suffix}}`;
}
