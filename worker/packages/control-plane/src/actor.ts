import type { ActorId } from './ids.js';

/** Who caused a transition. `system` = the platform acting on its own behalf. */
export type ActorKind = 'customer' | 'admin' | 'system';

/** Immutable value object identifying the initiator of an audited action. */
export interface Actor {
  readonly id: ActorId;
  readonly kind: ActorKind;
}

/** Construct a frozen `Actor`. */
export function makeActor(id: ActorId, kind: ActorKind): Actor {
  return Object.freeze({ id, kind });
}

/** The kinds of domain entity a lifecycle governs. */
export type EntityType = 'album' | 'asset' | 'run';
