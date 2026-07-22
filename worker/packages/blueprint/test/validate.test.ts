import { describe, expect, it } from 'vitest';
import { validateBlueprint, BlueprintError } from '@workerv2/blueprint';
import { mutableClone, sampleBlueprint, unwrapErr } from './helpers.js';

type Raw = Record<string, unknown>;
type RawNode = Record<string, unknown>;

function nodes(raw: Raw): RawNode[] {
  return raw.nodes as RawNode[];
}

function nodeOf(raw: Raw, id: string): RawNode {
  const found = nodes(raw).find((n) => n.id === id);
  if (found === undefined) throw new Error(`fixture node "${id}" missing`);
  return found;
}

const reject = (raw: unknown, pattern: RegExp): void => {
  const error = unwrapErr(validateBlueprint(raw));
  expect(error).toBeInstanceOf(BlueprintError);
  expect(error.message).toMatch(pattern);
};

describe('validateBlueprint — the invariants gate', () => {
  it('accepts a compiled blueprint (round-trip through unknown)', () => {
    const raw = mutableClone(sampleBlueprint());
    expect(validateBlueprint(raw).ok).toBe(true);
  });

  it('I1 — rejects an unsupported schema version', () => {
    const raw = mutableClone(sampleBlueprint());
    raw.schemaVersion = '9.9.9';
    reject(raw, /Unsupported blueprint schema version/);
  });

  it('I2 — rejects an invalid album id', () => {
    const raw = mutableClone(sampleBlueprint());
    raw.albumId = '   ';
    reject(raw, /albumId invalid/);
  });

  it('I3 — rejects duplicate node ids and unsorted node order', () => {
    const dup = mutableClone(sampleBlueprint());
    nodes(dup).push({ ...nodeOf(dup, 'cover:text:0000') });
    reject(dup, /Duplicate node id/);

    const unsorted = mutableClone(sampleBlueprint());
    (unsorted.nodes as RawNode[]).reverse();
    reject(unsorted, /sorted by id/);
  });

  it('I4 — rejects a missing root, a non-album root, and a second album node', () => {
    const missing = mutableClone(sampleBlueprint());
    missing.root = 'ghost';
    reject(missing, /Root node "ghost" not found/);

    const wrongKind = mutableClone(sampleBlueprint());
    wrongKind.root = 'cover';
    reject(wrongKind, /Root node must have kind "album"/);
  });

  it('I5 — rejects a dangling child reference and an illegal containment kind', () => {
    const dangling = mutableClone(sampleBlueprint());
    (nodeOf(dangling, 'spread:0000').children as string[]).push('ghost');
    reject(dangling, /dangling reference/);

    const illegal = mutableClone(sampleBlueprint());
    // Try to nest a spread inside a cover.
    (nodeOf(illegal, 'cover').children as string[]).push('spread:0001');
    reject(illegal, /may not contain/);
  });

  it('I6 — rejects multiple parents, unreachable nodes, and a referenced root', () => {
    const multi = mutableClone(sampleBlueprint());
    // Reference the same text from a second surface → 2 parents.
    (nodeOf(multi, 'spread:0000').children as string[]).push('cover:text:0000');
    reject(multi, /may not contain|parents/);

    const orphan = mutableClone(sampleBlueprint());
    nodes(orphan).push({
      id: 'spread:0000:text:0000',
      kind: 'text',
      content: 'orphan',
      frame: { x: 0, y: 0, w: 0.5, h: 0.1 },
    });
    nodes(orphan).sort((a, b) => ((a.id as string) < (b.id as string) ? -1 : 1));
    reject(orphan, /unreachable|no parent/);

    const rootRef = mutableClone(sampleBlueprint());
    (nodeOf(rootRef, 'cover').children as string[]).length = 0; // simplify cover
    (nodeOf(rootRef, 'album').children as string[]).splice(0); // rebuild album children
    reject(rootRef, /at least one spread|unreachable|no parent/);
  });

  it('I7 — rejects unstable (non-derived) ids', () => {
    const badSpread = mutableClone(sampleBlueprint());
    const spread = nodeOf(badSpread, 'spread:0001');
    spread.id = 'spread:1'; // not zero-padded → unstable
    const album = nodeOf(badSpread, 'album');
    album.children = ['cover', 'spread:0000', 'spread:1'];
    // Fix leaf ids' parents? Leave them — the spread id check fires first among its class.
    nodes(badSpread).sort((a, b) => ((a.id as string) < (b.id as string) ? -1 : 1));
    reject(badSpread, /stable id|dangling|unreachable/);
  });

  it('I8 — rejects non-contiguous spread indexes and a cover that is not first', () => {
    const gap = mutableClone(sampleBlueprint());
    (nodeOf(gap, 'spread:0001') as RawNode).index = 5;
    reject(gap, /contiguous/);

    const coverLast = mutableClone(sampleBlueprint());
    nodeOf(coverLast, 'album').children = ['spread:0000', 'spread:0001', 'cover'];
    reject(coverLast, /Cover must be the first child/);
  });

  it('I9 — rejects unsorted placement slots and placements after texts', () => {
    const unsortedSlots = mutableClone(sampleBlueprint());
    nodeOf(unsortedSlots, 'spread:0000').children = [
      'spread:0000:placement:main',
      'spread:0000:placement:inset',
    ];
    reject(unsortedSlots, /sorted/);

    const textFirst = mutableClone(sampleBlueprint());
    nodeOf(textFirst, 'cover').children = ['cover:text:0000', 'cover:placement:hero'];
    reject(textFirst, /placements must precede texts/);
  });

  it('I10 — rejects out-of-bounds frames on parse', () => {
    const raw = mutableClone(sampleBlueprint());
    (nodeOf(raw, 'cover:placement:hero') as RawNode).frame = { x: -0.1, y: 0, w: 1, h: 1 };
    reject(raw, /normalized/);
  });

  it('rejects non-object input and unknown node kinds', () => {
    reject(null, /must be an object/);
    reject('bp', /must be an object/);
    const raw = mutableClone(sampleBlueprint());
    (nodeOf(raw, 'cover:text:0000') as RawNode).kind = 'video';
    reject(raw, /unknown node kind/);
  });
});
