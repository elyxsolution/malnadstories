import { describe, expect, it } from 'vitest';
import { ConsoleLogger, NoopLogger, LEVEL_ORDER } from '@workerv2/logger';

function capture() {
  const lines: string[] = [];
  return { lines, sink: (line: string) => lines.push(line) };
}

const fixedNow = () => new Date('2026-07-22T00:00:00.000Z');

describe('ConsoleLogger', () => {
  it('emits structured JSON with level, time, message', () => {
    const { lines, sink } = capture();
    const log = new ConsoleLogger({ level: 'debug', sink, now: fixedNow });
    log.info('hello', { a: 1 });
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toStrictEqual({
      level: 'info',
      time: '2026-07-22T00:00:00.000Z',
      message: 'hello',
      a: 1,
    });
  });

  it('filters below the configured threshold', () => {
    const { lines, sink } = capture();
    const log = new ConsoleLogger({ level: 'warn', sink, now: fixedNow });
    log.debug('d');
    log.info('i');
    log.warn('w');
    log.error('e');
    expect(lines.map((l) => JSON.parse(l).level)).toStrictEqual(['warn', 'error']);
  });

  it('child binds base fields and inherits level + sink', () => {
    const { lines, sink } = capture();
    const log = new ConsoleLogger({ level: 'info', base: { svc: 'x' }, sink, now: fixedNow });
    log.child({ reqId: 'r1' }).info('m', { extra: true });
    expect(JSON.parse(lines[0]!)).toMatchObject({ svc: 'x', reqId: 'r1', extra: true });
  });
});

describe('NoopLogger', () => {
  it('discards output and returns itself as child', () => {
    const log = new NoopLogger();
    expect(() => log.error('ignored')).not.toThrow();
    expect(log.child({})).toBe(log);
  });
});

describe('LEVEL_ORDER', () => {
  it('is strictly increasing by severity', () => {
    expect(LEVEL_ORDER.debug).toBeLessThan(LEVEL_ORDER.info);
    expect(LEVEL_ORDER.info).toBeLessThan(LEVEL_ORDER.warn);
    expect(LEVEL_ORDER.warn).toBeLessThan(LEVEL_ORDER.error);
  });
});
