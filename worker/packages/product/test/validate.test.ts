import { describe, expect, it } from 'vitest';
import {
  defineProduct,
  validateProduct,
  ProductError,
  PRODUCT_SCHEMA_VERSION,
  optionAxis,
} from '@workerv2/product';
import { classicInput, classicProduct, mutableClone, unwrap, unwrapErr } from './helpers.js';

describe('defineProduct (validating constructor)', () => {
  it('builds a valid, deep-frozen definition with the schema version stamped', () => {
    const product = classicProduct();
    expect(product.schemaVersion).toBe(PRODUCT_SCHEMA_VERSION);
    expect(product.id).toBe('album-classic-a4');
    expect(Object.isFrozen(product)).toBe(true);
    expect(Object.isFrozen(product.options)).toBe(true);
    expect(Object.isFrozen(product.constraints[0])).toBe(true);
    expect(() => {
      (product as { name: string }).name = 'x';
    }).toThrow();
  });

  it('canonicalizes non-semantic orderings (pageCounts, options, values, capabilities)', () => {
    const product = unwrap(
      defineProduct(
        classicInput({
          pageCounts: [48, 24, 36],
          options: [
            { axis: 'paper', values: ['standard', 'premium'], defaultValue: 'standard' },
            { axis: 'cover-finish', values: ['matte', 'glossy'], defaultValue: 'matte' },
          ],
          capabilities: [
            { name: 'pdf.render', versionRange: '^1.0.0' },
            { name: 'image.canonical' },
          ],
        }),
      ),
    );
    expect(product.pageCounts).toEqual([24, 36, 48]);
    expect(product.options.map((o) => o.axis)).toEqual(['cover-finish', 'paper']);
    expect(product.options[0]?.values).toEqual(['glossy', 'matte']);
    expect(product.capabilities.map((c) => c.name)).toEqual(['image.canonical', 'pdf.render']);
  });

  it('two equivalent inputs in different declaration order define identical products', () => {
    const a = classicProduct();
    const b = unwrap(
      defineProduct(
        classicInput({
          pageCounts: [36, 48, 24],
          capabilities: [
            { name: 'pdf.render', versionRange: '^1.0.0' },
            { name: 'image.canonical' },
          ],
        }),
      ),
    );
    expect(b).toEqual(a);
  });

  it('optionAxis looks up an axis', () => {
    const product = classicProduct();
    expect(optionAxis(product, 'paper')?.defaultValue).toBe('standard');
    expect(optionAxis(product, 'missing')).toBeUndefined();
  });
});

describe('validateProduct (invariants P1–P10)', () => {
  const valid = (): Record<string, unknown> => mutableClone(classicProduct());

  const rejects = (mutate: (p: Record<string, unknown>) => void, fragment: string): void => {
    const input = valid();
    mutate(input);
    const error = unwrapErr(validateProduct(input));
    expect(error).toBeInstanceOf(ProductError);
    expect(error.message).toContain(fragment);
  };

  it('accepts its own canonical output (gate is idempotent)', () => {
    expect(unwrap(validateProduct(valid()))).toEqual(classicProduct());
  });

  it('P1 rejects an unsupported schema version', () => {
    rejects((p) => {
      p.schemaVersion = '9.9.9';
    }, 'schema version');
  });

  it('P2 rejects a non-token id', () => {
    rejects((p) => {
      p.id = 'Not A Token';
    }, 'lowercase token');
  });

  it('P3 rejects a non-semver version', () => {
    rejects((p) => {
      p.version = 'v1';
    }, 'semver');
  });

  it('P4 rejects an empty name', () => {
    rejects((p) => {
      p.name = '   ';
    }, 'name');
  });

  it('P5 rejects non-positive and oversized dimensions', () => {
    rejects((p) => {
      p.dimensions = { pageWidthMm: 0, pageHeightMm: 297 };
    }, 'dimensions');
    rejects((p) => {
      p.dimensions = { pageWidthMm: 210, pageHeightMm: 5000 };
    }, 'dimensions');
  });

  it('P6 rejects unsorted, duplicate, and non-integer page counts', () => {
    rejects((p) => {
      p.pageCounts = [36, 24];
    }, 'ascending');
    rejects((p) => {
      p.pageCounts = [24, 24];
    }, 'ascending');
    rejects((p) => {
      p.pageCounts = [24.5];
    }, 'positive integer');
    rejects((p) => {
      p.pageCounts = [];
    }, 'non-empty');
  });

  it('P7 rejects unsorted axes, unsorted values, and a default outside the vocabulary', () => {
    rejects((p) => {
      (p.options as unknown[]).reverse();
    }, 'ascending by axis');
    rejects((p) => {
      p.options = [{ axis: 'paper', values: ['standard', 'premium'], defaultValue: 'standard' }];
    }, 'ascending');
    rejects((p) => {
      p.options = [{ axis: 'paper', values: ['premium', 'standard'], defaultValue: 'silk' }];
    }, 'defaultValue');
  });

  it('P8 rejects constraints referencing unknown axes/values, bad limits, and non-canonical order', () => {
    rejects((p) => {
      p.constraints = [
        {
          kind: 'requires-option',
          ifAxis: 'binding',
          ifValue: 'sewn',
          thenAxis: 'paper',
          thenValue: 'premium',
        },
      ];
    }, 'unknown option axis');
    rejects((p) => {
      p.constraints = [
        {
          kind: 'requires-option',
          ifAxis: 'cover-finish',
          ifValue: 'velvet',
          thenAxis: 'paper',
          thenValue: 'premium',
        },
      ];
    }, 'unknown value');
    rejects((p) => {
      p.constraints = [{ kind: 'max-placements-per-spread', limit: 0 }];
    }, 'positive integer');
    rejects((p) => {
      (p.constraints as unknown[]).reverse();
    }, 'canonical form');
    rejects((p) => {
      p.constraints = [{ kind: 'left-handed' }];
    }, 'Unknown constraint kind');
  });

  it('P9 rejects invalid and non-canonical capabilities', () => {
    rejects((p) => {
      p.capabilities = [{ name: '' }];
    }, 'Capability');
    rejects((p) => {
      p.capabilities = [{ name: 'pdf.render', versionRange: '' }];
    }, 'invalid');
    rejects((p) => {
      p.capabilities = [{ name: 'pdf.render' }, { name: 'image.canonical' }];
    }, 'ascending by name');
    rejects((p) => {
      p.capabilities = [{ name: 'pdf.render' }, { name: 'pdf.render' }];
    }, 'ascending by name');
  });

  it('P10 rejects a non-boolean hasCover', () => {
    rejects((p) => {
      p.hasCover = 'yes';
    }, 'boolean');
  });

  it('rejects non-object input', () => {
    expect(unwrapErr(validateProduct(null)).message).toContain('object');
    expect(unwrapErr(validateProduct('x')).message).toContain('object');
  });
});
