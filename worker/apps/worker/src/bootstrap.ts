import { WorkerRuntime, jsonLineLogger } from '@workerv2/worker-runtime';
import type { StructuredLogger, RuntimeMetrics, StorageBackend } from '@workerv2/worker-runtime';
import type { AppConfig } from './config.js';
import type { QueueAdapter } from './queue.js';
import { InMemoryQueue } from './queue.js';

/**
 * APPLICATION BOOTSTRAP — constructs the production runtime + the app's operational pieces from the
 * loaded config. It COMPOSES existing libraries and duplicates NO runtime logic: it hands the config
 * straight to `WorkerRuntime` (which internally uses the existing `bootstrapRuntime` to wire the
 * durable stores), injects a structured logger + optional metrics, and selects the queue adapter.
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

export interface AppComponents {
  readonly runtime: WorkerRuntime;
  readonly queue: QueueAdapter;
  readonly logger: StructuredLogger;
}

/** Build the runtime + queue + logger for a configured worker. */
export function bootstrapApp(config: AppConfig, overrides: BootstrapOverrides = {}): AppComponents {
  const write = overrides.write ?? ((line: string): void => void process.stdout.write(`${line}\n`));
  const logger = overrides.logger ?? jsonLineLogger(write);

  const runtime = new WorkerRuntime(config.runtime, {
    logger,
    ...(overrides.metrics === undefined ? {} : { metrics: overrides.metrics }),
    ...(overrides.backend === undefined ? {} : { backend: overrides.backend }),
  });

  return {
    runtime,
    queue: overrides.queue ?? new InMemoryQueue(),
    logger,
  };
}
