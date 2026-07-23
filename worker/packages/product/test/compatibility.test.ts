import { describe, expect, it } from 'vitest';
import { BLUEPRINT_SCHEMA_VERSION } from '@workerv2/blueprint';
import type { CompatibilityMatrix } from '@workerv2/product';
import {
  ANY,
  checkCompatibility,
  defineCompatibilityMatrix,
  hashCompatibilityMatrix,
  serializeCompatibilityMatrix,
  validateCompatibilityMatrix,
  missingCapabilities,
  requiredCapabilityNames,
} from '@workerv2/product';
import { classicProduct, mutableClone, unwrap, unwrapErr } from './helpers.js';

function sampleMatrix(): CompatibilityMatrix {
  return unwrap(
    defineCompatibilityMatrix({
      version: '1.0.0',
      rules: [
        {
          product: 'album-classic-a4',
          productVersion: '1.0.0',
          processingProfiles: ['classic', 'premium'],
          runtimeCapabilities: [
            { name: 'image.canonical' },
            { name: 'pdf.render', versionRange: '^1.0.0' },
          ],
          blueprintSchemaVersions: [BLUEPRINT_SCHEMA_VERSION],
        },
        {
          product: ANY,
          processingProfiles: ['draft'],
          runtimeCapabilities: [],
          blueprintSchemaVersions: [BLUEPRINT_SCHEMA_VERSION],
        },
      ],
    }),
  );
}

describe('defineCompatibilityMatrix', () => {
  it('builds a frozen matrix, keeping rule order (first match wins is semantic)', () => {
    const matrix = sampleMatrix();
    expect(matrix.rules).toHaveLength(2);
    expect(matrix.rules[0]?.product).toBe('album-classic-a4');
    expect(Object.isFrozen(matrix)).toBe(true);
    expect(Object.isFrozen(matrix.rules[0])).toBe(true);
  });

  it('rejects bad shapes: empty rules, bad tokens, unsorted sets, bad versions', () => {
    expect(unwrapErr(defineCompatibilityMatrix({ version: '1.0.0', rules: [] })).message).toContain(
      'non-empty',
    );
    expect(
      unwrapErr(defineCompatibilityMatrix({ version: 'latest', rules: sampleMatrix().rules }))
        .message,
    ).toContain('semver');

    const badProfileOrder = mutableClone(sampleMatrix());
    const firstRule = (badProfileOrder.rules as Record<string, unknown>[])[0];
    if (firstRule !== undefined) firstRule.processingProfiles = ['premium', 'classic'];
    expect(unwrapErr(validateCompatibilityMatrix(badProfileOrder)).message).toContain('ascending');
  });
});

describe('checkCompatibility', () => {
  it('first-match: the specific rule wins over the wildcard fallback', () => {
    const verdict = checkCompatibility(sampleMatrix(), {
      productId: 'album-classic-a4',
      productVersion: '1.0.0',
      processingProfile: 'premium',
      blueprintSchemaVersion: BLUEPRINT_SCHEMA_VERSION,
      availableRuntimeCapabilities: ['image.canonical', 'pdf.render'],
    });
    expect(verdict.compatible).toBe(true);
    expect(verdict.reasons).toEqual([]);
    expect(verdict.rule?.product).toBe('album-classic-a4');
  });

  it('the wildcard rule covers other products / versions', () => {
    const verdict = checkCompatibility(sampleMatrix(), {
      productId: 'album-slim',
      productVersion: '1.1.0',
      processingProfile: 'draft',
    });
    expect(verdict.compatible).toBe(true);
    expect(verdict.rule?.product).toBe(ANY);
  });

  it('reports every failed facet with exact reasons', () => {
    const verdict = checkCompatibility(sampleMatrix(), {
      productId: 'album-classic-a4',
      productVersion: '1.0.0',
      processingProfile: 'archive',
      blueprintSchemaVersion: '9.0.0',
      availableRuntimeCapabilities: ['image.canonical'],
    });
    expect(verdict.compatible).toBe(false);
    expect(verdict.reasons).toEqual([
      'Processing profile "archive" is not compatible',
      'Blueprint schema version "9.0.0" is not compatible',
      'Runtime capability "pdf.render" is required but not available',
    ]);
  });

  it('omitted facets are not checked', () => {
    const verdict = checkCompatibility(sampleMatrix(), {
      productId: 'album-classic-a4',
      productVersion: '1.0.0',
    });
    expect(verdict.compatible).toBe(true);
  });

  it('no matching rule → incompatible with a covering reason', () => {
    const noWildcard = unwrap(
      defineCompatibilityMatrix({
        version: '1.0.0',
        rules: [
          {
            product: 'album-classic-a4',
            productVersion: '1.0.0',
            processingProfiles: ['classic'],
            runtimeCapabilities: [],
            blueprintSchemaVersions: [BLUEPRINT_SCHEMA_VERSION],
          },
        ],
      }),
    );
    const verdict = checkCompatibility(noWildcard, {
      productId: 'album-classic-a4',
      productVersion: '2.0.0',
    });
    expect(verdict.compatible).toBe(false);
    expect(verdict.rule).toBeUndefined();
    expect(verdict.reasons[0]).toContain('No compatibility rule');
  });
});

describe('matrix serialization + identity', () => {
  it('serializes canonically and hashes deterministically', () => {
    const a = sampleMatrix();
    const b = sampleMatrix();
    expect(serializeCompatibilityMatrix(a)).toBe(serializeCompatibilityMatrix(b));
    expect(hashCompatibilityMatrix(a)).toBe(hashCompatibilityMatrix(b));
    expect(hashCompatibilityMatrix(a)).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('round-trips through the validation gate', () => {
    const matrix = sampleMatrix();
    const reparsed = unwrap(
      validateCompatibilityMatrix(JSON.parse(serializeCompatibilityMatrix(matrix))),
    );
    expect(serializeCompatibilityMatrix(reparsed)).toBe(serializeCompatibilityMatrix(matrix));
  });
});

describe('capability helpers', () => {
  it('requiredCapabilityNames + missingCapabilities are pure set operations', () => {
    const product = classicProduct();
    expect(requiredCapabilityNames(product)).toEqual(['image.canonical', 'pdf.render']);
    const missing = missingCapabilities(product.capabilities, ['image.canonical']);
    expect(missing.map((c) => c.name)).toEqual(['pdf.render']);
    expect(missingCapabilities(product.capabilities, ['image.canonical', 'pdf.render'])).toEqual(
      [],
    );
  });
});
