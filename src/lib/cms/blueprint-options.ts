import 'server-only';
import { listPublicBlueprints } from '@/lib/blueprints/public';
import type { PickableBlueprint } from '@/app/admin/cms/content/_blueprint-picker-field';

/**
 * The designs a CMS editor can curate, plus the stickers their covers need.
 *
 * DELIBERATELY THE PUBLIC PROJECTION. The picker shows an editor exactly what a visitor will see,
 * so it should be fed exactly what a visitor is fed — same active-only filter, same cover, same
 * omission of geometry. Reusing `listPublicBlueprints` also means the admin and the site read one
 * cached catalogue rather than issuing a second query with its own subtly different rules.
 *
 * Never throws: an editor losing the picker is a degraded form, not a 500 on the content page.
 */
export async function listBlueprintOptions(): Promise<{
  options: PickableBlueprint[];
  stickerUrls: Record<string, string>;
}> {
  const { blueprints, stickerUrls } = await listPublicBlueprints();
  return {
    options: blueprints.map((b) => ({
      id: b.id,
      name: b.name,
      categoryLabel: b.categoryLabel,
      pageCount: b.pageCount,
      cover: b.cover,
    })),
    stickerUrls,
  };
}
