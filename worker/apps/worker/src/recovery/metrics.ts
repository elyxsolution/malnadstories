import type { StructuredLogger } from '@workerv2/worker-runtime';

/**
 * PIPELINE METRICS — a generic counter + observation sink for recovery/cleanup (and any future
 * pipeline). It is intentionally minimal + backend-agnostic (`increment` for counters, `observe` for
 * durations/sizes), so a real backend (Prometheus/OTel/StatsD) drops in behind the SAME interface and a
 * dashboard consumes the well-known metric names below. This phase ships the interface + in-memory /
 * logging / noop sinks; no dashboard.
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
