import { listActiveProducts } from '@/lib/products/catalog';
import { listActiveTemplates, listActiveBlueprints } from '@/lib/templates/catalog';
import { brandFontVars } from '@/lib/fonts';
import WorkerPrewarm from '@/components/worker/worker-prewarm';
import { resolveStickerUrls } from '@/lib/stickers';
import CreateWizard from './_wizard';

/** A design id is a uuid or it is not a design id. Checked before it is even compared. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Album creation entry. Cover catalogs are deliberately NOT loaded here: customers no longer
 * choose a cover during onboarding — every new album receives the admin's default cover template
 * (0052), resolved server-side inside `createAlbumDraft`. The full cover catalog still loads in
 * the builder, where covers can be browsed, switched and edited.
 *
 * ── "USE THIS DESIGN" LANDS HERE (Phase 2) ────────────────────────────────────────────────
 *
 * `?design=<id>` is what the public gallery's "Use this design" carries, and what survives a
 * login or signup round trip inside the validated `?next=`. It is CLIENT INPUT and is treated as
 * such:
 *
 *   1. it must look like a uuid at all, before anything else happens;
 *   2. it is resolved against `listActiveBlueprints()` — the SAME service-role, cached catalog
 *      every other surface uses — so an archived, deactivated or invented id resolves to nothing;
 *   3. only the RESOLVED id is handed to the wizard, and only as an id. No cover, no geometry and
 *      no metadata is accepted from the URL; the wizard re-reads all of that out of the catalog
 *      rows this page already loaded;
 *   4. `createAlbumDraft` and `applyBlueprintToAlbum` each re-resolve the id server-side again
 *      before it can affect an album. This page's check is a UX gate; those are the security ones.
 *
 * An id that does not resolve is NOT an error page and NOT a silent drop: `designUnavailable`
 * tells the wizard to say plainly that the design is no longer available, and creation continues
 * normally. A design that vanished between browsing and clicking must never produce a malformed
 * album or a stack trace.
 */
export default async function NewAlbumPage({
  searchParams,
}: {
  searchParams?: { design?: string };
}) {
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
    // The design's own front cover (Phase 0) — what a blueprint is shown as.
    cover: b.blueprint.cover ?? null,
    thumbUrl: b.thumbUrl,
    // The geometry itself (Phase 4). Auto Create now applies the blueprint IN THE BROWSER, so a
    // photo still uploading can be placed under its optimistic id instead of being ignored until
    // the worker finishes. `applyBlueprint` is the same pure function the server action calls.
    blueprint: b.blueprint,
  }));

  // THE REQUESTED DESIGN, resolved server-side against the active catalog (see the note above).
  const requested = searchParams?.design;
  const requestedId = typeof requested === 'string' && UUID.test(requested) ? requested : null;
  const initialBlueprintId = requestedId && blueprints.some((b) => b.id === requestedId) ? requestedId : null;
  const designUnavailable = requested != null && requested !== '' && initialBlueprintId === null;

  // Stickers placed on the blueprint COVERS shown in the picker — resolved by id, service-role,
  // one query for the whole catalog. Same resolver every other surface uses (Phase 0).
  const blueprintStickerUrls = await resolveStickerUrls(
    blueprints.flatMap((b) => (b.cover ? b.cover.stickers.map((s) => s.stickerId) : [])),
  );

  // Map the active layout catalog to the engine's TemplateChoice shape so "Build it for
  // me" can draw varied, geometry-driven overlay slots (deterministic; no AI).
  const templates = activeTemplates.map((t) => ({ base: t.geometry.base, overlays: t.geometry.overlays }));

  return (
    <div className={`${brandFontVars} font-ui`}>
      {/* Pre-warm the worker: this user is about to upload photos in the wizard. */}
      <WorkerPrewarm />
      <CreateWizard
        /*
         * KEYED BY THE DESIGN. Arriving at this route with a different `?design=` is a client
         * navigation to the SAME route, so React would otherwise keep the wizard mounted and
         * with it the product and page count it preselected for the PREVIOUS design. The key
         * makes "a different design" a different component instance, which is what it is.
         */
        key={initialBlueprintId ?? 'blank'}
        albumProducts={albumProducts}
        templates={templates}
        blueprints={blueprints}
        stickerUrls={blueprintStickerUrls}
        initialBlueprintId={initialBlueprintId}
        designUnavailable={designUnavailable}
      />
    </div>
  );
}
