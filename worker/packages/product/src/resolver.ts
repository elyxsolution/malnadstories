import type { Result } from '@workerv2/contracts';
import { ok, err, deepFreeze } from '@workerv2/utils';
import type { VersionComponent } from '@workerv2/control-plane';
import type {
  BlueprintSource,
  PlacementSource,
  SpreadSource,
  SurfaceSource,
  TextSource,
} from '@workerv2/blueprint';
import { ProductError } from './errors.js';
import type {
  ProductDefinition,
  ProductHash,
  ProductSelection,
  ResolvedSelection,
} from './model.js';
import { resolveSelection, spreadLimits } from './constraints.js';
import type { ProductCatalog } from './catalog.js';
import { getProduct } from './catalog.js';
import { hashProduct } from './identity.js';
import { SEMVER_RE } from './validate.js';
import { productVersionPins } from './versioning.js';

/**
 * PRODUCT RESOLUTION — the seam between the Product Platform and the Blueprint Platform.
 * Resolution consumes a product (from a versioned catalog), a selection, and declarative
 * album CONTENT, and produces a **`BlueprintSource`** — the blueprint compiler's INPUT —
 * never a `Blueprint`. It is a pure, deterministic data transformation: frames pass through
 * untouched, no layout is computed, nothing is rendered, executed, or stored.
 *
 * The RESOLVER CHAIN is the extension seam the frozen Blueprint phase reserves for future
 * layout/template/theme resolvers: each resolver transforms the draft source in declared
 * order (order is semantic). The chain CANNOT escape the product's rules — the final source
 * is re-verified against the product after the chain runs (one gate, same philosophy as the
 * blueprint compiler validating its own output).
 */

const RESOLVER_NAME_RE = /^[a-z0-9][a-z0-9._-]*$/;
const MAX_RESOLVER_NAME = 100;

/** Declarative album content, product-agnostic — the shapes are the blueprint compiler's source vocabulary. */
export interface ResolutionContent {
  readonly albumId: string;
  readonly title: string;
  readonly cover?: SurfaceSource;
  readonly spreads: readonly SpreadSource[];
}

export interface ResolutionRequest {
  readonly productId: string;
  /** Exact product version; absent → the catalog's latest version of the id. */
  readonly productVersion?: string;
  readonly selection: ProductSelection;
  readonly content: ResolutionContent;
}

/** The immutable context every resolver in the chain sees (identical for all of them). */
export interface ResolutionContext {
  readonly catalog: ProductCatalog;
  readonly product: ProductDefinition;
  readonly selection: ResolvedSelection;
}

/**
 * The RESOLVER CONTRACT. A resolver is a PURE transformation of the draft source: same
 * context + same draft → same output, always. No I/O, no clocks, no randomness — resolvers
 * that violate purity break resolution determinism (and with it, blueprint identity).
 */
export interface SourceResolver {
  /** Stable resolver identifier (lowercase token). */
  readonly name: string;
  /** The resolver's version (semver) — recorded in the resolution provenance. */
  readonly version: string;
  resolve(
    context: ResolutionContext,
    draft: BlueprintSource,
  ): Result<BlueprintSource, ProductError>;
}

/** Provenance of one chain entry (which resolver, at which version, touched the source). */
export interface ResolverRef {
  readonly name: string;
  readonly version: string;
}

/** The immutable result of resolving a product: the source the blueprint compiler consumes + provenance + pins. */
export interface ProductResolution {
  readonly product: ProductDefinition;
  readonly productHash: ProductHash;
  readonly selection: ResolvedSelection;
  /** The resolver chain that produced the source, in execution order. */
  readonly resolvers: readonly ResolverRef[];
  /** The blueprint compiler's input. NEVER a compiled Blueprint — compilation is the Blueprint Platform's job. */
  readonly source: BlueprintSource;
  /** Version pins the selecting run must freeze (INV-11): `{ product: <version> }`. */
  readonly pins: Readonly<Partial<Record<VersionComponent, string>>>;
}

function bad<T>(
  message: string,
  context?: Record<string, string | number>,
): Result<T, ProductError> {
  return err(new ProductError(message, context === undefined ? {} : { context }));
}

/** Structural copy keeping ONLY the known source fields (drops extra keys; shares nothing). */
function cloneSurface(surface: SurfaceSource): SurfaceSource {
  const out: { placements?: PlacementSource[]; texts?: TextSource[] } = {};
  if (surface.placements !== undefined) {
    out.placements = surface.placements.map((p) => ({
      slot: p.slot,
      artifact: p.artifact,
      frame: { x: p.frame.x, y: p.frame.y, w: p.frame.w, h: p.frame.h },
    }));
  }
  if (surface.texts !== undefined) {
    out.texts = surface.texts.map((t) => ({
      content: t.content,
      frame: { x: t.frame.x, y: t.frame.y, w: t.frame.w, h: t.frame.h },
    }));
  }
  return out;
}

function cloneSource(source: BlueprintSource): BlueprintSource {
  const out: {
    albumId: string;
    title: string;
    cover?: SurfaceSource;
    spreads: SpreadSource[];
  } = {
    albumId: source.albumId,
    title: source.title,
    spreads: source.spreads.map((s) => ({ ...cloneSurface(s), pages: s.pages })),
  };
  if (source.cover !== undefined) out.cover = cloneSurface(source.cover);
  return out;
}

function validateChain(chain: readonly SourceResolver[]): Result<void, ProductError> {
  const seen = new Set<string>();
  for (const resolver of chain) {
    if (
      typeof resolver.name !== 'string' ||
      resolver.name.length > MAX_RESOLVER_NAME ||
      !RESOLVER_NAME_RE.test(resolver.name)
    ) {
      return bad('Resolver name must be a lowercase token');
    }
    if (typeof resolver.version !== 'string' || !SEMVER_RE.test(resolver.version)) {
      return bad(`Resolver "${resolver.name}" version must be semver-shaped`);
    }
    if (seen.has(resolver.name)) {
      return bad(`Duplicate resolver "${resolver.name}" in chain`);
    }
    seen.add(resolver.name);
  }
  return ok(undefined);
}

/**
 * Verify a source against the product + selection — the PRODUCT GATE the chain cannot
 * escape: cover presence matches the product, total pages match the selected page count,
 * per-spread content limits hold. (Full structural/geometry validation is the blueprint
 * compiler's gate — not duplicated here.)
 */
function verifySource(
  product: ProductDefinition,
  selection: ResolvedSelection,
  source: BlueprintSource,
): Result<void, ProductError> {
  if (product.hasCover && source.cover === undefined) {
    return bad(`Product "${product.id}" has a cover — the source must provide a cover surface`);
  }
  if (!product.hasCover && source.cover !== undefined) {
    return bad(`Product "${product.id}" has no cover — the source must not provide one`);
  }
  if (source.spreads.length === 0) {
    return bad('Resolved source must contain at least one spread');
  }
  let totalPages = 0;
  for (const spread of source.spreads) {
    if (spread.pages !== 1 && spread.pages !== 2) {
      return bad('Spread pages must be 1 or 2');
    }
    totalPages += spread.pages;
  }
  if (totalPages !== selection.pageCount) {
    return bad(
      `Source pages (${String(totalPages)}) do not match the selected page count (${String(selection.pageCount)})`,
      { totalPages, pageCount: selection.pageCount },
    );
  }
  const limits = spreadLimits(product);
  for (let i = 0; i < source.spreads.length; i++) {
    const spread = source.spreads[i];
    if (spread === undefined) continue;
    const placements = spread.placements?.length ?? 0;
    const texts = spread.texts?.length ?? 0;
    if (limits.maxPlacementsPerSpread !== undefined && placements > limits.maxPlacementsPerSpread) {
      return bad(
        `Spread ${String(i)} has ${String(placements)} placements (product limit ${String(limits.maxPlacementsPerSpread)})`,
      );
    }
    if (limits.maxTextsPerSpread !== undefined && texts > limits.maxTextsPerSpread) {
      return bad(
        `Spread ${String(i)} has ${String(texts)} texts (product limit ${String(limits.maxTextsPerSpread)})`,
      );
    }
  }
  return ok(undefined);
}

/**
 * Resolve a product + selection + content into an immutable `ProductResolution` whose
 * `source` is ready for `compileBlueprint`. Deterministic end to end (given pure resolvers):
 * the same catalog, request, and chain always produce the same source — and therefore the
 * same downstream blueprint identity.
 */
export function resolveProduct(
  catalog: ProductCatalog,
  request: ResolutionRequest,
  chain: readonly SourceResolver[] = [],
): Result<ProductResolution, ProductError> {
  const product = getProduct(catalog, request.productId, request.productVersion);
  if (product === undefined) {
    return bad(
      `Product "${request.productId}"${request.productVersion === undefined ? '' : `@${request.productVersion}`} is not in the catalog`,
      { productId: request.productId },
    );
  }

  const selection = resolveSelection(product, request.selection);
  if (!selection.ok) return selection;

  const chainOk = validateChain(chain);
  if (!chainOk.ok) return chainOk;

  const context: ResolutionContext = Object.freeze({
    catalog,
    product,
    selection: selection.value,
  });

  // Run the chain in declared order (order is SEMANTIC), starting from a structural copy of
  // the content so no resolver ever sees (or can retain) the caller's objects.
  let draft = cloneSource(request.content);
  for (const resolver of chain) {
    const next = resolver.resolve(context, draft);
    if (!next.ok) {
      return err(
        new ProductError(`Resolver "${resolver.name}" failed: ${next.error.message}`, {
          cause: next.error,
          context: { resolver: resolver.name },
        }),
      );
    }
    draft = next.value;
  }

  // Re-copy the final source (drops unknown keys, shares nothing with resolver internals),
  // enforce the albumId is untouched, then run the product gate the chain cannot escape.
  const source = cloneSource(draft);
  if (source.albumId !== request.content.albumId) {
    return bad('Resolver chain must not change the source albumId');
  }
  const verified = verifySource(product, selection.value, source);
  if (!verified.ok) return verified;

  const resolution: ProductResolution = {
    product,
    productHash: hashProduct(product),
    selection: selection.value,
    resolvers: chain.map((r) => ({ name: r.name, version: r.version })),
    source,
    pins: productVersionPins(product),
  };
  deepFreeze(resolution);
  return ok(resolution);
}
