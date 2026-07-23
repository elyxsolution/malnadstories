import type { ProductCapability, ProductDefinition } from './model.js';

/**
 * PRODUCT CAPABILITIES — pure helpers over the declarative `ProductCapability` shape. The
 * shape is structurally identical to the runtime's `CapabilityRequirement` and processing's
 * `StepCapabilityRequirement` (asserted structurally, never by import), so any engine or
 * negotiator can consume product capability requirements directly.
 */

export const MAX_CAPABILITY_NAME = 200;
export const MAX_CAPABILITY_RANGE = 100;

/** Structural validity of one capability declaration (vocabulary/negotiation is an engine concern). */
export function isValidCapability(cap: ProductCapability): boolean {
  if (typeof cap.name !== 'string' || cap.name.trim() === '') return false;
  if (cap.name.length > MAX_CAPABILITY_NAME) return false;
  if (cap.versionRange !== undefined) {
    if (typeof cap.versionRange !== 'string' || cap.versionRange.trim() === '') return false;
    if (cap.versionRange.length > MAX_CAPABILITY_RANGE) return false;
  }
  return true;
}

/** The capability names a product requires (canonical order — the definition keeps them name-sorted). */
export function requiredCapabilityNames(product: ProductDefinition): readonly string[] {
  return product.capabilities.map((c) => c.name);
}

/**
 * Which required capabilities are NOT present in an available-capability name set. Pure set
 * difference — version-range negotiation belongs to an engine's negotiator, not the model.
 */
export function missingCapabilities(
  required: readonly ProductCapability[],
  availableNames: readonly string[],
): readonly ProductCapability[] {
  const available = new Set(availableNames);
  return required.filter((c) => !available.has(c.name));
}
