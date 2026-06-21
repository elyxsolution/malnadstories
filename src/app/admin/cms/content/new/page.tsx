import { requireCmsCapability } from '@/lib/cms/access';
import { isContentType, type ContentType } from '@/lib/cms/model';
import CmsEditor from '../_editor';

export default async function NewContentPage({ searchParams }: { searchParams: { type?: string } }) {
  await requireCmsCapability('cms:edit');
  const type: ContentType = isContentType(searchParams.type ?? '') ? (searchParams.type as ContentType) : 'blog';

  return (
    <CmsEditor
      initial={{
        id: null,
        type,
        status: 'new',
        title: '',
        slug: '',
        excerpt: '',
        content: '',
        coverImage: '',
        metadata: {},
      }}
    />
  );
}
