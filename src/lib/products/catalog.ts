import 'server-only';
import { unstable_cache } from 'next/cache';
import { createServiceClient } from '@/lib/supabase/service';
import { presignGet } from '@/lib/r2';
import { CACHE_TAGS, CACHE_TTL } from '@/lib/cache';
import { FALLBACK_DIMENSIONS, type AlbumProductCore, type ProductDimensions } from './model';

/**
 * Album Product catalog reads (0047). The active catalog is a GLOBAL, non-user-owned list
 * (like covers/templates), so it is read via the service role and CACHED under the
 * `album-products-active` tag — every create-album + pricing-preview load hits this without
 * new per-request DB round-trips. Admin writes call `revalidateTag(CACHE_TAGS.productsActive)`.
 *
 * Presigned preview URLs are signed OUTSIDE the cache (short-lived, per-request) exactly like
 * the blueprint/cover loaders — the cache stores R2 KEYS, never signed URLs.
 */

export type ProductPrice = { pageCount: number; price: number };

export type ActiveProduct = AlbumProductCore & {
  coverPreviewKey: string | null;
  previewKeys: string[]; // ordered gallery
  prices: ProductPrice[]; // supported page counts (ascending) + price
};

const num = (v: unknown): number => Number(v ?? 0);

const fetchActiveProducts = async (): Promise<ActiveProduct[]> => {
  const svc = createServiceClient();
  const { data: products } = await svc
    .from('album_products')
    .select(
      'id, name, slug, description, width_cm, height_cm, builder_aspect_ratio, print_width_cm, print_height_cm, cover_preview_key, display_order, is_default, is_active',
    )
    .eq('is_active', true)
    .order('display_order', { ascending: true });

  const rows = (products ?? []) as Record<string, unknown>[];
  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.id as string);
  const [{ data: previewRows }, { data: priceRows }] = await Promise.all([
    svc.from('album_product_previews').select('product_id, image_key, sort_order').in('product_id', ids).order('sort_order', { ascending: true }),
    svc.from('album_product_prices').select('product_id, page_count, price').in('product_id', ids).order('page_count', { ascending: true }),
  ]);

  const previewsByProduct = new Map<string, string[]>();
  for (const p of (previewRows ?? []) as { product_id: string; image_key: string }[]) {
    const list = previewsByProduct.get(p.product_id) ?? [];
    list.push(p.image_key);
    previewsByProduct.set(p.product_id, list);
  }
  const pricesByProduct = new Map<string, ProductPrice[]>();
  for (const p of (priceRows ?? []) as { product_id: string; page_count: number; price: unknown }[]) {
    const list = pricesByProduct.get(p.product_id) ?? [];
    list.push({ pageCount: p.page_count, price: num(p.price) });
    pricesByProduct.set(p.product_id, list);
  }

  return rows.map((r) => ({
    id: r.id as string,
    name: r.name as string,
    slug: r.slug as string,
    description: (r.description as string | null) ?? null,
    widthCm: num(r.width_cm),
    heightCm: num(r.height_cm),
    printWidthCm: num(r.print_width_cm),
    printHeightCm: num(r.print_height_cm),
    builderAspectRatio: num(r.builder_aspect_ratio),
    displayOrder: num(r.display_order),
    isDefault: Boolean(r.is_default),
    isActive: Boolean(r.is_active),
    coverPreviewKey: (r.cover_preview_key as string | null) ?? null,
    previewKeys: previewsByProduct.get(r.id as string) ?? [],
    prices: pricesByProduct.get(r.id as string) ?? [],
  }));
};

const getActiveProductsCached = unstable_cache(fetchActiveProducts, ['album-products-active'], {
  tags: [CACHE_TAGS.productsActive],
  revalidate: CACHE_TTL.productsActive,
});

/** Raw active catalog (keys, no signed URLs). Cached. */
export async function listActiveProductsRaw(): Promise<ActiveProduct[]> {
  return getActiveProductsCached();
}

export type ProductOption = ActiveProduct & {
  coverPreviewUrl: string | null;
  previewUrls: string[];
  pageCounts: number[]; // supported counts, ascending
  startingPrice: number | null; // cheapest supported price
};

/** Customer-facing catalog: active products + short-lived presigned preview URLs. */
export async function listActiveProducts(): Promise<ProductOption[]> {
  const rows = await getActiveProductsCached();
  return Promise.all(
    rows.map(async (r) => {
      const [coverPreviewUrl, previewUrls] = await Promise.all([
        r.coverPreviewKey ? presignGet(r.coverPreviewKey, 3600) : Promise.resolve(null),
        Promise.all(r.previewKeys.map((k) => presignGet(k, 3600))),
      ]);
      const pageCounts = r.prices.map((p) => p.pageCount);
      const startingPrice = r.prices.length ? Math.min(...r.prices.map((p) => p.price)) : null;
      return { ...r, coverPreviewUrl, previewUrls, pageCounts, startingPrice };
    }),
  );
}

/** One ACTIVE product (creation-apply path) with presigned previews. */
export async function getActiveProduct(id: string): Promise<ProductOption | null> {
  const all = await listActiveProducts();
  return all.find((p) => p.id === id) ?? null;
}

/** The default active product (Standard by seed). Used as the fallback / pre-selected option. */
export async function getDefaultProduct(): Promise<ProductOption | null> {
  const all = await listActiveProducts();
  return all.find((p) => p.isDefault) ?? all[0] ?? null;
}

/**
 * The distinct page counts offered by ANY active album product (ascending) — the authoritative
 * set of valid album sizes (0047), replacing the legacy `products.pages` enumeration. Used by the
 * admin blueprint-size gates.
 */
export async function getValidAlbumPageCounts(): Promise<number[]> {
  const all = await listActiveProductsRaw();
  const set = new Set<number>();
  for (const p of all) for (const pr of p.prices) set.add(pr.pageCount);
  return Array.from(set).sort((a, b) => a - b);
}

// ── Pricing + dimension resolution (may reference INACTIVE products for live albums) ──
// Deactivating a product must NOT change the price/dimensions of an album already created
// against it, so these read the row directly (regardless of active), with a legacy fallback.

/**
 * Server-authoritative unit price for (productId, pageCount). Falls back to the LEGACY
 * `products.base_price` (by page count) when the album has no product_id yet — so a
 * pre-migration album still prices exactly as before. Returns null only if nothing resolves.
 */
export async function priceFor(productId: string | null, pageCount: number): Promise<number | null> {
  const svc = createServiceClient();
  if (productId) {
    const { data } = await svc
      .from('album_product_prices')
      .select('price')
      .eq('product_id', productId)
      .eq('page_count', pageCount)
      .maybeSingle();
    const price = (data as { price: unknown } | null)?.price;
    if (price != null) return num(price);
  }
  // Legacy fallback: original products table keyed by page count.
  const { data: legacy } = await svc
    .from('products')
    .select('base_price')
    .eq('pages', pageCount)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle();
  const base = (legacy as { base_price: unknown } | null)?.base_price;
  return base != null ? num(base) : null;
}

/** Resolve a product's dimensions by id (active or not). Null → caller uses FALLBACK_DIMENSIONS. */
export async function getProductDimensions(productId: string | null): Promise<ProductDimensions | null> {
  if (!productId) return null;
  const svc = createServiceClient();
  const { data } = await svc
    .from('album_products')
    .select('width_cm, height_cm, print_width_cm, print_height_cm, builder_aspect_ratio')
    .eq('id', productId)
    .maybeSingle();
  const r = data as Record<string, unknown> | null;
  if (!r) return null;
  return {
    widthCm: num(r.width_cm),
    heightCm: num(r.height_cm),
    printWidthCm: num(r.print_width_cm),
    printHeightCm: num(r.print_height_cm),
    builderAspectRatio: num(r.builder_aspect_ratio),
  };
}

export type AlbumProductSnapshot = {
  productId: string | null;
  productName: string | null;
  dimensions: ProductDimensions;
};

/**
 * Load the product context for an album: its dimensions (always resolved — DB or fallback)
 * + a name/id snapshot for the order record. One place, so the print route, order creation,
 * and (future) builder all agree.
 */
export async function getAlbumProductSnapshot(productId: string | null): Promise<AlbumProductSnapshot> {
  if (!productId) return { productId: null, productName: null, dimensions: FALLBACK_DIMENSIONS };
  const svc = createServiceClient();
  const { data } = await svc
    .from('album_products')
    .select('id, name, width_cm, height_cm, print_width_cm, print_height_cm, builder_aspect_ratio')
    .eq('id', productId)
    .maybeSingle();
  const r = data as Record<string, unknown> | null;
  if (!r) return { productId, productName: null, dimensions: FALLBACK_DIMENSIONS };
  return {
    productId: r.id as string,
    productName: r.name as string,
    dimensions: {
      widthCm: num(r.width_cm),
      heightCm: num(r.height_cm),
      printWidthCm: num(r.print_width_cm),
      printHeightCm: num(r.print_height_cm),
      builderAspectRatio: num(r.builder_aspect_ratio),
    },
  };
}
