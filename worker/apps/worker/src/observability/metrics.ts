import type { Metrics, MetricTags } from '@workerv2/metrics';
import { InMemoryMetrics, NoopMetrics } from '@workerv2/metrics';
import type { WorkerLogger } from './logging.js';
import type { MetricsSink } from '../recovery/metrics.js';

/**
 * METRICS — the generic, backend-agnostic instrument surface.
 *
 * REUSE, NOT REINVENTION: `MetricsProvider` IS the foundation's `@workerv2/metrics` `Metrics`
 * contract, which already defines exactly the four instrument kinds this phase requires —
 * `counter` (monotonic), `gauge` (instantaneous), `histogram` (distribution) and `timing`
 * (duration). Aliasing rather than redefining means a future Prometheus/OpenTelemetry/StatsD
 * adapter implements a FOUNDATION contract, usable by any Worker V2 process, not an app-local one.
 * The foundation's `NoopMetrics` and `InMemoryMetrics` are re-exported for the same reason.
 *
 * What this module adds on top is what production needs and the foundation intentionally left out:
 * a `Timer` handle for scoped measurement, a resilient wrapper that degrades to no-op when a
 * backend misbehaves, a logging provider for deployments with no metrics stack, and the bridge that
 * folds Phase I-3's `MetricsSink` onto this one provider so there is exactly ONE metrics path.
 */

/** The metrics port. Structurally identical to `@workerv2/metrics`'s `Metrics`. */
export type MetricsProvider = Metrics;
export type { MetricTags };

/** Records nothing — the safe default and the degradation target. */
export { NoopMetrics as NoopMetricsProvider };
/** Retains samples for assertions + the diagnostics endpoint. */
export { InMemoryMetrics as InMemoryMetricsProvider };

/** A running duration measurement. `stop()` records the elapsed time and returns it. */
export interface Timer {
  stop(extraTags?: MetricTags): number;
}

/**
 * Start a timer that records into `name` when stopped. Uses `Date.now()` rather than `hrtime` on
 * purpose: the measured operations are I/O-bound (milliseconds to minutes), so millisecond
 * resolution is ample and the call is cheaper.
 */
export function startTimer(
  metrics: MetricsProvider,
  name: string,
  tags?: MetricTags,
  now: () => number = Date.now,
): Timer {
  const started = now();
  return {
    stop(extraTags?: MetricTags): number {
      const elapsed = Math.max(0, now() - started);
      metrics.timing(name, elapsed, { ...tags, ...extraTags });
      return elapsed;
    },
  };
}

/**
 * GRACEFUL DEGRADATION for metrics: wraps a provider so a failing backend can never break
 * processing. After `maxFailures` consecutive throws the wrapper permanently stops calling the
 * delegate and behaves as a no-op, logging the transition once. The worker keeps processing;
 * it simply stops emitting telemetry.
 */
export class ResilientMetricsProvider implements MetricsProvider {
  private failures = 0;
  private degraded = false;

  constructor(
    private readonly delegate: MetricsProvider,
    private readonly onDegraded?: (failures: number, error: unknown) => void,
    private readonly maxFailures = 3,
  ) {}

  /** Whether the provider has fallen back to no-op. */
  get isDegraded(): boolean {
    return this.degraded;
  }

  counter(name: string, value?: number, tags?: MetricTags): void {
    this.guard(() => this.delegate.counter(name, value, tags));
  }
  gauge(name: string, value: number, tags?: MetricTags): void {
    this.guard(() => this.delegate.gauge(name, value, tags));
  }
  histogram(name: string, value: number, tags?: MetricTags): void {
    this.guard(() => this.delegate.histogram(name, value, tags));
  }
  timing(name: string, milliseconds: number, tags?: MetricTags): void {
    this.guard(() => this.delegate.timing(name, milliseconds, tags));
  }

  private guard(emit: () => void): void {
    if (this.degraded) return;
    try {
      emit();
      this.failures = 0;
    } catch (error) {
      this.failures += 1;
      if (this.failures >= this.maxFailures) {
        this.degraded = true;
        try {
          this.onDegraded?.(this.failures, error);
        } catch {
          /* the degradation notice must not itself throw */
        }
      }
    }
  }
}

/**
 * Emits every sample as a structured `metric.*` log record. For deployments with no metrics stack
 * yet: the numbers are still queryable through log search, and swapping in a real backend later
 * changes one line at the composition root. Emitted at TRACE so it never dominates normal output.
 */
export class LoggingMetricsProvider implements MetricsProvider {
  constructor(private readonly logger: WorkerLogger) {}

  counter(name: string, value = 1, tags?: MetricTags): void {
    this.emit('counter', name, value, tags);
  }
  gauge(name: string, value: number, tags?: MetricTags): void {
    this.emit('gauge', name, value, tags);
  }
  histogram(name: string, value: number, tags?: MetricTags): void {
    this.emit('histogram', name, value, tags);
  }
  timing(name: string, milliseconds: number, tags?: MetricTags): void {
    this.emit('timing', name, milliseconds, tags);
  }

  private emit(kind: string, name: string, value: number, tags?: MetricTags): void {
    if (!this.logger.isEnabled('trace')) return; // avoid building the detail bag when filtered out
    this.logger.trace('metric', { kind, name, value, ...(tags ?? {}) });
  }
}

/** Fans samples out to several providers (e.g. in-memory for `/diagnostics` + a real backend). */
export class MultiMetricsProvider implements MetricsProvider {
  constructor(private readonly providers: readonly MetricsProvider[]) {}

  counter(name: string, value?: number, tags?: MetricTags): void {
    for (const p of this.providers) p.counter(name, value, tags);
  }
  gauge(name: string, value: number, tags?: MetricTags): void {
    for (const p of this.providers) p.gauge(name, value, tags);
  }
  histogram(name: string, value: number, tags?: MetricTags): void {
    for (const p of this.providers) p.histogram(name, value, tags);
  }
  timing(name: string, milliseconds: number, tags?: MetricTags): void {
    for (const p of this.providers) p.timing(name, milliseconds, tags);
  }
}

// --- Bridge: the Phase I-3 MetricsSink onto the one provider ------------------------------------

/**
 * Implements Phase I-3's `MetricsSink` (`increment`/`observe`) over a `MetricsProvider`.
 *
 * Phase I-3 introduced its own minimal metrics interface before this layer existed. Rather than
 * leave two parallel metric paths — the exact "duplicate instrumentation" this phase is meant to
 * remove — the older interface is kept as a stable API and RE-IMPLEMENTED here, so every sample
 * from any era lands in the same provider and the same backend. `increment` → `counter`,
 * `observe` → `histogram` (observations are distributions; a duration-shaped name additionally
 * records a `timing`).
 */
export class MetricsProviderSink implements MetricsSink {
  constructor(private readonly metrics: MetricsProvider) {}

  increment(name: string, value = 1, tags?: Readonly<Record<string, string>>): void {
    this.metrics.counter(name, value, tags);
  }

  observe(name: string, value: number, tags?: Readonly<Record<string, string>>): void {
    if (name.endsWith('_ms') || name.endsWith('duration_ms')) {
      this.metrics.timing(name, value, tags);
      return;
    }
    this.metrics.histogram(name, value, tags);
  }
}
