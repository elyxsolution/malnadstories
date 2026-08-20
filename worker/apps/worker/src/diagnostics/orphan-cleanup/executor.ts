/**
 * THE EXECUTOR — how a dry run is made STRUCTURALLY incapable of deleting.
 *
 * The weak version of this idea is `if (dryRun) { skip }`, which is one edited line away from
 * deleting in a mode that promised not to. So dry-run is not a boolean here: it is a variant of a
 * discriminated union that DOES NOT CARRY A DELETER AT ALL.
 *
 *   { mode: 'dry-run' }                             ← no `deleter` field exists
 *   { mode: 'execute'; deleter: VerifiedOrphanDeleter }
 *
 * In the `'dry-run'` branch, `executor.deleter` is not merely undefined — it is not a property of
 * the narrowed type, so referencing it is a compile error. The dry-run path holds no S3 client
 * with delete permission, constructs no `DeleteObjectCommand`, and has nothing to call.
 */

import type { VerifiedOrphanDeleter } from './deleter.js';

export type CleanupExecutor =
  | { readonly mode: 'dry-run' }
  | { readonly mode: 'execute'; readonly deleter: VerifiedOrphanDeleter };

/** A dry-run executor. Carries no capability whatsoever. */
export function dryRunExecutor(): CleanupExecutor {
  return { mode: 'dry-run' };
}

/** An executing executor. The ONLY way a deleter enters the pipeline. */
export function executingExecutor(deleter: VerifiedOrphanDeleter): CleanupExecutor {
  return { mode: 'execute', deleter };
}
