import type { ImageBackend } from '@workerv2/image-backend';
import { WorkerHost } from '@workerv2/worker-host';
import type { RuntimeConfig } from './config.js';
import { InMemoryStorageBackend, FileSystemStorageBackend } from './storage/backend.js';
import type { StorageBackend } from './storage/backend.js';
import { PersistentArtifactStore } from './storage/artifact-store.js';
import { DurableJournalStore, PersistentEventSink } from './storage/journal-store.js';
import { RunRecordStore } from './storage/run-records.js';
import type { StructuredLogger } from './logging.js';
import { noopLogger } from './logging.js';
import type { RuntimeMetrics } from './metrics.js';
import { noopMetrics } from './metrics.js';

/**
 * RUNTIME BOOTSTRAP — constructs the DURABLE infrastructure and injects it into a Worker Host. This
 * is the ONLY place the runtime replaces in-memory stores with durable ones; the host + every core
 * package are untouched. Dependency initialization order: storage backend → durable stores → host
 * (with the durable stores injected) → logging/metrics selection.
 */

export interface BootstrapDeps {
  /** Inject a specific storage backend (e.g. a shared in-memory backend to model a restart). */
  readonly backend?: StorageBackend;
  /** Additional ImageBackends to register for selection/replacement. */
  readonly backends?: ReadonlyArray<{ readonly id: string; readonly backend: ImageBackend }>;
  readonly logger?: StructuredLogger;
  readonly metrics?: RuntimeMetrics;
}

export interface RuntimeComponents {
  readonly host: WorkerHost;
  readonly backend: StorageBackend;
  readonly store: PersistentArtifactStore;
  readonly journalStore: DurableJournalStore;
  readonly eventSink: PersistentEventSink;
  readonly runRecords: RunRecordStore;
  readonly imageBackend: ImageBackend;
  readonly logger: StructuredLogger;
  readonly metrics: RuntimeMetrics;
}

/** Build a durable-infrastructure Worker Host + the runtime's operational services. */
export function bootstrapRuntime(
  config: RuntimeConfig,
  deps: BootstrapDeps = {},
): RuntimeComponents {
  const backend = deps.backend ?? createBackend(config);
  const store = new PersistentArtifactStore(backend);
  const journalStore = new DurableJournalStore(backend);
  const eventSink = new PersistentEventSink(backend);
  const runRecords = new RunRecordStore(backend);

  const host = new WorkerHost(
    { backendId: config.backendId, clockStart: config.clockStart },
    {
      store,
      journalStore,
      eventSink,
      ...(deps.backends === undefined ? {} : { backends: deps.backends }),
    },
  );

  const logger = config.diagnostics.structuredLogging ? (deps.logger ?? noopLogger) : noopLogger;
  const metrics = config.diagnostics.metrics ? (deps.metrics ?? noopMetrics) : noopMetrics;

  return {
    host,
    backend,
    store,
    journalStore,
    eventSink,
    runRecords,
    imageBackend: host.backends.get(config.backendId),
    logger,
    metrics,
  };
}

function createBackend(config: RuntimeConfig): StorageBackend {
  if (config.storage.kind === 'filesystem') {
    if (config.storage.root === undefined) {
      throw new Error('filesystem storage requires a root directory');
    }
    return new FileSystemStorageBackend(config.storage.root);
  }
  return new InMemoryStorageBackend();
}
