import { describe, it, expect } from 'vitest';
import { loadAppConfig, summarizeConfig, ConfigError } from '../src/config.js';
import { InMemoryQueue } from '../src/queue.js';
import type { WorkerJob } from '../src/queue.js';

describe('loadAppConfig', () => {
  it('applies defaults for an empty environment', () => {
    const config = loadAppConfig({});
    expect(config.runtime.storage.kind).toBe('memory');
    expect(config.pollIntervalMs).toBe(1000);
    expect(config.healthPort).toBeNull();
  });

  it('reads storage, backend, poll interval, and health port from env', () => {
    const config = loadAppConfig({
      WV2_STORAGE: 'filesystem',
      WV2_STORAGE_ROOT: '/data',
      WV2_POLL_INTERVAL_MS: '250',
      PORT: '8080',
    });
    expect(config.runtime.storage).toEqual({ kind: 'filesystem', root: '/data' });
    expect(config.pollIntervalMs).toBe(250);
    expect(config.healthPort).toBe(8080);
    expect(summarizeConfig(config)).toMatchObject({ storage: 'filesystem', pollIntervalMs: 250 });
  });

  it('fails fast on invalid configuration', () => {
    expect(() => loadAppConfig({ WV2_STORAGE: 'filesystem' })).toThrow(ConfigError);
    expect(() => loadAppConfig({ PORT: '0' })).toThrow(/PORT/);
    expect(() => loadAppConfig({ PORT: '99999' })).toThrow(/PORT/);
    expect(() => loadAppConfig({ WV2_POLL_INTERVAL_MS: '-5' })).toThrow(/WV2_POLL_INTERVAL_MS/);
  });
});

describe('InMemoryQueue', () => {
  const job = (id: string): WorkerJob => ({ id, blueprint: {} as never });

  it('is FIFO, returns null when empty, and tracks ack/nack', async () => {
    const q = new InMemoryQueue();
    expect(await q.poll()).toBeNull();
    q.enqueue(job('a'));
    q.enqueue(job('b'));
    expect(q.depth).toBe(2);
    expect((await q.poll())?.id).toBe('a');
    await q.ack('a');
    await q.nack('b', new Error('x'));
    expect(q.ackedIds).toEqual(['a']);
    expect(q.nackedIds).toEqual(['b']);
    expect((await q.poll())?.id).toBe('b');
    expect(await q.poll()).toBeNull();
  });
});
