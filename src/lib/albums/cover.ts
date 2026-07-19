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

export type CoverResolution = {
  /** An ACTIVE legacy PNG template is selected (server-resolved: active row WITH an image_key). */
  activeTemplate: boolean;
  /** Normalised cover_config (front + nested back). */
  config: CoverConfig;
  /** albums.title — the structured title; validated separately, not counted as a design choice. */
  title: string;
};

/** Has the FRONT cover been designed by any supported means? */
export function hasFrontCover(r: CoverResolution): boolean {
  const c = r.config;
  return (
    r.activeTemplate ||
    c.photoId !== null ||
    c.background !== null ||
    c.texts.length > 0 ||
    c.stickers.length > 0 ||
    c.qrs.length > 0 ||
    // Typography design: any deviation from the pristine defaults counts (a chosen design template
    // sets these; a hand-typed subtitle/author counts too).
    c.subtitle.trim() !== '' ||
    c.author.trim() !== '' ||
    c.spineTitle.trim() !== '' ||
    c.layout !== DEFAULT_COVER_CONFIG.layout ||
    c.font !== DEFAULT_COVER_CONFIG.font ||
    c.color !== DEFAULT_COVER_CONFIG.color ||
    c.align !== DEFAULT_COVER_CONFIG.align
  );
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
  let activeTemplate = false;
  if (album.cover_template_id) {
    const { data } = await client
      .from('cover_templates')
      .select('id, image_key')
      .eq('id', album.cover_template_id)
      .eq('active', true)
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
