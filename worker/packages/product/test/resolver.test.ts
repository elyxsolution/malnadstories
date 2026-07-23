import { describe, expect, it } from 'vitest';
import { ok, err } from '@workerv2/utils';
import { compileBlueprint } from '@workerv2/blueprint';
import type { SourceResolver } from '@workerv2/product';
import { ProductError, hashProduct, resolveProduct } from '@workerv2/product';
import {
  classicContent,
  classicProduct,
  classicRequest,
  rect,
  sampleCatalog,
  unwrap,
  unwrapErr,
} from './helpers.js';

const catalog = sampleCatalog();

/** A pure chain resolver appending one cover text (used to prove order semantics). */
const appendCoverText = (name: string, label: string): SourceResolver => ({
  name,
  version: '1.0.0',
  resolve: (_context, draft) =>
    ok({
      ...draft,
      cover: {
        ...(draft.cover ?? {}),
        texts: [...(draft.cover?.texts ?? []), { content: label, frame: rect(0, 0, 0.5, 0.1) }],
      },
    }),
});

describe('resolveProduct (happy path)', () => {
  it('resolves product + selection + content into a frozen ProductResolution', () => {
    const resolution = unwrap(resolveProduct(catalog, classicRequest()));
    expect(resolution.product.id).toBe('album-classic-a4');
    expect(resolution.productHash).toBe(hashProduct(classicProduct()));
    expect(resolution.selection).toEqual({
      pageCount: 24,
      options: { 'cover-finish': 'matte', paper: 'standard' },
    });
    expect(resolution.resolvers).toEqual([]);
    expect(resolution.pins).toEqual({ product: '1.0.0' });
    expect(resolution.source.cover).toBeDefined();
    expect(resolution.source.spreads).toHaveLength(12);
    expect(Object.isFrozen(resolution)).toBe(true);
    expect(Object.isFrozen(resolution.source)).toBe(true);
    expect(Object.isFrozen(resolution.source.spreads[0])).toBe(true);
  });

  it('produces a BlueprintSource the blueprint compiler accepts — deterministically', () => {
    const a = unwrap(resolveProduct(catalog, classicRequest()));
    const b = unwrap(resolveProduct(catalog, classicRequest()));
    const compiledA = unwrap(compileBlueprint(a.source));
    const compiledB = unwrap(compileBlueprint(b.source));
    // Same catalog + request → same source → same content-addressed blueprint identity.
    expect(compiledA.hash).toBe(compiledB.hash);
    expect(compiledA.blueprint.albumId).toBe('alb-1');
  });

  it('passes frames through untouched (no layout, no rendering decisions)', () => {
    const content = classicContent();
    const resolution = unwrap(resolveProduct(catalog, classicRequest({ content })));
    expect(resolution.source.spreads[0]?.placements?.[0]?.frame).toEqual(
      content.spreads[0]?.placements?.[0]?.frame,
    );
    expect(resolution.source.cover?.placements?.[0]?.frame).toEqual(
      content.cover?.placements?.[0]?.frame,
    );
  });

  it('is isolated from later caller mutations (structural copy, shares nothing)', () => {
    const content = classicContent();
    const resolution = unwrap(resolveProduct(catalog, classicRequest({ content })));
    const firstPlacement = (content.spreads[0]?.placements as { slot: string }[] | undefined)?.[0];
    if (firstPlacement !== undefined) firstPlacement.slot = 'mutated';
    expect(resolution.source.spreads[0]?.placements?.[0]?.slot).toBe('main');
  });

  it('drops unknown extra keys from content (only the source vocabulary survives)', () => {
    const content = classicContent();
    const smuggled = {
      ...content,
      renderHints: { dpi: 300 },
      spreads: content.spreads.map((s) => ({ ...s, cssOverride: 'x' })),
    } as unknown as typeof content;
    const resolution = unwrap(resolveProduct(catalog, classicRequest({ content: smuggled })));
    expect('renderHints' in resolution.source).toBe(false);
    expect(
      resolution.source.spreads[0] !== undefined && 'cssOverride' in resolution.source.spreads[0],
    ).toBe(false);
  });

  it('resolves the latest product version when none is requested', () => {
    const resolution = unwrap(
      resolveProduct(catalog, {
        productId: 'album-slim',
        selection: { pageCount: 12 },
        content: {
          albumId: 'alb-2',
          title: 'Slim',
          spreads: Array.from({ length: 12 }, () => ({ pages: 1 as const })),
        },
      }),
    );
    expect(resolution.product.version).toBe('1.1.0');
    expect(resolution.pins).toEqual({ product: '1.1.0' });
    expect(resolution.source.cover).toBeUndefined();
  });
});

describe('selection + constraint enforcement', () => {
  it('accepts an explicit selection that satisfies the coupling constraint', () => {
    const resolution = unwrap(
      resolveProduct(
        catalog,
        classicRequest({
          selection: { pageCount: 24, options: { 'cover-finish': 'glossy', paper: 'premium' } },
        }),
      ),
    );
    expect(resolution.selection.options).toEqual({ 'cover-finish': 'glossy', paper: 'premium' });
  });

  it('rejects a selection violating a requires-option constraint (default paper is standard)', () => {
    const error = unwrapErr(
      resolveProduct(
        catalog,
        classicRequest({ selection: { pageCount: 24, options: { 'cover-finish': 'glossy' } } }),
      ),
    );
    expect(error.message).toContain('requires');
  });

  it('rejects unknown products, versions, page counts, axes, and values', () => {
    expect(
      unwrapErr(resolveProduct(catalog, classicRequest({ productId: 'missing' }))).message,
    ).toContain('not in the catalog');
    expect(
      unwrapErr(resolveProduct(catalog, classicRequest({ productVersion: '9.0.0' }))).message,
    ).toContain('not in the catalog');
    expect(
      unwrapErr(resolveProduct(catalog, classicRequest({ selection: { pageCount: 25 } }))).message,
    ).toContain('not offered');
    expect(
      unwrapErr(
        resolveProduct(
          catalog,
          classicRequest({ selection: { pageCount: 24, options: { binding: 'sewn' } } }),
        ),
      ).message,
    ).toContain('no option axis');
    expect(
      unwrapErr(
        resolveProduct(
          catalog,
          classicRequest({ selection: { pageCount: 24, options: { paper: 'silk' } } }),
        ),
      ).message,
    ).toContain('does not allow');
  });

  it('enforces cover presence to match the product', () => {
    const noCover = classicContent();
    const rest = { albumId: noCover.albumId, title: noCover.title, spreads: noCover.spreads };
    expect(unwrapErr(resolveProduct(catalog, classicRequest({ content: rest }))).message).toContain(
      'must provide a cover',
    );

    expect(
      unwrapErr(
        resolveProduct(catalog, {
          productId: 'album-slim',
          selection: { pageCount: 12 },
          content: {
            albumId: 'alb-2',
            title: 'Slim',
            cover: {},
            spreads: Array.from({ length: 12 }, () => ({ pages: 1 as const })),
          },
        }),
      ).message,
    ).toContain('must not provide one');
  });

  it('enforces the page-count sum and per-spread content limits', () => {
    expect(
      unwrapErr(resolveProduct(catalog, classicRequest({ selection: { pageCount: 36 } }))).message,
    ).toContain('do not match');

    const overloaded = classicContent();
    const spreads = [...overloaded.spreads];
    spreads[0] = {
      pages: 2,
      placements: Array.from({ length: 5 }, (_, i) => ({
        slot: `s${String(i)}`,
        artifact: 'sha256:aa11',
        frame: rect(),
      })),
    };
    expect(
      unwrapErr(resolveProduct(catalog, classicRequest({ content: { ...overloaded, spreads } })))
        .message,
    ).toContain('placements (product limit 4)');

    const chatty = [...classicContent().spreads];
    chatty[0] = {
      pages: 2,
      texts: Array.from({ length: 3 }, (_, i) => ({
        content: `t${String(i)}`,
        frame: rect(0, 0, 0.5, 0.1),
      })),
    };
    expect(
      unwrapErr(
        resolveProduct(
          catalog,
          classicRequest({ content: { ...classicContent(), spreads: chatty } }),
        ),
      ).message,
    ).toContain('texts (product limit 2)');
  });
});

describe('resolver chain', () => {
  it('runs resolvers in declared order (order is semantic) and records provenance', () => {
    const ab = unwrap(
      resolveProduct(catalog, classicRequest(), [
        appendCoverText('resolver-a', 'A'),
        appendCoverText('resolver-b', 'B'),
      ]),
    );
    const ba = unwrap(
      resolveProduct(catalog, classicRequest(), [
        appendCoverText('resolver-b', 'B'),
        appendCoverText('resolver-a', 'A'),
      ]),
    );
    expect(ab.source.cover?.texts?.map((t) => t.content)).toEqual(['Goa 2026', 'A', 'B']);
    expect(ba.source.cover?.texts?.map((t) => t.content)).toEqual(['Goa 2026', 'B', 'A']);
    expect(ab.resolvers).toEqual([
      { name: 'resolver-a', version: '1.0.0' },
      { name: 'resolver-b', version: '1.0.0' },
    ]);
    // Text order is semantic downstream too: the two chains yield different blueprints.
    expect(unwrap(compileBlueprint(ab.source)).hash).not.toBe(
      unwrap(compileBlueprint(ba.source)).hash,
    );
  });

  it('the chain cannot escape the product gate (dropping a spread is caught)', () => {
    const dropSpread: SourceResolver = {
      name: 'dropper',
      version: '1.0.0',
      resolve: (_context, draft) => ok({ ...draft, spreads: draft.spreads.slice(1) }),
    };
    expect(unwrapErr(resolveProduct(catalog, classicRequest(), [dropSpread])).message).toContain(
      'do not match',
    );
  });

  it('the chain cannot change the albumId', () => {
    const hijack: SourceResolver = {
      name: 'hijack',
      version: '1.0.0',
      resolve: (_context, draft) => ok({ ...draft, albumId: 'alb-other' }),
    };
    expect(unwrapErr(resolveProduct(catalog, classicRequest(), [hijack])).message).toContain(
      'albumId',
    );
  });

  it('propagates a resolver failure with the resolver named', () => {
    const failing: SourceResolver = {
      name: 'failing',
      version: '1.0.0',
      resolve: () => err(new ProductError('no theme available')),
    };
    const error = unwrapErr(resolveProduct(catalog, classicRequest(), [failing]));
    expect(error.message).toContain('Resolver "failing" failed');
    expect(error.message).toContain('no theme available');
  });

  it('rejects invalid chain metadata (bad name, bad version, duplicate name)', () => {
    const base = appendCoverText('resolver-a', 'A');
    expect(
      unwrapErr(resolveProduct(catalog, classicRequest(), [{ ...base, name: 'Bad Name' }])).message,
    ).toContain('lowercase token');
    expect(
      unwrapErr(resolveProduct(catalog, classicRequest(), [{ ...base, version: 'v1' }])).message,
    ).toContain('semver');
    expect(
      unwrapErr(resolveProduct(catalog, classicRequest(), [base, { ...base }])).message,
    ).toContain('Duplicate resolver');
  });
});
