import { notFound } from 'next/navigation';
import { createHash } from 'crypto';
import { createServiceClient } from '@/lib/supabase/service';
import { resolveStickerUrls } from '@/lib/stickers';
import { normalizeBlueprint, applyBlueprint } from '@/lib/builder/blueprint';
import PairContent from '@/app/(app)/albums/[id]/build/_pair-frame';
import { builderFontVars } from '@/lib/fonts';
import PreviewReady from './_ready';

// Token-gated + never cached (live token check), exactly like the album print route.
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

// How many spreads to show in the thumbnail — enough to convey the album's character, cheap to render.
const PREVIEW_SPREADS = 4;

/**
 * /blueprints/[id]/preview?t=<token>
 *
 * NOT publicly accessible. Reached ONLY by the worker's headless Chromium with a short-lived token
 * (0044) — mirrors the album print route. Validates sha256(token) against the stored hash + expiry
 * (service role), then renders the blueprint's first spreads through the EXISTING renderer
 * (PairContent) with empty photo slots. Any invalid/expired token → 404, leaking nothing. This is
 * the ONLY surface that renders a blueprint headlessly; it never places real customer photos.
 */
export default async function BlueprintPreviewPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { t?: string };
}) {
  const token = searchParams.t;
  if (!token) notFound();

  const svc = createServiceClient();
  const { data } = await svc
    .from('layout_templates')
    .select('blueprint, preview_token_hash, preview_token_expires_at')
    .eq('id', params.id)
    .maybeSingle();
  const row = data as
    | { blueprint: unknown; preview_token_hash: string | null; preview_token_expires_at: string | null }
    | null;

  const tokenHash = createHash('sha256').update(token).digest('hex');
  const notExpired = !!row?.preview_token_expires_at && new Date(row.preview_token_expires_at).getTime() > Date.now();
  const valid = !!row?.preview_token_hash && row.preview_token_hash === tokenHash && notExpired && !!row.blueprint;
  if (!valid) {
    console.warn('[blueprint-preview] 404: token rejected', { blueprintId: params.id, hasRow: !!row, notExpired });
    notFound();
  }

  const bp = normalizeBlueprint(row!.blueprint);
  if (!bp) notFound();

  // Empty-slot Block[] (no customer photos) — the layout skeleton + decorative elements.
  const blocks = applyBlueprint(bp, []).slice(0, PREVIEW_SPREADS);

  // Resolve any stickers the blueprint places (by id, service role — like the print route).
  const stickerUrls = await resolveStickerUrls(blocks.flatMap((b) => b.stickers.map((s) => s.stickerId)));
  const stickerUrlFor = (id: string) => stickerUrls[id];

  return (
    <div className={`${builderFontVars} bg-white`} style={{ width: 1200, padding: 24 }}>
      <div className="grid grid-cols-2 gap-3">
        {blocks.map((b, i) => (
          <div
            key={i}
            className="overflow-hidden ring-1 ring-black/10"
            style={{ aspectRatio: '3 / 2', containerType: 'inline-size' }}
          >
            <PairContent block={b} photoFor={() => undefined} stickerUrlFor={stickerUrlFor} showPlaceholders />
          </div>
        ))}
      </div>
      <PreviewReady />
    </div>
  );
}
