/**
 * SAFE R2 ORPHAN RECLAMATION (Phase 6 Prompt 3).
 *
 * NOTE WHAT IS NOT EXPORTED: the `VerifiedOrphan` brand symbol. `VerifiedOrphan` is exported as a
 * TYPE so callers can read a report, but no module outside `verify.ts` can construct one — which
 * is what makes `deleteVerified` impossible to call with an arbitrary key. The Prompt-2
 * `orphan-scan` barrel remains entirely deletion-free; deletion lives only here.
 */

export {
  MIN_DESTRUCTIVE_AGE_MS,
  NON_DELETABLE_STATES,
  type CleanupAction,
  type CleanupError,
  type CleanupObjectRecord,
  type CleanupReport,
  type RevalidatedClassification,
  type VerifiedOrphan,
} from './model.js';
export {
  inScope,
  sameObject,
  verifyCandidate,
  type FreshOwnership,
  type VerificationOutcome,
} from './verify.js';
export {
  R2VerifiedOrphanDeleter,
  type DeleterConfig,
  type S3DeleteLike,
  type VerifiedOrphanDeleter,
} from './deleter.js';
export { dryRunExecutor, executingExecutor, type CleanupExecutor } from './executor.js';
export {
  runOrphanCleanup,
  type CleanupEvent,
  type CleanupOptions,
  type PreDeleteSummary,
} from './cleanup.js';
