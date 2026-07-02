import { listActiveStickers } from '@/lib/stickers';
import { DEFAULT_COVER_CONFIG } from '@/lib/builder/cover';
import { builderFontVars } from '@/lib/fonts';
import CoverTemplateDesigner from '../_designer';

export const dynamic = 'force-dynamic';

/** New cover-design template — opens the reused cover editor on a blank CoverConfig. */
export default async function NewCoverTemplatePage() {
  const stickerCatalog = await listActiveStickers();
  return (
    <div className={builderFontVars}>
      <CoverTemplateDesigner
        initial={{ id: null, name: '', category: 'general', featured: false, popular: false, pinned: false, config: DEFAULT_COVER_CONFIG }}
        stickerCatalog={stickerCatalog}
      />
    </div>
  );
}
