/**
 * ACCOUNT ASSET PREFLIGHT (Phase 6 Prompt 6) — read-only.
 *
 * Supports the deletion procedure that migration 0054 makes mandatory. Exports no deletion
 * capability, because none exists here.
 */

export {
  collectAccountAssets,
  dedupeKeys,
  keysOfPhoto,
  type AccountAssets,
  type AssetQuery,
  type PhotoAssetRow,
} from './assets.js';
