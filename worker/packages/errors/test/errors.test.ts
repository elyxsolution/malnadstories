import { describe, expect, it } from 'vitest';
import {
  WorkerV2Error,
  ConfigError,
  ValidationError,
  InvariantError,
  NotImplementedError,
  DependencyError,
  isWorkerV2Error,
} from '@workerv2/errors';

describe('@workerv2/errors', () => {
  it('base error carries code + context and a correct name', () => {
    const e = new WorkerV2Error('boom', { code: 'INVARIANT', context: { a: 1 } });
    expect(e).toBeInstanceOf(Error);
    expect(e).toBeInstanceOf(WorkerV2Error);
    expect(e.code).toBe('INVARIANT');
    expect(e.context).toStrictEqual({ a: 1 });
    expect(e.name).toBe('WorkerV2Error');
    expect(e.message).toBe('boom');
  });

  it('subclasses set their code and preserve instanceof', () => {
    const cases = [
      [new ConfigError('c'), 'CONFIG', 'ConfigError'],
      [new ValidationError('v'), 'VALIDATION', 'ValidationError'],
      [new InvariantError('i'), 'INVARIANT', 'InvariantError'],
      [new NotImplementedError('n'), 'NOT_IMPLEMENTED', 'NotImplementedError'],
      [new DependencyError('d'), 'DEPENDENCY', 'DependencyError'],
    ] as const;
    for (const [e, code, name] of cases) {
      expect(e).toBeInstanceOf(WorkerV2Error);
      expect(e.code).toBe(code);
      expect(e.name).toBe(name);
    }
  });

  it('propagates cause', () => {
    const cause = new Error('root');
    const e = new ConfigError('wrap', { cause });
    expect(e.cause).toBe(cause);
  });

  it('isWorkerV2Error guards correctly', () => {
    expect(isWorkerV2Error(new ConfigError('c'))).toBe(true);
    expect(isWorkerV2Error(new Error('plain'))).toBe(false);
    expect(isWorkerV2Error('nope')).toBe(false);
  });
});
