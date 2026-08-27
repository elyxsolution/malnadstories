import 'server-only';

import { createHash } from 'crypto';
import { createServiceClient } from '@/lib/supabase/service';
import { DEFAULT_PDF_KIND, type PdfKind } from './kind';

/**
 * THE PRINT-ROUTE TOKEN GATE — one implementation, shared by all three print routes.
 *
 * A print route is reached ONLY by the worker's headless Chromium carrying a short-lived,
 * single-use token. There is no session, no cookie and no RLS in play: THE TOKEN IS THE
 * AUTHORIZATION. Any invalid / expired / superseded token must 404, leaking nothing — not whether
 * the album exists, not whose it is, not whether a PDF was ever requested.
 *
 * This was previously inline in the preview route. It is extracted — verbatim, including the
 * bounded-reuse window and the diagnostic logging — because there are now three routes and three
 * copies of a security check is three chances for one of them to drift. The ONLY behavioural
 * addition is the `kind` filter: a `print_cover` token can never render `print_content`, and
 * neither can render the preview, because each kind owns its own row and therefore its own token.
 *
 * KIND SCOPING IS PART OF THE GATE, not a convenience. Without it, a token minted for one artifact
 * would authorize every artifact of that album, and a failed print export could be driven with a
 * preview token that a customer-facing flow had just created.
 */

/** Covers one PDF job's in-render requests — see the reuse note below. */
const REUSE_WINDOW_MS = 2 * 60 * 1000;

export type PrintTokenResult = { readonly ok: true } | { readonly ok: false };

/**
 * Validate a print token for one (album, kind) and stamp first use.
 *
 * Bounded-reuse window: a single `page.goto` by the worker triggers more than one request to a
 * print route (the HTML document AND Next's RSC/data fetch), so strict first-hit invalidation 404s
 * the second one. Instead the token is valid while:
 *   - the hash matches this album AND this kind, AND
 *   - it has not passed its absolute expiry (`token_expires_at`), AND
 *   - it is unused OR was first used within `REUSE_WINDOW_MS`.
 * The window is anchored to FIRST use (`token_used_at` is stamped only when null), so reuse is
 * bounded to one short burst — it can't be replayed later.
 */
export async function validatePrintToken(
  albumId: string,
  token: string | undefined,
  kind: PdfKind = DEFAULT_PDF_KIND,
): Promise<PrintTokenResult> {
  if (!token) {
    console.warn('[print] 404: no token', { albumId, kind, tokenPresent: false });
    return { ok: false };
  }

  const supabase = createServiceClient();
  const tokenHash = createHash('sha256').update(token).digest('hex');

  const { data: pdfRow } = await supabase
    .from('album_pdfs')
    .select('album_id, kind, token_hash, token_expires_at, token_used_at')
    .eq('album_id', albumId)
    .eq('kind', kind)
    .maybeSingle();

  const row = pdfRow as
    | {
        album_id: string;
        kind: string;
        token_hash: string | null;
        token_expires_at: string | null;
        token_used_at: string | null;
      }
    | null;

  // Diagnostics: the exact row (PK + expiry) the route actually loaded. With the Data Cache
  // disabled on the routes, this must match what the worker logs.
  console.log('[print] loaded album_pdfs row', {
    requestedAlbumId: albumId,
    kind,
    rowPk: row?.album_id ?? null,
    rowKind: row?.kind ?? null,
    tokenHash: row?.token_hash?.slice(0, 8) ?? null,
    tokenExpiresAt: row?.token_expires_at ?? null,
    tokenUsedAt: row?.token_used_at ?? null,
  });

  const now = Date.now();
  const usedAt = row?.token_used_at ? new Date(row.token_used_at).getTime() : null;
  const notExpired = !!row?.token_expires_at && new Date(row.token_expires_at).getTime() > now;
  const withinReuse = usedAt === null || now - usedAt <= REUSE_WINDOW_MS;

  const hashMatch = !!row?.token_hash && row.token_hash === tokenHash;
  const valid = !!row && hashMatch && notExpired && withinReuse;

  if (!valid) {
    // Log the PRECISE rejection reason before the caller returns the generic 404. (These land in
    // the Next app terminal — `pnpm dev` — not the worker terminal.) The token is never logged.
    console.warn('[print] 404: token rejected', {
      albumId,
      kind,
      tokenPresent: true,
      rowFound: !!row,
      hashMatch,
      expired: !notExpired,
      tokenExpiresAt: row?.token_expires_at ?? null,
      tokenUsedAt: row?.token_used_at ?? null,
      withinReuse,
      now: new Date(now).toISOString(),
    });
    return { ok: false };
  }

  // Anchor the window to first use only. The `.is('token_used_at', null)` guard makes this
  // idempotent + race-safe: when the document and RSC requests arrive together, both pass
  // validation, only the first stamps, and neither moves the window forward.
  if (usedAt === null) {
    await supabase
      .from('album_pdfs')
      .update({ token_used_at: new Date(now).toISOString() })
      .eq('album_id', albumId)
      .eq('kind', kind)
      .eq('token_hash', tokenHash)
      .is('token_used_at', null);
  }

  return { ok: true };
}
