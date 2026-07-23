// @workerv2/product — the Product Platform: the immutable, versioned, content-addressable
// product definition system. Product model + versioned catalogs + validation + canonical
// serialization + hashing + constraints + capabilities + the resolver chain (product +
// content → BlueprintSource, never a Blueprint) + the compatibility model.
// Pure data + pure functions — NO rendering, NO layout, NO execution, NO storage.

// --- Errors ---
export { ProductError } from './errors.js';

// --- Model + contracts ---
export type {
  ProductId,
  ProductHash,
  ProductDimensions,
  ProductOptionAxis,
  ProductConstraint,
  RequiresOptionConstraint,
  ExcludesOptionConstraint,
  MaxPlacementsPerSpreadConstraint,
  MaxTextsPerSpreadConstraint,
  ProductCapability,
  ProductDefinition,
  ProductVersionRef,
  ProductSelection,
  ResolvedSelection,
} from './model.js';
export { PRODUCT_SCHEMA_VERSION, optionAxis } from './model.js';

// --- Validation (the invariants gate) + validating constructor ---
export type { ProductInput } from './validate.js';
export { validateProduct, defineProduct, SEMVER_RE } from './validate.js';

// --- Constraints (pure evaluation) ---
export type { SpreadLimits } from './constraints.js';
export { resolveSelection, spreadLimits } from './constraints.js';

// --- Capabilities (pure helpers; shape structurally = runtime/processing requirements) ---
export {
  isValidCapability,
  requiredCapabilityNames,
  missingCapabilities,
  MAX_CAPABILITY_NAME,
  MAX_CAPABILITY_RANGE,
} from './capabilities.js';

// --- Catalog (immutable, versioned, canonical) ---
export type { ProductCatalog, CatalogInput } from './catalog.js';
export {
  CATALOG_SCHEMA_VERSION,
  validateCatalog,
  defineCatalog,
  getProduct,
  listProducts,
} from './catalog.js';

// --- Canonical serialization ---
export { serializeProduct, parseProduct, serializeCatalog, parseCatalog } from './serialize.js';

// --- Identity (content addressing) ---
export { PRODUCT_HASH_ALGORITHM, hashProduct, hashCanonical } from './identity.js';

// --- Versioning (deterministic ordering + INV-11 pins) ---
export { compareSemver, productVersionRef, productVersionPins } from './versioning.js';

// --- Resolution (product + content → BlueprintSource; resolver chain contracts) ---
export type {
  ResolutionContent,
  ResolutionRequest,
  ResolutionContext,
  SourceResolver,
  ResolverRef,
  ProductResolution,
} from './resolver.js';
export { resolveProduct } from './resolver.js';

// --- Compatibility model ---
export type {
  CompatibilityRule,
  CompatibilityMatrix,
  CompatibilityMatrixInput,
  CompatibilityQuery,
  CompatibilityVerdict,
} from './compatibility.js';
export {
  COMPATIBILITY_SCHEMA_VERSION,
  ANY,
  validateCompatibilityMatrix,
  defineCompatibilityMatrix,
  checkCompatibility,
  serializeCompatibilityMatrix,
  hashCompatibilityMatrix,
} from './compatibility.js';
