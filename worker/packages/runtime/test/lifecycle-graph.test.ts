import { describe, expect, it } from 'vitest';
import {
  RUNTIME_MACHINE,
  orderServices,
  ServiceRegistry,
  CapabilityRegistry,
} from '@workerv2/runtime';
import { recordingService } from './helpers.js';

describe('RUNTIME_MACHINE', () => {
  it('walks the normal lifecycle', () => {
    let s = RUNTIME_MACHINE.initial;
    for (const t of ['begin_start', 'complete_start', 'begin_stop', 'complete_stop'] as const) {
      const r = RUNTIME_MACHINE.nextState(s, t);
      expect(r.ok).toBe(true);
      if (r.ok) s = r.value;
    }
    expect(s).toBe('stopped');
    expect(RUNTIME_MACHINE.isTerminal('stopped')).toBe(true);
    expect(RUNTIME_MACHINE.isTerminal('failed')).toBe(true);
  });

  it('rejects illegal transitions', () => {
    expect(RUNTIME_MACHINE.nextState('created', 'complete_start').ok).toBe(false);
    expect(RUNTIME_MACHINE.nextState('running', 'begin_start').ok).toBe(false);
  });
});

describe('orderServices', () => {
  it('orders dependencies before dependents', () => {
    const log: string[] = [];
    const a = recordingService('a', log, ['b']);
    const b = recordingService('b', log);
    const c = recordingService('c', log, ['a']);
    const r = orderServices([a, b, c]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.map((s) => s.name)).toStrictEqual(['b', 'a', 'c']);
  });

  it('is deterministic with name-sorted tie-breaking', () => {
    const log: string[] = [];
    const services = [
      recordingService('c', log),
      recordingService('a', log),
      recordingService('b', log),
    ];
    const r = orderServices(services);
    if (!r.ok) throw r.error;
    expect(r.value.map((s) => s.name)).toStrictEqual(['a', 'b', 'c']);
  });

  it('fails on a missing dependency', () => {
    const log: string[] = [];
    const r = orderServices([recordingService('x', log, ['nope'])]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('DEPENDENCY');
  });

  it('fails on a cycle', () => {
    const log: string[] = [];
    const p = recordingService('p', log, ['q']);
    const q = recordingService('q', log, ['p']);
    const r = orderServices([p, q]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toMatch(/cycle/i);
  });
});

describe('registries', () => {
  it('ServiceRegistry rejects duplicate names', () => {
    const log: string[] = [];
    const reg = new ServiceRegistry();
    reg.register(recordingService('a', log));
    expect(() => reg.register(recordingService('a', log))).toThrowError(/Duplicate service/);
    expect(reg.size).toBe(1);
    expect(reg.has('a')).toBe(true);
  });

  it('CapabilityRegistry rejects duplicates and lists sorted', () => {
    const reg = new CapabilityRegistry();
    reg.register({ name: 'ocr', version: '1.0.0' });
    reg.register({ name: 'ai-enhance' });
    expect(() => reg.register({ name: 'ocr' })).toThrowError(/Duplicate capability/);
    expect(reg.list().map((c) => c.name)).toStrictEqual(['ai-enhance', 'ocr']);
    expect(Object.isFrozen(reg.get('ocr'))).toBe(true);
  });
});
