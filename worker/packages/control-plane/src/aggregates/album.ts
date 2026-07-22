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
 * The persisted state of an album, as handed to `Album.reconstitute`. Ids and timestamps are
 * already-validated value objects (parsed by the caller); `status` is raw and validated here.
 */
export interface AlbumSnapshot {
  readonly id: AlbumId;
  readonly title: string;
  readonly status: string;
  readonly createdAt: Timestamp;
  readonly updatedAt: Timestamp;
}

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

  /**
   * Reconstitute an album from persisted state WITHOUT emitting events — the domain-owned
   * reconstruction path repositories use (they never call the private constructor). Enforces the
   * same invariants as `create` (title bounds) plus a valid persisted status, so a corrupt record
   * cannot become a bad aggregate.
   */
  static reconstitute(snapshot: AlbumSnapshot): Result<Album, ValidationError> {
    const title = snapshot.title.trim();
    if (title === '' || title.length > MAX_TITLE) {
      return err(
        new ValidationError(`Album title must be 1..${MAX_TITLE} characters`, {
          context: { length: title.length },
        }),
      );
    }
    if (!ALBUM_MACHINE.hasState(snapshot.status)) {
      return err(
        new ValidationError(`Unknown album status: "${snapshot.status}"`, {
          context: { status: snapshot.status },
        }),
      );
    }
    return ok(
      new Album(snapshot.id, title, snapshot.status, snapshot.createdAt, snapshot.updatedAt),
    );
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
