import { describe, expect, it } from 'vitest';
import type { Result } from '@workerv2/contracts';
import {
  ok,
  err,
  isOk,
  isErr,
  mapResult,
  mapErr,
  unwrapOr,
  invariant,
  assertNever,
  isPlainObject,
  hasOwn,
  deepFreeze,
  canonicalJson,
} from '@workerv2/utils';

describe('result constructors + combinators', () => {
  it('ok/err build discriminated results', () => {
    expect(ok(1)).toStrictEqual({ ok: true, value: 1 });
    expect(err('e')).toStrictEqual({ ok: false, error: 'e' });
  });

  it('isOk/isErr narrow correctly', () => {
    expect(isOk(ok(1))).toBe(true);
    expect(isErr(err('e'))).toBe(true);
    expect(isOk(err('e'))).toBe(false);
  });

  it('mapResult maps success, passes error through', () => {
    expect(mapResult(ok(2), (n) => n * 3)).toStrictEqual(ok(6));
    expect(mapResult(err<string>('e'), (n: number) => n)).toStrictEqual(err('e'));
  });

  it('mapErr maps error, passes success through', () => {
    expect(mapErr(err('e'), (s) => s.toUpperCase())).toStrictEqual(err('E'));
    expect(mapErr(ok(1), (s: string) => s)).toStrictEqual(ok(1));
  });

  it('unwrapOr returns value or fallback', () => {
    const success: Result<number, string> = ok(5);
    const failure: Result<number, string> = err('e');
    expect(unwrapOr(success, 0)).toBe(5);
    expect(unwrapOr(failure, 0)).toBe(0);
  });
});

describe('invariant / assertNever', () => {
  it('invariant passes on truthy and throws on falsy', () => {
    expect(() => invariant(true, 'ok')).not.toThrow();
    expect(() => invariant(false, 'boom')).toThrowError(/Invariant violation: boom/);
  });

  it('assertNever always throws', () => {
    expect(() => assertNever('x' as never)).toThrowError(/Unexpected value: x/);
  });
});

describe('object helpers', () => {
  it('isPlainObject distinguishes plain objects', () => {
    expect(isPlainObject({})).toBe(true);
    expect(isPlainObject(Object.create(null))).toBe(true);
    expect(isPlainObject([])).toBe(false);
    expect(isPlainObject(null)).toBe(false);
    expect(isPlainObject(new Date())).toBe(false);
  });

  it('hasOwn checks own properties only', () => {
    expect(hasOwn({ a: 1 }, 'a')).toBe(true);
    expect(hasOwn({}, 'toString')).toBe(false);
  });

  it('deepFreeze freezes recursively and is cycle-safe', () => {
    const nested: Record<string, unknown> = { a: { b: 1 } };
    nested['self'] = nested;
    const frozen = deepFreeze(nested);
    expect(Object.isFrozen(frozen)).toBe(true);
    expect(Object.isFrozen((frozen as { a: unknown }).a)).toBe(true);
  });
});

describe('canonicalJson', () => {
  it('is key-order independent (deterministic)', () => {
    expect(canonicalJson({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
    expect(canonicalJson({ a: 1, b: 2 })).toBe(canonicalJson({ b: 2, a: 1 }));
  });

  it('preserves array order (semantic) and canonicalizes nested objects', () => {
    expect(canonicalJson([{ z: 1, a: 2 }, 3])).toBe('[{"a":2,"z":1},3]');
    expect(canonicalJson([3, 1, 2])).toBe('[3,1,2]');
  });

  it('omits undefined-valued keys and handles primitives', () => {
    expect(canonicalJson({ a: 1, gone: undefined })).toBe('{"a":1}');
    expect(canonicalJson('x')).toBe('"x"');
    expect(canonicalJson(null)).toBe('null');
    expect(canonicalJson(true)).toBe('true');
  });
});
