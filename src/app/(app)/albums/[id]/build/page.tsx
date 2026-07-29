import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { presignGet } from '@/lib/r2';
import { getPaidOrder } from '@/lib/orders/album-lock';
import { loadRenderReadiness } from '@/lib/albums/render-readiness';
import { getAdminContext } from '@/lib/auth/require-admin';
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
} from '@/lib/builder/model';
import { listActiveCoverOptions } from '@/lib/covers';
import { listActiveStickers, resolveStickerUrls } from '@/lib/stickers';
import { listActiveTemplates, listActiveBlueprints } from '@/lib/templates/catalog';
import { listActiveCoverTemplates } from '@/lib/cover-templates/catalog';
import { DEFAULT_COVER_CONFIG, normalizeCoverConfig } from '@/lib/builder/cover';
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
    texts?: TextElement[];
    qrs?: QrElement[];
    stickers?: StickerElement[];
    background?: Background | null;
    preset?: string;
  } | null;
};

export default async function BuildPage({ params }: { params: { id: string } }) {
  // Supabase server client: RLS "user_id = auth.uid()" scopes the SELECT. A foreign
  // or missing album → null → 404. No explicit AND(id, userId) needed.
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data } = await supabase
    .from('albums')
    .select('id, title, size, status, cover_template_id, product_id, product_name, destination, travel_dates, description')
    .eq('id', params.id)
    .maybeSingle();

  const album = data as AlbumRow | null;
  if (!album) notFound();

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
      photoIds: (r.photo_ids ?? []).filter((id) => photoIdSet.has(id)),
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
      thumbUrl: b.thumbUrl,
      blueprint: b.blueprint,
    }));

  const coverTemplates = (await listActiveCoverTemplates()).map((t) => ({
    id: t.id,
    name: t.name,
    category: t.category,
    featured: t.featured,
    popular: t.popular,
    pinned: t.pinned,
    isNew: t.isNew,
    config: t.config,
    previewUrl: t.previewUrl,
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

  // Initial preview-PDF status (album_pdfs is service-only; ownership already proven
  // by the RLS-scoped album load above). The builder polls for updates.
  const admin = createServiceClient();
  const { data: pdfRow } = await admin
    .from('album_pdfs')
    .select('status')
    .eq('album_id', album.id)
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
          cover={selectedCover ? { url: selectedCover.url, name: selectedCover.name } : null}
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
        coverTemplates={coverTemplates}
        blueprints={blueprints}
        blueprintDraftOf={blueprintDraftOf}
        blueprintMeta={blueprintMeta}
        stickerCatalog={stickerCatalog}
        stickerUrls={stickerUrls}
      />
      </DimensionsProvider>
    </div>
  );
}
