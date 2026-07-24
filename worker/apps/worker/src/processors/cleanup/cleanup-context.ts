import type { StructuredLogger } from '@workerv2/worker-runtime';
import type { ObjectStore } from '../../infra/storage/object-store.js';
import type { MetricsSink } from '../../recovery/metrics.js';
import type { Stage } from '../pipeline/pipeline.js';

/**
 * THE CLEANUP CONTEXT — the value threaded through the R2 cleanup pipeline. The app hands the worker an
 * explicit list of keys (album deletion already removed the DB rows), so the context is just the key set
 * + the running delete count. No mutable data is looked up mid-flight.
 */
export interface CleanupContext {
  readonly keys: readonly string[];
  readonly deleted: number;
}

export interface CleanupDeps {
  readonly objectStore: ObjectStore;
  readonly logger: StructuredLogger;
  readonly metrics: MetricsSink;
}

export type CleanupStage = Stage<CleanupContext, CleanupDeps>;
