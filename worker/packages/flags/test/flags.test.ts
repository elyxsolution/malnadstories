import { describe, expect, it } from 'vitest';
import { StaticFlagProvider } from '@workerv2/flags';

describe('StaticFlagProvider', () => {
  it('isEnabled is true only for boolean-true flags', () => {
    const p = new StaticFlagProvider({ on: true, off: false, name: 'x', count: 3 });
    expect(p.isEnabled('on')).toBe(true);
    expect(p.isEnabled('off')).toBe(false);
    expect(p.isEnabled('name')).toBe(false);
    expect(p.isEnabled('missing')).toBe(false);
  });

  it('getValue returns typed value or fallback', () => {
    const p = new StaticFlagProvider({ retries: 5, mode: 'fast', on: true });
    expect(p.getValue('retries', 1)).toBe(5);
    expect(p.getValue('mode', 'slow')).toBe('fast');
    expect(p.getValue('on', false)).toBe(true);
    expect(p.getValue('missing', 42)).toBe(42);
  });

  it('falls back when the stored type does not match the fallback type', () => {
    const p = new StaticFlagProvider({ retries: 5 });
    // Requesting a string but the stored value is a number → fallback.
    expect(p.getValue('retries', 'default')).toBe('default');
  });

  it('defends against external mutation of the source map', () => {
    const source = { on: true };
    const p = new StaticFlagProvider(source);
    source.on = false;
    expect(p.isEnabled('on')).toBe(true);
  });
});
