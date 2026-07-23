import type { Result } from '@workerv2/contracts';
import { ok, err, canonicalJson, deepFreeze } from '@workerv2/utils';
import { ProductError } from './errors.js';
import { PRODUCT_SCHEMA_VERSION } from './model.js';
import type {
  ProductCapability,
  ProductConstraint,
  ProductDefinition,
  ProductDimensions,
  ProductId,
  ProductOptionAxis,
} from './model.js';
import { isValidCapability, MAX_CAPABILITY_RANGE } from './capabilities.js';

/**
 * PRODUCT VALIDATION — the single gate every product definition passes before it exists
 * (`defineProduct` routes its own output through here too). Enforces the PRODUCT INVARIANTS:
 *
 *  P1  supported schema version
 *  P2  stable id: lowercase token, bounded
 *  P3  version is semver-shaped
 *  P4  name non-empty, bounded
 *  P5  dimensions finite, positive, bounded
 *  P6  pageCounts non-empty, positive integers, strictly ascending (unique + canonical order)
 *  P7  options canonical: axes strictly ascending tokens; values non-empty, strictly ascending
 *      tokens; defaultValue is one of values
 *  P8  constraints valid, reference existing axes/values, strictly ascending by canonical
 *      form (unique + canonical order)
 *  P9  capabilities valid, strictly ascending by name (unique + canonical order)
 *  P10 hasCover is a boolean
 */

export const SEMVER_RE = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const TOKEN_RE = /^[a-z0-9][a-z0-9._-]*$/;
const MAX_ID = 100;
const MAX_NAME = 200;
const MAX_TOKEN = 100;
const MAX_DIMENSION_MM = 2000;
const MAX_PAGE_COUNT = 1000;
const MAX_LIMIT = 10000;

function bad<T>(
  message: string,
  context?: Record<string, string | number>,
): Result<T, ProductError> {
  return err(new ProductError(message, context === undefined ? {} : { context }));
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
const isStr = (v: unknown): v is string => typeof v === 'string';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isToken = (v: unknown): v is string => isStr(v) && v.length <= MAX_TOKEN && TOKEN_RE.test(v);

function parseDimensions(v: unknown): Result<ProductDimensions, ProductError> {
  if (!isRecord(v)) return bad('Product dimensions must be an object');
  const { pageWidthMm, pageHeightMm } = v;
  if (!isNum(pageWidthMm) || !isNum(pageHeightMm)) {
    return bad('Product dimensions must be finite numbers');
  }
  if (
    pageWidthMm <= 0 ||
    pageHeightMm <= 0 ||
    pageWidthMm > MAX_DIMENSION_MM ||
    pageHeightMm > MAX_DIMENSION_MM
  ) {
    return bad(`Product dimensions must be positive and <= ${MAX_DIMENSION_MM}mm`, {
      pageWidthMm,
      pageHeightMm,
    });
  }
  return ok({ pageWidthMm, pageHeightMm });
}

function parsePageCounts(v: unknown): Result<readonly number[], ProductError> {
  if (!Array.isArray(v) || v.length === 0) {
    return bad('Product pageCounts must be a non-empty array');
  }
  const out: number[] = [];
  for (const raw of v) {
    if (!isNum(raw) || !Number.isInteger(raw) || raw <= 0 || raw > MAX_PAGE_COUNT) {
      return bad(`Page count must be a positive integer <= ${MAX_PAGE_COUNT}`);
    }
    const prev = out[out.length - 1];
    if (prev !== undefined && prev >= raw) {
      return bad('Product pageCounts must be strictly ascending (unique, canonical order)');
    }
    out.push(raw);
  }
  return ok(out);
}

function parseOptions(v: unknown): Result<readonly ProductOptionAxis[], ProductError> {
  if (v === undefined) return ok([]);
  if (!Array.isArray(v)) return bad('Product options must be an array');
  const out: ProductOptionAxis[] = [];
  for (const raw of v) {
    if (!isRecord(raw)) return bad('Option axis must be an object');
    const { axis, values, defaultValue } = raw;
    if (!isToken(axis)) return bad('Option axis name must be a lowercase token');
    const where = `Option axis "${axis}"`;
    if (!Array.isArray(values) || values.length === 0) {
      return bad(`${where}: values must be a non-empty array`);
    }
    const parsedValues: string[] = [];
    for (const value of values) {
      if (!isToken(value)) return bad(`${where}: values must be lowercase tokens`);
      const prev = parsedValues[parsedValues.length - 1];
      if (prev !== undefined && prev >= value) {
        return bad(`${where}: values must be strictly ascending (unique, canonical order)`);
      }
      parsedValues.push(value);
    }
    if (!isStr(defaultValue) || !parsedValues.includes(defaultValue)) {
      return bad(`${where}: defaultValue must be one of the axis values`);
    }
    const prevAxis = out[out.length - 1];
    if (prevAxis !== undefined && prevAxis.axis >= axis) {
      return bad('Product options must be strictly ascending by axis (unique, canonical order)');
    }
    out.push({ axis, values: parsedValues, defaultValue });
  }
  return ok(out);
}

function parseConstraint(
  v: unknown,
  axes: ReadonlyMap<string, ProductOptionAxis>,
): Result<ProductConstraint, ProductError> {
  if (!isRecord(v)) return bad('Constraint must be an object');
  const { kind } = v;
  if (kind === 'requires-option' || kind === 'excludes-option') {
    const { ifAxis, ifValue, thenAxis, thenValue } = v;
    if (!isStr(ifAxis) || !isStr(ifValue) || !isStr(thenAxis) || !isStr(thenValue)) {
      return bad(`Constraint "${kind}": axes and values must be strings`);
    }
    for (const [axis, value] of [
      [ifAxis, ifValue],
      [thenAxis, thenValue],
    ] as const) {
      const known = axes.get(axis);
      if (known === undefined) {
        return bad(`Constraint "${kind}" references unknown option axis "${axis}"`);
      }
      if (!known.values.includes(value)) {
        return bad(`Constraint "${kind}" references unknown value "${value}" on axis "${axis}"`);
      }
    }
    if (ifAxis === thenAxis) {
      return bad(`Constraint "${kind}" must couple two different axes`);
    }
    return ok({ kind, ifAxis, ifValue, thenAxis, thenValue });
  }
  if (kind === 'max-placements-per-spread' || kind === 'max-texts-per-spread') {
    const { limit } = v;
    if (!isNum(limit) || !Number.isInteger(limit) || limit <= 0 || limit > MAX_LIMIT) {
      return bad(`Constraint "${kind}": limit must be a positive integer <= ${MAX_LIMIT}`);
    }
    return ok({ kind, limit });
  }
  return bad(`Unknown constraint kind "${String(kind)}"`);
}

function parseConstraints(
  v: unknown,
  options: readonly ProductOptionAxis[],
): Result<readonly ProductConstraint[], ProductError> {
  if (v === undefined) return ok([]);
  if (!Array.isArray(v)) return bad('Product constraints must be an array');
  const axes = new Map(options.map((o) => [o.axis, o]));
  const out: ProductConstraint[] = [];
  let prevKey: string | null = null;
  for (const raw of v) {
    const parsed = parseConstraint(raw, axes);
    if (!parsed.ok) return parsed;
    const key = canonicalJson(parsed.value);
    if (prevKey !== null && prevKey >= key) {
      return bad(
        'Product constraints must be strictly ascending by canonical form (unique, canonical order)',
      );
    }
    prevKey = key;
    out.push(parsed.value);
  }
  return ok(out);
}

function parseCapabilities(v: unknown): Result<readonly ProductCapability[], ProductError> {
  if (v === undefined) return ok([]);
  if (!Array.isArray(v)) return bad('Product capabilities must be an array');
  const out: ProductCapability[] = [];
  for (const raw of v) {
    if (!isRecord(raw)) return bad('Capability must be an object');
    const { name, versionRange } = raw;
    if (!isStr(name)) return bad('Capability name must be a string');
    if (versionRange !== undefined && !isStr(versionRange)) {
      return bad(`Capability "${name}": versionRange must be a string`);
    }
    if (versionRange !== undefined && versionRange.length > MAX_CAPABILITY_RANGE) {
      return bad(`Capability "${name}": versionRange too long`);
    }
    const cap: ProductCapability = versionRange === undefined ? { name } : { name, versionRange };
    if (!isValidCapability(cap)) return bad(`Capability "${name}" is invalid`);
    const prev = out[out.length - 1];
    if (prev !== undefined && prev.name >= name) {
      return bad(
        'Product capabilities must be strictly ascending by name (unique, canonical order)',
      );
    }
    out.push(cap);
  }
  return ok(out);
}

/** The full untrusted-input boundary: parse + every invariant (P1–P10). */
export function validateProduct(input: unknown): Result<ProductDefinition, ProductError> {
  if (!isRecord(input)) return bad('Product must be an object');
  const { schemaVersion, id, version, name, hasCover } = input;

  // P1 — schema version
  if (schemaVersion !== PRODUCT_SCHEMA_VERSION) {
    return bad(`Unsupported product schema version "${String(schemaVersion)}"`, {
      supported: PRODUCT_SCHEMA_VERSION,
    });
  }
  // P2 — stable id
  if (!isStr(id) || id.length > MAX_ID || !TOKEN_RE.test(id)) {
    return bad('Product id must be a lowercase token (stable identifier)');
  }
  // P3 — semver version
  if (!isStr(version) || !SEMVER_RE.test(version)) {
    return bad(`Product version must be semver-shaped, got "${String(version)}"`);
  }
  // P4 — name
  if (!isStr(name) || name.trim().length === 0 || name.length > MAX_NAME) {
    return bad(`Product name must be a non-empty string (<= ${MAX_NAME} chars)`);
  }
  // P10 — hasCover
  if (typeof hasCover !== 'boolean') return bad('Product hasCover must be a boolean');

  // P5 — dimensions
  const dimensions = parseDimensions(input.dimensions);
  if (!dimensions.ok) return dimensions;
  // P6 — page counts
  const pageCounts = parsePageCounts(input.pageCounts);
  if (!pageCounts.ok) return pageCounts;
  // P7 — options
  const options = parseOptions(input.options);
  if (!options.ok) return options;
  // P8 — constraints
  const constraints = parseConstraints(input.constraints, options.value);
  if (!constraints.ok) return constraints;
  // P9 — capabilities
  const capabilities = parseCapabilities(input.capabilities);
  if (!capabilities.ok) return capabilities;

  const product: ProductDefinition = {
    schemaVersion: PRODUCT_SCHEMA_VERSION,
    id: id as ProductId,
    version,
    name,
    dimensions: dimensions.value,
    pageCounts: pageCounts.value,
    hasCover,
    options: options.value,
    constraints: constraints.value,
    capabilities: capabilities.value,
  };
  return ok(product);
}

/** The author-facing input shape — order-insensitive; `defineProduct` canonicalizes it. */
export interface ProductInput {
  readonly id: string;
  readonly version: string;
  readonly name: string;
  readonly dimensions: ProductDimensions;
  readonly pageCounts: readonly number[];
  readonly hasCover: boolean;
  readonly options?: readonly ProductOptionAxis[];
  readonly constraints?: readonly ProductConstraint[];
  readonly capabilities?: readonly ProductCapability[];
}

const byString = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The VALIDATING CONSTRUCTOR for product definitions. Canonicalizes the NON-semantic
 * orderings (pageCounts ascending; options by axis with values sorted; constraints by
 * canonical form; capabilities by name), stamps the schema version, routes the result
 * through the full validation gate, and deep-freezes it — an invariant-violating product
 * definition is unrepresentable.
 */
export function defineProduct(input: ProductInput): Result<ProductDefinition, ProductError> {
  const assembled = {
    schemaVersion: PRODUCT_SCHEMA_VERSION,
    id: input.id,
    version: input.version,
    name: input.name,
    dimensions: input.dimensions,
    pageCounts: [...input.pageCounts].sort((a, b) => a - b),
    hasCover: input.hasCover,
    options: [...(input.options ?? [])]
      .sort((a, b) => byString(a.axis, b.axis))
      .map((o) => ({ ...o, values: [...o.values].sort(byString) })),
    constraints: [...(input.constraints ?? [])].sort((a, b) =>
      byString(canonicalJson(a), canonicalJson(b)),
    ),
    capabilities: [...(input.capabilities ?? [])].sort((a, b) => byString(a.name, b.name)),
  };
  const validated = validateProduct(assembled);
  if (!validated.ok) return validated;
  deepFreeze(validated.value);
  return validated;
}
