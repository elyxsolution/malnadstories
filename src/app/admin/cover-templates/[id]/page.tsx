import { notFound } from 'next/navigation';
import { db } from '@/db';
import { coverDesignTemplates } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { listActiveStickers } from '@/lib/stickers';
import { normalizeCoverConfig } from '@/lib/builder/cover';
import { isCoverTemplateCategory, type CoverTemplateCategory } from '@/lib/cover-templates/model';
import { builderFontVars } from '@/lib/fonts';
import CoverTemplateDesigner from '../_designer';

export const dynamic = 'force-dynamic';

/** Edit an existing cover-design template — loads its stored CoverConfig into the reused editor. */
export default async function EditCoverTemplatePage({ params }: { params: { id: string } }) {
  const [row] = await db
    .select({
      id: coverDesignTemplates.id,
      name: coverDesignTemplates.name,
      category: coverDesignTemplates.category,
      featured: coverDesignTemplates.featured,
      popular: coverDesignTemplates.popular,
      pinned: coverDesignTemplates.pinned,
      config: coverDesignTemplates.config,
    })
    .from(coverDesignTemplates)
    .where(eq(coverDesignTemplates.id, params.id))
    .limit(1);
  if (!row) notFound();

  const stickerCatalog = await listActiveStickers();
  const category: CoverTemplateCategory = isCoverTemplateCategory(row.category) ? row.category : 'general';

  return (
    <div className={builderFontVars}>
      <CoverTemplateDesigner
        initial={{
          id: row.id,
          name: row.name,
          category,
          featured: row.featured,
          popular: row.popular,
          pinned: row.pinned,
          config: normalizeCoverConfig(row.config as Parameters<typeof normalizeCoverConfig>[0]),
        }}
        stickerCatalog={stickerCatalog}
      />
    </div>
  );
}
