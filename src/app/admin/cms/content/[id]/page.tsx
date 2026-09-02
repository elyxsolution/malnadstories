import { notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { contentPages } from '@/db/schema';
import { requireCmsCapability } from '@/lib/cms/access';
import { isContentType, type ContentType } from '@/lib/cms/model';
import CmsEditor from '../_editor';
import { listBlueprintOptions } from '@/lib/cms/blueprint-options';

export default async function EditContentPage({ params }: { params: { id: string } }) {
  await requireCmsCapability('cms:edit');

  const [row] = await db.select().from(contentPages).where(eq(contentPages.id, params.id)).limit(1);
  if (!row) notFound();

  const type: ContentType = isContentType(row.type) ? (row.type as ContentType) : 'blog';
  // Includes entity-reference lists (Phase 1) as well as scalars.
  const metadata = (row.metadata ?? {}) as Record<string, string | number | boolean | string[]>;
  const { options, stickerUrls } = await listBlueprintOptions();

  return (
    <CmsEditor
      initial={{
        id: row.id,
        type,
        status: row.status,
        title: row.title,
        slug: row.slug,
        excerpt: row.excerpt ?? '',
        content: row.content ?? '',
        coverImage: row.coverImage ?? '',
        metadata,
      }}
      blueprintOptions={options}
      blueprintStickerUrls={stickerUrls}
    />
  );
}
