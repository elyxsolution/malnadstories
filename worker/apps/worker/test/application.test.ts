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
import { MemoryLogSink } from '../src/observability/index.js';

interface Built {
  app: WorkerApplication;
  components: AppComponents;
  queue: InMemoryQueue;
  /** Captures the RUNTIME's structured records (the library's own logging port). */
  logger: RecordingLogger;
  /**
   * Captures the APPLICATION's records. Phase I-4: the app logs through the observability layer, so
   * its output is asserted at the observability SINK — which is exactly the separation being tested
   * (libraries keep their `StructuredLogger`; the app uses the richer layer).
   */
  sink: MemoryLogSink;
  backend: StorageBackend;
  metrics: RecordingMetrics;
}

function buildApp(backend: StorageBackend = new InMemoryStorageBackend()): Built {
  const config = loadAppConfig({ WV2_POLL_INTERVAL_MS: '5' });
  const queue = new InMemoryQueue();
  const logger = new RecordingLogger();
  const sink = new MemoryLogSink();
  const metrics = new RecordingMetrics();
  const components = bootstrapApp(config, { queue, logger, metrics, backend, sink });
  return {
    app: new WorkerApplication(config, components),
    components,
    queue,
    logger,
    sink,
    backend,
    metrics,
  };
}

function messages(logger: RecordingLogger): string[] {
  return logger.records.map((r) => r.message);
}

/** Application-level log messages, captured at the observability sink. */
function appMessages(sink: MemoryLogSink): string[] {
  return sink.records.map((r) => r.message);
}

describe('application bootstrap + startup', () => {
  it('bootstraps the runtime + queue and starts to idle', async () => {
    const { app, logger, sink } = buildApp();
    expect(app.appState).toBe('starting');
    await app.start();
    expect(app.appState).toBe('idle');
    expect(appMessages(sink)).toEqual(
      expect.arrayContaining([
        'worker.startup',
        'worker.startup.report', // Phase I-4: ONE consolidated startup validation report
        'worker.recovery',
        'worker.ready',
      ]),
    );
    // The runtime library still logs through its own unchanged port.
    expect(messages(logger)).toContain('runtime.started');
    await app.stop('test');
  });

  it('exposes an observational health snapshot', async () => {
    const { app } = buildApp();
    await app.start();
    const snap = await app.snapshot();
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
    expect(appMessages(built.sink)).toEqual(
      expect.arrayContaining(['worker.job.start', 'worker.job.done']),
    );
    // Correlation: every job record carries the job id, bound once by the child logger.
    expect(built.sink.withMessage('worker.job.done')[0]?.jobId).toBe('job-1');
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
    const { app, logger, sink } = buildApp();
    await app.start();
    app.begin();
    await app.stop('signal:SIGTERM');

    expect(app.appState).toBe('stopped');
    expect(appMessages(sink)).toEqual(
      expect.arrayContaining(['worker.draining', 'worker.shutdown']),
    );
    expect(messages(logger)).toContain('runtime.stopped');
    const shutdown = sink.withMessage('worker.shutdown')[0];
    expect(shutdown?.detail).toMatchObject({ complete: true });
    // No trace was left dangling by the drain — the span bookkeeping released everything.
    expect(shutdown?.detail).toMatchObject({ openTraces: 0 });
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
    const recovery = second.sink.withMessage('worker.recovery')[0];
    expect(recovery?.detail).toMatchObject({ recovered: 1 });
    await second.app.stop('test');
  });
});
