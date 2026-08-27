import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { LAYOUT_TEMPLATES, PAGE_COST, type LayoutTemplate } from '@/lib/builder/model';

/**
 * PRINT PRE-FLIGHT — the page-count invariant, checked before a print job is ever enqueued.
 *
 * An album's `size` IS its content page count: every `album_pages` row is a two-page unit, and a
 * complete album satisfies `Σ PAGE_COST = size`. The printer-ready interior must therefore contain
 * exactly `size` pages — a file with the wrong number of leaves is not a smaller book, it is an
 * unbindable one, and a print partner would discover that after the paper is cut.
 *
 * The content route enforces this too (it is the backstop a stale token cannot bypass), but a 404
 * there surfaces to an admin only as a generic `print_route_error`. Checking here means the admin
 * gets a specific, readable refusal in the UI before a Chromium render is scheduled.
 *
 * Read with whichever client the caller already holds — the generator uses the service role,
 * because print generation is a backend workflow the caller has already authorized.
 */

export type PreflightResult = { readonly ok: true; readonly pages: number } | { readonly ok: false; readonly error: string };

/**
 * Verify that the album's SAVED layout accounts for exactly `size` content pages.
 *
 * Deliberately re-reads the database rather than trusting anything in memory: this is the same
 * data the print route will render, and the point of the check is that the two agree.
 */
export async function assertPrintablePageCount(
  svc: SupabaseClient,
  albumId: string,
): Promise<PreflightResult> {
  const { data: albumRow, error: albumErr } = await svc
    .from('albums')
    .select('size')
    .eq('id', albumId)
    .maybeSingle();
  if (albumErr || !albumRow) return { ok: false, error: 'Album not found.' };
  const size = (albumRow as { size: number }).size;

  const { data: pageData, error: pagesErr } = await svc
    .from('album_pages')
    .select('layout_template')
    .eq('album_id', albumId);
  // Fail CLOSED. A read error here must not be mistaken for "the layout is fine" — the whole
  // purpose of this gate is to refuse when we cannot prove the page count.
  if (pagesErr) return { ok: false, error: 'Could not read the album layout. Please try again.' };

  const isTemplate = (t: string | null): t is LayoutTemplate =>
    !!t && (LAYOUT_TEMPLATES as readonly string[]).includes(t);

  // Count exactly what the print route will render: rows whose template the renderer recognises.
  // A row with a null/unknown template is dropped there, so it must be dropped here too, or this
  // gate would pass an album the route then refuses.
  const pages = ((pageData ?? []) as { layout_template: string | null }[])
    .filter((r) => isTemplate(r.layout_template))
    .reduce((sum, r) => sum + PAGE_COST[r.layout_template as LayoutTemplate], 0);

  if (pages !== size) {
    return {
      ok: false,
      error:
        `This album's layout accounts for ${pages} content ${pages === 1 ? 'page' : 'pages'}, ` +
        `but it is a ${size}-page album. The print file must contain exactly ${size} pages — ` +
        `finish or repair the layout before exporting.`,
    };
  }
  return { ok: true, pages };
}
