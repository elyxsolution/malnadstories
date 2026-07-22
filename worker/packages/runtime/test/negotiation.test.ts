import { describe, expect, it } from 'vitest';
import type {
  CapabilityNegotiator,
  CapabilityRequirement,
  CapabilityOffer,
} from '@workerv2/runtime';

// The runtime exposes the negotiation CONTRACT only (no implementation). This test provides a
// trivial reference negotiator to prove the interfaces are usable and correctly shaped.
const exactMatchNegotiator: CapabilityNegotiator = {
  negotiate(required, offered) {
    const matched: { requirement: CapabilityRequirement; offer: CapabilityOffer }[] = [];
    const unmet: CapabilityRequirement[] = [];
    for (const req of required) {
      const offer = offered.find(
        (o) =>
          o.name === req.name && (req.versionRange === undefined || o.version === req.versionRange),
      );
      if (offer) matched.push({ requirement: req, offer });
      else unmet.push(req);
    }
    return { satisfied: unmet.length === 0, matched, unmet };
  },
};

describe('capability negotiation contract', () => {
  it('reports satisfied when all requirements are offered', () => {
    const result = exactMatchNegotiator.negotiate(
      [{ name: 'thumbnails' }, { name: 'ocr', versionRange: '1.0.0' }],
      [
        { name: 'thumbnails', version: '2.0.0' },
        { name: 'ocr', version: '1.0.0' },
      ],
    );
    expect(result.satisfied).toBe(true);
    expect(result.matched).toHaveLength(2);
    expect(result.unmet).toHaveLength(0);
  });

  it('reports unmet requirements', () => {
    const result = exactMatchNegotiator.negotiate(
      [{ name: 'ocr', versionRange: '2.0.0' }],
      [{ name: 'ocr', version: '1.0.0' }],
    );
    expect(result.satisfied).toBe(false);
    expect(result.unmet.map((r) => r.name)).toStrictEqual(['ocr']);
  });
});
