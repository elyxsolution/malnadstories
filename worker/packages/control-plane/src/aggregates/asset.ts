import type { Result } from '@workerv2/contracts';
import { ok } from '@workerv2/utils';
import type { AssetId, AlbumId } from '../ids.js';
import type { Timestamp } from '../time.js';
import type { DomainContext } from '../context.js';
import type { TransitionError } from '../errors.js';
import { ASSET_MACHINE } from '../lifecycle/asset.js';
import type { AssetState, AssetTrigger } from '../lifecycle/asset.js';
import { domainEvent } from '../events/domain-event.js';
import { recordTransition } from '../audit/audit-record.js';
import type { TransitionOutcome } from './outcome.js';

/**
 * The Asset aggregate — the lifecycle model of an uploaded asset (incoming → … → deleted).
 * Immutable, pure, deterministic. Carries the owning `albumId` for lineage but performs no I/O.
 */
export class Asset {
  private constructor(
    readonly id: AssetId,
    readonly albumId: AlbumId,
    readonly status: AssetState,
    readonly createdAt: Timestamp,
    readonly updatedAt: Timestamp,
  ) {
    Object.freeze(this);
  }

  /** Create a new asset in the initial (`incoming`) state, with its creation event + audit. */
  static create(
    input: { id: AssetId; albumId: AlbumId },
    ctx: DomainContext,
  ): TransitionOutcome<Asset> {
    const asset = new Asset(
      input.id,
      input.albumId,
      ASSET_MACHINE.initial,
      ctx.occurredAt,
      ctx.occurredAt,
    );
    const event = domainEvent({
      id: ctx.eventId,
      type: 'asset.created',
      occurredAt: ctx.occurredAt,
      subjectId: input.id,
      payload: { albumId: input.albumId },
    });
    const audit = recordTransition({
      id: ctx.auditId,
      occurredAt: ctx.occurredAt,
      actor: ctx.actor,
      entityType: 'asset',
      entityId: input.id,
      action: 'asset.created',
      toState: asset.status,
      metadata: ctx.metadata,
    });
    return { aggregate: asset, event, audit };
  }

  /** Attempt a lifecycle transition. Returns a `TransitionError` if the edge is illegal. */
  transition(
    trigger: AssetTrigger,
    ctx: DomainContext,
  ): Result<TransitionOutcome<Asset>, TransitionError> {
    const next = ASSET_MACHINE.nextState(this.status, trigger);
    if (!next.ok) return next;

    const asset = new Asset(this.id, this.albumId, next.value, this.createdAt, ctx.occurredAt);
    const type = `asset.${next.value}`;
    const event = domainEvent({
      id: ctx.eventId,
      type,
      occurredAt: ctx.occurredAt,
      subjectId: this.id,
      payload: { trigger, from: this.status, to: next.value },
    });
    const audit = recordTransition({
      id: ctx.auditId,
      occurredAt: ctx.occurredAt,
      actor: ctx.actor,
      entityType: 'asset',
      entityId: this.id,
      action: type,
      fromState: this.status,
      toState: next.value,
      metadata: ctx.metadata,
    });
    return ok({ aggregate: asset, event, audit });
  }

  isTerminal(): boolean {
    return ASSET_MACHINE.isTerminal(this.status);
  }

  legalTriggers(): AssetTrigger[] {
    return ASSET_MACHINE.legalTriggers(this.status);
  }
}
