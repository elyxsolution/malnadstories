import { requireCmsCapability } from '@/lib/cms/access';
import { isContentType, type ContentType } from '@/lib/cms/model';
import CmsEditor from '../_editor';
import { listBlueprintOptions } from '@/lib/cms/blueprint-options';

export default async function NewContentPage({ searchParams }: { searchParams: { type?: string } }) {
  await requireCmsCapability('cms:edit');
  const type: ContentType = isContentType(searchParams.type ?? '') ? (searchParams.type as ContentType) : 'blog';
  // Designs offered by any `blueprints` metadata field this type declares (Phase 1).
  const { options, stickerUrls } = await listBlueprintOptions();

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
      blueprintOptions={options}
      blueprintStickerUrls={stickerUrls}
    />
  );
}
