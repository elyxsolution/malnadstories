import { describe, expect, it } from 'vitest';
import {
  makeAlbumId,
  makeTimestamp,
  compareTimestamps,
  makeActor,
  makeActorId,
} from '@workerv2/control-plane';
import { unwrap } from './helpers.js';

describe('ids', () => {
  it('trims and accepts a valid id', () => {
    expect(unwrap(makeAlbumId('  a1  '))).toBe('a1');
  });

  it('rejects empty / whitespace ids', () => {
    const r = makeAlbumId('   ');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('VALIDATION');
  });

  it('rejects overly long ids', () => {
    expect(makeAlbumId('x'.repeat(201)).ok).toBe(false);
  });
});

describe('timestamp', () => {
  it('normalizes a valid ISO string to UTC ISO', () => {
    expect(unwrap(makeTimestamp('2026-07-22T05:30:00+05:30'))).toBe('2026-07-22T00:00:00.000Z');
  });

  it('accepts a Date', () => {
    expect(unwrap(makeTimestamp(new Date('2026-07-22T00:00:00Z')))).toBe(
      '2026-07-22T00:00:00.000Z',
    );
  });

  it('rejects an invalid timestamp', () => {
    expect(makeTimestamp('not-a-date').ok).toBe(false);
  });

  it('compares chronologically', () => {
    const a = unwrap(makeTimestamp('2026-01-01T00:00:00Z'));
    const b = unwrap(makeTimestamp('2026-01-02T00:00:00Z'));
    expect(compareTimestamps(a, b)).toBeLessThan(0);
    expect(compareTimestamps(b, a)).toBeGreaterThan(0);
    expect(compareTimestamps(a, a)).toBe(0);
  });
});

describe('actor', () => {
  it('builds a frozen actor', () => {
    const actor = makeActor(unwrap(makeActorId('u1')), 'admin');
    expect(actor).toStrictEqual({ id: 'u1', kind: 'admin' });
    expect(Object.isFrozen(actor)).toBe(true);
  });
});
