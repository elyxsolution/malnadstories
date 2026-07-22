import { describe, expect, it } from 'vitest';
import { compileBlueprint, nodeById, BLUEPRINT_SCHEMA_VERSION } from '@workerv2/blueprint';
import type { BlueprintNodeId } from '@workerv2/blueprint';
import { compiled, rect, sampleSource, unwrapErr } from './helpers.js';

describe('compileBlueprint — declarative compilation', () => {
  it('compiles the sample source into the expected stable-id graph', () => {
    const { blueprint } = compiled();
    expect(blueprint.schemaVersion).toBe(BLUEPRINT_SCHEMA_VERSION);
    expect(blueprint.albumId).toBe('alb-1');
    expect(blueprint.root).toBe('album');

    const album = nodeById(blueprint, 'album' as BlueprintNodeId);
    expect(album?.kind).toBe('album');
    if (album?.kind === 'album') {
      expect(album.title).toBe('Goa 2026');
      expect(album.children).toStrictEqual(['cover', 'spread:0000', 'spread:0001']);
    }

    const spread0 = nodeById(blueprint, 'spread:0000' as BlueprintNodeId);
    if (spread0?.kind === 'spread') {
      expect(spread0.index).toBe(0);
      expect(spread0.pages).toBe(1);
      // Placements canonicalized by slot: inset < main.
      expect(spread0.children).toStrictEqual([
        'spread:0000:placement:inset',
        'spread:0000:placement:main',
      ]);
    }

    const cover = nodeById(blueprint, 'cover' as BlueprintNodeId);
    if (cover?.kind === 'cover') {
      expect(cover.children).toStrictEqual(['cover:placement:hero', 'cover:text:0000']);
    }

    // Nodes are id-sorted (canonical node order).
    const ids = blueprint.nodes.map((n) => n.id);
    expect(ids).toStrictEqual([...ids].sort());
  });

  it('compiles without a cover (spreads only)', () => {
    const source = sampleSource();
    const { blueprint } = compiled({ ...source, cover: undefined });
    const album = nodeById(blueprint, 'album' as BlueprintNodeId);
    if (album?.kind === 'album') {
      expect(album.children).toStrictEqual(['spread:0000', 'spread:0001']);
    }
    expect(nodeById(blueprint, 'cover' as BlueprintNodeId)).toBeUndefined();
  });

  it('is deterministic: recompiling the same source yields identical content + hash', () => {
    const a = compiled();
    const b = compiled();
    expect(a.canonical).toBe(b.canonical);
    expect(a.hash).toBe(b.hash);
    expect(a.blueprint).toStrictEqual(b.blueprint);
  });

  it('placement declaration order is NON-semantic (canonicalized by slot)', () => {
    const source = sampleSource();
    const spread0 = source.spreads[0];
    const reversed = {
      ...source,
      spreads: [
        { ...spread0, placements: [...(spread0?.placements ?? [])].reverse() },
        ...source.spreads.slice(1),
      ],
    } as typeof source;
    expect(compiled(reversed).hash).toBe(compiled().hash);
  });

  it('spread order IS semantic (different order → different identity)', () => {
    const source = sampleSource();
    const swapped = { ...source, spreads: [...source.spreads].reverse() };
    expect(compiled(swapped).hash).not.toBe(compiled().hash);
  });

  it('deep-freezes the compiled blueprint (immutability)', () => {
    const result = compiled();
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.blueprint)).toBe(true);
    expect(Object.isFrozen(result.blueprint.nodes)).toBe(true);
    for (const node of result.blueprint.nodes) expect(Object.isFrozen(node)).toBe(true);
  });
});

describe('compileBlueprint — source rejections (via the single validation gate)', () => {
  const reject = (source: ReturnType<typeof sampleSource>, pattern: RegExp): void => {
    const error = unwrapErr(compileBlueprint(source));
    expect(error.message).toMatch(pattern);
  };

  it('rejects an invalid album id', () => {
    reject(sampleSource({ albumId: '  ' }), /albumId invalid/);
  });

  it('rejects an empty / oversized title', () => {
    reject(sampleSource({ title: '   ' }), /title/);
    reject(sampleSource({ title: 'x'.repeat(201) }), /title/);
  });

  it('rejects a source with no spreads', () => {
    reject(sampleSource({ spreads: [] }), /at least one spread/);
  });

  it('rejects duplicate placement slots on one surface', () => {
    reject(
      sampleSource({
        spreads: [
          {
            pages: 1,
            placements: [
              { slot: 'main', artifact: 'sha256:aa11', frame: rect() },
              { slot: 'main', artifact: 'sha256:bb22', frame: rect() },
            ],
          },
        ],
      }),
      /Duplicate node id/,
    );
  });

  it('rejects a malformed artifact key (artifact identities only)', () => {
    reject(
      sampleSource({
        spreads: [
          {
            pages: 1,
            placements: [{ slot: 'main', artifact: 'C:\\photos\\img.jpg', frame: rect() }],
          },
        ],
      }),
      /content-addressed key/,
    );
  });

  it('rejects an invalid slot token and an out-of-bounds frame', () => {
    reject(
      sampleSource({
        spreads: [
          { pages: 1, placements: [{ slot: 'bad slot', artifact: 'sha256:aa', frame: rect() }] },
        ],
      }),
      /slot must be a valid token/,
    );
    reject(
      sampleSource({
        spreads: [
          {
            pages: 1,
            placements: [{ slot: 'main', artifact: 'sha256:aa', frame: rect(0, 0, 1.5, 1) }],
          },
        ],
      }),
      /normalized/,
    );
  });

  it('rejects invalid pages and oversized text', () => {
    reject(
      sampleSource({ spreads: [{ pages: 3 as unknown as 1, placements: [] }] }),
      /pages must be 1 or 2/,
    );
    reject(
      sampleSource({
        spreads: [
          { pages: 1, texts: [{ content: 'x'.repeat(2001), frame: rect(0, 0, 0.5, 0.1) }] },
        ],
      }),
      /text content/,
    );
  });
});
