/**
 * THE OBSERVABILITY LAYER — the worker's single, dedicated home for logging, tracing, metrics,
 * health and diagnostics.
 *
 * The organising rule: PROCESSING COMPONENTS EMIT EVENTS AND EXPOSE STATE; THIS LAYER TURNS THOSE
 * INTO SIGNALS. No processor, stage, pipeline, recovery handler or infrastructure adapter imports a
 * logging library, a metrics client, a tracer, or `console`. They emit `ProcessorEvent`s and expose
 * `healthCheck()`/stats; `ObservabilityEventSink` and the health probes do the rest.
 *
 * That inversion is what makes the monitoring backend replaceable: swapping to Prometheus or
 * OpenTelemetry means implementing `MetricsProvider` / `SpanExporter` / `LogSink` and changing one
 * line at the composition root — with zero edits to processing code.
 *
 * Layout:
 *   model.ts             severity levels, the correlated field set, sanitization + bounding
 *   logging.ts           the `WorkerLogger` port + its reference implementation
 *   sinks.ts             pluggable log destinations + the Worker Runtime logger bridge
 *   tracing.ts           span/tracer contracts + the reference tracer (head sampling)
 *   trace-exporters.ts   replaceable tracing backends
 *   metrics.ts           `MetricsProvider` (= `@workerv2/metrics`) + resilience + the I-3 bridge
 *   metric-names.ts      the metric vocabulary (a public dashboard contract)
 *   health.ts            criticality-aware health registry (liveness vs readiness) + aggregation
 *   probes.ts            the concrete component probes
 *   monitor.ts           periodic resource sampling → gauges
 *   startup.ts           startup validation → ONE report, fail fast on critical checks
 *   diagnostics.ts       the production-debugging report (identity + composition + state)
 *   event-sink.ts        THE single instrumentation point (events → logs + metrics + traces)
 *   resource-observer.ts the Resource Manager's observability seam
 *   observability.ts     the facade that owns and wires all of the above
 */

// --- Model + logging ---
export type { LogLevel, LogRecord, ObservabilityFields, SanitizeLimits } from './model.js';
export {
  DEFAULT_LIMITS,
  LEVEL_ORDER,
  LOG_LEVELS,
  REDACTED,
  compactFields,
  errorMessage,
  isLogLevel,
  parseLogLevel,
  sanitizeDetail,
  sanitizeValue,
} from './model.js';

export type { WorkerLogger, ObservabilityLoggerOptions } from './logging.js';
export { NoopLogger, ObservabilityLogger } from './logging.js';

export type { LogSink } from './sinks.js';
export {
  ConsoleLogSink,
  JsonLogSink,
  MemoryLogSink,
  MultiLogSink,
  NoopLogSink,
  asStructuredLogger,
  resilientSink,
} from './sinks.js';

// --- Tracing ---
export type {
  FinishedSpan,
  Span,
  SpanAttributes,
  SpanContext,
  SpanExporter,
  SpanStatus,
  StartSpanOptions,
  Tracer,
} from './tracing.js';
export { DefaultTracer, NOOP_SPAN, NoopTracer, spanFields } from './tracing.js';
export {
  LoggingSpanExporter,
  MemorySpanExporter,
  MultiSpanExporter,
  NoopSpanExporter,
} from './trace-exporters.js';

// --- Metrics ---
export type { MetricsProvider, MetricTags, Timer } from './metrics.js';
export {
  InMemoryMetricsProvider,
  LoggingMetricsProvider,
  MetricsProviderSink,
  MultiMetricsProvider,
  NoopMetricsProvider,
  ResilientMetricsProvider,
  startTimer,
} from './metrics.js';
export { WORKER_METRICS } from './metric-names.js';
export type { WorkerMetricName } from './metric-names.js';

// --- Health ---
export type {
  ComponentHealth,
  ComponentReport,
  Criticality,
  HealthProbe,
  HealthStatus,
  WorkerHealthReport,
} from './health.js';
export {
  HEALTHY,
  WorkerHealthRegistry,
  degraded,
  healthy,
  statusValue,
  unhealthy,
} from './health.js';
export type {
  BinaryHealthSource,
  MemoryThresholds,
  ResourceHealthSource,
  ResourceManagerStats,
  RuntimeHealthSource,
  SchedulerStats,
} from './probes.js';
export {
  chromiumProbe,
  configurationProbe,
  cpuProbe,
  databaseProbe,
  memoryProbe,
  objectStoreProbe,
  processorsProbe,
  queueCoverageProbe,
  queueProbe,
  recoverySchedulerProbe,
  resourceManagerProbe,
  runtimeStorageProbe,
} from './probes.js';

// --- Monitoring ---
export type {
  BrowserStats,
  CpuSample,
  MonitorSources,
  ResourceSnapshot,
  RuntimeMonitorOptions,
} from './monitor.js';
export { RuntimeMonitor } from './monitor.js';

// --- Startup + diagnostics ---
export type {
  StartupCheck,
  StartupCheckReport,
  StartupCheckResult,
  StartupOutcome,
  StartupReport,
} from './startup.js';
export { PASS, StartupDiagnostics, StartupError, fail, pass, warn } from './startup.js';
export type {
  CompositionInfo,
  DiagnosticsInputs,
  DiagnosticsReport,
  PlatformInfo,
} from './diagnostics.js';
export { buildDiagnosticsReport, readBuildIdentity, readPlatformInfo } from './diagnostics.js';

// --- The instrumentation point + facade ---
export { ObservabilityEventSink } from './event-sink.js';
export type { ObservabilityEventSinkDeps } from './event-sink.js';
export type { ResourceObserver } from './resource-observer.js';
export { NoopResourceObserver, ObservabilityResourceObserver } from './resource-observer.js';
export { Observability, createObservability } from './observability.js';
export type { ObservabilityConfig, ObservabilityOverrides } from './observability.js';
