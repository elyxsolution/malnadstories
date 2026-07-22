import type { Result, JsonObject } from '@workerv2/contracts';
import {
  makeActorId,
  makeEventId,
  makeAuditId,
  makeTimestamp,
  makeActor,
} from '@workerv2/control-plane';
import type { DomainContext, Actor, Timestamp } from '@workerv2/control-plane';

/** Force-unwrap a `Result` in tests; throws on the error branch. */
export function unwrap<T>(r: Result<T, unknown>): T {
  if (!r.ok) throw new Error(`unwrap() called on Err: ${String(r.error)}`);
  return r.value;
}

export const timestamp = (iso: string): Timestamp => unwrap(makeTimestamp(iso));

export function systemActor(id = 'sys-1'): Actor {
  return makeActor(unwrap(makeActorId(id)), 'system');
}

/** Build a deterministic `DomainContext` for tests. */
export function makeCtx(
  occurredAtIso: string,
  opts?: { eventId?: string; auditId?: string; actor?: Actor; metadata?: JsonObject },
): DomainContext {
  return {
    actor: opts?.actor ?? systemActor(),
    occurredAt: unwrap(makeTimestamp(occurredAtIso)),
    eventId: unwrap(makeEventId(opts?.eventId ?? 'evt-1')),
    auditId: unwrap(makeAuditId(opts?.auditId ?? 'aud-1')),
    ...(opts?.metadata ? { metadata: opts.metadata } : {}),
  };
}
