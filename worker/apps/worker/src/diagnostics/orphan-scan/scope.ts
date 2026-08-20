/**
 * SCAN SCOPE — what the detector is allowed to look at, and the validation that makes a
 * caller-supplied scope safe.
 *
 * The raw-upload namespace is DYNAMIC (`{userId}/albums/{albumId}/`), so there is no single static
 * prefix to default to. The resolution is to make the scope explicit and structurally derived:
 * an operator names a user or an album by UUID and the prefix is BUILT here from those UUIDs —
 * a caller never supplies a prefix string directly, so there is nothing to escape from.
 *
 * A whole-bucket scan is possible but must be opted into by name, and it is stamped
 * `bucketWide: true` in the report so nobody mistakes it for a targeted one.
 */

import { isUuid } from './raw-upload-key.js';
import type { ScanScope } from './model.js';

export type ScopeRequest =
  | { readonly kind: 'album'; readonly userId: string; readonly albumId: string }
  | { readonly kind: 'user'; readonly userId: string }
  | { readonly kind: 'bucket' };

export type ScopeResult =
  { readonly ok: true; readonly scope: ScanScope } | { readonly ok: false; readonly error: string };

/**
 * Validate a scope request and build its literal R2 prefix.
 *
 * Every accepted prefix is ASSEMBLED from validated UUIDs, never passed through from input. That
 * is what makes `../../`, absolute paths, wildcards, and cross-namespace prefixes impossible
 * rather than merely filtered: a value that is not a canonical UUID never reaches the template.
 */
export function resolveScope(request: ScopeRequest): ScopeResult {
  if (request.kind === 'album') {
    if (!isUuid(request.userId))
      return { ok: false, error: 'userId must be a canonical lowercase UUID' };
    if (!isUuid(request.albumId))
      return { ok: false, error: 'albumId must be a canonical lowercase UUID' };
    return {
      ok: true,
      scope: {
        kind: 'album',
        prefix: `${request.userId}/albums/${request.albumId}/`,
        bucketWide: false,
      },
    };
  }

  if (request.kind === 'user') {
    if (!isUuid(request.userId))
      return { ok: false, error: 'userId must be a canonical lowercase UUID' };
    return {
      ok: true,
      scope: { kind: 'user', prefix: `${request.userId}/albums/`, bucketWide: false },
    };
  }

  // Whole bucket: no prefix filter. Non-raw namespaces (cover-templates/, album-products/,
  // stickers/) are still listed, but the parser classifies every one of them NOT_RAW_UPLOAD, so
  // they can never become candidates — the breadth costs listing calls, not safety.
  return { ok: true, scope: { kind: 'bucket', prefix: '', bucketWide: true } };
}
