import type { Result } from '@workerv2/contracts';
import { ok, err } from '@workerv2/utils';
import { ValidationError } from '@workerv2/errors';
import type { RunId, AlbumId } from '../ids.js';
import type { Timestamp } from '../time.js';
import type { DomainContext } from '../context.js';
import type { TransitionError } from '../errors.js';
import { RUN_MACHINE } from '../lifecycle/run.js';
import type { RunState, RunTrigger } from '../lifecycle/run.js';
import { isActiveRunState } from '../lifecycle/run.js';
import type { VersionSet } from '../version/version-set.js';
import { domainEvent } from '../events/domain-event.js';
import { recordTransition } from '../audit/audit-record.js';
import type { TransitionOutcome } from './outcome.js';

/** The persisted state of a run, as handed to `Run.reconstitute`. */
export interface RunSnapshot {
  readonly id: RunId;
  readonly albumId: AlbumId;
  readonly status: string;
  readonly versions: VersionSet;
  readonly createdAt: Timestamp;
  readonly updatedAt: Timestamp;
}

/**
 * The Run aggregate — one processing execution for an album. It pins a `VersionSet` at
 * creation that NEVER changes for the life of the run (INV-11: versions frozen at run start),
 * so a rebuild from the same run is reproducible. Immutable, pure, deterministic.
 */
export class Run {
  private constructor(
    readonly id: RunId,
    readonly albumId: AlbumId,
    readonly status: RunState,
    readonly versions: VersionSet,
    readonly createdAt: Timestamp,
    readonly updatedAt: Timestamp,
  ) {
    Object.freeze(this);
  }

  /** Create a new run (state `pending`) with a frozen version set, plus event + audit. */
  static create(
    input: { id: RunId; albumId: AlbumId; versions: VersionSet },
    ctx: DomainContext,
  ): TransitionOutcome<Run> {
    const run = new Run(
      input.id,
      input.albumId,
      RUN_MACHINE.initial,
      input.versions,
      ctx.occurredAt,
      ctx.occurredAt,
    );
    const event = domainEvent({
      id: ctx.eventId,
      type: 'run.created',
      occurredAt: ctx.occurredAt,
      subjectId: input.id,
      payload: { albumId: input.albumId, versions: input.versions.toJSON() },
    });
    const audit = recordTransition({
      id: ctx.auditId,
      occurredAt: ctx.occurredAt,
      actor: ctx.actor,
      entityType: 'run',
      entityId: input.id,
      action: 'run.created',
      toState: run.status,
      metadata: ctx.metadata,
    });
    return { aggregate: run, event, audit };
  }

  /**
   * Reconstitute a run from persisted state WITHOUT emitting events (domain-owned
   * reconstruction). The frozen `versions` are supplied pre-validated (a `VersionSet`); the
   * persisted status is validated so a corrupt record cannot become a run.
   */
  static reconstitute(snapshot: RunSnapshot): Result<Run, ValidationError> {
    if (!RUN_MACHINE.hasState(snapshot.status)) {
      return err(
        new ValidationError(`Unknown run status: "${snapshot.status}"`, {
          context: { status: snapshot.status },
        }),
      );
    }
    return ok(
      new Run(
        snapshot.id,
        snapshot.albumId,
        snapshot.status,
        snapshot.versions,
        snapshot.createdAt,
        snapshot.updatedAt,
      ),
    );
  }

  /**
   * Attempt a lifecycle transition. The frozen `versions` are carried forward unchanged —
   * a run never mixes versions mid-flight (INV-11).
   */
  transition(
    trigger: RunTrigger,
    ctx: DomainContext,
  ): Result<TransitionOutcome<Run>, TransitionError> {
    const next = RUN_MACHINE.nextState(this.status, trigger);
    if (!next.ok) return next;

    const run = new Run(
      this.id,
      this.albumId,
      next.value,
      this.versions,
      this.createdAt,
      ctx.occurredAt,
    );
    const type = `run.${next.value}`;
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
      entityType: 'run',
      entityId: this.id,
      action: type,
      fromState: this.status,
      toState: next.value,
      metadata: ctx.metadata,
    });
    return ok({ aggregate: run, event, audit });
  }

  /** Whether this run is active (non-terminal) — feeds the one-active-run policy (INV-6). */
  isActive(): boolean {
    return isActiveRunState(this.status);
  }

  isTerminal(): boolean {
    return RUN_MACHINE.isTerminal(this.status);
  }

  legalTriggers(): RunTrigger[] {
    return RUN_MACHINE.legalTriggers(this.status);
  }
}
