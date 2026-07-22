import type { JsonObject } from '@workerv2/contracts';
import type { Timestamp } from '../time.js';
import type { EventId } from '../ids.js';

/**
 * A DOMAIN event — a business-meaningful fact about an entity (e.g. `album.submitted`).
 * Distinct from technical events (INV-12): domain events describe *what happened to the
 * business*, never operational mechanics. Immutable.
 */
export interface DomainEvent {
  readonly kind: 'domain';
  readonly id: EventId;
  /** `entity.past_tense` naming, e.g. `album.submitted`. */
  readonly type: string;
  readonly occurredAt: Timestamp;
  /** Id of the entity the event concerns. */
  readonly subjectId: string;
  readonly payload?: JsonObject;
}

/** Construct a frozen `DomainEvent`. Omits `payload` entirely when not provided. */
export function domainEvent(input: {
  id: EventId;
  type: string;
  occurredAt: Timestamp;
  subjectId: string;
  payload?: JsonObject;
}): DomainEvent {
  const base = {
    kind: 'domain' as const,
    id: input.id,
    type: input.type,
    occurredAt: input.occurredAt,
    subjectId: input.subjectId,
  };
  return Object.freeze(input.payload === undefined ? base : { ...base, payload: input.payload });
}
