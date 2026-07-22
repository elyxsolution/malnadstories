import type { JsonObject } from '@workerv2/contracts';
import type { Timestamp } from '../time.js';
import type { AuditId } from '../ids.js';
import type { Actor, EntityType } from '../actor.js';

/**
 * An immutable audit record for a single state transition. Every domain transition produces
 * one (INV-9: all transitions audited). Records are append-only facts — they are never mutated.
 */
export interface AuditRecord {
  readonly id: AuditId;
  readonly occurredAt: Timestamp;
  readonly actor: Actor;
  readonly entityType: EntityType;
  readonly entityId: string;
  /** The action performed, e.g. `album.submitted` or `album.created`. */
  readonly action: string;
  readonly fromState?: string;
  readonly toState?: string;
  readonly metadata?: JsonObject;
}

/** Build a frozen `AuditRecord`, omitting absent optional fields for clean equality. */
export function recordTransition(input: {
  id: AuditId;
  occurredAt: Timestamp;
  actor: Actor;
  entityType: EntityType;
  entityId: string;
  action: string;
  fromState?: string;
  toState?: string;
  metadata?: JsonObject;
}): AuditRecord {
  return Object.freeze({
    id: input.id,
    occurredAt: input.occurredAt,
    actor: input.actor,
    entityType: input.entityType,
    entityId: input.entityId,
    action: input.action,
    ...(input.fromState !== undefined ? { fromState: input.fromState } : {}),
    ...(input.toState !== undefined ? { toState: input.toState } : {}),
    ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
  });
}
