/**
 * PREVIEW-PDF RECLAMATION — the barrel.
 *
 * Deliberately does NOT re-export the brand symbol (`PREVIEW_BRAND`). A `VerifiedPreviewOrphan`
 * can therefore only be minted inside this module's `reclaim.ts`, which is what makes the deleter's
 * parameter type a real authorisation rather than a naming convention.
 */

export { parsePreviewPdfKey, previewPdfKeyFor, ADMIN_NAMESPACES } from './preview-key.js';
export type { PreviewPdfKey, PreviewKeyRejection, PreviewParseResult } from './preview-key.js';

export { lookupPreviewOwnership, OWNERSHIP_BATCH_SIZE } from './ownership.js';
export type { PreviewOwnershipQuery, PreviewOwnershipVerdict, PreviewOwnershipResult } from './ownership.js';

export { reclaimPreviewPdfs } from './reclaim.js';
export type { ReclaimOptions } from './reclaim.js';

export {
  R2VerifiedPreviewDeleter,
  previewDryRunExecutor,
  previewExecutingExecutor,
} from './executor.js';
export type { PreviewExecutor, VerifiedPreviewDeleter, PreviewDeleterConfig } from './executor.js';

export { MIN_DESTRUCTIVE_AGE_MS, NON_DELETABLE_PREVIEW_STATES } from './model.js';
export type {
  VerifiedPreviewOrphan,
  PreviewClassification,
  RevalidatedPreviewClassification,
  PreviewCleanupAction,
  PreviewObjectRecord,
  PreviewCleanupReport,
} from './model.js';
