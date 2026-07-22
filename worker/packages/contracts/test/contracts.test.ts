import { describe, expect, it } from 'vitest';
import { CONTRACTS_VERSION } from '@workerv2/contracts';
import type { Result, JsonValue, Brand } from '@workerv2/contracts';

describe('@workerv2/contracts', () => {
  it('exposes a semver contracts version', () => {
    expect(CONTRACTS_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('Result discriminates on `ok` (compile-time + runtime shape)', () => {
    const good: Result<number, string> = { ok: true, value: 42 };
    const bad: Result<number, string> = { ok: false, error: 'nope' };
    expect(good.ok ? good.value : null).toBe(42);
    expect(bad.ok ? null : bad.error).toBe('nope');
  });

  it('JsonValue accepts nested JSON structures', () => {
    const v: JsonValue = { a: [1, 'two', true, null], b: { c: 3 } };
    expect(v).toStrictEqual({ a: [1, 'two', true, null], b: { c: 3 } });
  });

  it('Brand is structurally the base type at runtime', () => {
    type UserId = Brand<string, 'UserId'>;
    const id = 'u1' as UserId;
    expect(id).toBe('u1');
  });
});
