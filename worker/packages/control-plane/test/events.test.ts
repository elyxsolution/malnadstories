import { describe, expect, it } from 'vitest';
import {
  domainEvent,
  technicalEvent,
  isDomainEvent,
  isTechnicalEvent,
} from '@workerv2/control-plane';
import type { PlatformEvent } from '@workerv2/control-plane';
import { unwrap, timestamp } from './helpers.js';
import { makeEventId } from '@workerv2/control-plane';

const at = timestamp('2026-07-22T00:00:00Z');
const id = unwrap(makeEventId('evt-1'));

describe('domainEvent', () => {
  it('builds a frozen domain event and omits absent payload', () => {
    const e = domainEvent({ id, type: 'album.submitted', occurredAt: at, subjectId: 'alb-1' });
    expect(e).toStrictEqual({
      kind: 'domain',
      id: 'evt-1',
      type: 'album.submitted',
      occurredAt: at,
      subjectId: 'alb-1',
    });
    expect(Object.isFrozen(e)).toBe(true);
    expect('payload' in e).toBe(false);
  });

  it('includes payload when provided', () => {
    const e = domainEvent({
      id,
      type: 'album.created',
      occurredAt: at,
      subjectId: 'alb-1',
      payload: { title: 'Goa' },
    });
    expect(e.payload).toStrictEqual({ title: 'Goa' });
  });
});

describe('technicalEvent', () => {
  it('builds a frozen technical event', () => {
    const e = technicalEvent({ id, type: 'job.retried', occurredAt: at });
    expect(e.kind).toBe('technical');
    expect(Object.isFrozen(e)).toBe(true);
  });
});

describe('event stream separation (INV-12)', () => {
  it('guards discriminate domain vs technical', () => {
    const d: PlatformEvent = domainEvent({
      id,
      type: 'run.succeeded',
      occurredAt: at,
      subjectId: 'r1',
    });
    const t: PlatformEvent = technicalEvent({ id, type: 'job.retried', occurredAt: at });
    expect(isDomainEvent(d)).toBe(true);
    expect(isTechnicalEvent(d)).toBe(false);
    expect(isTechnicalEvent(t)).toBe(true);
    expect(isDomainEvent(t)).toBe(false);
  });
});
