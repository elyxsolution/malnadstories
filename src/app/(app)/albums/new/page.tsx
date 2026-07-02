import { db } from '@/db';
import { products } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { listActiveCoverOptions } from '@/lib/covers';
import { listActiveTemplates } from '@/lib/templates/catalog';
import { listActiveCoverTemplates } from '@/lib/cover-templates/catalog';
import { brandFontVars } from '@/lib/fonts';
import WorkerPrewarm from '@/components/worker/worker-prewarm';
import CreateWizard from './_wizard';

export default async function NewAlbumPage() {
  const [activeProducts, covers, activeTemplates, coverTemplates] = await Promise.all([
    db
      .select({
        id: products.id,
        name: products.name,
        pages: products.pages,
        basePrice: products.basePrice,
      })
      .from(products)
      .where(eq(products.isActive, true))
      .orderBy(products.pages),
    listActiveCoverOptions(),
    listActiveTemplates(),
    listActiveCoverTemplates(),
  ]);

  // Map the active layout catalog to the engine's TemplateChoice shape so "Build it for
  // me" can draw varied, geometry-driven overlay slots (deterministic; no AI).
  const templates = activeTemplates.map((t) => ({ base: t.geometry.base, overlays: t.geometry.overlays }));

  // Minimal cover-design-template options for the Format step (id + name + preview thumbnail).
  const coverTemplateOptions = coverTemplates.map((t) => ({ id: t.id, name: t.name, previewUrl: t.previewUrl }));

  return (
    <div className={`${brandFontVars} font-ui`}>
      {/* Pre-warm the worker: this user is about to upload photos in the wizard. */}
      <WorkerPrewarm />
      <CreateWizard products={activeProducts} covers={covers} coverTemplates={coverTemplateOptions} templates={templates} />
    </div>
  );
}
