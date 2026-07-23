import type { Result } from '@workerv2/contracts';
import { err, canonicalJson } from '@workerv2/utils';
import { ProductError } from './errors.js';
import type { ProductDefinition } from './model.js';
import { validateProduct } from './validate.js';
import type { ProductCatalog } from './catalog.js';
import { validateCatalog } from './catalog.js';

/**
 * CANONICAL SERIALIZATION — the byte form product/catalog identities are computed from.
 * Object keys sorted, arrays in canonical order (the validation gates enforce canonical array
 * order), no whitespace: structurally-equal values always serialize byte-identically, so
 * serialization is deterministic and identity is content-only.
 */

export function serializeProduct(product: ProductDefinition): string {
  return canonicalJson(product);
}

/**
 * Parse a serialized product back through the FULL validation gate. Incoming key order and
 * whitespace are irrelevant — canonical form is recomputed, never trusted.
 */
export function parseProduct(json: string): Result<ProductDefinition, ProductError> {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (cause) {
    return err(new ProductError('Product JSON is not parseable', { cause }));
  }
  return validateProduct(raw);
}

export function serializeCatalog(catalog: ProductCatalog): string {
  return canonicalJson(catalog);
}

/** Parse a serialized catalog back through the FULL catalog gate (incl. every product). */
export function parseCatalog(json: string): Result<ProductCatalog, ProductError> {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (cause) {
    return err(new ProductError('Catalog JSON is not parseable', { cause }));
  }
  return validateCatalog(raw);
}
