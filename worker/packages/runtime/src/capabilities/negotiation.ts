/**
 * Capability version negotiation — INTERFACES ONLY (no implementation).
 *
 * A forward-looking hook (recommended after Phase 2): a consumer declares the capabilities it
 * REQUIRES, optionally with a version range; providers declare what they OFFER, with concrete
 * versions; a negotiator reconciles the two. The concrete negotiation algorithm (semver-range
 * matching, resolution policy) is deferred to the phase that needs it — this file reserves the
 * contract so it can be added additively without reshaping the runtime.
 */

/** A required capability, optionally constrained to a version range (e.g. a semver range). */
export interface CapabilityRequirement {
  readonly name: string;
  readonly versionRange?: string;
}

/** An offered capability at a concrete version. */
export interface CapabilityOffer {
  readonly name: string;
  readonly version: string;
}

/** One satisfied requirement paired with the offer that satisfied it. */
export interface CapabilityMatch {
  readonly requirement: CapabilityRequirement;
  readonly offer: CapabilityOffer;
}

/** The outcome of negotiating a set of requirements against a set of offers. */
export interface CapabilityNegotiationResult {
  readonly satisfied: boolean;
  readonly matched: readonly CapabilityMatch[];
  readonly unmet: readonly CapabilityRequirement[];
}

/** Reconciles required capabilities against offered ones. Implementation deferred. */
export interface CapabilityNegotiator {
  negotiate(
    required: readonly CapabilityRequirement[],
    offered: readonly CapabilityOffer[],
  ): CapabilityNegotiationResult;
}
