import type { Brand } from '@workerv2/contracts';

/**
 * The PRODUCT MODEL — the immutable, deterministic definition of what can be manufactured:
 * an album product's dimensions, page-count offering, material options, declarative
 * constraints, and capability requirements. Pure data — no rendering, no layout, no pricing
 * logic, no execution. Every type here is a value; behavior lives in the sibling modules
 * (validate / catalog / resolver / compatibility), all pure functions.
 */

/** The product SCHEMA version (semver). Part of the canonical content — bumping it changes every product's identity, by design. */
export const PRODUCT_SCHEMA_VERSION = '1.0.0';

/**
 * A product's STABLE identifier — an author-chosen, validated lowercase token (e.g.
 * `album-classic-a4`). Stable across versions: the pair (id, version) names one immutable
 * definition; the content hash addresses its exact content.
 */
export type ProductId = Brand<string, 'ProductId'>;

/** A product's content-addressed IDENTITY: `sha256:<hex>` of its canonical serialization. */
export type ProductHash = Brand<string, 'ProductHash'>;

/** Physical page dimensions in millimetres (one page, not the spread). */
export interface ProductDimensions {
  readonly pageWidthMm: number;
  readonly pageHeightMm: number;
}

/**
 * One MATERIAL/OPTION axis of the product (e.g. `cover-finish` → `glossy | matte`). Values
 * are a closed, validated vocabulary; `defaultValue` is applied when a selection omits the
 * axis. Axis and value order is NON-semantic (canonicalized sorted).
 */
export interface ProductOptionAxis {
  readonly axis: string;
  readonly values: readonly string[];
  readonly defaultValue: string;
}

/**
 * A declarative PRODUCT CONSTRAINT. Constraints are data, never code: option coupling rules
 * (requires/excludes across axes) and per-spread content limits. Constraint order is
 * NON-semantic (canonicalized by canonical-JSON form).
 */
export type ProductConstraint =
  | RequiresOptionConstraint
  | ExcludesOptionConstraint
  | MaxPlacementsPerSpreadConstraint
  | MaxTextsPerSpreadConstraint;

/** If `ifAxis` is selected as `ifValue`, then `thenAxis` MUST be `thenValue`. */
export interface RequiresOptionConstraint {
  readonly kind: 'requires-option';
  readonly ifAxis: string;
  readonly ifValue: string;
  readonly thenAxis: string;
  readonly thenValue: string;
}

/** If `ifAxis` is selected as `ifValue`, then `thenAxis` must NOT be `thenValue`. */
export interface ExcludesOptionConstraint {
  readonly kind: 'excludes-option';
  readonly ifAxis: string;
  readonly ifValue: string;
  readonly thenAxis: string;
  readonly thenValue: string;
}

/** No spread of a resolved source may carry more than `limit` placements. */
export interface MaxPlacementsPerSpreadConstraint {
  readonly kind: 'max-placements-per-spread';
  readonly limit: number;
}

/** No spread of a resolved source may carry more than `limit` texts. */
export interface MaxTextsPerSpreadConstraint {
  readonly kind: 'max-texts-per-spread';
  readonly limit: number;
}

/**
 * A PRODUCT CAPABILITY declaration: what a product requires from the platform that will
 * process it (e.g. `pdf.render`, `image.canonical`). Deliberately STRUCTURALLY IDENTICAL to
 * the runtime's `CapabilityRequirement` and processing's `StepCapabilityRequirement`
 * negotiation shapes, without importing either — the product model must stay consumable by
 * any engine without depending on the hosting framework.
 */
export interface ProductCapability {
  readonly name: string;
  /** Optional compatible-version constraint (e.g. a semver range). Opaque here; an engine's negotiator interprets it. */
  readonly versionRange?: string;
}

/**
 * An immutable, validated PRODUCT DEFINITION — one version of one product. Constructed only
 * by `defineProduct` or the parse/validation boundary; always deep-frozen. Identity: the
 * (id, version) pair names it; `hashProduct` addresses its exact canonical content.
 */
export interface ProductDefinition {
  readonly schemaVersion: string;
  readonly id: ProductId;
  /** This definition's version (semver). A definition is immutable — any change is a new version. */
  readonly version: string;
  readonly name: string;
  readonly dimensions: ProductDimensions;
  /** The page (leaf) counts this product is offered in — strictly ascending positive integers. */
  readonly pageCounts: readonly number[];
  /** Whether this product has a printed cover surface. Resolution enforces presence/absence accordingly. */
  readonly hasCover: boolean;
  /** Material/option axes, sorted by axis (canonical). */
  readonly options: readonly ProductOptionAxis[];
  /** Declarative constraints, sorted by canonical form (canonical). */
  readonly constraints: readonly ProductConstraint[];
  /** Required platform capabilities, sorted by name (canonical). */
  readonly capabilities: readonly ProductCapability[];
}

/** A stable reference to one immutable product definition: id + version + content hash. */
export interface ProductVersionRef {
  readonly id: ProductId;
  readonly version: string;
  readonly hash: ProductHash;
}

/**
 * A customer/system SELECTION against a product: the chosen page count plus option values.
 * Unspecified axes take the product's defaults during resolution.
 */
export interface ProductSelection {
  readonly pageCount: number;
  readonly options?: Readonly<Record<string, string>>;
}

/** A selection with every axis resolved (defaults applied) and all constraints verified. */
export interface ResolvedSelection {
  readonly pageCount: number;
  readonly options: Readonly<Record<string, string>>;
}

/** Look up an option axis by name (axes are axis-sorted; linear scan is fine at product scale). */
export function optionAxis(
  product: ProductDefinition,
  axis: string,
): ProductOptionAxis | undefined {
  return product.options.find((o) => o.axis === axis);
}
