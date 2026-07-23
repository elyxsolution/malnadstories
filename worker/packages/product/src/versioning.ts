import type { VersionComponent } from '@workerv2/control-plane';
import type { ProductDefinition, ProductVersionRef } from './model.js';
import { hashProduct } from './identity.js';

/**
 * PRODUCT VERSIONING — deterministic version ordering and the version-pin bridge to the
 * control plane's `VersionSet` (INV-11). A product definition is immutable: any change is a
 * new version; the (id, version) pair names it and the content hash addresses it.
 */

/**
 * Deterministic semver ordering: numeric on major/minor/patch; a release orders AFTER any
 * suffixed build of the same triple; suffixes compare lexicographically. (A total, stable
 * order for catalog resolution — not the full SemVer precedence spec.)
 */
export function compareSemver(a: string, b: string): number {
  const parse = (v: string): { nums: number[]; rest: string } => {
    const match = /^(\d+)\.(\d+)\.(\d+)(.*)$/.exec(v);
    if (match === null) return { nums: [0, 0, 0], rest: v };
    return {
      nums: [Number(match[1]), Number(match[2]), Number(match[3])],
      rest: match[4] ?? '',
    };
  };
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < 3; i++) {
    const na = pa.nums[i] ?? 0;
    const nb = pb.nums[i] ?? 0;
    if (na !== nb) return na < nb ? -1 : 1;
  }
  if (pa.rest === pb.rest) return 0;
  if (pa.rest === '') return 1; // release > pre-release/build of the same triple
  if (pb.rest === '') return -1;
  return pa.rest < pb.rest ? -1 : 1;
}

/** The stable reference (id + version + content hash) for one immutable definition. */
export function productVersionRef(product: ProductDefinition): ProductVersionRef {
  return { id: product.id, version: product.version, hash: hashProduct(product) };
}

/**
 * The version pins a run must freeze when it selects this product (INV-11): feed this into
 * `VersionSet.create` alongside the other components the run pins.
 */
export function productVersionPins(
  product: ProductDefinition,
): Readonly<Partial<Record<VersionComponent, string>>> {
  return { product: product.version };
}
