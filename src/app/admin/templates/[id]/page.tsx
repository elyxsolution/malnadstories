import { notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { layoutTemplates } from '@/db/schema';
import { requireTemplateCapability } from '@/lib/templates/access';
import { normalizeGeometry, isTemplateCategory, type TemplateCategory } from '@/lib/templates/model';
import TemplateEditor from '../_editor';

export default async function EditTemplatePage({ params }: { params: { id: string } }) {
  await requireTemplateCapability('template:edit');

  const [row] = await db.select().from(layoutTemplates).where(eq(layoutTemplates.id, params.id)).limit(1);
  if (!row) notFound();

  const category: TemplateCategory = isTemplateCategory(row.category) ? (row.category as TemplateCategory) : 'pair';

  return (
    <TemplateEditor
      initial={{
        id: row.id,
        name: row.name,
        slug: row.slug,
        description: row.description ?? '',
        category,
        status: row.status,
        geometry: normalizeGeometry(row.geometry),
        previewImage: row.previewImage ?? '',
      }}
    />
  );
}
