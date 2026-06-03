import { notFound } from 'next/navigation';
import { createHash } from 'crypto';
import { createServiceClient } from '@/lib/supabase/service';
import { presignGet } from '@/lib/r2';
import PrintAlbum, { type PrintPhoto } from './_print-album';
import { LAYOUT_TEMPLATES, type Block, type EditConfig, type LayoutTemplate, type Overlay } from '@/lib/builder/model';

// No caching: this route is token-gated and renders live album data for the worker.
export const dynamic = 'force-dynamic';

type PhotoRow = { id: string; edit_config: EditConfig | null; sanitized_key: string | null };
type PageRow = {
  page_number: number;
  layout_template: string | null;
  caption: string | null;
  photo_ids: string[] | null;
  layout_config: { overlays?: Overlay[] } | null;
};

/**
 * /albums/[id]/print?t=<token>
 *
 * NOT publicly accessible. Reached only by the worker's headless Chromium with a
 * short-lived, single-use token. We validate the token (service role), mark it used,
 * then render the album via service access (the token IS the authorization here).
 * Any invalid/expired/used token → 404, leaking nothing.
 */
export default async function PrintPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { t?: string };
}) {
  const token = searchParams.t;
  if (!token) notFound();

  const supabase = createServiceClient();
  const tokenHash = createHash('sha256').update(token).digest('hex');

  // Validate: matches this album, not expired, not yet used.
  const { data: pdfRow } = await supabase
    .from('album_pdfs')
    .select('album_id, token_hash, token_expires_at, token_used_at')
    .eq('album_id', params.id)
    .maybeSingle();

  const row = pdfRow as
    | { token_hash: string | null; token_expires_at: string | null; token_used_at: string | null }
    | null;

  const valid =
    !!row &&
    !!row.token_hash &&
    row.token_hash === tokenHash &&
    !row.token_used_at &&
    !!row.token_expires_at &&
    new Date(row.token_expires_at).getTime() > Date.now();

  if (!valid) notFound();

  // Single-use: consume the token now (scoped to the matching hash).
  await supabase
    .from('album_pdfs')
    .update({ token_used_at: new Date().toISOString() })
    .eq('album_id', params.id)
    .eq('token_hash', tokenHash);

  const { data: albumData } = await supabase
    .from('albums')
    .select('id')
    .eq('id', params.id)
    .maybeSingle();
  if (!albumData) notFound();

  // Only 'ready' photos have a sanitized key; presign the full-res master (longer
  // TTL so the worker finishes within the window). Never the raw original.
  const { data: photoData } = await supabase
    .from('photos')
    .select('id, edit_config, sanitized_key, status')
    .eq('album_id', params.id)
    .eq('status', 'ready');

  const photoRows = (photoData ?? []) as PhotoRow[];
  const photos: PrintPhoto[] = await Promise.all(
    photoRows
      .filter((r) => r.sanitized_key)
      .map(async (r) => ({
        id: r.id,
        url: await presignGet(r.sanitized_key as string, 900),
        edit: r.edit_config,
      })),
  );
  const photoIdSet = new Set(photos.map((p) => p.id));

  const { data: pageData } = await supabase
    .from('album_pages')
    .select('page_number, layout_template, caption, photo_ids, layout_config')
    .eq('album_id', params.id)
    .order('page_number', { ascending: true });

  const isTemplate = (t: string | null): t is LayoutTemplate =>
    !!t && (LAYOUT_TEMPLATES as readonly string[]).includes(t);

  const blocks: Block[] = ((pageData ?? []) as PageRow[])
    .filter((r) => isTemplate(r.layout_template))
    .map((r) => ({
      key: `${r.page_number}`,
      template: r.layout_template as LayoutTemplate,
      photoIds: (r.photo_ids ?? []).filter((id) => photoIdSet.has(id)),
      caption: r.caption ?? '',
      overlays: (r.layout_config?.overlays ?? []).filter((o) => photoIdSet.has(o.photoId)),
    }));

  return <PrintAlbum blocks={blocks} photos={photos} />;
}
