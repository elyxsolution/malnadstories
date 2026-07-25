import { describe, it, expect } from 'vitest';
import {
  WorkerHealthRegistry,
  chromiumProbe,
  configurationProbe,
  cpuProbe,
  databaseProbe,
  degraded,
  healthy,
  memoryProbe,
  objectStoreProbe,
  processorsProbe,
  queueProbe,
  recoverySchedulerProbe,
  resourceManagerProbe,
  runtimeStorageProbe,
  statusValue,
  unhealthy,
} from '../src/observability/index.js';
import type { HealthProbe } from '../src/observability/index.js';

function probe(
  name: string,
  criticality: HealthProbe['criticality'],
  status: 'healthy' | 'degraded' | 'unhealthy',
): HealthProbe {
  return {
    name,
    criticality,
    ttlMs: 0,
    check: () =>
      status === 'healthy' ? healthy() : status === 'degraded' ? degraded('d') : unhealthy('u'),
  };
}

describe('health aggregation — liveness vs readiness', () => {
  it('an empty registry is healthy, live and ready', async () => {
    const report = await new WorkerHealthRegistry().report();
    expect(report).toMatchObject({ status: 'healthy', live: true, ready: true });
    expect(report.components).toEqual([]);
  });

  it('overall status is the WORST component status', async () => {
    const registry = new WorkerHealthRegistry();
    registry.register(probe('a', 'readiness', 'healthy'));
    registry.register(probe('b', 'informational', 'degraded'));
    expect((await registry.report()).status).toBe('degraded');

    registry.register(probe('c', 'informational', 'unhealthy'));
    expect((await registry.report()).status).toBe('unhealthy');
  });

  it('an unhealthy READINESS component clears readiness but NOT liveness', async () => {
    const registry = new WorkerHealthRegistry();
    registry.register(probe('database', 'readiness', 'unhealthy'));
    const report = await registry.report();
    expect(report.ready).toBe(false);
    expect(report.live).toBe(true); // an external outage must not trigger a restart loop
  });

  it('an unhealthy LIVENESS component clears both', async () => {
    const registry = new WorkerHealthRegistry();
    registry.register(probe('runtime-storage', 'liveness', 'unhealthy'));
    const report = await registry.report();
    expect(report.live).toBe(false);
    expect(report.ready).toBe(false);
  });

  it('a DEGRADED readiness component lowers status but keeps the worker in rotation', async () => {
    const registry = new WorkerHealthRegistry();
    registry.register(probe('chromium', 'readiness', 'degraded'));
    const report = await registry.report();
    expect(report.status).toBe('degraded');
    expect(report.ready).toBe(true); // still takes image + cleanup work
    expect(report.live).toBe(true);
  });

  it('an informational component never affects liveness or readiness', async () => {
    const registry = new WorkerHealthRegistry();
    registry.register(probe('cpu', 'informational', 'unhealthy'));
    const report = await registry.report();
    expect(report.status).toBe('unhealthy');
    expect(report.live).toBe(true);
    expect(report.ready).toBe(true);
  });
});

describe('health probing is total and cheap', () => {
  it('a probe that throws becomes unhealthy rather than an exception', async () => {
    const registry = new WorkerHealthRegistry();
    registry.register({
      name: 'exploding',
      criticality: 'readiness',
      ttlMs: 0,
      check: () => {
        throw new Error('probe blew up');
      },
    });
    const report = await registry.report();
    expect(report.components[0]).toMatchObject({ status: 'unhealthy', detail: 'probe blew up' });
    expect(report.ready).toBe(false);
  });

  it('caches per-probe for its TTL, so orchestrator polling cannot hammer a dependency', async () => {
    let calls = 0;
    let now = 0;
    const registry = new WorkerHealthRegistry(() => now);
    registry.register({
      name: 'database',
      criticality: 'readiness',
      ttlMs: 5_000,
      check: () => {
        calls += 1;
        return healthy();
      },
    });

    await registry.report();
    await registry.report();
    await registry.report();
    expect(calls).toBe(1);
    expect((await registry.report()).components[0]?.cached).toBe(true);

    now = 6_000; // TTL expired
    await registry.report();
    expect(calls).toBe(2);

    registry.invalidate(); // the manual "run checks now" path
    await registry.report();
    expect(calls).toBe(3);
  });

  it('reports components in a stable, sorted order', async () => {
    const registry = new WorkerHealthRegistry();
    registry.register(probe('zulu', 'informational', 'healthy'));
    registry.register(probe('alpha', 'informational', 'healthy'));
    expect((await registry.report()).components.map((c) => c.name)).toEqual(['alpha', 'zulu']);
    expect(registry.names).toEqual(['alpha', 'zulu']);
  });
});

describe('concrete probes encode the operational policy', () => {
  it('database / queue / storage are readiness-critical and binary', async () => {
    const down = { healthCheck: async (): Promise<'unhealthy'> => 'unhealthy' };
    const up = { healthCheck: async (): Promise<'healthy'> => 'healthy' };
    for (const make of [databaseProbe, queueProbe, objectStoreProbe]) {
      expect(make(down).criticality).toBe('readiness');
      expect((await make(down).check()).status).toBe('unhealthy');
      expect((await make(up).check()).status).toBe('healthy');
    }
  });

  it('CHROMIUM degrades rather than failing — PDF is unavailable, other processors are not', async () => {
    const crashed = chromiumProbe({ health: async () => 'unhealthy' });
    const result = await crashed.check();
    expect(result.status).toBe('degraded');
    expect(result.detail).toMatch(/other processors unaffected/);
  });

  it('an ABSENT (lazily unlaunched) browser is healthy, not degraded', async () => {
    const lazy = chromiumProbe({ health: async () => 'absent' });
    expect((await lazy.check()).status).toBe('healthy');
  });

  it('memory back-pressures at the soft limit and refuses work at the hard limit', async () => {
    const thresholds = { softLimitBytes: 100, hardLimitBytes: 200 };
    const usageOf = (rss: number): NodeJS.MemoryUsage =>
      ({ rss, heapUsed: 0, heapTotal: 0, external: 0, arrayBuffers: 0 }) as NodeJS.MemoryUsage;

    expect((await memoryProbe(thresholds, () => usageOf(50)).check()).status).toBe('healthy');
    expect((await memoryProbe(thresholds, () => usageOf(150)).check()).status).toBe('degraded');
    const critical = await memoryProbe(thresholds, () => usageOf(250)).check();
    expect(critical.status).toBe('unhealthy');
    expect(memoryProbe(thresholds).criticality).toBe('readiness'); // stop taking work, don't restart
  });

  it('a repeatedly failing recovery sweep degrades but never stops processing', async () => {
    const failing = recoverySchedulerProbe(() => ({
      running: true,
      consecutiveFailures: 5,
      lastRunAt: 'T',
      lastError: 'db down',
    }));
    expect(failing.criticality).toBe('informational'); // processors continue regardless
    const result = await failing.check();
    expect(result.status).toBe('degraded');
    expect(result.detail).toMatch(/processing unaffected/);
  });

  it('a disabled recovery scheduler is healthy, not degraded', async () => {
    const off = recoverySchedulerProbe(() => ({
      running: false,
      consecutiveFailures: 0,
      lastRunAt: null,
      lastError: null,
    }));
    expect((await off.check()).status).toBe('healthy');
  });

  it('reports processors, resources, cpu and configuration for diagnosis', async () => {
    expect((await processorsProbe(() => []).check()).status).toBe('degraded');
    expect((await processorsProbe(() => ['image-hardening']).check()).status).toBe('healthy');
    expect((await resourceManagerProbe(() => ({ registered: 1, live: 0 })).check()).data).toEqual({
      registered: 1,
      live: 0,
    });
    expect((await cpuProbe(() => null).check()).status).toBe('healthy');
    expect((await cpuProbe(() => ({ userPercent: 98, systemPercent: 5 })).check()).status).toBe(
      'degraded',
    );
    expect((await configurationProbe(() => ({ storage: 'memory' })).check()).status).toBe(
      'healthy',
    );
    expect(
      (await configurationProbe(() => ({ storage: 'memory' }), ['a warning']).check()).status,
    ).toBe('degraded');
  });

  it('runtime storage is LIVENESS-critical (a restart is the right remedy)', async () => {
    const broken = runtimeStorageProbe({
      health: () => ({
        live: true,
        ready: false,
        dependencies: [{ name: 'storage', state: 'unhealthy', detail: 'disk full' }],
      }),
    });
    expect(broken.criticality).toBe('liveness');
    expect(await broken.check()).toMatchObject({ status: 'unhealthy', detail: 'disk full' });
  });
});

describe('status encoding', () => {
  it('encodes statuses by ascending severity for the health gauge', () => {
    expect(statusValue('healthy')).toBe(0);
    expect(statusValue('degraded')).toBe(1);
    expect(statusValue('unhealthy')).toBe(2);
  });
});
