import 'server-only';
import { createServiceClient } from '@/lib/supabase/service';
import { presignGet } from '@/lib/r2';

/**
 * Admin catalogue read for /admin/dimensions — EVERY album product (active + inactive), with
 * its prices, gallery previews, and presigned cover/gallery URLs, plus a usage count (albums +
 * orders referencing it) that drives the delete-if-unused rule. Service role (bypasses RLS);
 * the page + every mutation are gated by `product:manage`. Read-only; never writes.
 */

export type AdminProductPrice = { pageCount: number; price: number };
export type AdminProductPreview = { id: string; imageKey: string; url: string; sortOrder: number };

export type AdminProduct = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  widthCm: number;
  heightCm: number;
  printWidthCm: number;
  printHeightCm: number;
  builderAspectRatio: number;
  displayOrder: number;
  isDefault: boolean;
  isActive: boolean;
  coverPreviewKey: string | null;
  coverPreviewUrl: string | null;
  prices: AdminProductPrice[]; // ascending page count
  previews: AdminProductPreview[]; // ascending sort order
  usedBy: number; // albums + orders referencing this product (0 → deletable)
  demoAlbumId: string | null; // assigned demo album for the interactive preview (0048)
  demoAlbumTitle: string | null;
  bestFor: string[]; // marketing tags (0048)
};

const num = (v: unknown): number => Number(v ?? 0);

export async function listAllProductsForAdmin(): Promise<AdminProduct[]> {
  const svc = createServiceClient();
  const { data: products } = await svc
    .from('album_products')
    .select(
      'id, name, slug, description, width_cm, height_cm, print_width_cm, print_height_cm, builder_aspect_ratio, display_order, is_default, is_active, cover_preview_key, demo_album_id, best_for',
    )
    .order('display_order', { ascending: true })
    .order('created_at', { ascending: false });

  const rows = (products ?? []) as Record<string, unknown>[];
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id as string);

  const [{ data: priceRows }, { data: previewRows }, { data: albumRefs }, { data: orderRefs }] = await Promise.all([
    svc.from('album_product_prices').select('product_id, page_count, price').in('product_id', ids).order('page_count', { ascending: true }),
    svc.from('album_product_previews').select('id, product_id, image_key, sort_order').in('product_id', ids).order('sort_order', { ascending: true }),
    svc.from('albums').select('product_id').in('product_id', ids),
    svc.from('orders').select('product_id').in('product_id', ids),
  ]);

  const pricesByProduct = new Map<string, AdminProductPrice[]>();
  for (const p of (priceRows ?? []) as { product_id: string; page_count: number; price: unknown }[]) {
    const list = pricesByProduct.get(p.product_id) ?? [];
    list.push({ pageCount: p.page_count, price: num(p.price) });
    pricesByProduct.set(p.product_id, list);
  }
  const previewsByProduct = new Map<string, AdminProductPreview[]>();
  const usage = new Map<string, number>();
  for (const r of (albumRefs ?? []) as { product_id: string | null }[]) if (r.product_id) usage.set(r.product_id, (usage.get(r.product_id) ?? 0) + 1);
  for (const r of (orderRefs ?? []) as { product_id: string | null }[]) if (r.product_id) usage.set(r.product_id, (usage.get(r.product_id) ?? 0) + 1);

  // Presign every preview + cover (small catalogue). Grouped per product.
  await Promise.all(
    ((previewRows ?? []) as { id: string; product_id: string; image_key: string; sort_order: number }[]).map(async (p) => {
      const list = previewsByProduct.get(p.product_id) ?? [];
      list.push({ id: p.id, imageKey: p.image_key, url: await presignGet(p.image_key, 3600), sortOrder: p.sort_order });
      previewsByProduct.set(p.product_id, list);
    }),
  );

  // Resolve demo album titles in one query.
  const demoIds = rows.map((r) => r.demo_album_id as string | null).filter((v): v is string => !!v);
  const demoTitles = new Map<string, string>();
  if (demoIds.length) {
    const { data: demoRows } = await svc.from('albums').select('id, title').in('id', demoIds);
    for (const d of (demoRows ?? []) as { id: string; title: string }[]) demoTitles.set(d.id, d.title);
  }

  return Promise.all(
    rows.map(async (r) => {
      const coverKey = (r.cover_preview_key as string | null) ?? null;
      const demoAlbumId = (r.demo_album_id as string | null) ?? null;
      return {
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
        coverPreviewKey: coverKey,
        coverPreviewUrl: coverKey ? await presignGet(coverKey, 3600) : null,
        prices: pricesByProduct.get(r.id as string) ?? [],
        previews: previewsByProduct.get(r.id as string) ?? [],
        usedBy: usage.get(r.id as string) ?? 0,
        demoAlbumId,
        demoAlbumTitle: demoAlbumId ? demoTitles.get(demoAlbumId) ?? null : null,
        bestFor: (r.best_for as string[] | null) ?? [],
      };
    }),
  );
}

export async function getProductForAdmin(id: string): Promise<AdminProduct | null> {
  const all = await listAllProductsForAdmin();
  return all.find((p) => p.id === id) ?? null;
}
