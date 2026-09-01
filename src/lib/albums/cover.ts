/**
 * Canonical cover validation — the SINGLE source of truth for "does this album have a cover?".
 *
 * Replaces the previously-divergent definitions in submitAlbum / PDF generation / admin readiness
 * / checkout readiness (each of which counted a different subset of cover types). Pure predicates
 * (no I/O, no 'server-only') so client + server share one implementation.
 *
 * A cover is recognised regardless of HOW it was created:
 *   • legacy PNG template   → `activeTemplate` (resolved from cover_templates, active + image_key)
 *   • cover design template → applied into cover_config (photo/background/texts/typography)
 *   • photo cover           → cover_config.photoId
 *   • background cover       → cover_config.background
 *   • typography-only cover  → free text elements OR a non-default structured title design
 * The mandatory album title is a SEPARATE readiness check ("Cover title set"), so a pristine,
 * untouched cover (bare defaults, no design choice) correctly reports as "not created".
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { DEFAULT_COVER_CONFIG, normalizeCoverConfig, type CoverConfig } from '@/lib/builder/cover';
import { freeTexts } from '@/lib/builder/model';

export type CoverResolution = {
  /** An ACTIVE legacy PNG template is selected (server-resolved: active row WITH an image_key). */
  activeTemplate: boolean;
  /** Normalised cover_config (front + nested back). */
  config: CoverConfig;
  /** albums.title — the structured title; validated separately, not counted as a design choice. */
  title: string;
};

/**
 * Does this album have a printable FRONT cover?
 *
 * ALWAYS TRUE (Section 3). The default green product cover is a first-class cover, not a "no cover"
 * fallback: every renderer (`coverBackgroundStyle` → brand green `#1e3a2f`) draws a complete cover
 * even for a pristine album. So the canonical answer to "is there a cover to print?" is yes — there
 * is always at least the default. This removes the old divergence where validation reported
 * "No cover selected" while the builder/preview/print all showed the default green cover.
 *
 * "Has the customer *actively designed* a cover?" is a different question — see `hasDesignedFrontCover`.
 * The mandatory album title is validated separately (`cover_title_missing`, advisory info).
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- param kept for signature compatibility with callers
export function hasFrontCover(_r: CoverResolution): boolean {
  return true;
}

/**
 * Has the customer actively designed the front cover (vs. leaving the pristine default)? Not used for
 * print-readiness (the default is printable) — kept for UI affordances that want to distinguish a
 * chosen/edited cover from an untouched one.
 */
export function hasDesignedFrontCover(r: CoverResolution): boolean {
  const c = r.config;
  return (
    r.activeTemplate ||
    c.photoId !== null ||
    c.background !== null ||
    // Metadata objects (title / subtitle / author) are a VIEW of album fields, not a design
    // decision — counting them would make every album since Cover Editor 2.0 report as designed
    // and silently reclassify pristine covers from `default` to `design`.
    freeTexts(c.texts).length > 0 ||
    c.stickers.length > 0 ||
    c.qrs.length > 0 ||
    c.subtitle.trim() !== '' ||
    c.author.trim() !== '' ||
    c.spineTitle.trim() !== '' ||
    c.layout !== DEFAULT_COVER_CONFIG.layout ||
    c.font !== DEFAULT_COVER_CONFIG.font ||
    c.color !== DEFAULT_COVER_CONFIG.color ||
    c.align !== DEFAULT_COVER_CONFIG.align
  );
}

/**
 * CANONICAL cover kind — the single priority chain the whole app resolves a printable cover through
 * (Section 3, CHANGE 2):
 *   1. photo    — a customer-uploaded cover photo (`cover_config.photoId`)          [Custom]
 *   2. template — a selected cover-template artwork (`cover_template_id`)            [Template]
 *   3. design   — a designed cover: CSS background / typography / free elements      [Generated]
 *   4. default  — the brand-green product cover with the album title                 [Default]
 * Exactly one result; no layer decides independently.
 */
export type CoverKind = 'photo' | 'template' | 'design' | 'default';

export function classifyCover(r: CoverResolution): CoverKind {
  if (r.config.photoId) return 'photo';
  if (r.activeTemplate) return 'template';
  if (hasDesignedFrontCover(r)) return 'design';
  return 'default';
}

/** Has the BACK cover been designed? (No mandatory title on the back — it prints blank otherwise.) */
export function hasBackCover(r: CoverResolution): boolean {
  const b = r.config.back;
  return (
    b.photoId !== null ||
    b.background !== null ||
    b.texts.length > 0 ||
    b.stickers.length > 0 ||
    b.qrs.length > 0 ||
    b.overlays.length > 0 ||
    b.showLogo
  );
}

// ── Server-side resolution (inject any Supabase client — user RLS or service role) ──────────
/**
 * Resolve the full CoverResolution for an album row (does the active-template DB check). Used by
 * the central validation loader so submit + PDF share the exact same cover truth. `activeTemplate`
 * requires the referenced cover_template to be `active` AND have an `image_key` (printable).
 */
export async function resolveCoverResolution(
  client: SupabaseClient,
  album: { cover_template_id: string | null; cover_config: unknown; title: string | null },
): Promise<CoverResolution> {
  // A referenced template resolves if its row exists AND has a printable `image_key` — regardless of
  // `active` (Section 3 / H-3). An album already using a template keeps rendering it even after the
  // admin deactivates that template (grandfathered), so validation, builder, checkout and the print
  // route all agree the cover is present instead of one flipping to "no cover" while others print it.
  let activeTemplate = false;
  if (album.cover_template_id) {
    const { data } = await client
      .from('cover_templates')
      .select('id, image_key')
      .eq('id', album.cover_template_id)
      .maybeSingle();
    const c = data as { image_key: string | null } | null;
    activeTemplate = !!(c && c.image_key);
  }
  return {
    activeTemplate,
    config: normalizeCoverConfig(album.cover_config as Parameters<typeof normalizeCoverConfig>[0]),
    title: album.title ?? '',
  };
}

/**
 * CANONICAL printable-image-key resolution — the ONE place that turns an album's cover choice into
 * the R2 object key(s) to render (Section 3, CHANGE 1/6). Replaces the duplicated photo+template
 * lookups previously inlined in the print route, checkout, and the build page. Callers presign the
 * returned keys with their own TTL (presigning is context-specific; the DECISION lives here).
 *
 * Front resolution mirrors `classifyCover` exactly: ready cover photo → template artwork → none
 * (design/default render from CSS via `coverBackgroundStyle`). Back cover uses its own photo only.
 */
export type CoverImageKeys = {
  front: { kind: CoverKind; key: string | null };
  back: { key: string | null };
};

export async function resolveCoverImageKeys(
  client: SupabaseClient,
  album: { id: string; cover_template_id: string | null; cover_config: unknown },
): Promise<CoverImageKeys> {
  const config = normalizeCoverConfig(album.cover_config as Parameters<typeof normalizeCoverConfig>[0]);

  const readyPhotoKey = async (photoId: string): Promise<string | null> => {
    const { data } = await client
      .from('photos')
      .select('sanitized_key')
      .eq('id', photoId)
      .eq('album_id', album.id)
      .eq('status', 'ready')
      .maybeSingle();
    return (data as { sanitized_key: string | null } | null)?.sanitized_key ?? null;
  };

  let front: { kind: CoverKind; key: string | null };
  if (config.photoId) {
    front = { kind: 'photo', key: await readyPhotoKey(config.photoId) };
  } else if (!config.background && album.cover_template_id) {
    const { data } = await client
      .from('cover_templates')
      .select('image_key')
      .eq('id', album.cover_template_id)
      .maybeSingle();
    const key = (data as { image_key: string | null } | null)?.image_key ?? null;
    front = { kind: key ? 'template' : 'default', key };
  } else {
    front = { kind: config.background ? 'design' : 'default', key: null };
  }

  const backKey = config.back.photoId ? await readyPhotoKey(config.back.photoId) : null;
  return { front, back: { key: backKey } };
}

/**
 * THE SAME PRIORITY CHAIN, FOR MANY ALBUMS AT ONCE — the shelf's resolver.
 *
 * `resolveCoverImageKeys` is per-album and issues up to two queries each, which is correct for the
 * builder, checkout and the print route (one album, richest possible data) and wrong for a
 * dashboard listing every album a customer owns: that is an N+1 on a page that already makes its
 * reads in two round trips.
 *
 * So this answers the identical question in THREE queries total, whatever the album count: one
 * `photos` read for every album that names a cover photo, one `cover_templates` read for every
 * album that falls through to artwork, and nothing at all for the rest. **The decision itself is
 * not re-implemented** — the chain below is the same photo → template → none written above, and
 * `tests/dashboard-cover.test.ts` pins the two against each other so they cannot drift.
 *
 * It resolves the FRONT only, and prefers `thumb_key`: a shelf book is ~150 px wide, so presigning
 * the full-resolution print master would download several megabytes to draw a thumbnail. A photo
 * with no thumbnail yet falls back to its sanitized master rather than showing nothing.
 */
export async function resolveCoverFrontKeys(
  client: SupabaseClient,
  albums: readonly { id: string; cover_template_id: string | null; cover_config: unknown }[],
): Promise<Map<string, { kind: CoverKind; key: string | null }>> {
  const out = new Map<string, { kind: CoverKind; key: string | null }>();
  const configs = new Map(
    albums.map((a) => [a.id, normalizeCoverConfig(a.cover_config as Parameters<typeof normalizeCoverConfig>[0])] as const),
  );

  // Pass 1 — the photo covers. One read, scoped to the caller's own albums by RLS AND by the
  // explicit album_id list, so a forged photo id from another album can never resolve.
  const photoIds = albums.map((a) => configs.get(a.id)?.photoId).filter((id): id is string => !!id);
  const photoKeys = new Map<string, string>();
  if (photoIds.length > 0) {
    const { data } = await client
      .from('photos')
      .select('id, album_id, thumb_key, sanitized_key')
      .in('album_id', albums.map((a) => a.id))
      .in('id', photoIds)
      .eq('status', 'ready');
    for (const r of (data ?? []) as { id: string; album_id: string; thumb_key: string | null; sanitized_key: string | null }[]) {
      const key = r.thumb_key ?? r.sanitized_key;
      // Keyed by (album, photo) so a cover photo only ever resolves for the album that owns it.
      if (key) photoKeys.set(`${r.album_id}:${r.id}`, key);
    }
  }

  // Pass 2 — the artwork templates, for the albums that fall through. Same fall-through rule as
  // the single-album resolver: a chosen CSS background outranks a leftover template id.
  const templateIds = albums
    .filter((a) => {
      const c = configs.get(a.id);
      return c && !c.photoId && !c.background && !!a.cover_template_id;
    })
    .map((a) => a.cover_template_id as string);
  const templateKeys = new Map<string, string>();
  if (templateIds.length > 0) {
    const { data } = await client.from('cover_templates').select('id, image_key').in('id', templateIds);
    for (const r of (data ?? []) as { id: string; image_key: string | null }[]) {
      if (r.image_key) templateKeys.set(r.id, r.image_key);
    }
  }

  for (const a of albums) {
    const c = configs.get(a.id);
    if (!c) continue;
    if (c.photoId) {
      out.set(a.id, { kind: 'photo', key: photoKeys.get(`${a.id}:${c.photoId}`) ?? null });
    } else if (!c.background && a.cover_template_id) {
      const key = templateKeys.get(a.cover_template_id) ?? null;
      out.set(a.id, { kind: key ? 'template' : 'default', key });
    } else {
      out.set(a.id, { kind: c.background ? 'design' : 'default', key: null });
    }
  }
  return out;
}
