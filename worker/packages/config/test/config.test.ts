import { describe, expect, it } from 'vitest';
import { requireEnv, optionalEnv, boolEnv, loadConfig } from '@workerv2/config';
import { isWorkerV2Error } from '@workerv2/errors';

const source = { A: 'x', EMPTY: '  ', FLAG_ON: 'yes', FLAG_OFF: '0', BAD: 'maybe' } as const;

describe('env helpers', () => {
  it('requireEnv returns value or throws ConfigError', () => {
    expect(requireEnv(source, 'A')).toBe('x');
    expect(() => requireEnv(source, 'EMPTY')).toThrowError(/Missing required/);
    expect(() => requireEnv(source, 'MISSING')).toThrowError(/Missing required/);
  });

  it('optionalEnv returns value or fallback', () => {
    expect(optionalEnv(source, 'A')).toBe('x');
    expect(optionalEnv(source, 'EMPTY', 'def')).toBe('def');
    expect(optionalEnv(source, 'MISSING')).toBeUndefined();
  });

  it('boolEnv parses booleans and rejects garbage', () => {
    expect(boolEnv(source, 'FLAG_ON', false)).toBe(true);
    expect(boolEnv(source, 'FLAG_OFF', true)).toBe(false);
    expect(boolEnv(source, 'MISSING', true)).toBe(true);
    expect(() => boolEnv(source, 'BAD', false)).toThrowError(/not a valid boolean/);
  });
});

describe('loadConfig', () => {
  it('returns a deep-frozen validated config', () => {
    const cfg = loadConfig({ port: 8080 }, (raw) => raw as { port: number });
    expect(cfg.port).toBe(8080);
    expect(Object.isFrozen(cfg)).toBe(true);
  });

  it('wraps validator failures in a ConfigError with cause', () => {
    const boom = new Error('bad');
    try {
      loadConfig(
        {},
        () => {
          throw boom;
        },
        'worker-config',
      );
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(isWorkerV2Error(e)).toBe(true);
      expect((e as { message: string }).message).toContain('worker-config');
      expect((e as { cause: unknown }).cause).toBe(boom);
    }
  });
});
