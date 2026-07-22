import { describe, expect, it } from 'vitest';
import { HealthRegistry, worseStatus } from '@workerv2/health';
import type { HealthCheck } from '@workerv2/health';

const check = (name: string, result: HealthCheck['check']): HealthCheck => ({
  name,
  check: result,
});

describe('worseStatus', () => {
  it('returns the more severe status', () => {
    expect(worseStatus('healthy', 'degraded')).toBe('degraded');
    expect(worseStatus('unhealthy', 'degraded')).toBe('unhealthy');
    expect(worseStatus('healthy', 'healthy')).toBe('healthy');
  });
});

describe('HealthRegistry', () => {
  it('empty registry is healthy', async () => {
    const r = new HealthRegistry();
    expect(await r.run()).toStrictEqual({ status: 'healthy', checks: [] });
  });

  it('aggregates to the worst status and includes each result', async () => {
    const r = new HealthRegistry();
    r.register(check('a', () => ({ status: 'healthy' })));
    r.register(check('b', async () => ({ status: 'degraded', detail: 'slow' })));
    const report = await r.run();
    expect(report.status).toBe('degraded');
    expect(report.checks).toEqual(
      expect.arrayContaining([
        { name: 'a', status: 'healthy' },
        { name: 'b', status: 'degraded', detail: 'slow' },
      ]),
    );
  });

  it('treats a throwing check as unhealthy', async () => {
    const r = new HealthRegistry();
    r.register(
      check('boom', () => {
        throw new Error('down');
      }),
    );
    const report = await r.run();
    expect(report.status).toBe('unhealthy');
    expect(report.checks[0]).toStrictEqual({ name: 'boom', status: 'unhealthy', detail: 'down' });
  });

  it('registers, replaces, and unregisters by name', () => {
    const r = new HealthRegistry();
    r.register(check('x', () => ({ status: 'healthy' })));
    r.register(check('x', () => ({ status: 'unhealthy' })));
    expect(r.size).toBe(1);
    expect(r.unregister('x')).toBe(true);
    expect(r.unregister('x')).toBe(false);
    expect(r.size).toBe(0);
  });
});
