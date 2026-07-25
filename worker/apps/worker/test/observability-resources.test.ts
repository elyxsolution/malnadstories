import { describe, it, expect } from 'vitest';
import {
  InMemoryMetricsProvider,
  MemoryLogSink,
  NoopResourceObserver,
  ObservabilityLogger,
  ObservabilityResourceObserver,
  WORKER_METRICS,
} from '../src/observability/index.js';
import { ResourceManager } from '../src/resources/resource-manager.js';
import type { ManagedResource } from '../src/resources/resource-manager.js';

/**
 * The Resource Manager's observability seam. Before Phase I-4 a Chromium crash-and-rebuild was
 * completely invisible; these tests pin the fact that it is now counted, logged and timed — while
 * asserting that the manager's behaviour is unchanged when no observer is supplied.
 */

interface FakeBrowser {
  readonly id: number;
  alive: boolean;
}

function fakeResource(): { resource: ManagedResource<FakeBrowser>; created: FakeBrowser[] } {
  const created: FakeBrowser[] = [];
  let next = 0;
  return {
    created,
    resource: {
      name: 'chromium',
      create: async (): Promise<FakeBrowser> => {
        const browser = { id: (next += 1), alive: true };
        created.push(browser);
        return browser;
      },
      isHealthy: (browser): boolean => browser.alive,
      destroy: async (browser): Promise<void> => {
        browser.alive = false;
      },
    },
  };
}

function observed(): {
  manager: ResourceManager;
  logs: MemoryLogSink;
  metrics: InMemoryMetricsProvider;
} {
  const logs = new MemoryLogSink();
  const metrics = new InMemoryMetricsProvider();
  const observer = new ObservabilityResourceObserver(
    new ObservabilityLogger({ level: 'trace', sink: logs }),
    metrics,
  );
  return { manager: new ResourceManager(observer), logs, metrics };
}

describe('resource lifecycle observability', () => {
  it('records creation with its cost, and acquisition as a cache hit thereafter', async () => {
    const { manager, logs, metrics } = observed();
    const { resource, created } = fakeResource();
    const handle = manager.register(resource);

    await handle.acquire();
    await handle.acquire();

    expect(created).toHaveLength(1); // built once, reused
    expect(metrics.counterTotal(WORKER_METRICS.resourceCreated)).toBe(1);
    expect(logs.withMessage('resource.created')).toHaveLength(1);
    expect(
      metrics.samples.filter((s) => s.name === WORKER_METRICS.resourceAcquireDurationMs),
    ).toHaveLength(2);
    expect(logs.withMessage('resource.acquired')[1]?.detail).toMatchObject({ created: false });
  });

  it('surfaces the previously invisible crash-and-rebuild as a WARNING plus a counter', async () => {
    const { manager, logs, metrics } = observed();
    const { resource, created } = fakeResource();
    const handle = manager.register(resource);

    const first = await handle.acquire();
    first.alive = false; // Chromium crashed
    const second = await handle.acquire();

    expect(second.id).not.toBe(first.id); // silently rebuilt before this phase
    expect(created).toHaveLength(2);
    const reset = logs.withMessage('resource.reset')[0];
    expect(reset?.level).toBe('warn');
    expect(reset?.detail).toMatchObject({ resource: 'chromium', reason: 'unhealthy' });
    expect(
      metrics.samples.filter(
        (s) => s.name === WORKER_METRICS.resourceReset && s.tags['reason'] === 'unhealthy',
      ),
    ).toHaveLength(1);
  });

  it('distinguishes explicit resets and shutdown from crashes', async () => {
    const { manager, logs } = observed();
    const handle = manager.register(fakeResource().resource);
    await handle.acquire();
    await handle.reset();
    await handle.acquire();
    await manager.shutdown();

    expect(logs.withMessage('resource.reset').map((r) => r.detail?.['reason'])).toEqual([
      'explicit',
      'shutdown',
    ]);
    // Only a crash is a warning; deliberate teardown is not.
    expect(logs.withMessage('resource.reset').map((r) => r.level)).toEqual(['info', 'info']);
  });

  it('records a creation failure', async () => {
    const { manager, logs, metrics } = observed();
    const handle = manager.register({
      name: 'chromium',
      create: async (): Promise<FakeBrowser> => {
        throw new Error('no executable');
      },
      isHealthy: (): boolean => true,
      destroy: async (): Promise<void> => {},
    });

    await expect(handle.acquire()).rejects.toThrow('no executable');
    expect(metrics.counterTotal(WORKER_METRICS.resourceAcquireFailed)).toBe(1);
    expect(logs.withMessage('resource.create_failed')[0]?.level).toBe('error');
  });
});

describe('resource state exposed for health + monitoring', () => {
  it('peek() reports the live resource WITHOUT creating one', async () => {
    const { manager } = observed();
    const { resource, created } = fakeResource();
    const handle = manager.register(resource);

    expect(handle.peek()).toBeNull();
    expect(created).toHaveLength(0); // a health check must never launch Chromium

    await handle.acquire();
    expect(handle.peek()).not.toBeNull();
  });

  it('exposes registry contents + live counts for the probe and diagnostics', async () => {
    const { manager } = observed();
    const handle = manager.register(fakeResource().resource);
    expect(manager.registered).toEqual(['chromium']);
    expect(manager.stats()).toEqual({ registered: 1, live: 0 });

    await handle.acquire();
    expect(manager.stats()).toEqual({ registered: 1, live: 1 });

    await manager.shutdown();
    expect(manager.stats()).toEqual({ registered: 1, live: 0 });
  });

  it('health() reflects absent → healthy → unhealthy without side effects', async () => {
    const { manager } = observed();
    const handle = manager.register(fakeResource().resource);
    expect(await handle.health()).toBe('absent');

    const browser = await handle.acquire();
    expect(await handle.health()).toBe('healthy');

    browser.alive = false;
    expect(await handle.health()).toBe('unhealthy');
  });
});

describe('the observer can never break resource management', () => {
  it('a throwing observer does not fail acquisition', async () => {
    const manager = new ResourceManager({
      onCreated: (): void => {
        throw new Error('observer down');
      },
      onCreateFailed: (): void => {
        throw new Error('observer down');
      },
      onAcquired: (): void => {
        throw new Error('observer down');
      },
      onReset: (): void => {
        throw new Error('observer down');
      },
    });
    const handle = manager.register(fakeResource().resource);
    await expect(handle.acquire()).resolves.toMatchObject({ id: 1 });
    await expect(manager.shutdown()).resolves.toBeUndefined();
  });

  it('with no observer the manager behaves exactly as before', async () => {
    const manager = new ResourceManager(); // default no-op observer
    const { resource, created } = fakeResource();
    const handle = manager.register(resource);
    const first = await handle.acquire();
    first.alive = false;
    const second = await handle.acquire();
    expect(created).toHaveLength(2);
    expect(second.alive).toBe(true);
    await manager.shutdown();
    expect(second.alive).toBe(false);
  });

  it('the no-op observer accepts every notification', () => {
    const observer = new NoopResourceObserver();
    expect(() => {
      observer.onCreated('x', 1);
      observer.onCreateFailed('x', new Error('e'), 1);
      observer.onAcquired('x', 1, true);
      observer.onReset('x', 'shutdown');
    }).not.toThrow();
  });
});
