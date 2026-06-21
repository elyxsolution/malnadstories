import { requireTemplateCapability } from '@/lib/templates/access';
import { CATEGORY_PRESET, isTemplateCategory, type TemplateCategory } from '@/lib/templates/model';
import TemplateEditor from '../_editor';

export default async function NewTemplatePage({ searchParams }: { searchParams: { category?: string } }) {
  await requireTemplateCapability('template:edit');
  const category: TemplateCategory = isTemplateCategory(searchParams.category ?? '')
    ? (searchParams.category as TemplateCategory)
    : 'pair';

  return (
    <TemplateEditor
      initial={{
        id: null,
        name: '',
        slug: '',
        description: '',
        category,
        status: 'new',
        geometry: CATEGORY_PRESET[category],
        previewImage: '',
      }}
    />
  );
}
