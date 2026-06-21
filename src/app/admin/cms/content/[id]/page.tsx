import { notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { contentPages } from '@/db/schema';
import { requireCmsCapability } from '@/lib/cms/access';
import { isContentType, type ContentType } from '@/lib/cms/model';
import CmsEditor from '../_editor';

export default async function EditContentPage({ params }: { params: { id: string } }) {
  await requireCmsCapability('cms:edit');

  const [row] = await db.select().from(contentPages).where(eq(contentPages.id, params.id)).limit(1);
  if (!row) notFound();

  const type: ContentType = isContentType(row.type) ? (row.type as ContentType) : 'blog';
  const metadata = (row.metadata ?? {}) as Record<string, string | number | boolean>;

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
    />
  );
}
