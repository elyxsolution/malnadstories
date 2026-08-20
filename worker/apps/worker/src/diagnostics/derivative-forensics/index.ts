/**
 * DERIVATIVE OWNERSHIP FORENSICS (Phase 6 Prompt 5) — read-only.
 *
 * Exports parsers and an inventory. Exports NO deletion capability, because none exists here.
 */

export {
  RAW_EXTENSIONS,
  derivativeKeysForRaw,
  parseDerivativeKey,
  siblingKey,
  type DerivativeKey,
  type DerivativeKind,
} from './derivative-key.js';
export {
  buildDerivativeInventory,
  type DerivativeInventory,
  type DerivativeOwnership,
  type DerivativeRecord,
  type InventoryOptions,
} from './inventory.js';
