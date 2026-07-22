import type { JsonObject } from '@workerv2/contracts';
import type { Actor } from './actor.js';
import type { Timestamp } from './time.js';
import type { EventId, AuditId } from './ids.js';

/**
 * The ambient inputs a domain transition needs, supplied by the caller (never read from the
 * environment). Time and identifiers are injected so the domain stays pure and deterministic:
 * the same aggregate + trigger + context always yields the same event and audit record.
 */
export interface DomainContext {
  readonly actor: Actor;
  readonly occurredAt: Timestamp;
  readonly eventId: EventId;
  readonly auditId: AuditId;
  readonly metadata?: JsonObject;
}
