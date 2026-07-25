import type { StructuredLogger } from '@workerv2/worker-runtime';
import type { ObjectStore } from '../../infra/storage/object-store.js';
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

/**
 * Stage dependencies. Note what is NOT here: a metrics sink. Phase I-4 removed it — the delete count
 * already travels on the `cleanup.completed` event, so the Observability layer derives the
 * `worker.cleanup.objects_removed` counter from that one fact. A stage that both emitted an event AND
 * incremented a counter was stating the same thing twice, in two places that could drift.
 */
export interface CleanupDeps {
  readonly objectStore: ObjectStore;
  readonly logger: StructuredLogger;
}

export type CleanupStage = Stage<CleanupContext, CleanupDeps>;
