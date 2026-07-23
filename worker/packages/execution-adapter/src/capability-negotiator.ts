import type {
  CapabilityMatch,
  CapabilityNegotiationResult,
  CapabilityNegotiator,
  CapabilityOffer,
  CapabilityRequirement,
} from '@workerv2/runtime';

/**
 * The CAPABILITY NEGOTIATOR — the concrete implementation of the runtime's reserved
 * `CapabilityNegotiator` seam (interfaces-only until now). A work node declares the runtime
 * capabilities it REQUIRES (structurally `CapabilityRequirement`s); the host declares what it
 * OFFERS at concrete versions; this reconciles them BEFORE dispatch so a node whose host lacks a
 * capability never invokes a processor.
 *
 * Version policy (minimal + deterministic): an undefined range or `*` is satisfied by any offer
 * of that name; otherwise the offered version must equal the range exactly. Richer semver-range
 * matching is an additive refinement behind this same interface — every driver keeps working.
 */
export class DefaultCapabilityNegotiator implements CapabilityNegotiator {
  negotiate(
    required: readonly CapabilityRequirement[],
    offered: readonly CapabilityOffer[],
  ): CapabilityNegotiationResult {
    const matched: CapabilityMatch[] = [];
    const unmet: CapabilityRequirement[] = [];

    for (const requirement of required) {
      const offer = offered.find((o) => o.name === requirement.name && satisfies(requirement, o));
      if (offer === undefined) {
        unmet.push(requirement);
      } else {
        matched.push({ requirement, offer });
      }
    }
    // Deterministic ordering of the report (input order does not affect the verdict).
    matched.sort((a, b) => cmp(a.requirement.name, b.requirement.name));
    unmet.sort((a, b) => cmp(a.name, b.name));
    return Object.freeze({ satisfied: unmet.length === 0, matched, unmet });
  }
}

/** The shared, ready-to-inject negotiator instance. */
export const defaultCapabilityNegotiator = new DefaultCapabilityNegotiator();

function satisfies(requirement: CapabilityRequirement, offer: CapabilityOffer): boolean {
  const range = requirement.versionRange;
  if (range === undefined || range === '*') return true;
  return offer.version === range;
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
