import type { DomainEvent } from '../events/domain-event.js';
import type { AuditRecord } from '../audit/audit-record.js';

/**
 * The pure result of a successful aggregate operation: the next (immutable) aggregate, the
 * domain event it emitted, and the audit record of the transition (INV-9). The caller decides
 * what to do with the event/audit — the domain performs no I/O.
 */
export interface TransitionOutcome<A> {
  readonly aggregate: A;
  readonly event: DomainEvent;
  readonly audit: AuditRecord;
}
