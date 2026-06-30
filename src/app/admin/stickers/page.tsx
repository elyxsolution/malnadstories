import { requireCapability } from '@/lib/auth/require-admin';
import { listAllStickers } from '@/lib/admin/stickers';
import StickersManager from './_stickers-manager';

/**
 * Admin sticker catalogue. Gated by requireCapability('sticker:manage') (belt to the layout
 * route-guard). Admins upload/rename/categorize/activate/delete stickers; customers place them
 * on the cover + album pages in the builder. Mirrors /admin/covers.
 */
export default async function AdminStickersPage() {
  await requireCapability('sticker:manage');
  const { stickers, categories } = await listAllStickers();

  return (
    <div className="mx-auto max-w-5xl p-6">
      <h1 className="mb-1 text-xl font-bold">Stickers</h1>
      <p className="mb-4 text-sm text-muted-foreground">
        Manage the decorative stickers customers can place on the cover and album pages. Transparent PNGs work best.
      </p>
      <StickersManager stickers={stickers} categories={categories} />
    </div>
  );
}
