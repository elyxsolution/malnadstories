import type { Result } from '@workerv2/contracts';
import { ok, err } from '@workerv2/utils';
import { ValidationError } from '@workerv2/errors';
import type { AlbumId } from '../ids.js';
import type { Timestamp } from '../time.js';
import type { DomainContext } from '../context.js';
import type { TransitionError } from '../errors.js';
import { ALBUM_MACHINE } from '../lifecycle/album.js';
import type { AlbumState, AlbumTrigger } from '../lifecycle/album.js';
import { domainEvent } from '../events/domain-event.js';
import { recordTransition } from '../audit/audit-record.js';
import type { TransitionOutcome } from './outcome.js';

const MAX_TITLE = 120;

/**
 * The Album aggregate — the source-of-truth model of an album's lifecycle. Immutable: every
 * operation returns a NEW `Album` plus the emitted domain event and audit record. Pure and
 * deterministic (all time/ids are injected via `DomainContext`).
 */
export class Album {
  private constructor(
    readonly id: AlbumId,
    readonly title: string,
    readonly status: AlbumState,
    readonly createdAt: Timestamp,
    readonly updatedAt: Timestamp,
  ) {
    Object.freeze(this);
  }

  /** Create a new album in the initial state, with its creation event + audit. */
  static create(
    input: { id: AlbumId; title: string },
    ctx: DomainContext,
  ): Result<TransitionOutcome<Album>, ValidationError> {
    const title = input.title.trim();
    if (title === '' || title.length > MAX_TITLE) {
      return err(
        new ValidationError(`Album title must be 1..${MAX_TITLE} characters`, {
          context: { length: title.length },
        }),
      );
    }
    const album = new Album(input.id, title, ALBUM_MACHINE.initial, ctx.occurredAt, ctx.occurredAt);
    const event = domainEvent({
      id: ctx.eventId,
      type: 'album.created',
      occurredAt: ctx.occurredAt,
      subjectId: input.id,
      payload: { title },
    });
    const audit = recordTransition({
      id: ctx.auditId,
      occurredAt: ctx.occurredAt,
      actor: ctx.actor,
      entityType: 'album',
      entityId: input.id,
      action: 'album.created',
      toState: album.status,
      metadata: ctx.metadata,
    });
    return ok({ aggregate: album, event, audit });
  }

  /** Attempt a lifecycle transition. Returns a `TransitionError` if the edge is illegal. */
  transition(
    trigger: AlbumTrigger,
    ctx: DomainContext,
  ): Result<TransitionOutcome<Album>, TransitionError> {
    const next = ALBUM_MACHINE.nextState(this.status, trigger);
    if (!next.ok) return next;

    const album = new Album(this.id, this.title, next.value, this.createdAt, ctx.occurredAt);
    const type = `album.${next.value}`;
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
      entityType: 'album',
      entityId: this.id,
      action: type,
      fromState: this.status,
      toState: next.value,
      metadata: ctx.metadata,
    });
    return ok({ aggregate: album, event, audit });
  }

  isTerminal(): boolean {
    return ALBUM_MACHINE.isTerminal(this.status);
  }

  legalTriggers(): AlbumTrigger[] {
    return ALBUM_MACHINE.legalTriggers(this.status);
  }
}
