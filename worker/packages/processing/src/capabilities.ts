/**
 * CAPABILITY REQUIREMENTS a step declares against the runtime that will host its processor.
 * Declarative only — matching/negotiation is an engine concern (the runtime package reserves
 * `CapabilityNegotiator` for exactly that).
 *
 * The shape is deliberately STRUCTURALLY IDENTICAL to the runtime's `CapabilityRequirement`
 * negotiation contract, without importing it: the processing model must stay consumable by any
 * engine without depending on the hosting framework. TypeScript's structural typing makes the
 * two interchangeable (asserted by a compile-time test).
 */
export interface StepCapabilityRequirement {
  /** The capability name (matches the runtime capability registry vocabulary). */
  readonly name: string;
  /** Optional compatible-version constraint (e.g. a semver range). Opaque here; the engine's negotiator interprets it. */
  readonly versionRange?: string;
}

export function isValidCapabilityRequirement(req: StepCapabilityRequirement): boolean {
  if (req.name.trim() === '' || req.name.length > 200) return false;
  if (req.versionRange !== undefined && req.versionRange.trim() === '') return false;
  return true;
}
