import { describe, expect, it } from 'vitest';
import { INFRA_EVENTS, makeInfraEvent, valid, invalid } from '@workerv2/infra-contracts';
import type { Validator } from '@workerv2/infra-contracts';
import { makeEventId, makeTimestamp } from '@workerv2/control-plane';
import { unwrap } from './helpers.js';

const id = unwrap(makeEventId('evt-1'));
const at = unwrap(makeTimestamp('2026-07-22T00:00:00Z'));

describe('infra technical events', () => {
  it('exposes stable infra.* event types', () => {
    expect(INFRA_EVENTS.unitOfWorkCommitted).toBe('infra.uow_committed');
    expect(INFRA_EVENTS.artifactStored).toBe('infra.artifact_stored');
  });

  it('makeInfraEvent builds a technical event on the operational stream', () => {
    const e = makeInfraEvent({
      id,
      type: INFRA_EVENTS.recordPersisted,
      occurredAt: at,
      payload: { table: 'albums' },
    });
    expect(e).toStrictEqual({
      kind: 'technical',
      id: 'evt-1',
      type: 'infra.record_persisted',
      occurredAt: at,
      payload: { table: 'albums' },
    });
  });

  it('omits payload when not provided', () => {
    const e = makeInfraEvent({ id, type: INFRA_EVENTS.unitOfWorkCommitted, occurredAt: at });
    expect('payload' in e).toBe(false);
  });
});

describe('validation contract', () => {
  it('valid/invalid build Result values', () => {
    expect(valid(5)).toStrictEqual({ ok: true, value: 5 });
    const bad = invalid<number>('nope', { field: 'x' });
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.error.code).toBe('VALIDATION');
      expect(bad.error.context).toStrictEqual({ field: 'x' });
    }
  });

  it('a concrete Validator can be plugged in', () => {
    const positive: Validator<number> = {
      validate: (input) =>
        typeof input === 'number' && input > 0
          ? valid(input)
          : invalid('must be a positive number'),
    };
    expect(positive.validate(3).ok).toBe(true);
    expect(positive.validate(-1).ok).toBe(false);
    expect(positive.validate('x').ok).toBe(false);
  });
});
