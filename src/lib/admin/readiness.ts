import 'server-only';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { albums, albumPages, photos } from '@/db/schema';
import { PAGE_COST, requiredBaseCount, type LayoutTemplate } from '@/lib/builder/model';
import { hasFrontCover } from '@/lib/albums/cover';
import { normalizeCoverConfig } from '@/lib/builder/cover';

/**
 * Admin print-readiness — the SAME advisory checks the customer sees at checkout, read
 * read-only over existing data (album_pages + photos.width/height + cover/title). No
 * new state, no writes; service-side via Drizzle behind requireAdmin().
 */

export const LOWRES_MIN_EDGE = 1000; // longest-edge px below which a placed photo may print soft

export type ReadinessItem = { ok: boolean; title: string; detail: string; advisory?: boolean };
export type AlbumReadiness = { items: ReadinessItem[]; score: number; warnings: number } | null;

export async function getAlbumReadiness(albumId: string): Promise<AlbumReadiness> {
  const [album] = await db
    .select({ title: albums.title, size: albums.size, coverTemplateId: albums.coverTemplateId, coverConfig: albums.coverConfig })
    .from(albums)
    .where(eq(albums.id, albumId))
    .limit(1);
  if (!album) return null;

  const [pageRows, photoRows] = await Promise.all([
    db
      .select({ layoutTemplate: albumPages.layoutTemplate, photoIds: albumPages.photoIds, layoutConfig: albumPages.layoutConfig })
      .from(albumPages)
      .where(eq(albumPages.albumId, albumId)),
    db.select({ id: photos.id, width: photos.width, height: photos.height, status: photos.status }).from(photos).where(eq(photos.albumId, albumId)),
  ]);

  let consumed = 0;
  let emptyFrames = 0;
  const placedIds = new Set<string>();
  for (const p of pageRows) {
    const t = p.layoutTemplate as LayoutTemplate | null;
    if (!t || !(t in PAGE_COST)) continue;
    consumed += PAGE_COST[t];
    const filled = (p.photoIds ?? []).filter(Boolean);
    filled.forEach((id) => placedIds.add(id));
    const overlays = (p.layoutConfig as { overlays?: { photoId: string | null }[] } | null)?.overlays ?? [];
    overlays.forEach((o) => o.photoId && placedIds.add(o.photoId));
    emptyFrames += Math.max(0, requiredBaseCount(t) - filled.length);
  }

  const lowResCount = photoRows.filter(
    (ph) => ph.status === 'ready' && placedIds.has(ph.id) && ph.width != null && ph.height != null && Math.max(ph.width, ph.height) < LOWRES_MIN_EDGE,
  ).length;

  const structureOk = consumed === album.size;
  // Canonical cover check — recognises legacy templates, design templates, photo/background, and
  // typography covers (the single source of truth in lib/albums/cover). For this advisory panel
  // `activeTemplate` = a selected template id (no extra active/image_key round-trip needed).
  const coverOk = hasFrontCover({
    activeTemplate: !!album.coverTemplateId,
    config: normalizeCoverConfig(album.coverConfig as Parameters<typeof normalizeCoverConfig>[0]),
    title: album.title,
  });
  const titleOk = !!album.title.trim();
  const framesOk = emptyFrames === 0;
  const resOk = lowResCount === 0;

  const items: ReadinessItem[] = [
    {
      ok: structureOk,
      title: 'Album structure complete',
      detail: structureOk ? `All ${album.size} pages are laid out.` : `${consumed} of ${album.size} pages laid out.`,
    },
    {
      ok: coverOk,
      title: coverOk ? 'Cover design chosen' : 'No cover design',
      detail: coverOk ? 'A cover will be printed on page one.' : 'No cover template is selected.',
    },
    {
      ok: titleOk,
      title: titleOk ? 'Cover title set' : 'Cover title missing',
      detail: titleOk ? `“${album.title}” prints on the cover.` : 'The album has no title.',
    },
    {
      ok: framesOk,
      title: framesOk ? 'No empty frames' : `${emptyFrames} empty frame${emptyFrames === 1 ? '' : 's'}`,
      detail: framesOk ? 'Every frame has a photo.' : 'Empty frames print as blank paper.',
    },
    {
      ok: resOk,
      title: resOk ? 'Image resolution looks good' : `${lowResCount} low-resolution photo${lowResCount === 1 ? '' : 's'}`,
      detail: resOk ? 'Placed photos are large enough to print crisply.' : 'Some placed photos sit below the recommended print resolution.',
      advisory: true,
    },
  ];

  // Weighted score (advisory). Hard checks weigh more; low-res is a soft deduction.
  let score = 100;
  if (!structureOk) score -= 25;
  if (!coverOk) score -= 20;
  if (!titleOk) score -= 15;
  if (!framesOk) score -= 20;
  score -= Math.min(20, lowResCount * 5);
  score = Math.max(0, Math.min(100, score));

  return { items, score, warnings: items.filter((i) => !i.ok).length };
}
