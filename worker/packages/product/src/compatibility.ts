import type { Result } from '@workerv2/contracts';
import { ok, err, canonicalJson, deepFreeze } from '@workerv2/utils';
import { ProductError } from './errors.js';
import type { ProductCapability } from './model.js';
import { isValidCapability } from './capabilities.js';
import { missingCapabilities } from './capabilities.js';
import { SEMVER_RE } from './validate.js';
import { hashCanonical } from './identity.js';

/**
 * The COMPATIBILITY MODEL — a declarative, versioned matrix stating which combinations of
 * product, processing profile, runtime capabilities, and blueprint schema version can work
 * together. Pure data + a pure check: nothing here negotiates, executes, or renders.
 *
 * Processing-profile ids are OPAQUE TOKENS here — the processing-profile registry is a later
 * deliverable of the frozen Product phase; the matrix only names profiles, it never defines
 * them. Blueprint schema versions are matched against `@workerv2/blueprint`'s published
 * version by the caller (the matrix is data; it does not import blueprint internals).
 *
 * Matching is FIRST-MATCH in declared rule order (rule order is SEMANTIC: put specific rules
 * before wildcard fallbacks). Within a rule, the compatible sets are canonical (sorted).
 */

export const COMPATIBILITY_SCHEMA_VERSION = '1.0.0';

/** Matches any product id / any product version. */
export const ANY = '*';

export interface CompatibilityRule {
  /** Product id this rule covers, or `'*'` for any product. */
  readonly product: string;
  /** Exact product version this rule covers, or `'*'` (default) for any version. */
  readonly productVersion?: string;
  /** Processing-profile ids compatible under this rule (opaque tokens, sorted). */
  readonly processingProfiles: readonly string[];
  /** Runtime capabilities REQUIRED for this combination (name-sorted). */
  readonly runtimeCapabilities: readonly ProductCapability[];
  /** Blueprint schema versions this combination can compile into (sorted). */
  readonly blueprintSchemaVersions: readonly string[];
}

export interface CompatibilityMatrix {
  readonly schemaVersion: string;
  /** This matrix snapshot's version (semver). Any change is a new version. */
  readonly version: string;
  /** Rules in match order (order is SEMANTIC — first match wins). */
  readonly rules: readonly CompatibilityRule[];
}

/** What a caller wants to run: the product pair plus the facets it wants checked. */
export interface CompatibilityQuery {
  readonly productId: string;
  readonly productVersion: string;
  /** Check that this processing profile is compatible (omit to skip the facet). */
  readonly processingProfile?: string;
  /** Check that this blueprint schema version is compatible (omit to skip the facet). */
  readonly blueprintSchemaVersion?: string;
  /** Check the rule's required runtime capabilities against these (omit to skip the facet). */
  readonly availableRuntimeCapabilities?: readonly string[];
}

/** The deterministic outcome: compatible, or the exact reasons it is not. */
export interface CompatibilityVerdict {
  readonly compatible: boolean;
  /** Empty when compatible; otherwise every failed facet, in check order. */
  readonly reasons: readonly string[];
  /** The rule that matched the product pair (absent when no rule matched). */
  readonly rule?: CompatibilityRule;
}

const TOKEN_RE = /^[a-z0-9][a-z0-9._-]*$/;
const MAX_TOKEN = 100;

function bad<T>(message: string): Result<T, ProductError> {
  return err(new ProductError(message));
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
const isStr = (v: unknown): v is string => typeof v === 'string';
const isToken = (v: unknown): v is string => isStr(v) && v.length <= MAX_TOKEN && TOKEN_RE.test(v);

function parseSortedTokens(
  v: unknown,
  where: string,
  what: string,
): Result<readonly string[], ProductError> {
  if (!Array.isArray(v)) return bad(`${where}: ${what} must be an array`);
  const out: string[] = [];
  for (const raw of v) {
    if (!isToken(raw)) return bad(`${where}: ${what} must be lowercase tokens`);
    const prev = out[out.length - 1];
    if (prev !== undefined && prev >= raw) {
      return bad(`${where}: ${what} must be strictly ascending (unique, canonical order)`);
    }
    out.push(raw);
  }
  return ok(out);
}

function parseRule(v: unknown, position: number): Result<CompatibilityRule, ProductError> {
  const where = `Compatibility rule ${String(position)}`;
  if (!isRecord(v)) return bad(`${where}: must be an object`);
  const { product, productVersion } = v;
  if (product !== ANY && !isToken(product)) {
    return bad(`${where}: product must be a lowercase token or "*"`);
  }
  if (productVersion !== undefined && productVersion !== ANY) {
    if (!isStr(productVersion) || !SEMVER_RE.test(productVersion)) {
      return bad(`${where}: productVersion must be semver-shaped or "*"`);
    }
  }
  const profiles = parseSortedTokens(v.processingProfiles, where, 'processingProfiles');
  if (!profiles.ok) return profiles;
  const schemaVersions = v.blueprintSchemaVersions;
  if (!Array.isArray(schemaVersions) || schemaVersions.length === 0) {
    return bad(`${where}: blueprintSchemaVersions must be a non-empty array`);
  }
  const parsedVersions: string[] = [];
  for (const raw of schemaVersions) {
    if (!isStr(raw) || !SEMVER_RE.test(raw)) {
      return bad(`${where}: blueprintSchemaVersions must be semver-shaped`);
    }
    const prev = parsedVersions[parsedVersions.length - 1];
    if (prev !== undefined && prev >= raw) {
      return bad(
        `${where}: blueprintSchemaVersions must be strictly ascending (unique, canonical order)`,
      );
    }
    parsedVersions.push(raw);
  }
  const capsRaw = v.runtimeCapabilities;
  if (!Array.isArray(capsRaw)) return bad(`${where}: runtimeCapabilities must be an array`);
  const caps: ProductCapability[] = [];
  for (const raw of capsRaw) {
    if (!isRecord(raw) || !isStr(raw.name)) {
      return bad(`${where}: runtime capability must have a string name`);
    }
    if (raw.versionRange !== undefined && !isStr(raw.versionRange)) {
      return bad(`${where}: runtime capability versionRange must be a string`);
    }
    const cap: ProductCapability =
      raw.versionRange === undefined
        ? { name: raw.name }
        : { name: raw.name, versionRange: raw.versionRange };
    if (!isValidCapability(cap)) return bad(`${where}: runtime capability "${raw.name}" invalid`);
    const prev = caps[caps.length - 1];
    if (prev !== undefined && prev.name >= cap.name) {
      return bad(
        `${where}: runtimeCapabilities must be strictly ascending by name (unique, canonical order)`,
      );
    }
    caps.push(cap);
  }
  const rule: CompatibilityRule = {
    product: product as string,
    ...(productVersion === undefined ? {} : { productVersion: productVersion as string }),
    processingProfiles: profiles.value,
    runtimeCapabilities: caps,
    blueprintSchemaVersions: parsedVersions,
  };
  return ok(rule);
}

/** The full untrusted-input boundary for compatibility matrices. */
export function validateCompatibilityMatrix(
  input: unknown,
): Result<CompatibilityMatrix, ProductError> {
  if (!isRecord(input)) return bad('Compatibility matrix must be an object');
  const { schemaVersion, version, rules } = input;
  if (schemaVersion !== COMPATIBILITY_SCHEMA_VERSION) {
    return bad(`Unsupported compatibility schema version "${String(schemaVersion)}"`);
  }
  if (!isStr(version) || !SEMVER_RE.test(version)) {
    return bad(`Compatibility matrix version must be semver-shaped, got "${String(version)}"`);
  }
  if (!Array.isArray(rules) || rules.length === 0) {
    return bad('Compatibility matrix rules must be a non-empty array');
  }
  const parsed: CompatibilityRule[] = [];
  for (let i = 0; i < rules.length; i++) {
    const rule = parseRule(rules[i], i);
    if (!rule.ok) return rule;
    parsed.push(rule.value);
  }
  return ok({ schemaVersion: COMPATIBILITY_SCHEMA_VERSION, version, rules: parsed });
}

/** The author-facing input shape. Rule order is kept (it is semantic — first match wins). */
export interface CompatibilityMatrixInput {
  readonly version: string;
  readonly rules: readonly CompatibilityRule[];
}

/** The VALIDATING CONSTRUCTOR for compatibility matrices: gate + deep-freeze. */
export function defineCompatibilityMatrix(
  input: CompatibilityMatrixInput,
): Result<CompatibilityMatrix, ProductError> {
  const validated = validateCompatibilityMatrix({
    schemaVersion: COMPATIBILITY_SCHEMA_VERSION,
    version: input.version,
    rules: input.rules,
  });
  if (!validated.ok) return validated;
  deepFreeze(validated.value);
  return validated;
}

function ruleMatches(rule: CompatibilityRule, query: CompatibilityQuery): boolean {
  if (rule.product !== ANY && rule.product !== query.productId) return false;
  const ruleVersion = rule.productVersion ?? ANY;
  return ruleVersion === ANY || ruleVersion === query.productVersion;
}

/**
 * Check a combination against the matrix: find the FIRST rule matching the product pair
 * (declared order), then verify each facet the query provides. Pure and deterministic —
 * same matrix + same query → same verdict, always.
 */
export function checkCompatibility(
  matrix: CompatibilityMatrix,
  query: CompatibilityQuery,
): CompatibilityVerdict {
  const rule = matrix.rules.find((r) => ruleMatches(r, query));
  if (rule === undefined) {
    return {
      compatible: false,
      reasons: [
        `No compatibility rule covers product "${query.productId}@${query.productVersion}"`,
      ],
    };
  }
  const reasons: string[] = [];
  if (
    query.processingProfile !== undefined &&
    !rule.processingProfiles.includes(query.processingProfile)
  ) {
    reasons.push(`Processing profile "${query.processingProfile}" is not compatible`);
  }
  if (
    query.blueprintSchemaVersion !== undefined &&
    !rule.blueprintSchemaVersions.includes(query.blueprintSchemaVersion)
  ) {
    reasons.push(`Blueprint schema version "${query.blueprintSchemaVersion}" is not compatible`);
  }
  if (query.availableRuntimeCapabilities !== undefined) {
    for (const cap of missingCapabilities(
      rule.runtimeCapabilities,
      query.availableRuntimeCapabilities,
    )) {
      reasons.push(`Runtime capability "${cap.name}" is required but not available`);
    }
  }
  return { compatible: reasons.length === 0, reasons, rule };
}

/** Canonical serialization + content hash of a matrix (identity = canonical content only). */
export function serializeCompatibilityMatrix(matrix: CompatibilityMatrix): string {
  return canonicalJson(matrix);
}

export function hashCompatibilityMatrix(matrix: CompatibilityMatrix): string {
  return hashCanonical(matrix);
}
