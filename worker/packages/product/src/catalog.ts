import type { Result } from '@workerv2/contracts';
import { ok, err, deepFreeze } from '@workerv2/utils';
import { ProductError } from './errors.js';
import type { ProductDefinition, ProductVersionRef } from './model.js';
import { validateProduct, SEMVER_RE } from './validate.js';
import { compareSemver, productVersionRef } from './versioning.js';

/**
 * The PRODUCT CATALOG — an immutable, VERSIONED collection of product definitions. A catalog
 * is a value: it has its own semver, its content is canonically ordered, and it is fully
 * serializable — the same catalog always serializes byte-identically and hashes identically.
 * Multiple versions of the same product coexist; resolution picks an exact version or the
 * latest. Catalog invariants (the single gate `validateCatalog` enforces):
 *
 *  C1  supported schema version
 *  C2  catalogVersion is semver-shaped
 *  C3  at least one product; every product passes the FULL product gate (P1–P10)
 *  C4  products strictly ascending by (id, version) — unique pairs, canonical order
 *  C5  the catalog is deep-frozen on construction (immutability by construction)
 */

export const CATALOG_SCHEMA_VERSION = '1.0.0';

export interface ProductCatalog {
  readonly schemaVersion: string;
  /** This catalog snapshot's version (semver). Any change to the catalog is a new version. */
  readonly catalogVersion: string;
  /** Product definitions, sorted by (id, version) — the canonical catalog order. */
  readonly products: readonly ProductDefinition[];
}

function bad<T>(message: string): Result<T, ProductError> {
  return err(new ProductError(message));
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** The full untrusted-input boundary for catalogs: parse + every invariant (C1–C4). */
export function validateCatalog(input: unknown): Result<ProductCatalog, ProductError> {
  if (!isRecord(input)) return bad('Catalog must be an object');
  const { schemaVersion, catalogVersion, products } = input;

  // C1 — schema version
  if (schemaVersion !== CATALOG_SCHEMA_VERSION) {
    return bad(`Unsupported catalog schema version "${String(schemaVersion)}"`);
  }
  // C2 — catalog version
  if (typeof catalogVersion !== 'string' || !SEMVER_RE.test(catalogVersion)) {
    return bad(`Catalog version must be semver-shaped, got "${String(catalogVersion)}"`);
  }
  // C3 — products pass the full product gate
  if (!Array.isArray(products) || products.length === 0) {
    return bad('Catalog products must be a non-empty array');
  }
  const parsed: ProductDefinition[] = [];
  for (const raw of products) {
    const product = validateProduct(raw);
    if (!product.ok) return product;
    parsed.push(product.value);
  }
  // C4 — strictly ascending by (id, version): unique pairs, canonical order.
  for (let i = 1; i < parsed.length; i++) {
    const prev = parsed[i - 1];
    const curr = parsed[i];
    if (prev === undefined || curr === undefined) continue;
    const order =
      prev.id < curr.id ? -1 : prev.id > curr.id ? 1 : compareSemver(prev.version, curr.version);
    if (order >= 0) {
      return bad(
        `Catalog products must be strictly ascending by (id, version): "${curr.id}@${curr.version}" after "${prev.id}@${prev.version}"`,
      );
    }
  }

  return ok({ schemaVersion: CATALOG_SCHEMA_VERSION, catalogVersion, products: parsed });
}

/** The author-facing input shape — product order is irrelevant; `defineCatalog` canonicalizes it. */
export interface CatalogInput {
  readonly catalogVersion: string;
  readonly products: readonly ProductDefinition[];
}

/**
 * The VALIDATING CONSTRUCTOR for catalogs. Sorts products into canonical (id, version)
 * order, routes the result through the full catalog gate (which re-runs the product gate on
 * every entry), and deep-freezes it (C5) — an invalid or mutable catalog is unrepresentable.
 */
export function defineCatalog(input: CatalogInput): Result<ProductCatalog, ProductError> {
  const sorted = [...input.products].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : compareSemver(a.version, b.version),
  );
  const validated = validateCatalog({
    schemaVersion: CATALOG_SCHEMA_VERSION,
    catalogVersion: input.catalogVersion,
    products: sorted,
  });
  if (!validated.ok) return validated;
  deepFreeze(validated.value);
  return validated;
}

/**
 * Resolve a product from the catalog: exact (id, version) when `version` is given, otherwise
 * the LATEST version of the id (deterministic `compareSemver` order). `undefined` = not in
 * this catalog.
 */
export function getProduct(
  catalog: ProductCatalog,
  id: string,
  version?: string,
): ProductDefinition | undefined {
  if (version !== undefined) {
    return catalog.products.find((p) => p.id === id && p.version === version);
  }
  // Products are (id, version)-sorted: the last entry of the id group is the latest.
  let latest: ProductDefinition | undefined;
  for (const product of catalog.products) {
    if (product.id === id) latest = product;
  }
  return latest;
}

/** Every definition in the catalog as a stable (id, version, hash) reference — canonical order. */
export function listProducts(catalog: ProductCatalog): readonly ProductVersionRef[] {
  return catalog.products.map(productVersionRef);
}
