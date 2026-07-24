import { WorkerRuntime, jsonLineLogger } from '@workerv2/worker-runtime';
import type { StructuredLogger, RuntimeMetrics, StorageBackend } from '@workerv2/worker-runtime';
import type { AppConfig } from './config.js';
import type { QueueAdapter, WorkerJob } from './queue.js';
import { InMemoryQueue } from './queue.js';
import type { JobRunner } from './runner.js';
import { BlueprintJobRunner } from './runner.js';

/**
 * APPLICATION BOOTSTRAP — constructs the production runtime + the app's operational pieces from the
 * loaded config. It COMPOSES existing libraries and duplicates NO runtime logic: it hands the config
 * straight to `WorkerRuntime` (which internally uses the existing `bootstrapRuntime` to wire the durable
 * stores), injects a structured logger + optional metrics, and selects the queue adapter + job runner.
 *
 * `AppComponents` is generic over the job type so ONE `WorkerApplication` drives both the legacy album
 * path (`WorkerJob` + `BlueprintJobRunner`) and the processor path (`Job` + `ProcessorJobRunner`). The
 * default `bootstrapApp` builds the album path; the processor path is assembled in `main.ts` from the
 * shared `buildRuntime` plus the infrastructure queue.
 */

export interface BootstrapOverrides {
  /** Inject a queue adapter (default: an in-memory polling queue). */
  readonly queue?: QueueAdapter;
  /** Inject a structured logger (default: JSON lines to stdout). */
  readonly logger?: StructuredLogger;
  readonly metrics?: RuntimeMetrics;
  /** Inject a durable storage backend (e.g. a shared one to model a restart). */
  readonly backend?: StorageBackend;
  /** Where structured log lines are written (default: process.stdout). */
  readonly write?: (line: string) => void;
}

export interface AppComponents<TJob = WorkerJob> {
  readonly runtime: WorkerRuntime;
  readonly queue: QueueAdapter<TJob>;
  readonly logger: StructuredLogger;
  readonly runner: JobRunner<TJob>;
}

/** Construct the runtime + logger (the lifecycle/health substrate shared by every worker path). */
export function buildRuntime(
  config: AppConfig,
  overrides: BootstrapOverrides = {},
): { runtime: WorkerRuntime; logger: StructuredLogger } {
  const write = overrides.write ?? ((line: string): void => void process.stdout.write(`${line}\n`));
  const logger = overrides.logger ?? jsonLineLogger(write);
  const runtime = new WorkerRuntime(config.runtime, {
    logger,
    ...(overrides.metrics === undefined ? {} : { metrics: overrides.metrics }),
    ...(overrides.backend === undefined ? {} : { backend: overrides.backend }),
  });
  return { runtime, logger };
}

/** Build the default (album/blueprint) worker components. */
export function bootstrapApp(
  config: AppConfig,
  overrides: BootstrapOverrides = {},
): AppComponents<WorkerJob> {
  const { runtime, logger } = buildRuntime(config, overrides);
  return {
    runtime,
    queue: overrides.queue ?? new InMemoryQueue(),
    logger,
    runner: new BlueprintJobRunner(runtime),
  };
}
