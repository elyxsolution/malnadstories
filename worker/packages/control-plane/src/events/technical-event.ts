import type { JsonObject } from '@workerv2/contracts';
import type { Timestamp } from '../time.js';
import type { EventId } from '../ids.js';
import type { DomainEvent } from './domain-event.js';

/**
 * A TECHNICAL event — an operational/mechanical fact (e.g. `run.retry_scheduled`). Distinct
 * from domain events (INV-12) and carried on a separate stream by later phases. Defined here
 * as a contract; the pure domain emits domain events, while the runtime emits technical ones.
 * Immutable.
 */
export interface TechnicalEvent {
  readonly kind: 'technical';
  readonly id: EventId;
  /** `subject.past_tense` naming, e.g. `job.retried`. */
  readonly type: string;
  readonly occurredAt: Timestamp;
  readonly payload?: JsonObject;
}

/** Construct a frozen `TechnicalEvent`. Omits `payload` entirely when not provided. */
export function technicalEvent(input: {
  id: EventId;
  type: string;
  occurredAt: Timestamp;
  payload?: JsonObject;
}): TechnicalEvent {
  const base = {
    kind: 'technical' as const,
    id: input.id,
    type: input.type,
    occurredAt: input.occurredAt,
  };
  return Object.freeze(input.payload === undefined ? base : { ...base, payload: input.payload });
}

/** Either event family. Discriminate on `kind` (INV-12: the two streams stay separate). */
export type PlatformEvent = DomainEvent | TechnicalEvent;

/** Type guard for domain events. */
export function isDomainEvent(event: PlatformEvent): event is DomainEvent {
  return event.kind === 'domain';
}

/** Type guard for technical events. */
export function isTechnicalEvent(event: PlatformEvent): event is TechnicalEvent {
  return event.kind === 'technical';
}
