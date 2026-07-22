import { describe, expect, it } from 'vitest';
import { recordTransition, makeAuditId } from '@workerv2/control-plane';
import { unwrap, timestamp, systemActor } from './helpers.js';

const at = timestamp('2026-07-22T00:00:00Z');
const id = unwrap(makeAuditId('aud-1'));
const actor = systemActor();

describe('recordTransition', () => {
  it('builds a frozen record and omits absent optionals', () => {
    const rec = recordTransition({
      id,
      occurredAt: at,
      actor,
      entityType: 'album',
      entityId: 'alb-1',
      action: 'album.created',
      toState: 'draft',
    });
    expect(rec).toStrictEqual({
      id: 'aud-1',
      occurredAt: at,
      actor,
      entityType: 'album',
      entityId: 'alb-1',
      action: 'album.created',
      toState: 'draft',
    });
    expect('fromState' in rec).toBe(false);
    expect('metadata' in rec).toBe(false);
    expect(Object.isFrozen(rec)).toBe(true);
  });

  it('includes fromState/toState/metadata when provided', () => {
    const rec = recordTransition({
      id,
      occurredAt: at,
      actor,
      entityType: 'run',
      entityId: 'run-1',
      action: 'run.succeeded',
      fromState: 'running',
      toState: 'succeeded',
      metadata: { note: 'ok' },
    });
    expect(rec.fromState).toBe('running');
    expect(rec.toState).toBe('succeeded');
    expect(rec.metadata).toStrictEqual({ note: 'ok' });
  });
});
