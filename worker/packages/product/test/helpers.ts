import type { Result } from '@workerv2/contracts';
import type {
  ProductCatalog,
  ProductDefinition,
  ProductInput,
  ResolutionContent,
  ResolutionRequest,
} from '@workerv2/product';
import { defineCatalog, defineProduct } from '@workerv2/product';

export function unwrap<T>(r: Result<T, unknown>): T {
  if (!r.ok) throw new Error(`unwrap() called on Err: ${String(r.error)}`);
  return r.value;
}

export function unwrapErr<E>(r: Result<unknown, E>): E {
  if (r.ok) throw new Error('unwrapErr() called on Ok');
  return r.error;
}

export const rect = (
  x = 0,
  y = 0,
  w = 1,
  h = 1,
): { x: number; y: number; w: number; h: number } => ({ x, y, w, h });

/** The reference product: covered album, two option axes, coupling + content constraints. */
export function classicInput(overrides: Partial<ProductInput> = {}): ProductInput {
  return {
    id: 'album-classic-a4',
    version: '1.0.0',
    name: 'Classic A4 Album',
    dimensions: { pageWidthMm: 210, pageHeightMm: 297 },
    pageCounts: [24, 36, 48],
    hasCover: true,
    options: [
      { axis: 'cover-finish', values: ['glossy', 'matte'], defaultValue: 'matte' },
      { axis: 'paper', values: ['premium', 'standard'], defaultValue: 'standard' },
    ],
    constraints: [
      {
        kind: 'requires-option',
        ifAxis: 'cover-finish',
        ifValue: 'glossy',
        thenAxis: 'paper',
        thenValue: 'premium',
      },
      { kind: 'max-placements-per-spread', limit: 4 },
      { kind: 'max-texts-per-spread', limit: 2 },
    ],
    capabilities: [{ name: 'image.canonical' }, { name: 'pdf.render', versionRange: '^1.0.0' }],
    ...overrides,
  };
}

export function classicProduct(overrides: Partial<ProductInput> = {}): ProductDefinition {
  return unwrap(defineProduct(classicInput(overrides)));
}

/** A coverless companion product, in two versions (for latest-resolution tests). */
export function slimProduct(version = '1.0.0'): ProductDefinition {
  return unwrap(
    defineProduct({
      id: 'album-slim',
      version,
      name: 'Slim Album',
      dimensions: { pageWidthMm: 150, pageHeightMm: 150 },
      pageCounts: [12, 24],
      hasCover: false,
    }),
  );
}

export function sampleCatalog(): ProductCatalog {
  return unwrap(
    defineCatalog({
      catalogVersion: '1.0.0',
      products: [slimProduct('1.1.0'), classicProduct(), slimProduct('1.0.0')],
    }),
  );
}

/** Content that satisfies the classic product at 24 pages: cover + 12 double spreads. */
export function classicContent(overrides: Partial<ResolutionContent> = {}): ResolutionContent {
  return {
    albumId: 'alb-1',
    title: 'Goa 2026',
    cover: {
      placements: [{ slot: 'hero', artifact: 'sha256:c0ffee', frame: rect() }],
      texts: [{ content: 'Goa 2026', frame: rect(0.1, 0.8, 0.8, 0.1) }],
    },
    spreads: Array.from({ length: 12 }, (_, i) => ({
      pages: 2 as const,
      placements: [
        { slot: 'main', artifact: `sha256:aa${String(i).padStart(2, '0')}`, frame: rect() },
      ],
    })),
    ...overrides,
  };
}

export function classicRequest(overrides: Partial<ResolutionRequest> = {}): ResolutionRequest {
  return {
    productId: 'album-classic-a4',
    selection: { pageCount: 24 },
    content: classicContent(),
    ...overrides,
  };
}

/** A structural (unfrozen, plain) clone for invariant-violation tests. */
export function mutableClone(value: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}
