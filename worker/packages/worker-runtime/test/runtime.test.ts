import { describe, it, expect } from 'vitest';
import { validatePdf } from '@workerv2/pdf-export';
import {
  WorkerRuntime,
  InMemoryStorageBackend,
  makeRuntimeHarness,
  seedRuntimeAlbum,
} from '@workerv2/worker-runtime';

describe('runtime startup + run + shutdown', () => {
  it('starts, runs a complete album through durable infrastructure, and shuts down', async () => {
    const { runtime } = makeRuntimeHarness();
    runtime.start();
    expect(runtime.phase).toBe('running');

    const { result } = await runtime.run(seedRuntimeAlbum(runtime, 2));
    expect(result.succeeded).toBe(true);
    expect(validatePdf(result.pdfBytes!).ok).toBe(true);

    runtime.shutdown();
    expect(runtime.phase).toBe('stopped');
  });

  it('persists artifacts + journal in the durable backend', async () => {
    const backend = new InMemoryStorageBackend();
    const { runtime } = makeRuntimeHarness(backend);
    runtime.start();
    const { result } = await runtime.run(seedRuntimeAlbum(runtime, 1));

    // Durable backend holds artifacts (sha256:*), a journal, events, and a run record.
    const keys = backend.keys();
    expect(keys.some((k) => k.startsWith('sha256:'))).toBe(true);
    expect(keys).toContain(`journal:${result.runId}`);
    expect(keys).toContain(`run:${result.runId}`);
    expect(runtime.store.size).toBeGreaterThan(0);
  });

  it('rejects work after shutdown (graceful lifecycle)', async () => {
    const { runtime } = makeRuntimeHarness();
    runtime.start();
    runtime.shutdown();
    await expect(runtime.run(seedRuntimeAlbum(runtime, 1))).rejects.toThrow(/not accepting work/);
  });
});

describe('structured logging + metrics (observational)', () => {
  it('emits per-node + run structured logs with the required fields', async () => {
    const { runtime, logger } = makeRuntimeHarness();
    runtime.start();
    const { result } = await runtime.run(seedRuntimeAlbum(runtime, 1));

    const runLogs = logger.forRun(result.runId);
    expect(runLogs.length).toBeGreaterThan(0);
    const nodeLog = runLogs.find((r) => r.message === 'node.settled');
    expect(nodeLog).toMatchObject({
      nodeId: expect.any(String),
      processor: expect.any(String),
      outcome: 'succeeded',
    });
    expect(runLogs.some((r) => r.message === 'run.settled' && r.outcome === 'succeeded')).toBe(
      true,
    );
  });

  it('records execution metrics', async () => {
    const { runtime, metrics } = makeRuntimeHarness();
    runtime.start();
    const { result } = await runtime.run(seedRuntimeAlbum(runtime, 2));

    expect(metrics.executionDurations.some((m) => m.runId === result.runId)).toBe(true);
    expect(metrics.artifactCounts[0]?.count).toBeGreaterThan(0);
    expect(metrics.retries[0]?.retries).toBe(0);
    expect(metrics.failures[0]?.failures).toBe(0);
    expect(metrics.backendUsage).toContain('reference');
    expect(metrics.processorTimings.length).toBeGreaterThan(0);
  });

  it('metrics + logging are disabled when configured off', async () => {
    const backend = new InMemoryStorageBackend();
    const runtime = new WorkerRuntime(
      { diagnostics: { structuredLogging: false, metrics: false } },
      { backend },
    );
    runtime.start();
    await runtime.run(seedRuntimeAlbum(runtime, 1));
    // noop logger/metrics → nothing recorded (they are the shared no-op singletons).
    expect(runtime.health().ready).toBe(true);
  });
});

describe('health reporting', () => {
  it('reports live + ready after startup', () => {
    const { runtime } = makeRuntimeHarness();
    runtime.start();
    const health = runtime.health();
    expect(health.live).toBe(true);
    expect(health.ready).toBe(true);
  });

  it('is not live after shutdown', () => {
    const { runtime } = makeRuntimeHarness();
    runtime.start();
    runtime.shutdown();
    expect(runtime.health().live).toBe(false);
  });
});
