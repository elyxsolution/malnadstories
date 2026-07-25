import type { StructuredLogger } from '@workerv2/worker-runtime';
import type { MetricsSink } from '../recovery/metrics.js';
import type { CompositionInfo } from './diagnostics.js';
import { ObservabilityEventSink } from './event-sink.js';
import { WorkerHealthRegistry } from './health.js';
import type { WorkerLogger } from './logging.js';
import { ObservabilityLogger } from './logging.js';
import type { MetricsProvider } from './metrics.js';
import {
  InMemoryMetricsProvider,
  LoggingMetricsProvider,
  MetricsProviderSink,
  MultiMetricsProvider,
  NoopMetricsProvider,
  ResilientMetricsProvider,
} from './metrics.js';
import type { LogLevel } from './model.js';
import type { LogSink } from './sinks.js';
import {
  ConsoleLogSink,
  JsonLogSink,
  MemoryLogSink,
  MultiLogSink,
  asStructuredLogger,
  resilientSink,
} from './sinks.js';
import { LoggingSpanExporter, MemorySpanExporter, MultiSpanExporter } from './trace-exporters.js';
import type { Tracer } from './tracing.js';
import { DefaultTracer, NoopTracer } from './tracing.js';
import type { ResourceObserver } from './resource-observer.js';
import { ObservabilityResourceObserver } from './resource-observer.js';

/**
 * THE OBSERVABILITY FACADE — one object that owns the logging, tracing, metrics and health
 * subsystems, and the adapters that let every pre-existing component consume them unchanged.
 *
 * Composition roots take an `Observability` and hand out its ports; nothing else in the worker
 * constructs a logger, a tracer, a metrics client, or a health registry. That single ownership is
 * what guarantees the layer can be swapped wholesale — a deployment moving to OpenTelemetry changes
 * this file's wiring and no processing code at all.
 *
 * EVERY SUBSYSTEM FAILS INDEPENDENTLY. The log sink is wrapped so a broken destination falls back to
 * stderr; the metrics provider is wrapped so a broken backend degrades to no-op; the tracer is a
 * no-op when disabled; health probes are total. There is no configuration of this layer that can
 * stop the worker from processing jobs.
 */

export interface ObservabilityConfig {
  /** Identifies this process in every record (defaults to the hostname). */
  readonly workerId: string;
  /** Minimum log level emitted. */
  readonly level: LogLevel;
  /** `json` for production log shipping; `console` for readable local development. */
  readonly format: 'json' | 'console';
  /** Whether spans are recorded. */
  readonly tracing: boolean;
  /** Head sampling ratio in `[0, 1]` — a whole trace is kept or dropped, never half. */
  readonly traceSampleRatio: number;
  /** Whether metrics are recorded. */
  readonly metrics: boolean;
  /** Resource-sampling interval (ms) for the runtime monitor. */
  readonly monitorIntervalMs: number;
  /** RSS above which the worker reports `degraded`. */
  readonly memorySoftLimitBytes: number;
  /** RSS above which the worker reports `unhealthy` and stops accepting work. */
  readonly memoryHardLimitBytes: number;
  /** How many recent log records + spans are retained for `/diagnostics`. */
  readonly recentCapacity: number;
}

/** Test/composition seams — inject a sink, a provider, or deterministic clocks. */
export interface ObservabilityOverrides {
  readonly sink?: LogSink;
  readonly metrics?: MetricsProvider;
  readonly now?: () => Date;
  readonly clock?: () => number;
  readonly ids?: () => string;
  readonly random?: () => number;
}

export class Observability {
  /** The primary logging port. Subsystems bind their own context with `.child(...)`. */
  readonly logger: WorkerLogger;
  readonly tracer: Tracer;
  readonly metrics: MetricsProvider;
  readonly health: WorkerHealthRegistry;
  /**
   * THE instrumentation entry point for processing code. Every processor, pipeline and recovery
   * handler is given this sink and emits events into it; logs, metrics and spans follow.
   */
  readonly events: ObservabilityEventSink;
  readonly resourceObserver: ResourceObserver;

  /** Adapter for every component that depends on the Worker Runtime's `StructuredLogger` port. */
  readonly structuredLogger: StructuredLogger;
  /** Adapter for every component that depends on Phase I-3's `MetricsSink` port. */
  readonly metricsSink: MetricsSink;

  /** Bounded rings backing the `/diagnostics` endpoint (and test assertions). */
  readonly recentLogs: MemoryLogSink;
  readonly recentSpans: MemorySpanExporter;

  private readonly sink: LogSink;

  constructor(
    readonly config: ObservabilityConfig,
    overrides: ObservabilityOverrides = {},
  ) {
    // --- Logging: primary sink (+ a bounded ring for diagnostics), made failure-proof ------------
    this.recentLogs = new MemoryLogSink(config.recentCapacity);
    const primary =
      overrides.sink ?? (config.format === 'console' ? new ConsoleLogSink() : new JsonLogSink());
    this.sink = resilientSink(new MultiLogSink([primary, this.recentLogs]));
    this.logger = new ObservabilityLogger({
      level: config.level,
      sink: this.sink,
      fields: { workerId: config.workerId },
      ...(overrides.now === undefined ? {} : { now: overrides.now }),
    });
    this.structuredLogger = asStructuredLogger(this.logger);

    // --- Metrics: pluggable backend, degrading to no-op if it misbehaves -------------------------
    this.recentSpans = new MemorySpanExporter(config.recentCapacity);
    const metricsBackend = config.metrics
      ? (overrides.metrics ??
        new MultiMetricsProvider([
          new InMemoryMetricsProvider(),
          new LoggingMetricsProvider(this.logger),
        ]))
      : new NoopMetricsProvider();
    this.metrics = new ResilientMetricsProvider(metricsBackend, (failures, error) => {
      this.logger.error('observability.metrics.degraded', {
        failures,
        error: error instanceof Error ? error.message : String(error),
        fallback: 'noop',
      });
    });
    this.metricsSink = new MetricsProviderSink(this.metrics);

    // --- Tracing --------------------------------------------------------------------------------
    this.tracer = config.tracing
      ? new DefaultTracer({
          exporter: new MultiSpanExporter([new LoggingSpanExporter(this.logger), this.recentSpans]),
          sampleRatio: config.traceSampleRatio,
          ...(overrides.clock === undefined ? {} : { clock: overrides.clock }),
          ...(overrides.ids === undefined ? {} : { ids: overrides.ids }),
          ...(overrides.random === undefined ? {} : { random: overrides.random }),
        })
      : new NoopTracer();

    // --- The single instrumentation point + the remaining ports ----------------------------------
    this.events = new ObservabilityEventSink({
      logger: this.logger,
      metrics: this.metrics,
      tracer: this.tracer,
      ...(overrides.clock === undefined ? {} : { now: overrides.clock }),
    });
    this.resourceObserver = new ObservabilityResourceObserver(this.logger, this.metrics);
    this.health = new WorkerHealthRegistry(overrides.clock ?? ((): number => Date.now()));
  }

  /** The concrete telemetry implementations in use — reported by `/diagnostics`. */
  backends(): Pick<CompositionInfo, 'metricsBackend' | 'tracingBackend' | 'logSinks'> {
    return {
      metricsBackend: this.config.metrics ? 'resilient(in-memory+logging)' : 'noop',
      tracingBackend: this.config.tracing
        ? `default(sample=${this.config.traceSampleRatio})`
        : 'noop',
      logSinks: [this.config.format, 'memory'],
    };
  }

  /** Flush buffered sinks on shutdown. Best-effort; never throws. */
  async flush(): Promise<void> {
    try {
      await this.sink.flush?.();
    } catch {
      /* nothing useful to do while shutting down */
    }
  }
}

/** Build the observability layer from its config. */
export function createObservability(
  config: ObservabilityConfig,
  overrides: ObservabilityOverrides = {},
): Observability {
  return new Observability(config, overrides);
}
