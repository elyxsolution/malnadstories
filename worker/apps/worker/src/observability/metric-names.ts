/**
 * THE METRIC VOCABULARY — every metric name the worker emits, in one place.
 *
 * Names are a PUBLIC CONTRACT: dashboards, alerts, and recording rules are written against them, so
 * they live here rather than being spelled inline at emission sites. The convention is
 * `worker.<subsystem>.<measurement>[_unit]`, lower_snake within a dot-separated namespace — a shape
 * that maps cleanly onto Prometheus (`worker_processor_duration_ms`), OTel, and StatsD alike.
 *
 * Dimensions are TAGS, never name suffixes (`worker.processor.completed{processor="album-pdf"}`,
 * not `worker.processor.album_pdf.completed`), which keeps cardinality bounded and dashboards
 * generic. Tag values are always low-cardinality: processor/stage/outcome/resource names — never a
 * job id, photo id, album id, or correlation id.
 */
export const WORKER_METRICS = {
  // --- Job lifecycle (the consume loop) ---
  jobsReceived: 'worker.jobs.received',
  jobsCompleted: 'worker.jobs.completed',
  jobsFailed: 'worker.jobs.failed',
  jobDurationMs: 'worker.jobs.duration_ms',
  jobsActive: 'worker.jobs.active',

  // --- Processor + pipeline execution (derived from the processor event stream) ---
  processorStarted: 'worker.processor.started',
  processorCompleted: 'worker.processor.completed',
  processorFailed: 'worker.processor.failed',
  processorSkipped: 'worker.processor.skipped',
  processorRejected: 'worker.processor.rejected',
  processorDurationMs: 'worker.processor.duration_ms',
  stageCompleted: 'worker.stage.completed',
  stageFailed: 'worker.stage.failed',
  stageDurationMs: 'worker.stage.duration_ms',

  // --- Recovery / self-healing ---
  recoveryStaleDetected: 'worker.recovery.stale_detected',
  recoveryOutcome: 'worker.recovery.outcome',
  recoveryFailed: 'worker.recovery.failed',
  recoveryDurationMs: 'worker.recovery.duration_ms',
  recoverySweepDurationMs: 'worker.recovery.sweep_duration_ms',
  recoveryBacklog: 'worker.recovery.backlog',

  // --- Cleanup ---
  cleanupObjectsRemoved: 'worker.cleanup.objects_removed',
  cleanupDurationMs: 'worker.cleanup.duration_ms',

  // --- Long-lived resources (Chromium et al., via the ResourceManager observer) ---
  resourceCreated: 'worker.resource.created',
  resourceReset: 'worker.resource.reset',
  resourceAcquireDurationMs: 'worker.resource.acquire_duration_ms',
  resourceAcquireFailed: 'worker.resource.acquire_failed',
  resourcesLive: 'worker.resource.live',
  browserPagesOpen: 'worker.resource.browser_pages_open',

  // --- Process resources ---
  memoryRssBytes: 'worker.process.memory_rss_bytes',
  memoryHeapUsedBytes: 'worker.process.memory_heap_used_bytes',
  memoryHeapTotalBytes: 'worker.process.memory_heap_total_bytes',
  memoryExternalBytes: 'worker.process.memory_external_bytes',
  cpuUserPercent: 'worker.process.cpu_user_percent',
  cpuSystemPercent: 'worker.process.cpu_system_percent',
  uptimeSeconds: 'worker.process.uptime_seconds',
  eventLoopDelayMs: 'worker.process.event_loop_delay_ms',

  // --- Queue ---
  queueDepth: 'worker.queue.depth',
  queuePollEmpty: 'worker.queue.poll_empty',

  // --- Health ---
  healthCheckDurationMs: 'worker.health.check_duration_ms',
  healthComponentStatus: 'worker.health.component_status',
} as const;

/** A metric name from the vocabulary above. */
export type WorkerMetricName = (typeof WORKER_METRICS)[keyof typeof WORKER_METRICS];
