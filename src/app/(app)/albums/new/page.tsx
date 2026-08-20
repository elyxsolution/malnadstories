import { listActiveProducts } from '@/lib/products/catalog';
import { listActiveTemplates, listActiveBlueprints } from '@/lib/templates/catalog';
import { brandFontVars } from '@/lib/fonts';
import WorkerPrewarm from '@/components/worker/worker-prewarm';
import CreateWizard from './_wizard';

/**
 * Album creation entry. Cover catalogs are deliberately NOT loaded here: customers no longer
 * choose a cover during onboarding — every new album receives the admin's default cover template
 * (0052), resolved server-side inside `createAlbumDraft`. The full cover catalog still loads in
 * the builder, where covers can be browsed, switched and edited.
 */
export default async function NewAlbumPage() {
  const [albumProducts, activeTemplates, activeBlueprints] = await Promise.all([
    listActiveProducts(), // physical Album Products (0047) — dimensions + previews
    listActiveTemplates(),
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
    // The geometry itself (Phase 4). Auto Create now applies the blueprint IN THE BROWSER, so a
    // photo still uploading can be placed under its optimistic id instead of being ignored until
    // the worker finishes. `applyBlueprint` is the same pure function the server action calls.
    blueprint: b.blueprint,
  }));

  // Map the active layout catalog to the engine's TemplateChoice shape so "Build it for
  // me" can draw varied, geometry-driven overlay slots (deterministic; no AI).
  const templates = activeTemplates.map((t) => ({ base: t.geometry.base, overlays: t.geometry.overlays }));

  return (
    <div className={`${brandFontVars} font-ui`}>
      {/* Pre-warm the worker: this user is about to upload photos in the wizard. */}
      <WorkerPrewarm />
      <CreateWizard albumProducts={albumProducts} templates={templates} blueprints={blueprints} />
    </div>
  );
}
