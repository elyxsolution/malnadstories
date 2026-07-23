import { describe, expect, it } from 'vitest';
import { resolveSelection, spreadLimits } from '@workerv2/product';
import { classicProduct, unwrap, unwrapErr } from './helpers.js';

describe('resolveSelection', () => {
  it('applies defaults for omitted axes', () => {
    const resolved = unwrap(resolveSelection(classicProduct(), { pageCount: 36 }));
    expect(resolved).toEqual({
      pageCount: 36,
      options: { 'cover-finish': 'matte', paper: 'standard' },
    });
  });

  it('enforces an excludes-option constraint', () => {
    const product = classicProduct({
      constraints: [
        {
          kind: 'excludes-option',
          ifAxis: 'paper',
          ifValue: 'standard',
          thenAxis: 'cover-finish',
          thenValue: 'glossy',
        },
      ],
    });
    expect(
      unwrapErr(resolveSelection(product, { pageCount: 24, options: { 'cover-finish': 'glossy' } }))
        .message,
    ).toContain('excludes');
    expect(
      resolveSelection(product, {
        pageCount: 24,
        options: { 'cover-finish': 'glossy', paper: 'premium' },
      }).ok,
    ).toBe(true);
  });
});

describe('spreadLimits', () => {
  it('extracts content limits; multiple constraints of one kind take the strictest', () => {
    expect(spreadLimits(classicProduct())).toEqual({
      maxPlacementsPerSpread: 4,
      maxTextsPerSpread: 2,
    });
    const strict = classicProduct({
      constraints: [
        { kind: 'max-placements-per-spread', limit: 6 },
        { kind: 'max-placements-per-spread', limit: 3 },
      ],
    });
    expect(spreadLimits(strict)).toEqual({ maxPlacementsPerSpread: 3 });
  });

  it('is empty for a product without content limits', () => {
    expect(spreadLimits(classicProduct({ constraints: [] }))).toEqual({});
  });
});
