import { describe, expect, it } from 'vitest';
import { Runtime, LoggerToken } from '@workerv2/runtime';
import type { Plugin } from '@workerv2/runtime';
import { NoopLogger } from '@workerv2/logger';
import { recordingService, testBuild, testConfig, counterId, fixedNow } from './helpers.js';

function makeRuntime(log: string[], extra?: Partial<Parameters<typeof Runtime.create>[0]>) {
  return Runtime.create({
    runtimeId: 'rt-1',
    config: testConfig(),
    build: testBuild,
    now: fixedNow,
    nextId: counterId(),
    logger: new NoopLogger(),
    services: [recordingService('a', log, ['b']), recordingService('b', log)],
    ...extra,
  });
}

describe('Runtime — build', () => {
  it('exposes immutable metadata and deterministic service order', () => {
    const rt = makeRuntime([]);
    expect(rt.status).toBe('created');
    expect(rt.metadata).toMatchObject({ runtimeId: 'rt-1', name: 'worker-v2' });
    expect(Object.isFrozen(rt.metadata)).toBe(true);
    expect(rt.serviceOrder()).toStrictEqual(['b', 'a']);
    expect(rt.container.resolve(LoggerToken)).toBeInstanceOf(NoopLogger);
  });

  it('fails fast on a cyclic dependency graph', () => {
    const log: string[] = [];
    expect(() =>
      Runtime.create({
        runtimeId: 'rt-x',
        config: testConfig(),
        build: testBuild,
        now: fixedNow,
        nextId: counterId(),
        services: [recordingService('p', log, ['q']), recordingService('q', log, ['p'])],
      }),
    ).toThrowError(/cycle/i);
  });

  it('registers capabilities + services contributed by a plugin', () => {
    const log: string[] = [];
    const plugin: Plugin = {
      name: 'thumbs',
      register(ctx) {
        ctx.registerCapability({ name: 'thumbnails', version: '1.0.0' });
        ctx.registerService(recordingService('c', log));
      },
    };
    const rt = makeRuntime(log, { plugins: [plugin] });
    expect(rt.capabilities().map((c) => c.name)).toStrictEqual(['thumbnails']);
    // b (no deps) and c (no deps) are both ready first; name-sorted → b, then a's dep (b)
    // clears so a and c are ready → name-sorted a before c. Deterministic order: b, a, c.
    expect(rt.serviceOrder()).toStrictEqual(['b', 'a', 'c']);
  });
});

describe('Runtime — lifecycle', () => {
  it('starts services in dependency order and emits lifecycle events', async () => {
    const log: string[] = [];
    const rt = makeRuntime(log);
    const events: string[] = [];
    rt.onEvent((e) => events.push(e.type));

    await rt.start();
    expect(rt.status).toBe('running');
    expect(log).toStrictEqual(['start:b', 'start:a']);
    expect(events).toStrictEqual([
      'runtime.starting',
      'runtime.service_started',
      'runtime.service_started',
      'runtime.started',
    ]);
  });

  it('reports healthy while running and stops in reverse order', async () => {
    const log: string[] = [];
    const rt = makeRuntime(log);
    await rt.start();
    const health = await rt.health();
    expect(health.status).toBe('healthy');

    await rt.stop();
    expect(rt.status).toBe('stopped');
    expect(log).toStrictEqual(['start:b', 'start:a', 'stop:a', 'stop:b']);
  });

  it('is idempotent: start() while running and stop() when stopped are no-ops', async () => {
    const log: string[] = [];
    const rt = makeRuntime(log);
    const events: string[] = [];
    rt.onEvent((e) => events.push(e.type));

    await rt.start();
    await rt.start(); // no-op — no extra start events / service starts
    expect(log).toStrictEqual(['start:b', 'start:a']);
    const startEvents = events.filter((t) => t === 'runtime.starting').length;
    expect(startEvents).toBe(1);

    await rt.stop();
    await rt.stop(); // no-op
    expect(log).toStrictEqual(['start:b', 'start:a', 'stop:a', 'stop:b']);
  });

  it('cannot be restarted after stopping', async () => {
    const rt = makeRuntime([]);
    await rt.start();
    await rt.stop();
    await expect(rt.start()).rejects.toThrowError(/Cannot start runtime from state "stopped"/);
  });

  it('transitions to failed when a service fails to start', async () => {
    const boom = {
      name: 'boom',
      start() {
        throw new Error('cannot start');
      },
    };
    const rt = Runtime.create({
      runtimeId: 'rt-f',
      config: testConfig(),
      build: testBuild,
      now: fixedNow,
      nextId: counterId(),
      services: [boom],
    });
    await expect(rt.start()).rejects.toThrowError(/cannot start/);
    expect(rt.status).toBe('failed');
  });
});
