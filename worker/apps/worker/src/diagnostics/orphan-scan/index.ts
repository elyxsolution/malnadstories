/**
 * READ-ONLY R2 ORPHAN DETECTION (Phase 6, report-only slice).
 *
 * This barrel intentionally exports NO deletion capability, because none exists in this
 * subsystem. The public surface is: parse a key, classify an object, list objects, look up
 * ownership, run a scan, read the report. Acting on a report is a later, separate slice.
 */

export {
  CLOCK_SKEW_ALLOWANCE_MS,
  DB_LOOKUP_BATCH_SIZE,
  LIST_PAGE_SIZE,
  MAX_LIST_PAGES,
  ORPHAN_MIN_AGE_MS,
  PROTECTED_CLASSIFICATIONS,
  type ClassifiedObject,
  type DbInconsistency,
  type OrphanClassification,
  type OrphanScanReport,
  type ScanError,
  type ScanScope,
} from './model.js';
export {
  NON_USER_NAMESPACES,
  RAW_UPLOAD_EXTENSIONS,
  isInAlbumNamespace,
  isUuid,
  parseRawUploadKey,
  type ParseResult,
  type RawKeyRejection,
  type RawUploadKey,
} from './raw-upload-key.js';
export {
  classifyObject,
  type ClassifyInput,
  type ListedObject,
  type OwnershipVerdict,
} from './classify.js';
export {
  R2ReadOnlyLister,
  type ListPage,
  type ListPageRequest,
  type ListerConfig,
  type ReadOnlyMetadataReader,
  type ReadOnlyObjectLister,
  type S3ListLike,
} from './object-lister.js';
export {
  lookupOwnership,
  type OwnershipLookupResult,
  type OwnershipQuery,
} from './photo-lookup.js';
export { resolveScope, type ScopeRequest, type ScopeResult } from './scope.js';
export { runOrphanScan, type ScanOptions } from './scan.js';
