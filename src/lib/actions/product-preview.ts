'use server';

import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { presignGet } from '@/lib/r2';
import { normalizeCoverConfig, type CoverConfig } from '@/lib/builder/cover';
import { resolveStickerUrls } from '@/lib/stickers';
import {
  LAYOUT_TEMPLATES,
  type Background,
  type Block,
  type EditConfig,
  type LayoutTemplate,
  type Overlay,
  type QrElement,
  type StickerElement,
  type TextElement,
  trimBaseIds,
} from '@/lib/builder/model';
import { getProductDimensions } from '@/lib/products/catalog';
import { FALLBACK_DIMENSIONS, type ProductDimensions } from '@/lib/products/model';

/**
 * Load a product's interactive preview payload (Phase B — preview redesign).
 *
 * Returns the REAL render data for the product's assigned DEMO ALBUM so the customer flipbook
 * reuses the exact same pipeline (PairContent + CoverDesign) as the builder + PDF — one source
 * of truth, no duplicate rendering. If the product has no demo album (or it has no content), it
 * falls back to the existing gallery preview images. Service-role reads (the demo album is
 * admin-designated marketing content); the caller must be signed in (creation flow).
 */

export type PreviewPhoto = { id: string; url: string; edit: EditConfig | null };

export type ProductPreviewPayload =
  | {
      kind: 'flipbook';
      dimensions: ProductDimensions;
      size: number;
      title: string;
      photos: PreviewPhoto[];
      blocks: Block[];
      cover: { imageUrl: string | null; backImageUrl: string | null; config: CoverConfig; title: string };
      stickerUrls: Record<string, string>;
    }
  | { kind: 'gallery'; images: string[] }
  | { kind: 'empty' };

export type ProductPreviewResult =
  | {
      ok: true;
      product: {
        name: string;
        description: string | null;
        widthCm: number;
        heightCm: number;
        startingPrice: number | null;
        pageCounts: number[];
        bestFor: string[];
      };
      preview: ProductPreviewPayload;
    }
  | { ok: false; error: string };

const num = (v: unknown): number => Number(v ?? 0);
const isTemplate = (t: string | null): t is LayoutTemplate => !!t && (LAYOUT_TEMPLATES as readonly string[]).includes(t);

type PageRow = {
  page_number: number;
  layout_template: string | null;
  caption: string | null;
  photo_ids: string[] | null;
  layout_config: {
    overlays?: Overlay[];
    texts?: TextElement[];
    qrs?: QrElement[];
    stickers?: StickerElement[];
    background?: Background | null;
  } | null;
};

export async function getProductPreview(input: unknown): Promise<ProductPreviewResult> {
  const parsed = z.object({ productId: z.string().uuid() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Invalid product' };

  // Light gate: the creation flow is authenticated. Demo content itself is admin-designated.
  const {
    data: { user },
  } = await createClient().auth.getUser();
  if (!user) return { ok: false, error: 'Not signed in' };

  const svc = createServiceClient();
  const { data: prodRow } = await svc
    .from('album_products')
    .select('id, name, description, width_cm, height_cm, best_for, demo_album_id, is_active')
    .eq('id', parsed.data.productId)
    .maybeSingle();
  const product = prodRow as
    | {
        id: string;
        name: string;
        description: string | null;
        width_cm: unknown;
        height_cm: unknown;
        best_for: string[] | null;
        demo_album_id: string | null;
        is_active: boolean;
      }
    | null;
  if (!product || !product.is_active) return { ok: false, error: 'Product unavailable' };

  // Prices → supported page counts + starting price.
  const { data: priceRows } = await svc
    .from('album_product_prices')
    .select('page_count, price')
    .eq('product_id', product.id)
    .order('page_count', { ascending: true });
  const prices = ((priceRows ?? []) as { page_count: number; price: unknown }[]).map((p) => ({ pageCount: p.page_count, price: num(p.price) }));

  const meta = {
    name: product.name,
    description: product.description,
    widthCm: num(product.width_cm),
    heightCm: num(product.height_cm),
    startingPrice: prices.length ? Math.min(...prices.map((p) => p.price)) : null,
    pageCounts: prices.map((p) => p.pageCount),
    bestFor: product.best_for ?? [],
  };

  // Gallery fallback (also used when the demo album has no content).
  const galleryFallback = async (): Promise<ProductPreviewPayload> => {
    const { data: previews } = await svc
      .from('album_product_previews')
      .select('image_key, sort_order')
      .eq('product_id', product.id)
      .order('sort_order', { ascending: true });
    const keys = ((previews ?? []) as { image_key: string }[]).map((p) => p.image_key);
    const coverKeyRow = await svc.from('album_products').select('cover_preview_key').eq('id', product.id).maybeSingle();
    const coverKey = (coverKeyRow.data as { cover_preview_key: string | null } | null)?.cover_preview_key ?? null;
    const allKeys = [coverKey, ...keys].filter((k): k is string => !!k);
    if (allKeys.length === 0) return { kind: 'empty' };
    const images = await Promise.all(allKeys.map((k) => presignGet(k, 3600)));
    return { kind: 'gallery', images };
  };

  // No demo album → gallery preview (unchanged behaviour).
  if (!product.demo_album_id) {
    return { ok: true, product: meta, preview: await galleryFallback() };
  }

  // ── Load the demo album through the SAME shape the print route uses ──────────────
  const demoId = product.demo_album_id;
  const { data: albumRow } = await svc.from('albums').select('id, title, size, cover_template_id').eq('id', demoId).maybeSingle();
  const album = albumRow as { id: string; title: string; size: number; cover_template_id: string | null } | null;
  if (!album) return { ok: true, product: meta, preview: await galleryFallback() };

  const dimensions = (await getProductDimensions(product.id)) ?? FALLBACK_DIMENSIONS;

  // Ready photos → presigned sanitized masters.
  const { data: photoData } = await svc
    .from('photos')
    .select('id, edit_config, sanitized_key, status')
    .eq('album_id', demoId)
    .eq('status', 'ready');
  const photoRows = (photoData ?? []) as { id: string; edit_config: EditConfig | null; sanitized_key: string | null }[];
  const photos: PreviewPhoto[] = await Promise.all(
    photoRows
      .filter((r) => r.sanitized_key)
      .map(async (r) => ({ id: r.id, url: await presignGet(r.sanitized_key as string, 3600), edit: r.edit_config })),
  );
  const photoIdSet = new Set(photos.map((p) => p.id));

  // Blocks (same mapping as the print route: overlays filtered to present photos).
  const { data: pageData } = await svc
    .from('album_pages')
    .select('page_number, layout_template, caption, photo_ids, layout_config')
    .eq('album_id', demoId)
    .order('page_number', { ascending: true });
  const blocks: Block[] = ((pageData ?? []) as PageRow[])
    .filter((r) => isTemplate(r.layout_template))
    .map((r) => ({
      key: `${r.page_number}`,
      template: r.layout_template as LayoutTemplate,
      // Vacate the slot of a photo that no longer exists — never compact the row, or the right
      // page's photo slides onto the left. `trimBaseIds` drops trailing holes only.
      photoIds: trimBaseIds((r.photo_ids ?? []).map((id) => (id && photoIdSet.has(id) ? id : null))),
      caption: r.caption ?? '',
      overlays: (r.layout_config?.overlays ?? []).filter((o) => o.photoId != null && photoIdSet.has(o.photoId)),
      texts: r.layout_config?.texts ?? [],
      qrs: r.layout_config?.qrs ?? [],
      stickers: r.layout_config?.stickers ?? [],
      background: r.layout_config?.background ?? null,
    }));

  if (blocks.length === 0) return { ok: true, product: meta, preview: await galleryFallback() };

  // Cover config + images (chosen photo → admin template artwork → none).
  const { data: cfgRow } = await svc.from('albums').select('cover_config').eq('id', demoId).maybeSingle();
  const coverConfig = normalizeCoverConfig((cfgRow as { cover_config?: unknown } | null)?.cover_config as Parameters<typeof normalizeCoverConfig>[0]);

  const keyForPhoto = async (photoId: string | null): Promise<string | null> => {
    if (!photoId) return null;
    const { data } = await svc.from('photos').select('sanitized_key').eq('id', photoId).eq('album_id', demoId).eq('status', 'ready').maybeSingle();
    return (data as { sanitized_key: string | null } | null)?.sanitized_key ?? null;
  };

  let coverImageUrl: string | null = null;
  const frontKey = await keyForPhoto(coverConfig.photoId);
  if (frontKey) coverImageUrl = await presignGet(frontKey, 3600);
  if (!coverImageUrl && !coverConfig.background && album.cover_template_id) {
    const { data: coverRow } = await svc.from('cover_templates').select('image_key').eq('id', album.cover_template_id).maybeSingle();
    const key = (coverRow as { image_key: string } | null)?.image_key;
    if (key) coverImageUrl = await presignGet(key, 3600);
  }
  let backCoverImageUrl: string | null = null;
  const backKey = await keyForPhoto(coverConfig.back.photoId);
  if (backKey) backCoverImageUrl = await presignGet(backKey, 3600);

  const stickerUrls = await resolveStickerUrls([
    ...blocks.flatMap((b) => b.stickers.map((s) => s.stickerId)),
    ...coverConfig.stickers.map((s) => s.stickerId),
    ...coverConfig.back.stickers.map((s) => s.stickerId),
  ]);

  return {
    ok: true,
    product: meta,
    preview: {
      kind: 'flipbook',
      dimensions,
      size: album.size,
      title: album.title,
      photos,
      blocks,
      cover: { imageUrl: coverImageUrl, backImageUrl: backCoverImageUrl, config: coverConfig, title: album.title },
      stickerUrls,
    },
  };
}
