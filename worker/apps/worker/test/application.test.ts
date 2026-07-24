import { describe, it, expect } from 'vitest';
import {
  InMemoryStorageBackend,
  RecordingLogger,
  RecordingMetrics,
  seedRuntimeAlbum,
} from '@workerv2/worker-runtime';
import type { StorageBackend } from '@workerv2/worker-runtime';
import { loadAppConfig } from '../src/config.js';
import { bootstrapApp } from '../src/bootstrap.js';
import type { AppComponents } from '../src/bootstrap.js';
import { InMemoryQueue } from '../src/queue.js';
import { WorkerApplication } from '../src/main.js';

interface Built {
  app: WorkerApplication;
  components: AppComponents;
  queue: InMemoryQueue;
  logger: RecordingLogger;
  backend: StorageBackend;
  metrics: RecordingMetrics;
}

function buildApp(backend: StorageBackend = new InMemoryStorageBackend()): Built {
  const config = loadAppConfig({ WV2_POLL_INTERVAL_MS: '5' });
  const queue = new InMemoryQueue();
  const logger = new RecordingLogger();
  const metrics = new RecordingMetrics();
  const components = bootstrapApp(config, { queue, logger, metrics, backend });
  return {
    app: new WorkerApplication(config, components),
    components,
    queue,
    logger,
    backend,
    metrics,
  };
}

function messages(logger: RecordingLogger): string[] {
  return logger.records.map((r) => r.message);
}

describe('application bootstrap + startup', () => {
  it('bootstraps the runtime + queue and starts to idle', async () => {
    const { app, logger } = buildApp();
    expect(app.appState).toBe('starting');
    await app.start();
    expect(app.appState).toBe('idle');
    expect(messages(logger)).toEqual(
      expect.arrayContaining([
        'worker.startup',
        'runtime.started',
        'worker.recovery',
        'worker.ready',
      ]),
    );
    await app.stop('test');
  });

  it('exposes an observational health snapshot', async () => {
    const { app } = buildApp();
    await app.start();
    const snap = app.snapshot();
    expect(snap).toMatchObject({
      state: 'idle',
      storage: 'healthy',
      currentJob: null,
      version: '0.0.0',
    });
    await app.stop('test');
  });
});

describe('job processing', () => {
  it('consumes a queued job and produces a PDF (via the unchanged runtime)', async () => {
    const built = buildApp();
    await built.app.start();
    const blueprint = seedRuntimeAlbum(built.components.runtime, 1);
    built.queue.enqueue({ id: 'job-1', blueprint });

    const processed = await built.app.processOnce();
    expect(processed).toBe(true);
    expect(built.queue.ackedIds).toEqual(['job-1']);
    expect(messages(built.logger)).toEqual(
      expect.arrayContaining(['worker.job.start', 'worker.job.done']),
    );
    // The runtime's own structured logs flow through the same injected logger.
    expect(messages(built.logger)).toContain('run.settled');
    expect(built.metrics.executionDurations.length).toBeGreaterThan(0);
    await built.app.stop('test');
  });

  it('processOnce returns false when the queue is empty', async () => {
    const { app } = buildApp();
    await app.start();
    expect(await app.processOnce()).toBe(false);
    await app.stop('test');
  });
});

describe('graceful shutdown', () => {
  it('drains the consume loop, shuts down the runtime, and logs the shutdown summary', async () => {
    const { app, logger } = buildApp();
    await app.start();
    app.begin();
    await app.stop('signal:SIGTERM');

    expect(app.appState).toBe('stopped');
    expect(messages(logger)).toEqual(
      expect.arrayContaining(['worker.draining', 'worker.shutdown', 'runtime.stopped']),
    );
    const shutdown = logger.records.find((r) => r.message === 'worker.shutdown');
    expect(shutdown?.detail).toMatchObject({ complete: true });
  });

  it('a whenStopped() promise resolves after graceful stop', async () => {
    const { app } = buildApp();
    await app.start();
    app.begin();
    const stopped = app.whenStopped();
    await app.stop('test');
    await expect(stopped).resolves.toBeUndefined();
  });
});

describe('restart recovery startup', () => {
  it('a fresh application over the same durable backend recovers prior runs at startup', async () => {
    const backend = new InMemoryStorageBackend();

    // App #1 runs a job, persisting artifacts + journal + run record durably.
    const first = buildApp(backend);
    await first.app.start();
    const blueprint = seedRuntimeAlbum(first.components.runtime, 1);
    first.queue.enqueue({ id: 'job-1', blueprint });
    await first.app.processOnce();
    await first.app.stop('test');

    // App #2 (restart) over the SAME backend recovers the run during startup.
    const second = buildApp(backend);
    await second.app.start();
    const recovery = second.logger.records.find((r) => r.message === 'worker.recovery');
    expect(recovery?.detail).toMatchObject({ recovered: 1 });
    await second.app.stop('test');
  });
});
