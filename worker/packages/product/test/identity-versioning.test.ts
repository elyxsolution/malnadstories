import { describe, expect, it } from 'vitest';
import {
  compareSemver,
  hashProduct,
  parseProduct,
  productVersionPins,
  productVersionRef,
  serializeProduct,
  PRODUCT_HASH_ALGORITHM,
} from '@workerv2/product';
import { classicProduct, unwrap } from './helpers.js';

describe('product identity (content addressing)', () => {
  it('hashes to sha256:<hex> — the shared content-address format', () => {
    expect(PRODUCT_HASH_ALGORITHM).toBe('sha256');
    const hash = hashProduct(classicProduct());
    // The same `alg:hexdigest` shape artifact keys and blueprint hashes use — a canonical
    // product stored as an artifact would get a storage key equal to its own hash.
    expect(hash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('identity depends only on canonical content (stable across re-definition and re-parse)', () => {
    const a = classicProduct();
    const b = classicProduct();
    expect(hashProduct(a)).toBe(hashProduct(b));

    const reparsed = unwrap(parseProduct(JSON.stringify(JSON.parse(serializeProduct(a)), null, 2)));
    expect(hashProduct(reparsed)).toBe(hashProduct(a));
  });

  it('every semantic change alters the hash', () => {
    const base = hashProduct(classicProduct());
    expect(hashProduct(classicProduct({ name: 'Classic A4 Album (2nd ed.)' }))).not.toBe(base);
    expect(hashProduct(classicProduct({ version: '1.0.1' }))).not.toBe(base);
    expect(hashProduct(classicProduct({ pageCounts: [24, 36] }))).not.toBe(base);
    expect(
      hashProduct(classicProduct({ dimensions: { pageWidthMm: 200, pageHeightMm: 297 } })),
    ).not.toBe(base);
  });

  it('serialization round-trip is byte-stable', () => {
    const product = classicProduct();
    const canonical = serializeProduct(product);
    expect(serializeProduct(unwrap(parseProduct(canonical)))).toBe(canonical);
  });
});

describe('versioning', () => {
  it('compareSemver orders numerically with a deterministic suffix rule', () => {
    expect(compareSemver('1.0.0', '1.0.0')).toBe(0);
    expect(compareSemver('1.9.0', '1.10.0')).toBeLessThan(0);
    expect(compareSemver('2.0.0', '1.99.99')).toBeGreaterThan(0);
    expect(compareSemver('1.0.0-beta', '1.0.0')).toBeLessThan(0); // release > pre-release
    expect(compareSemver('1.0.0-alpha', '1.0.0-beta')).toBeLessThan(0);
  });

  it('productVersionRef binds id + version + content hash', () => {
    const product = classicProduct();
    const ref = productVersionRef(product);
    expect(ref.id).toBe(product.id);
    expect(ref.version).toBe('1.0.0');
    expect(ref.hash).toBe(hashProduct(product));
  });

  it('productVersionPins yields the INV-11 pin for the product component', () => {
    expect(productVersionPins(classicProduct())).toEqual({ product: '1.0.0' });
  });
});
