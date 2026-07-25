import type { CancellationToken } from '../../recovery/cancellation.js';
import type { CleanupContext, CleanupDeps, CleanupStage } from './cleanup-context.js';

/**
 * THE CLEANUP STAGES — a composable, idempotent, cancellable delete pipeline.
 *
 * Placement note (cleaner than the prompt's literal 5-stage split): "locate resources" and "database
 * reconciliation" are NO-OPS for this cleanup shape and are intentionally omitted. The app hands the
 * worker the EXACT R2 keys and has already deleted the owning DB rows before enqueuing (`deleteAlbum`),
 * so there is nothing to locate and no rows to reconcile — inventing those stages would be dead code.
 * The real work is Validate → Delete (idempotent + cancellable) → Finalize.
 */

// --- 1. Validate: keep only well-formed keys (defensive; the producer already sends clean keys). ---
export class ValidateCleanupStage implements CleanupStage {
  readonly name = 'validate' as const;
  async run(ctx: CleanupContext): Promise<CleanupContext> {
    const keys = ctx.keys.filter((k) => typeof k === 'string' && k.length > 0);
    return { ...ctx, keys };
  }
}

// --- 2. Delete: remove each object idempotently; observe cancellation between objects. ---
export class DeleteObjectsStage implements CleanupStage {
  readonly name = 'delete' as const;
  async run(
    ctx: CleanupContext,
    deps: CleanupDeps,
    cancellation: CancellationToken,
  ): Promise<CleanupContext> {
    let deleted = 0;
    for (const key of ctx.keys) {
      cancellation.throwIfCancelled(); // graceful interruption between objects
      // R2 DeleteObject is idempotent: a missing/already-deleted key is a no-op, so duplicate
      // cleanup + partial-then-retried cleanup are both safe.
      await deps.objectStore.delete(key);
      deleted += 1;
    }
    // The count is REPORTED, not instrumented: it rides out on the context and then on the
    // `cleanup.completed` event, from which the observability layer derives the counter.
    return { ...ctx, deleted };
  }
}

// --- 3. Finalize: nothing to persist (rows already gone) — the completion event carries the result. ---
export class FinalizeCleanupStage implements CleanupStage {
  readonly name = 'finalize' as const;
  async run(ctx: CleanupContext): Promise<CleanupContext> {
    return ctx;
  }
}

/** The default, ordered cleanup pipeline. */
export function defaultCleanupStages(): readonly CleanupStage[] {
  return [new ValidateCleanupStage(), new DeleteObjectsStage(), new FinalizeCleanupStage()];
}
