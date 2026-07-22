import type { JsonObject } from '@workerv2/contracts';
import { technicalEvent } from '@workerv2/control-plane';
import type { TechnicalEvent, EventId, Timestamp } from '@workerv2/control-plane';

/**
 * Infrastructure TECHNICAL event types (INV-12 operational stream). Emitted by concrete adapters
 * at persistence/storage boundaries. Stable `infra.*` names — treat as a contract.
 */
export const INFRA_EVENTS = {
  unitOfWorkCommitted: 'infra.uow_committed',
  unitOfWorkRolledBack: 'infra.uow_rolled_back',
  recordPersisted: 'infra.record_persisted',
  recordDeleted: 'infra.record_deleted',
  artifactStored: 'infra.artifact_stored',
} as const;

export type InfraEventType = (typeof INFRA_EVENTS)[keyof typeof INFRA_EVENTS];

/**
 * Build an infrastructure technical event, reusing the domain's `TechnicalEvent` model so the
 * operational stream stays single-sourced (INV-12). Pure and deterministic — id + time injected.
 */
export function makeInfraEvent(input: {
  id: EventId;
  type: InfraEventType;
  occurredAt: Timestamp;
  payload?: JsonObject;
}): TechnicalEvent {
  return technicalEvent({
    id: input.id,
    type: input.type,
    occurredAt: input.occurredAt,
    ...(input.payload !== undefined ? { payload: input.payload } : {}),
  });
}

/** A sink that receives infrastructure technical events (concrete transport supplied later). */
export interface TechnicalEventSink {
  publish(event: TechnicalEvent): void | Promise<void>;
}
