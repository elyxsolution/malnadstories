import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { presignGet } from '@/lib/r2';
import { getPaidOrder } from '@/lib/orders/album-lock';
import Builder from './_builder';
import PurchasedAlbum from './_purchased';
import WorkerPrewarm from '@/components/worker/worker-prewarm';
import { type Photo } from './_uploader';
import { LAYOUT_TEMPLATES, type Block, type EditConfig, type LayoutTemplate, type Overlay } from '@/lib/builder/model';
import { listActiveCoverOptions } from '@/lib/covers';
import { brandFontVars } from '@/lib/fonts';

type AlbumRow = { id: string; title: string; size: number; status: string; cover_template_id: string | null };
type PhotoRow = {
  id: string;
  original_filename: string;
  edit_config: EditConfig | null;
  status: 'pending' | 'ready' | 'rejected';
  sanitized_key: string | null;
  thumb_key: string | null;
  taken_at: string | null;
};
type PageRow = {
  page_number: number;
  layout_template: string | null;
  caption: string | null;
  photo_ids: string[] | null;
  layout_config: { overlays?: Overlay[] } | null;
};

export default async function BuildPage({ params }: { params: { id: string } }) {
  // Supabase server client: RLS "user_id = auth.uid()" scopes the SELECT. A foreign
  // or missing album → null → 404. No explicit AND(id, userId) needed.
  const supabase = createClient();

  const { data } = await supabase
    .from('albums')
    .select('id, title, size, status, cover_template_id')
    .eq('id', params.id)
    .maybeSingle();

  const album = data as AlbumRow | null;
  if (!album) notFound();

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
    .select('id, original_filename, edit_config, status, sanitized_key, thumb_key, taken_at')
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
      overlays: (r.layout_config?.overlays ?? []).filter((o) => photoIdSet.has(o.photoId)),
    }));

  // Active cover designs (admin-managed; RLS exposes only active rows), with thumbnail
  // + full URLs. The album's stored cover is resolved from this list for the preview.
  const covers = await listActiveCoverOptions();
  let selectedCover = covers.find((c) => c.id === album.cover_template_id) ?? null;

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

  if (paidOrder) {
    return (
      <div className={`${brandFontVars} brand-surface min-h-[calc(100vh-3.5rem)] font-ui`}>
        <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:py-10">
        <PurchasedAlbum
          albumId={album.id}
          title={album.title}
          size={album.size}
          order={{ id: paidOrder.id, status: paidOrder.status }}
          photos={photos}
          blocks={initialBlocks}
          cover={selectedCover ? { url: selectedCover.url, name: selectedCover.name } : null}
          initialPdfStatus={initialPdfStatus}
        />
        </div>
      </div>
    );
  }

  return (
    <div className={`${brandFontVars} builder-studio min-h-[calc(100vh-3.5rem)] font-ui`}>
      {/* Opportunistic worker pre-warm (≤ once / 10 min): the user is in the builder
          and will likely upload or generate a PDF soon, so wake the worker early. */}
      <WorkerPrewarm />
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:py-8">
      <Builder
        albumId={album.id}
        title={album.title}
        size={album.size}
        initialStatus={album.status}
        initialPhotos={photos}
        initialBlocks={initialBlocks}
        covers={covers}
        initialCoverId={album.cover_template_id}
      />
      </div>
    </div>
  );
}
