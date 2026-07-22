import { describe, expect, it } from 'vitest';
import { Container, token } from '@workerv2/di';
import { isWorkerV2Error } from '@workerv2/errors';

interface Greeter {
  greet(): string;
}

const NAME = token<string>('name');
const GREETER = token<Greeter>('greeter');

describe('Container — values & factories', () => {
  it('resolves a registered value', () => {
    const c = new Container().registerValue(NAME, 'world');
    expect(c.resolve(NAME)).toBe('world');
  });

  it('resolves a factory that pulls its own dependencies', () => {
    const c = new Container().registerValue(NAME, 'ada').registerFactory(GREETER, (container) => ({
      greet: () => `hi ${container.resolve(NAME)}`,
    }));
    expect(c.resolve(GREETER).greet()).toBe('hi ada');
  });

  it('caches singletons and re-invokes transients', () => {
    let calls = 0;
    const COUNT = token<number>('count');

    const singletonC = new Container().registerFactory(COUNT, () => ++calls);
    expect(singletonC.resolve(COUNT)).toBe(1);
    expect(singletonC.resolve(COUNT)).toBe(1);

    calls = 0;
    const transientC = new Container().registerFactory(COUNT, () => ++calls, { singleton: false });
    expect(transientC.resolve(COUNT)).toBe(1);
    expect(transientC.resolve(COUNT)).toBe(2);
  });

  it('has() reflects registration across scopes', () => {
    const c = new Container().registerValue(NAME, 'x');
    expect(c.has(NAME)).toBe(true);
    expect(c.has(GREETER)).toBe(false);
  });
});

describe('Container — errors & scopes', () => {
  it('throws DependencyError for unregistered tokens', () => {
    const c = new Container();
    try {
      c.resolve(NAME);
      expect.unreachable();
    } catch (e) {
      expect(isWorkerV2Error(e)).toBe(true);
      expect((e as { code: string }).code).toBe('DEPENDENCY');
    }
  });

  it('detects circular dependencies', () => {
    const A = token<string>('A');
    const B = token<string>('B');
    const c = new Container()
      .registerFactory(A, (container) => `a:${container.resolve(B)}`)
      .registerFactory(B, (container) => `b:${container.resolve(A)}`);
    expect(() => c.resolve(A)).toThrowError(/Circular dependency/);
  });

  it('child scope inherits and overrides parent registrations', () => {
    const parent = new Container().registerValue(NAME, 'parent');
    const child = parent.createChild().registerValue(NAME, 'child');
    expect(parent.resolve(NAME)).toBe('parent');
    expect(child.resolve(NAME)).toBe('child');
    expect(child.has(GREETER)).toBe(false);
  });
});
