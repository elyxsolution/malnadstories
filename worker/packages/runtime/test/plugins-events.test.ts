import { describe, expect, it } from 'vitest';
import { applyPlugins, TechnicalEventBus } from '@workerv2/runtime';
import type { Plugin, PluginContext, Service, Capability } from '@workerv2/runtime';
import { Container } from '@workerv2/di';
import { technicalEvent, makeEventId, makeTimestamp } from '@workerv2/control-plane';
import { recordingService, testConfig, unwrap } from './helpers.js';
import { NoopLogger } from '@workerv2/logger';

function makeContext(): {
  ctx: PluginContext;
  services: Service[];
  capabilities: Capability[];
} {
  const services: Service[] = [];
  const capabilities: Capability[] = [];
  const ctx: PluginContext = {
    registerService: (s) => services.push(s),
    registerCapability: (c) => capabilities.push(c),
    container: new Container(),
    config: testConfig(),
    logger: new NoopLogger(),
  };
  return { ctx, services, capabilities };
}

describe('applyPlugins', () => {
  it('applies plugins in order, collecting their contributions', () => {
    const log: string[] = [];
    const p1: Plugin = {
      name: 'p1',
      register(ctx) {
        ctx.registerCapability({ name: 'cap-1' });
        ctx.registerService(recordingService('s1', log));
      },
    };
    const p2: Plugin = {
      name: 'p2',
      register(ctx) {
        ctx.registerService(recordingService('s2', log));
      },
    };
    const { ctx, services, capabilities } = makeContext();
    const applied = applyPlugins([p1, p2], ctx);
    expect(applied).toStrictEqual(['p1', 'p2']);
    expect(services.map((s) => s.name)).toStrictEqual(['s1', 's2']);
    expect(capabilities.map((c) => c.name)).toStrictEqual(['cap-1']);
  });

  it('rejects duplicate plugin names', () => {
    const dup: Plugin = { name: 'dup', register() {} };
    const { ctx } = makeContext();
    expect(() => applyPlugins([dup, dup], ctx)).toThrowError(/Duplicate plugin/);
  });
});

describe('TechnicalEventBus', () => {
  const event = technicalEvent({
    id: unwrap(makeEventId('evt-1')),
    type: 'runtime.started',
    occurredAt: unwrap(makeTimestamp('2026-07-22T00:00:00Z')),
  });

  it('delivers to subscribers and supports unsubscribe', () => {
    const bus = new TechnicalEventBus();
    const seen: string[] = [];
    const off = bus.subscribe((e) => seen.push(e.type));
    bus.publish(event);
    expect(seen).toStrictEqual(['runtime.started']);
    off();
    bus.publish(event);
    expect(seen).toStrictEqual(['runtime.started']);
    expect(bus.listenerCount).toBe(0);
  });

  it('isolates a throwing listener and reports the failure count', () => {
    const bus = new TechnicalEventBus();
    const seen: string[] = [];
    bus.subscribe(() => {
      throw new Error('boom');
    });
    bus.subscribe((e) => seen.push(e.type));
    const failures = bus.publish(event);
    expect(failures).toBe(1);
    expect(seen).toStrictEqual(['runtime.started']); // healthy listener still ran
  });
});
