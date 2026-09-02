import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { presignGet } from '@/lib/r2';
import { getPaidOrder } from '@/lib/orders/album-lock';
import { loadRenderReadiness } from '@/lib/albums/render-readiness';
import { getAdminContext } from '@/lib/auth/require-admin';
import { resolveAlbumWriteAccess } from '@/lib/albums/access';
import { adminUserEmail } from '@/lib/admin/users';
import { roleHasCapability } from '@/lib/auth/capabilities';
import Builder from './_builder';
import PurchasedAlbum from './_purchased';
import { DimensionsProvider } from './_dimensions';
import { getProductDimensions } from '@/lib/products/catalog';
import { FALLBACK_DIMENSIONS } from '@/lib/products/model';
import WorkerPrewarm from '@/components/worker/worker-prewarm';
import type { Photo } from '@/lib/builder/photo';
import {
  LAYOUT_TEMPLATES,
  type Background,
  type Block,
  type EditConfig,
  type LayoutTemplate,
  type Overlay,
  type QrElement,
  type StickerElement,
  type TextElement,
  trimBaseIds,
} from '@/lib/builder/model';
import { listActiveCoverOptions } from '@/lib/covers';
import { listActiveStickers, resolveStickerUrls } from '@/lib/stickers';
import { listActiveTemplates, listActiveBlueprints } from '@/lib/templates/catalog';

import { DEFAULT_COVER_CONFIG, normalizeCoverConfig } from '@/lib/builder/cover';
import { resolveCoverImageKeys } from '@/lib/albums/cover';
import { builderFontVars } from '@/lib/fonts';

type AlbumRow = {
  id: string;
  title: string;
  size: number;
  status: string;
  cover_template_id: string | null;
  product_id: string | null;
  product_name: string | null;
  destination: string | null;
  travel_dates: string | null;
  description: string | null;
};
type PhotoRow = {
  id: string;
  original_filename: string;
  edit_config: EditConfig | null;
  status: 'pending' | 'ready' | 'rejected';
  sanitized_key: string | null;
  thumb_key: string | null;
  taken_at: string | null;
  width: number | null;
  height: number | null;
};
type PageRow = {
  page_number: number;
  layout_template: string | null;
  caption: string | null;
  photo_ids: string[] | null;
  layout_config: {
    overlays?: Overlay[];
    /** Per-base-slot placement edits (see `Block.baseEdits`). Absent on every pre-existing row. */
    baseEdits?: (EditConfig | null)[];
    texts?: TextElement[];
    qrs?: QrElement[];
    stickers?: StickerElement[];
    background?: Background | null;
    /** The unified stacking order (see `lib/builder/layers`). Absent ⇒ the legacy family order. */
    layerOrder?: string[];
    preset?: string;
  } | null;
};

export default async function BuildPage({ params }: { params: { id: string } }) {
  // Supabase server client: RLS "user_id = auth.uid()" scopes the SELECT. A foreign
  // or missing album → null. No explicit AND(id, userId) needed.
  const userClient = createClient();
  const {
    data: { user },
  } = await userClient.auth.getUser();

  const ALBUM_COLUMNS =
    'id, title, size, status, cover_template_id, product_id, product_name, destination, travel_dates, description';

  const { data } = await userClient.from('albums').select(ALBUM_COLUMNS).eq('id', params.id).maybeSingle();
  let album = data as AlbumRow | null;

  /**
   * ── ADMIN EDITING: THE SAME BUILDER, NOT A SECOND ONE ──────────────────────────────────────
   *
   * An administrator reviewing a submitted album could see it and approve it, but not fix a
   * crooked photo in it — the workflow for a two-second correction was "send it back to the
   * customer". So an authorised admin opens THIS route, on the customer's album, and gets the
   * real builder: same state model, same canvas, same save actions, same PDF pipeline. There is
   * deliberately no admin album editor, because a second editor is a second thing to keep in step
   * with the renderer and the print export.
   *
   * AUTHORIZATION IS SERVER-SIDE AND IS THE EXISTING GATE. The customer path is completely
   * untouched: RLS answers first, and for an owner this branch never runs. Only a null result
   * asks the second question, of `resolveAlbumWriteAccess` — `profiles.role = 'admin'` (locked by
   * 0019, resolved through the Drizzle superuser) plus the `album:manage` capability, exactly the
   * gate that already authorises the admin album console and admin PDF generation. Anyone else,
   * including a signed-in customer who guesses the URL, gets the same 404 they always did. Hiding
   * the entry button would not be a boundary; this is.
   *
   * The album's SAVED STATE is the source of truth throughout: the admin's edits go through the
   * same `saveLayout` / `savePhotoEdit` / `saveCoverDesign` (which resolve the same access), and
   * the PDF is rendered by the worker from the database rows those actions wrote — never from a
   * client snapshot. So "generate the PDF after editing" needs no special admin path at all.
   */
  const adminAccess = album ? null : await resolveAlbumWriteAccess(params.id);
  if (!album && adminAccess?.actor === 'admin') {
    const { data: adminRow } = await adminAccess.client
      .from('albums')
      .select(ALBUM_COLUMNS)
      .eq('id', params.id)
      .maybeSingle();
    album = adminRow as AlbumRow | null;
  }
  if (!album) notFound();

  /**
   * EVERY READ ON THIS PAGE goes through this client. For a customer it is the RLS-scoped one and
   * nothing changes; for an authorised admin it is the service-role client, because the album,
   * photos and pages being loaded belong to someone else. Every query below is already pinned to
   * `album.id`, which is what keeps the admin session scoped to the one album they opened.
   */
  const supabase = adminAccess?.actor === 'admin' ? adminAccess.client : userClient;
  const adminEditing = adminAccess?.actor === 'admin';
  // Whose album this is, for the admin banner. Read only in the admin branch, and only to display.
  const ownerLabel = adminEditing && adminAccess?.ownerId ? await adminUserEmail(adminAccess.ownerId) : null;

  // Physical dimensions of the album's product (Phase B) — the single geometry source for the
  // whole builder tree. Null/legacy albums fall back to the legacy 6×8in, unchanged. Provided
  // via DimensionsProvider so every builder/preview/flipbook/cover component reads the same values.
  const dimensions = (await getProductDimensions(album.product_id)) ?? FALLBACK_DIMENSIONS;

  // Authoritative purchase check (orders.status ∈ PAID_STATES, RLS-scoped). When the
  // album is purchased we render a READ-ONLY experience instead of the editable
  // builder — no edit/submit/checkout controls (Parts 3–5). The DB is the source of
  // truth; this is decided server-side, never from client state.
  const paidOrder = await getPaidOrder(supabase, album.id);

  // Photos (RLS-scoped), auto-ordered by EXIF capture date (PRD auto-organise),
  // nulls last. We presign only the SANITIZED derivatives — never the raw original.
  // 'pending'/'rejected' photos have no usable URL yet.
  const { data: photoData } = await supabase
    .from('photos')
    .select('id, original_filename, edit_config, status, sanitized_key, thumb_key, taken_at, width, height')
    .eq('album_id', album.id)
    .order('taken_at', { ascending: true, nullsFirst: false })
    .order('uploaded_at', { ascending: true });

  const photoRows = (photoData ?? []) as PhotoRow[];
  const photos: Photo[] = await Promise.all(
    photoRows.map(async (r) => ({
      id: r.id,
      url: r.status === 'ready' && r.sanitized_key ? await presignGet(r.sanitized_key) : '',
      thumbUrl: r.status === 'ready' && r.thumb_key ? await presignGet(r.thumb_key) : '',
      filename: r.original_filename,
      edit: r.edit_config,
      status: r.status,
      takenAt: r.taken_at,
      width: r.width,
      height: r.height,
    })),
  );
  const photoIdSet = new Set(photos.map((p) => p.id));

  // Saved layout → blocks (RLS-scoped via parent album). photo_ids holds the base
  // slot; overlays live in layout_config.overlays. Drop any id whose photo was
  // since deleted so stale references don't render as broken slots.
  const { data: pageData } = await supabase
    .from('album_pages')
    .select('page_number, layout_template, caption, photo_ids, layout_config')
    .eq('album_id', album.id)
    .order('page_number', { ascending: true });

  const isTemplate = (t: string | null): t is LayoutTemplate =>
    !!t && (LAYOUT_TEMPLATES as readonly string[]).includes(t);

  const initialBlocks: Block[] = ((pageData ?? []) as PageRow[])
    .filter((r) => isTemplate(r.layout_template))
    .map((r) => ({
      key: crypto.randomUUID(),
      template: r.layout_template as LayoutTemplate,
      // Vacate the slot of a photo that no longer exists — never compact the row, or the right
      // page's photo slides onto the left. `trimBaseIds` drops trailing holes only.
      photoIds: trimBaseIds((r.photo_ids ?? []).map((id) => (id && photoIdSet.has(id) ? id : null))),
      // A slot's edit belongs to the PLACEMENT, so it comes back positionally with the slot. It is
      // deliberately NOT vacated when the photo is gone: the slot itself is vacated above, and an
      // edit at an empty index is inert (nothing renders it) — clearing it would throw away the
      // customer's framing if the same photo were dropped back in.
      baseEdits: r.layout_config?.baseEdits,
      caption: r.caption ?? '',
      // Keep every overlay CONTAINER; only its photo assignment is provisional. A slot that is
      // an intentional placeholder (photoId=null) OR whose photo was since deleted hydrates as an
      // EMPTY overlay (photoId=null) — the geometry is preserved, never dropped. This is what
      // makes a blueprint's overlay slots survive edit-open, and a deleted-photo overlay stay
      // refillable instead of vanishing. Text/QR/background carry no photo refs (verbatim).
      overlays: (r.layout_config?.overlays ?? []).map((o) =>
        o.photoId && photoIdSet.has(o.photoId) ? o : { ...o, photoId: null },
      ),
      texts: r.layout_config?.texts ?? [],
      qrs: r.layout_config?.qrs ?? [],
      stickers: r.layout_config?.stickers ?? [],
      background: r.layout_config?.background ?? null,
      // The unified stacking order rides through verbatim. It is a permutation of ids the
      // element arrays already hold, so a stale id names nothing and is ignored by `layerStack`
      // — there is nothing to reconcile here.
      layerOrder: r.layout_config?.layerOrder,
      preset: r.layout_config?.preset,
    }));

  // Active cover designs (admin-managed; RLS exposes only active rows), with thumbnail
  // + full URLs. The album's stored cover is resolved from this list for the preview.
  const covers = await listActiveCoverOptions();
  let selectedCover = covers.find((c) => c.id === album.cover_template_id) ?? null;

  // Active layout-template catalog (Phase 9E). Advisory presets the builder + auto-layout
  // can apply; only ACTIVE + geometry-valid templates are returned. Never gates anything.
  const layoutTemplates = await listActiveTemplates();

  // Active cover-DESIGN templates (Task 2) — the in-builder "Cover Templates" panel. Only the
  // fields the panel needs; applying one copies its config into cover_config (no link kept).
  // Admin capability gate (content/super_admin): decides whether to check for Blueprint Mode below.
  // Only an admin can ever open a blueprint-draft album, so a non-admin simply never enters it.
  let canEditBlueprint = false;
  try {
    const ctx = await getAdminContext();
    canEditBlueprint = roleHasCapability(ctx.role, 'template:edit');
  } catch {
    canEditBlueprint = false;
  }

  // Blueprint EDIT mode (0046): if this album is a blueprint draft, the builder "Save" updates the
  // SAME blueprint. Resilient best-effort read — a not-yet-migrated column returns an error (not a
  // throw), so the builder still loads normally for every other album.
  let blueprintDraftOf: string | null = null;
  let blueprintMeta: { name: string; isDefault: boolean; featured: boolean; pinned: boolean; status: string; updatedAt: string } | null = null;
  if (canEditBlueprint) {
    const { data: draftRow } = await supabase.from('albums').select('blueprint_draft_of').eq('id', album.id).maybeSingle();
    blueprintDraftOf = (draftRow as { blueprint_draft_of?: string | null } | null)?.blueprint_draft_of ?? null;
    // In blueprint-edit mode, load the blueprint's identity for the builder's "Blueprint Mode" badge.
    // Service role: the draft is inactive (not RLS-readable by the authenticated client) and this
    // branch is already admin-gated (canEditBlueprint).
    if (blueprintDraftOf) {
      const svc = createServiceClient();
      const { data: bpRow } = await svc
        .from('layout_templates')
        .select('name, is_default, featured, pinned, status, updated_at')
        .eq('id', blueprintDraftOf)
        .maybeSingle();
      const b = bpRow as
        | { name: string; is_default: boolean; featured: boolean; pinned: boolean; status: string; updated_at: string }
        | null;
      if (b) {
        blueprintMeta = {
          name: b.name,
          isDefault: b.is_default,
          featured: b.featured,
          pinned: b.pinned,
          status: b.status,
          updatedAt: b.updated_at,
        };
      }
    }
  }

  // Active whole-album Blueprints for THIS album size — the builder's "Build it for me" now offers
  // the SAME Auto Create / Choose Blueprint / Custom workflow as the creation wizard (reused).
  const blueprints = (await listActiveBlueprints())
    .filter((b) => b.pageCount === album.size)
    .map((b) => ({
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
      blueprint: b.blueprint,
    }));

  // Custom cover design (0038). Best-effort secondary read: if the `cover_config` column
  // isn't migrated yet, supabase-js returns an error (not a throw) → we keep defaults, so
  // the builder still loads. After the migration it hydrates the saved design.
  let initialCoverConfig = DEFAULT_COVER_CONFIG;
  {
    const { data: cc } = await supabase.from('albums').select('cover_config').eq('id', album.id).maybeSingle();
    const raw = (cc as { cover_config?: unknown } | null)?.cover_config;
    if (raw) initialCoverConfig = normalizeCoverConfig(raw as Parameters<typeof normalizeCoverConfig>[0]);
  }

  // Sticker catalog (active, grouped — for the builder's Stickers panel) + presigned URLs for the
  // stickers ALREADY placed on the pages/cover (service-role, so a deactivated-but-placed sticker
  // still renders). The two combine into the builder's id→url resolver.
  const stickerCatalog = await listActiveStickers();
  const referencedStickerIds = [
    ...initialBlocks.flatMap((b) => b.stickers.map((s) => s.stickerId)),
    ...initialCoverConfig.stickers.map((s) => s.stickerId),
    ...initialCoverConfig.back.stickers.map((s) => s.stickerId),
    // Stickers on the COVERS of the blueprints offered by "Build it for me" (Phase 0). Those
    // covers are drawn live in the picker, so their stickers need resolving here alongside the
    // album's own — same call, same resolver, no extra round trip.
    ...blueprints.flatMap((b) => (b.cover ? b.cover.stickers.map((s) => s.stickerId) : [])),
  ];
  const stickerUrls = await resolveStickerUrls(referencedStickerIds);

  // The album may reference a now-INACTIVE (soft-deleted) cover. It still renders in the
  // PDF (the print route resolves by id regardless of active), so resolve it for the
  // preview too — even though it won't appear in the active "Change cover" grid. RLS
  // hides inactive rows from the user client, so read it via the service role.
  if (!selectedCover && album.cover_template_id) {
    const svc = createServiceClient();
    const { data: c } = await svc
      .from('cover_templates')
      .select('name, image_key')
      .eq('id', album.cover_template_id)
      .maybeSingle();
    const row = c as { name: string; image_key: string } | null;
    if (row) {
      const url = await presignGet(row.image_key, 3600);
      selectedCover = { id: album.cover_template_id, name: row.name, description: null, url, thumbUrl: url };
    }
  }

  /**
   * The cover's printable image(s), through the CANONICAL resolver — the same one the print route
   * and checkout use, so the post-purchase view cannot show a different cover from the one in the
   * PDF. Front follows the priority chain (customer photo → chosen artwork → none, which the
   * renderer draws from CSS); back uses its own photo only.
   */
  const coverKeys = await resolveCoverImageKeys(supabase, {
    id: album.id,
    cover_template_id: album.cover_template_id,
    cover_config: initialCoverConfig,
  });
  const coverFrontImageUrl = coverKeys.front.key ? await presignGet(coverKeys.front.key, 3600) : null;
  const coverBackImageUrl = coverKeys.back.key ? await presignGet(coverKeys.back.key, 3600) : null;

  // Initial preview-PDF status (album_pdfs is service-only; ownership already proven
  // by the RLS-scoped album load above). The builder polls for updates.
  const admin = createServiceClient();
  const { data: pdfRow } = await admin
    .from('album_pdfs')
    .select('status')
    .eq('album_id', album.id)
    // The PREVIEW artifact (0058) — the only PDF a customer ever sees.
    .eq('kind', 'preview')
    .maybeSingle();
  const initialPdfStatus = ((pdfRow as { status: string } | null)?.status ?? 'idle') as
    | 'idle'
    | 'generating'
    | 'ready'
    | 'failed';

  // Phase 9C — current album review (advisory). album_reviews is service-only (ownership
  // already proven by the RLS-scoped album load above). The latest active revision's
  // requested-changes drives the builder banner. Never gates editing/checkout.
  let initialReview: {
    status: string;
    requestedChanges: string | null;
    requestedAt: string | null;
    revisionNumber: number;
  } | null = null;
  {
    const { data: reviewRow } = await admin
      .from('album_reviews')
      .select('id, status')
      .eq('album_id', album.id)
      .maybeSingle();
    const rv = reviewRow as { id: string; status: string } | null;
    if (rv) {
      let requestedChanges: string | null = null;
      let requestedAt: string | null = null;
      let revisionNumber = 1;
      if (rv.status === 'changes_requested') {
        const { data: rev } = await admin
          .from('revision_requests')
          .select('requested_changes, created_at')
          .eq('album_review_id', rv.id)
          .in('status', ['open', 'in_progress', 'resubmitted'])
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        const revRow = rev as { requested_changes: string; created_at: string } | null;
        requestedChanges = revRow?.requested_changes ?? null;
        requestedAt = revRow?.created_at ?? null;
        // Revision number = how many change-request loops this album has been through.
        const { count } = await admin
          .from('revision_requests')
          .select('id', { count: 'exact', head: true })
          .eq('album_review_id', rv.id);
        revisionNumber = count ?? 1;
      }
      initialReview = { status: rv.status, requestedChanges, requestedAt, revisionNumber };
    }
  }

  // A paid album is normally READ-ONLY (PurchasedAlbum) — UNLESS an admin has requested
  // changes, which reopens editing (CHANGE 6/7). This mirrors `isEditingLocked` exactly:
  // paid + review 'changes_requested' ⇒ editable; every other paid state ⇒ frozen. When
  // reopened we fall through to the editable Builder, which shows the requested-changes
  // banner (initialReview) so the customer knows what to fix before resubmitting.
  const reopenedForChanges = initialReview?.status === 'changes_requested';

  // Render-readiness SNAPSHOT for the in-builder diagnostics (review mode only, to avoid the cost on
  // ordinary edits). Consumed by the shared PrintDiagnostics — the Builder never recomputes render
  // logic; it reuses the centralized loader. A snapshot at load is fine: the review card is the
  // customer's entry point to fix the requested changes.
  const initialRenderReadiness = reopenedForChanges ? await loadRenderReadiness(supabase, album.id) : null;

  if (paidOrder && !reopenedForChanges) {
    return (
      <div className={`${builderFontVars} brand-surface min-h-[calc(100vh-3.5rem)] font-ui`}>
        <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:py-10">
        <DimensionsProvider dimensions={dimensions}>
        <PurchasedAlbum
          albumId={album.id}
          title={album.title}
          size={album.size}
          order={{ id: paidOrder.id, status: paidOrder.status }}
          photos={photos}
          blocks={initialBlocks}
          /* The customer's DESIGN, resolved exactly as the builder resolves it: their cover photo
             wins, then the chosen artwork, then the CSS/brand backdrop the renderer draws. */
          cover={{
            config: initialCoverConfig,
            title: album.title,
            size: album.size,
            frontImageUrl: coverFrontImageUrl,
            backImageUrl: coverBackImageUrl,
          }}
          stickerUrls={stickerUrls}
          initialPdfStatus={initialPdfStatus}
        />
        </DimensionsProvider>
        </div>
      </div>
    );
  }

  return (
    <div className={`${builderFontVars} builder-studio font-ui`}>
      {/* Opportunistic worker pre-warm (≤ once / 10 min): the user is in the builder
          and will likely upload or generate a PDF soon, so wake the worker early. */}
      <WorkerPrewarm />
      <DimensionsProvider dimensions={dimensions}>
      <Builder
        albumId={album.id}
        title={album.title}
        size={album.size}
        email={user?.email ?? ''}
        productName={album.product_name}
        destination={album.destination}
        travelDates={album.travel_dates}
        description={album.description}
        initialStatus={album.status}
        initialPhotos={photos}
        initialBlocks={initialBlocks}
        covers={covers}
        initialCoverId={album.cover_template_id}
        initialCoverConfig={initialCoverConfig}
        initialReview={initialReview}
        initialRenderReadiness={initialRenderReadiness}
        layoutTemplates={layoutTemplates}
        blueprints={blueprints}
        blueprintDraftOf={blueprintDraftOf}
        blueprintMeta={blueprintMeta}
        stickerCatalog={stickerCatalog}
        stickerUrls={stickerUrls}
        /* Presentational only — the authorization is the server-side gate above and in each action. */
        adminEditing={adminEditing}
        ownerName={adminEditing ? ownerLabel : null}
      />
      </DimensionsProvider>
    </div>
  );
}
