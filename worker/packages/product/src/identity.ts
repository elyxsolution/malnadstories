import { createHash } from 'node:crypto';
import { canonicalJson } from '@workerv2/utils';
import type { ProductDefinition, ProductHash } from './model.js';

/**
 * PRODUCT IDENTITY — content addressing for product definitions: `sha256:<hex>` of the
 * UTF-8 bytes of the canonical serialization. Identity depends ONLY on canonical product
 * content — never on time, storage, or process state — and is byte-compatible with the
 * artifact platform's addressing scheme (ADR-0006) and blueprint identity (ADR-0008), so a
 * canonical product definition stored as an artifact gets a storage key equal to its hash.
 */
export const PRODUCT_HASH_ALGORITHM = 'sha256';

function sha256(canonical: string): string {
  return createHash(PRODUCT_HASH_ALGORITHM).update(canonical, 'utf8').digest('hex');
}

export function hashProduct(product: ProductDefinition): ProductHash {
  return `${PRODUCT_HASH_ALGORITHM}:${sha256(canonicalJson(product))}` as ProductHash;
}

/** Content hash of any canonical Product-Platform value (catalogs, compatibility matrices). */
export function hashCanonical(value: unknown): string {
  return `${PRODUCT_HASH_ALGORITHM}:${sha256(canonicalJson(value))}`;
}
