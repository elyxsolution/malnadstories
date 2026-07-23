import { describe, expect, it } from 'vitest';
import {
  CATALOG_SCHEMA_VERSION,
  defineCatalog,
  getProduct,
  listProducts,
  parseCatalog,
  serializeCatalog,
  validateCatalog,
  hashCanonical,
} from '@workerv2/product';
import {
  classicProduct,
  mutableClone,
  sampleCatalog,
  slimProduct,
  unwrap,
  unwrapErr,
} from './helpers.js';

describe('defineCatalog (validating constructor)', () => {
  it('canonicalizes product order to (id, version) and deep-freezes', () => {
    const catalog = sampleCatalog();
    expect(catalog.schemaVersion).toBe(CATALOG_SCHEMA_VERSION);
    expect(catalog.products.map((p) => `${p.id}@${p.version}`)).toEqual([
      'album-classic-a4@1.0.0',
      'album-slim@1.0.0',
      'album-slim@1.1.0',
    ]);
    expect(Object.isFrozen(catalog)).toBe(true);
    expect(Object.isFrozen(catalog.products)).toBe(true);
  });

  it('orders numeric semver segments numerically (1.10.0 after 1.9.0)', () => {
    const catalog = unwrap(
      defineCatalog({
        catalogVersion: '1.0.0',
        products: [slimProduct('1.10.0'), slimProduct('1.9.0')],
      }),
    );
    expect(catalog.products.map((p) => p.version)).toEqual(['1.9.0', '1.10.0']);
  });

  it('rejects duplicate (id, version) pairs', () => {
    const error = unwrapErr(
      defineCatalog({
        catalogVersion: '1.0.0',
        products: [slimProduct('1.0.0'), slimProduct('1.0.0')],
      }),
    );
    expect(error.message).toContain('strictly ascending');
  });

  it('rejects a non-semver catalog version and an empty catalog', () => {
    expect(
      unwrapErr(defineCatalog({ catalogVersion: 'latest', products: [slimProduct()] })).message,
    ).toContain('semver');
    expect(unwrapErr(defineCatalog({ catalogVersion: '1.0.0', products: [] })).message).toContain(
      'non-empty',
    );
  });
});

describe('validateCatalog (untrusted boundary)', () => {
  it('re-runs the full product gate on every entry', () => {
    const raw = mutableClone(sampleCatalog());
    const first = (raw.products as Record<string, unknown>[])[0];
    if (first !== undefined) first.version = 'not-semver';
    expect(unwrapErr(validateCatalog(raw)).message).toContain('semver');
  });

  it('rejects non-canonical product order (untrusted input is never re-sorted)', () => {
    const raw = mutableClone(sampleCatalog());
    (raw.products as unknown[]).reverse();
    expect(unwrapErr(validateCatalog(raw)).message).toContain('ascending');
  });

  it('rejects an unsupported catalog schema version', () => {
    const raw = mutableClone(sampleCatalog());
    raw.schemaVersion = '2.0.0';
    expect(unwrapErr(validateCatalog(raw)).message).toContain('schema version');
  });
});

describe('getProduct / listProducts', () => {
  it('resolves an exact version', () => {
    const catalog = sampleCatalog();
    expect(getProduct(catalog, 'album-slim', '1.0.0')?.version).toBe('1.0.0');
    expect(getProduct(catalog, 'album-slim', '2.0.0')).toBeUndefined();
    expect(getProduct(catalog, 'missing', '1.0.0')).toBeUndefined();
  });

  it('resolves the latest version when none is given', () => {
    const catalog = sampleCatalog();
    expect(getProduct(catalog, 'album-slim')?.version).toBe('1.1.0');
    expect(getProduct(catalog, 'album-classic-a4')?.version).toBe('1.0.0');
  });

  it('lists stable (id, version, hash) refs in canonical order', () => {
    const refs = listProducts(sampleCatalog());
    expect(refs.map((r) => `${r.id}@${r.version}`)).toEqual([
      'album-classic-a4@1.0.0',
      'album-slim@1.0.0',
      'album-slim@1.1.0',
    ]);
    for (const ref of refs) expect(ref.hash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});

describe('catalog serialization + identity', () => {
  it('round-trips byte-stably and ignores incoming key order', () => {
    const catalog = sampleCatalog();
    const canonical = serializeCatalog(catalog);
    const reparsed = unwrap(parseCatalog(canonical));
    expect(serializeCatalog(reparsed)).toBe(canonical);

    // Same content, scrambled key order + whitespace → identical canonical form.
    const scrambled = JSON.stringify(JSON.parse(canonical), null, 2);
    expect(serializeCatalog(unwrap(parseCatalog(scrambled)))).toBe(canonical);
  });

  it('hashes deterministically; a version bump changes the hash', () => {
    const a = sampleCatalog();
    const b = sampleCatalog();
    expect(hashCanonical(a)).toBe(hashCanonical(b));
    const bumped = unwrap(defineCatalog({ catalogVersion: '1.0.1', products: [...a.products] }));
    expect(hashCanonical(bumped)).not.toBe(hashCanonical(a));
  });

  it('rejects unparseable JSON', () => {
    expect(unwrapErr(parseCatalog('{nope')).message).toContain('parseable');
  });
});

describe('classicProduct helper sanity', () => {
  it('is a covered product with canonical constraints', () => {
    const product = classicProduct();
    expect(product.hasCover).toBe(true);
    expect(product.constraints).toHaveLength(3);
  });
});
