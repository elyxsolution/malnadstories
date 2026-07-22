// @workerv2/control-plane — Worker V2 Control Plane DOMAIN.
//
// Framework-independent, immutable, deterministic, side-effect-free source-of-truth model.
// No infrastructure, no I/O, no persistence — those (State Store, Run Registry) are deferred
// to a later phase (see ADR-0002). Time and identifiers are always injected.

// --- Value objects ---
export type { AlbumId, AssetId, RunId, ActorId, EventId, AuditId } from './ids.js';
export {
  makeAlbumId,
  makeAssetId,
  makeRunId,
  makeActorId,
  makeEventId,
  makeAuditId,
} from './ids.js';
export type { Timestamp } from './time.js';
export { makeTimestamp, compareTimestamps } from './time.js';
export type { Actor, ActorKind, EntityType } from './actor.js';
export { makeActor } from './actor.js';
export type { DomainContext } from './context.js';

// --- Domain errors ---
export { TransitionError, PolicyViolationError } from './errors.js';

// --- State machines ---
export type {
  Transition,
  StateMachine,
  StateMachineDefinition,
} from './lifecycle/state-machine.js';
export { defineStateMachine } from './lifecycle/state-machine.js';
export type { AlbumState, AlbumTrigger } from './lifecycle/album.js';
export { ALBUM_MACHINE } from './lifecycle/album.js';
export type { AssetState, AssetTrigger } from './lifecycle/asset.js';
export { ASSET_MACHINE } from './lifecycle/asset.js';
export type { RunState, RunTrigger } from './lifecycle/run.js';
export { RUN_MACHINE, ACTIVE_RUN_STATES, isActiveRunState } from './lifecycle/run.js';

// --- Events (technical vs domain — INV-12) ---
export type { DomainEvent } from './events/domain-event.js';
export { domainEvent } from './events/domain-event.js';
export type { TechnicalEvent, PlatformEvent } from './events/technical-event.js';
export { technicalEvent, isDomainEvent, isTechnicalEvent } from './events/technical-event.js';

// --- Audit (INV-9) ---
export type { AuditRecord } from './audit/audit-record.js';
export { recordTransition } from './audit/audit-record.js';

// --- Version registry model (INV-11) ---
export type { VersionComponent } from './version/version-set.js';
export { VersionSet, VERSION_COMPONENTS } from './version/version-set.js';

// --- Domain policies ---
export { canStartRun } from './policies/one-active-run.js';

// --- Aggregates ---
export type { TransitionOutcome } from './aggregates/outcome.js';
export { Album } from './aggregates/album.js';
export type { AlbumSnapshot } from './aggregates/album.js';
export { Asset } from './aggregates/asset.js';
export type { AssetSnapshot } from './aggregates/asset.js';
export { Run } from './aggregates/run.js';
export type { RunSnapshot } from './aggregates/run.js';
