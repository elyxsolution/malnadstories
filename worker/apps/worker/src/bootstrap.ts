import { WorkerRuntime } from '@workerv2/worker-runtime';
import type { StructuredLogger, RuntimeMetrics, StorageBackend } from '@workerv2/worker-runtime';
import type { AppConfig } from './config.js';
import type { QueueAdapter, WorkerJob } from './queue.js';
import { InMemoryQueue } from './queue.js';
import type { JobRunner } from './runner.js';
import { BlueprintJobRunner } from './runner.js';
import type { ConcurrencyController } from './concurrency.js';
import type {
  LogSink,
  Observability,
  RuntimeMonitor,
  StartupDiagnostics,
} from './observability/index.js';
import { createObservability } from './observability/index.js';

/**
 * APPLICATION BOOTSTRAP — constructs the observability layer, the production runtime, and the app's
 * operational pieces from the loaded config. It COMPOSES existing libraries and duplicates NO runtime
 * logic: it hands the config straight to `WorkerRuntime` (which internally uses the existing
 * `bootstrapRuntime` to wire the durable stores) and selects the queue adapter + job runner.
 *
 * OBSERVABILITY IS BUILT FIRST, and everything else receives its ports. That ordering matters: the
 * runtime, the infrastructure adapters and the pipeline stages all depend on the Worker Runtime's
 * `StructuredLogger`, and they are handed `observability.structuredLogger` — the bridge — so their
 * unchanged logging calls flow through the observability layer's levels, bound fields and sinks
 * without a single one of those components being modified.
 *
 * `AppComponents` is generic over the job type so ONE `WorkerApplication` drives both the album path
 * (`WorkerJob` + `BlueprintJobRunner`) and the processor path (`Job` + `ProcessorJobRunner`).
 */

export interface BootstrapOverrides {
  /** Inject a queue adapter (default: an in-memory polling queue). */
  readonly queue?: QueueAdapter;
  /**
   * Inject the `StructuredLogger` handed to the runtime + adapters (default: the observability
   * bridge). Tests use this to capture runtime records directly; the observability layer is still
   * constructed, so health, metrics and tracing behave identically.
   */
  readonly logger?: StructuredLogger;
  /** Inject the observability log sink (captures the app's own structured output in tests). */
  readonly sink?: LogSink;
  readonly metrics?: RuntimeMetrics;
  /** Inject a durable storage backend (e.g. a shared one to model a restart). */
  readonly backend?: StorageBackend;
  /** Inject a fully-built observability layer (advanced composition + tests). */
  readonly observability?: Observability;
}

/** What the composition root registered, for the diagnostics report. */
export interface CompositionSources {
  readonly processors?: () => readonly string[];
  readonly resources?: () => readonly string[];
  readonly recoveryHandlers?: () => readonly string[];
}

export interface AppComponents<TJob = WorkerJob> {
  readonly runtime: WorkerRuntime;
  readonly queue: QueueAdapter<TJob>;
  /** The runtime-shaped logger handed to libraries that predate the observability layer. */
  readonly logger: StructuredLogger;
  readonly runner: JobRunner<TJob>;
  /** The observability layer. Owns logging, tracing, metrics, health and diagnostics. */
  readonly observability: Observability;
  /** Startup validation to run before the worker becomes ready. */
  readonly startup?: StartupDiagnostics;
  /** Periodic resource sampler, started with the app and stopped with it. */
  readonly monitor?: RuntimeMonitor;
  /** Registry contents for `/diagnostics`. */
  readonly composition?: CompositionSources;
  /**
   * Concurrency lanes. Injected so a composition root (or a load test) can share ONE controller
   * between the dispatch loop and the recovery scheduler — which is how recovery learns to defer
   * while production work is heavy. Omitted, the application builds its own from config.
   */
  readonly concurrency?: ConcurrencyController;
}

/** Construct observability + the runtime (the substrate shared by every worker path). */
export function buildRuntime(
  config: AppConfig,
  overrides: BootstrapOverrides = {},
): { runtime: WorkerRuntime; logger: StructuredLogger; observability: Observability } {
  const observability =
    overrides.observability ??
    createObservability(
      config.observability,
      overrides.sink === undefined ? {} : { sink: overrides.sink },
    );
  const logger = overrides.logger ?? observability.structuredLogger;
  const runtime = new WorkerRuntime(config.runtime, {
    logger,
    ...(overrides.metrics === undefined ? {} : { metrics: overrides.metrics }),
    ...(overrides.backend === undefined ? {} : { backend: overrides.backend }),
  });
  return { runtime, logger, observability };
}

/** Build the default (album/blueprint) worker components. */
export function bootstrapApp(
  config: AppConfig,
  overrides: BootstrapOverrides = {},
): AppComponents<WorkerJob> {
  const { runtime, logger, observability } = buildRuntime(config, overrides);
  return {
    runtime,
    queue: overrides.queue ?? new InMemoryQueue(),
    logger,
    observability,
    runner: new BlueprintJobRunner(runtime),
  };
}
