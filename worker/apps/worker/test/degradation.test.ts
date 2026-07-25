import { describe, it, expect } from 'vitest';
import { InMemoryStorageBackend, RecordingLogger } from '@workerv2/worker-runtime';
import { loadAppConfig } from '../src/config.js';
import { bootstrapApp } from '../src/bootstrap.js';
import { WorkerApplication } from '../src/main.js';
import { installSignalHandlers } from '../src/shutdown.js';
import { MemoryLogSink, degraded, unhealthy } from '../src/observability/index.js';
import type { HealthProbe } from '../src/observability/index.js';

/**
 * GRACEFUL DEGRADATION, end to end.
 *
 * The claim under test: every subsystem fails INDEPENDENTLY. A crashed Chromium must not stop image
 * hardening; a dead database must remove the worker from rotation without restarting it; a broken
 * telemetry backend must not be visible to processing at all. These assertions run against the real
 * `WorkerApplication`, not a mock of it.
 */

function buildApp(): { app: WorkerApplication; sink: MemoryLogSink } {
  const config = loadAppConfig({ WV2_POLL_INTERVAL_MS: '5' });
  const sink = new MemoryLogSink();
  const components = bootstrapApp(config, {
    logger: new RecordingLogger(),
    backend: new InMemoryStorageBackend(),
    sink,
  });
  return { app: new WorkerApplication(config, components), sink };
}

function fixedProbe(
  name: string,
  criticality: HealthProbe['criticality'],
  result: ReturnType<typeof degraded>,
): HealthProbe {
  return { name, criticality, ttlMs: 0, check: () => result };
}

describe('graceful degradation — subsystems fail independently', () => {
  it('CHROMIUM down: the worker stays ready and keeps processing; only the status degrades', async () => {
    const { app } = buildApp();
    await app.start();
    app.healthRegistry.register(
      fixedProbe('chromium', 'readiness', degraded('chromium unhealthy')),
    );

    const snapshot = await app.snapshot();
    expect(snapshot.live).toBe(true); // NOT dead
    expect(snapshot.ready).toBe(true); // still accepts image + cleanup jobs
    expect(snapshot.status).toBe('degraded'); // but the operator can see it

    // The consume loop is unaffected — it still polls and processes.
    expect(await app.processOnce()).toBe(false); // empty queue, no error
    await app.stop('test');
  });

  it('DATABASE down: the worker stops accepting work but is NOT restarted', async () => {
    const { app } = buildApp();
    await app.start();
    app.healthRegistry.register(
      fixedProbe('database', 'readiness', unhealthy('postgres unreachable')),
    );

    const snapshot = await app.snapshot();
    expect(snapshot.ready).toBe(false); // pulled from rotation
    expect(snapshot.live).toBe(true); // a restart loop would not fix an external outage
    expect(snapshot.status).toBe('degraded');
    await app.stop('test');
  });

  it('RUNTIME STORAGE down: liveness fails, which is the one case a restart helps', async () => {
    const { app } = buildApp();
    await app.start();
    app.healthRegistry.register(fixedProbe('runtime-storage', 'liveness', unhealthy('disk full')));

    const snapshot = await app.snapshot();
    expect(snapshot.live).toBe(false);
    expect(snapshot.ready).toBe(false);
    await app.stop('test');
  });

  it('a health probe that throws never breaks the health endpoint', async () => {
    const { app } = buildApp();
    await app.start();
    app.healthRegistry.register({
      name: 'exploding',
      criticality: 'informational',
      ttlMs: 0,
      check: () => {
        throw new Error('probe blew up');
      },
    });

    await expect(app.snapshot()).resolves.toMatchObject({ live: true });
    await expect(app.healthReport()).resolves.toMatchObject({ live: true });
    await expect(app.diagnostics()).resolves.toMatchObject({ state: 'idle' });
    await app.stop('test');
  });
});

describe('graceful shutdown — signal handling', () => {
  it('installs SIGINT + SIGTERM handlers and fires the callback exactly once', () => {
    const signals: string[] = [];
    const remove = installSignalHandlers((s) => signals.push(s));
    try {
      process.emit('SIGTERM');
      process.emit('SIGTERM'); // a second signal while draining is ignored
      process.emit('SIGINT');
      expect(signals).toEqual(['SIGTERM']);
    } finally {
      remove();
    }
  });

  it('removes its listeners, leaving no handler behind', () => {
    const before = process.listenerCount('SIGTERM');
    const remove = installSignalHandlers(() => {});
    expect(process.listenerCount('SIGTERM')).toBe(before + 1);
    remove();
    expect(process.listenerCount('SIGTERM')).toBe(before);
  });

  it('drains, stops the monitor, flushes observability and is idempotent', async () => {
    const { app, sink } = buildApp();
    await app.start();
    app.begin();

    await app.stop('signal:SIGTERM');
    await app.stop('signal:SIGTERM'); // second call is a no-op, not a crash

    expect(app.appState).toBe('stopped');
    const shutdown = sink.withMessage('worker.shutdown');
    expect(shutdown).toHaveLength(1);
    expect(shutdown[0]?.detail).toMatchObject({ complete: true, openTraces: 0 });
    // The health endpoint reflects the terminal state rather than lying about readiness.
    expect((await app.snapshot()).status).toBe('stopped');
  });
});
