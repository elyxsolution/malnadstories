import { listActiveProducts } from '@/lib/products/catalog';
import { listActiveCoverOptions } from '@/lib/covers';
import { listActiveTemplates, listActiveBlueprints } from '@/lib/templates/catalog';
import { listActiveCoverTemplates } from '@/lib/cover-templates/catalog';
import { brandFontVars } from '@/lib/fonts';
import WorkerPrewarm from '@/components/worker/worker-prewarm';
import CreateWizard from './_wizard';

export default async function NewAlbumPage() {
  const [albumProducts, covers, activeTemplates, coverTemplates, activeBlueprints] = await Promise.all([
    listActiveProducts(), // physical Album Products (0047) — dimensions + per-page-count pricing + previews
    listActiveCoverOptions(),
    listActiveTemplates(),
    listActiveCoverTemplates(),
    listActiveBlueprints(),
  ]);

  // Whole-album blueprints (0043) for the creation strategies (id + display fields only; apply
  // happens server-side by id). The wizard filters to the selected page count.
  const blueprints = activeBlueprints.map((b) => ({
    id: b.id,
    name: b.name,
    description: b.description,
    category: b.category,
    pageCount: b.pageCount,
    slotCount: b.slotCount,
    recommendedPhotos: b.recommendedPhotos,
    featured: b.featured,
    popular: b.popular,
    pinned: b.pinned,
    isDefault: b.isDefault,
    isNew: b.isNew,
    breakdown: b.breakdown,
    thumbUrl: b.thumbUrl,
  }));

  // Map the active layout catalog to the engine's TemplateChoice shape so "Build it for
  // me" can draw varied, geometry-driven overlay slots (deterministic; no AI).
  const templates = activeTemplates.map((t) => ({ base: t.geometry.base, overlays: t.geometry.overlays }));

  // Minimal cover-design-template options for the Format step (id + name + preview thumbnail).
  const coverTemplateOptions = coverTemplates.map((t) => ({ id: t.id, name: t.name, previewUrl: t.previewUrl }));

  return (
    <div className={`${brandFontVars} font-ui`}>
      {/* Pre-warm the worker: this user is about to upload photos in the wizard. */}
      <WorkerPrewarm />
      <CreateWizard albumProducts={albumProducts} covers={covers} coverTemplates={coverTemplateOptions} templates={templates} blueprints={blueprints} />
    </div>
  );
}
