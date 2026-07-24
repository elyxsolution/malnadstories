import { describe, it, expect } from 'vitest';
import { ResourceManager } from '../src/resources/resource-manager.js';
import type { ManagedResource } from '../src/resources/resource-manager.js';

/** A fake managed resource that counts creates/destroys and can be flipped unhealthy (crash simulation). */
class FakeResource {
  creates = 0;
  destroys = 0;
  healthy = true;
  readonly live = new Set<number>();

  managed(): ManagedResource<number> {
    return {
      name: 'fake',
      create: async () => {
        this.creates += 1;
        const id = this.creates;
        this.live.add(id);
        return id;
      },
      isHealthy: () => this.healthy,
      destroy: async (id) => {
        this.destroys += 1;
        this.live.delete(id);
      },
    };
  }
}

describe('ResourceManager / ResourceHandle', () => {
  it('creates lazily and reuses the same healthy resource', async () => {
    const fake = new FakeResource();
    const handle = new ResourceManager().register(fake.managed());
    expect(fake.creates).toBe(0); // lazy
    const a = await handle.acquire();
    const b = await handle.acquire();
    expect(a).toBe(b);
    expect(fake.creates).toBe(1); // reused, not recreated
  });

  it('rebuilds the resource when it becomes unhealthy (crash recovery)', async () => {
    const fake = new FakeResource();
    const handle = new ResourceManager().register(fake.managed());
    const first = await handle.acquire();
    fake.healthy = false; // simulate a crash / disconnect
    const second = await handle.acquire();
    expect(second).not.toBe(first);
    expect(fake.creates).toBe(2);
    expect(fake.destroys).toBe(1); // the stale one was torn down
  });

  it('reset() forces a rebuild on the next acquire', async () => {
    const fake = new FakeResource();
    const handle = new ResourceManager().register(fake.managed());
    await handle.acquire();
    await handle.reset();
    expect(fake.destroys).toBe(1);
    await handle.acquire();
    expect(fake.creates).toBe(2);
  });

  it('serializes concurrent acquires so only ONE resource is created', async () => {
    const fake = new FakeResource();
    const handle = new ResourceManager().register(fake.managed());
    const [a, b, c] = await Promise.all([handle.acquire(), handle.acquire(), handle.acquire()]);
    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(fake.creates).toBe(1);
  });

  it('reports health without side effects', async () => {
    const fake = new FakeResource();
    const handle = new ResourceManager().register(fake.managed());
    expect(await handle.health()).toBe('absent');
    await handle.acquire();
    expect(await handle.health()).toBe('healthy');
    fake.healthy = false;
    expect(await handle.health()).toBe('unhealthy');
  });

  it('shutdown() destroys every registered resource', async () => {
    const a = new FakeResource();
    const b = new FakeResource();
    const manager = new ResourceManager();
    const ha = manager.register(a.managed());
    const hb = manager.register(b.managed());
    await ha.acquire();
    await hb.acquire();
    await manager.shutdown();
    expect(a.destroys).toBe(1);
    expect(b.destroys).toBe(1);
    expect(a.live.size).toBe(0);
    expect(b.live.size).toBe(0);
  });
});
