import { describe, expect, it } from 'vitest';
import {
  diffBlueprints,
  walkBlueprint,
  referencedArtifacts,
  totalPages,
} from '@workerv2/blueprint';
import { rect, sampleBlueprint, sampleSource } from './helpers.js';

describe('blueprint diff model', () => {
  it('identical blueprints diff as identical (empty change sets)', () => {
    const diff = diffBlueprints(sampleBlueprint(), sampleBlueprint());
    expect(diff).toStrictEqual({ identical: true, added: [], removed: [], changed: [] });
    expect(Object.isFrozen(diff)).toBe(true);
  });

  it('detects added, removed, and changed nodes by stable id', () => {
    const before = sampleBlueprint();
    const source = sampleSource();
    // Change spread 0's inset frame + drop the cover text + add a text to spread 1.
    const after = sampleBlueprint({
      ...source,
      cover: { placements: source.cover?.placements ?? [] }, // cover text removed
      spreads: [
        {
          pages: 1,
          placements: [
            { slot: 'main', artifact: 'sha256:aa11', frame: rect() },
            { slot: 'inset', artifact: 'sha256:bb22', frame: rect(0.5, 0.5, 0.4, 0.4) }, // changed
          ],
        },
        {
          ...(source.spreads[1] ?? { pages: 2 as const }),
          pages: 2,
          texts: [
            ...(source.spreads[1]?.texts ?? []),
            { content: 'New caption', frame: rect(0.1, 0.9, 0.3, 0.08) }, // added
          ],
        },
      ],
    });

    const diff = diffBlueprints(before, after);
    expect(diff.identical).toBe(false);
    expect(diff.added).toStrictEqual(['spread:0001:text:0001']);
    expect(diff.removed).toStrictEqual(['cover:text:0000']);
    expect(diff.changed).toContain('spread:0000:placement:inset');
    expect(diff.changed).toContain('cover'); // its children changed
  });

  it('is symmetric by construction: diff(a,b).added === diff(b,a).removed', () => {
    const a = sampleBlueprint();
    const b = sampleBlueprint(sampleSource({ title: 'Coorg' }));
    const ab = diffBlueprints(a, b);
    const ba = diffBlueprints(b, a);
    expect(ab.added).toStrictEqual(ba.removed);
    expect(ab.removed).toStrictEqual(ba.added);
    expect(ab.changed).toStrictEqual(ba.changed);
  });
});

describe('blueprint graph traversals', () => {
  it('walkBlueprint visits depth-first from the root in semantic order', () => {
    const order = walkBlueprint(sampleBlueprint()).map((n) => n.id);
    expect(order).toStrictEqual([
      'album',
      'cover',
      'cover:placement:hero',
      'cover:text:0000',
      'spread:0000',
      'spread:0000:placement:inset',
      'spread:0000:placement:main',
      'spread:0001',
      'spread:0001:placement:pano',
      'spread:0001:text:0000',
    ]);
  });

  it('referencedArtifacts is deduplicated + sorted', () => {
    const source = sampleSource();
    const blueprint = sampleBlueprint({
      ...source,
      spreads: [
        ...source.spreads,
        // Re-uses an artifact already placed on spread 0.
        { pages: 1, placements: [{ slot: 'repeat', artifact: 'sha256:aa11', frame: rect() }] },
      ],
    });
    expect(referencedArtifacts(blueprint)).toStrictEqual([
      'sha256:aa11',
      'sha256:bb22',
      'sha256:c0ffee',
      'sha256:dd44',
    ]);
  });

  it('totalPages sums spread page costs', () => {
    expect(totalPages(sampleBlueprint())).toBe(3); // 1 + 2
  });
});
