import { describe, it, expect } from 'vitest';
import { createReferenceBackend } from '@workerv2/image-backend';
import {
  resolveRuntimeConfig,
  loadRuntimeConfigFromEnv,
  retryPolicies,
  DEFAULT_RUNTIME_CONFIG,
  WorkerLifecycle,
  reportHealth,
  InMemoryStorageBackend,
} from '@workerv2/worker-runtime';

describe('runtime configuration (external, injectable)', () => {
  it('applies defaults', () => {
    expect(resolveRuntimeConfig()).toEqual(DEFAULT_RUNTIME_CONFIG);
  });

  it('loads from environment variables', () => {
    const config = loadRuntimeConfigFromEnv({
      WV2_STORAGE: 'filesystem',
      WV2_STORAGE_ROOT: '/data',
      WV2_BACKEND: 'reference',
      WV2_LOGGING: 'off',
    });
    expect(config.storage).toEqual({ kind: 'filesystem', root: '/data' });
    expect(config.diagnostics.structuredLogging).toBe(false);
  });

  it('translates retry overrides into declarative manifest policies', () => {
    expect(retryPolicies(resolveRuntimeConfig())).toBeUndefined();
    const policies = retryPolicies(
      resolveRuntimeConfig({ retryOverrides: { maxAttempts: 3, backoffMs: 50 } }),
    );
    expect(policies?.retry).toMatchObject({ maxAttempts: 3, backoff: 'fixed', initialDelayMs: 50 });
  });
});

describe('WorkerLifecycle', () => {
  it('transitions idle → running → draining → stopped', () => {
    const l = new WorkerLifecycle();
    expect(l.phase).toBe('idle');
    l.starting();
    l.started();
    expect(l.running).toBe(true);
    expect(l.live).toBe(true);
    l.beginRun();
    l.endRun();
    l.drain();
    expect(l.phase).toBe('draining');
    l.stop();
    expect(l.phase).toBe('stopped');
    expect(l.live).toBe(false);
  });

  it('rejects work when not running and refuses to stop with in-flight work', () => {
    const l = new WorkerLifecycle();
    expect(() => l.beginRun()).toThrow(/not accepting work/);
    l.starting();
    l.started();
    l.beginRun();
    expect(() => l.stop()).toThrow(/in flight/);
    l.endRun();
    l.stop();
    expect(l.phase).toBe('stopped');
  });
});

describe('health (observational)', () => {
  it('reports live + ready with healthy dependencies', () => {
    const report = reportHealth({
      live: true,
      started: true,
      storage: new InMemoryStorageBackend(),
      backend: createReferenceBackend(),
    });
    expect(report.live).toBe(true);
    expect(report.ready).toBe(true);
    expect(report.dependencies.map((d) => d.name).sort()).toEqual(['backend', 'storage']);
    expect(report.dependencies.every((d) => d.state === 'healthy')).toBe(true);
  });

  it('is not ready before startup', () => {
    const report = reportHealth({
      live: true,
      started: false,
      storage: new InMemoryStorageBackend(),
      backend: createReferenceBackend(),
    });
    expect(report.ready).toBe(false);
  });
});
