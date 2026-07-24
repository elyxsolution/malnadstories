import type { Blueprint } from '@workerv2/blueprint';
import { compileBlueprint } from '@workerv2/blueprint';
import { solidRaster } from '@workerv2/image-backend';
import { InMemoryStorageBackend } from './storage/backend.js';
import type { StorageBackend } from './storage/backend.js';
import { RecordingLogger } from './logging.js';
import { RecordingMetrics } from './metrics.js';
import { WorkerRuntime } from './runtime.js';
import type { RuntimeConfig } from './config.js';

/**
 * The RUNTIME INTEGRATION HARNESS — builds a runtime over an INJECTED (shareable) storage backend
 * with recording logger + metrics, so a test can drive a real album run through durable
 * infrastructure and then SIMULATE A RESTART by constructing a fresh runtime over the SAME backend.
 * Ships in `src` (no test framework imported).
 */

export interface RuntimeHarness {
  readonly runtime: WorkerRuntime;
  readonly backend: StorageBackend;
  readonly logger: RecordingLogger;
  readonly metrics: RecordingMetrics;
}

/** Build a runtime over a (given or new) shared backend with recording diagnostics. */
export function makeRuntimeHarness(
  backend: StorageBackend = new InMemoryStorageBackend(),
  config: Partial<RuntimeConfig> = {},
): RuntimeHarness {
  const logger = new RecordingLogger();
  const metrics = new RecordingMetrics();
  const runtime = new WorkerRuntime(
    { diagnostics: { structuredLogging: true, metrics: true }, ...config },
    { backend, logger, metrics },
  );
  return { runtime, backend, logger, metrics };
}

/** Seed page-source images + build a small album blueprint referencing them, via a runtime. */
export function seedRuntimeAlbum(runtime: WorkerRuntime, spreads = 1): Blueprint {
  const cover = runtime.seedRasterArtifact(solidRaster(16, 16, [200, 40, 40]));
  const spreadSources = [];
  for (let i = 0; i < spreads; i += 1) {
    const key = runtime.seedRasterArtifact(solidRaster(16, 16, [40 + i * 20, 200 - i * 10, 60]));
    spreadSources.push({
      pages: 1 as const,
      placements: [{ slot: 'main', artifact: key, frame: { x: 0, y: 0, w: 1, h: 1 } }],
    });
  }
  const compiled = compileBlueprint({
    albumId: 'album-1',
    title: 'Runtime Album',
    cover: { placements: [{ slot: 'main', artifact: cover, frame: { x: 0, y: 0, w: 1, h: 1 } }] },
    spreads: spreadSources,
  });
  if (!compiled.ok) throw new Error(`blueprint compile failed: ${compiled.error.message}`);
  return compiled.value.blueprint;
}
