import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeCoverConfig } from '@/lib/builder/cover';
import { LAYOUT_TEMPLATES } from '@/lib/builder/model';

/**
 * RENDER READINESS — the layer the audit exposed as missing.
 *
 *   Validation (validation.ts) answers:  "Is the album CONTENT complete?"  (data correctness)
 *   Render readiness (this file) answers: "Can the RENDERER produce the book right now?" (renderability)
 *
 * The two are different questions, and conflating them is what let a "100% print-ready" album drop
 * placed-but-unready photos to blank slots (H-1) or reference a broken cover asset. This check runs
 * over the EXACT data the print route reads (`app/albums/[id]/print/page.tsx`) and confirms every
 * referenced asset actually resolves, so a `renderable: true` result guarantees the worker will find
 * every photo/cover it needs — no blank slots, no broken references, no silent drops.
 *
 * It is intentionally I/O-based (unlike the pure content validator): it queries the photos table for
 * real `status='ready'` + `sanitized_key` presence. `sanitized_key` is only written by the hardening
 * job AFTER the R2 upload succeeds, so its presence is a reliable proxy for "the R2 object exists"
 * without an R2 HEAD per photo. Cover template assets are resolved the same way the print route does.
 *
 * The pipeline is now:  Validation  →  Render Readiness  →  Print Ready / generate.
 */

export type RenderIssueCode =
  | 'no_pages'
  | 'photo_missing' // referenced id has no photos row (deleted / foreign)
  | 'photo_not_ready' // photo exists but status !== 'ready' (still processing / rejected)
  | 'photo_no_asset' // ready but no sanitized_key (R2 object never landed)
  | 'cover_photo_unresolved' // front cover references a photo that isn't renderable
  | 'back_cover_photo_unresolved' // back cover references a photo that isn't renderable
  | 'cover_template_missing'; // cover_template_id set but the template row/asset is gone

export type RenderIssue = {
  code: RenderIssueCode;
  message: string;
  page?: number; // 1-based content page, when applicable
  cover?: 'front' | 'back';
  ref?: string; // offending photo/template id (never user-facing)
};

export type RenderReadinessReport = {
  /** True when EVERY referenced asset resolves — the renderer can produce the book. */
  renderable: boolean;
  issues: RenderIssue[];
  stats: { referenced: number; ready: number; pages: number };
};

type AlbumRow = { id: string; cover_template_id: string | null; cover_config: unknown };
type PageRow = {
  page_number: number;
  layout_template: string | null;
  photo_ids: string[] | null;
  layout_config: { overlays?: { photoId: string | null }[] } | null;
};
type PhotoRow = { id: string; status: string; sanitized_key: string | null };

const isTemplate = (t: string | null): boolean => !!t && (LAYOUT_TEMPLATES as readonly string[]).includes(t);

/**
 * Evaluate whether an album is renderable. `client` may be the user's RLS client or the service-role
 * client (PDF generation uses service role). Returns null when the album isn't visible to the client.
 */
export async function loadRenderReadiness(
  client: SupabaseClient,
  albumId: string,
): Promise<RenderReadinessReport | null> {
  const { data: albumData } = await client
    .from('albums')
    .select('id, cover_template_id, cover_config')
    .eq('id', albumId)
    .maybeSingle();
  const album = albumData as AlbumRow | null;
  if (!album) return null;

  const cover = normalizeCoverConfig(album.cover_config as Parameters<typeof normalizeCoverConfig>[0]);

  const [{ data: pageData }, { data: photoData }] = await Promise.all([
    client
      .from('album_pages')
      .select('page_number, layout_template, photo_ids, layout_config')
      .eq('album_id', albumId)
      .order('page_number', { ascending: true }),
    client.from('photos').select('id, status, sanitized_key').eq('album_id', albumId),
  ]);

  const pages = (pageData ?? []) as PageRow[];
  const photos = (photoData ?? []) as PhotoRow[];
  const byId = new Map(photos.map((p) => [p.id, p]));

  const issues: RenderIssue[] = [];
  let referenced = 0;

  // One helper: does a referenced photo id resolve to a renderable asset?
  const checkPhoto = (id: string): RenderIssueCode | null => {
    const row = byId.get(id);
    if (!row) return 'photo_missing';
    if (row.status !== 'ready') return 'photo_not_ready';
    if (!row.sanitized_key) return 'photo_no_asset';
    return null;
  };

  // ── Content pages: base slots + overlays ────────────────────────────────────────
  const templatePages = pages.filter((p) => isTemplate(p.layout_template));
  templatePages.forEach((p) => {
    const pageNo = p.page_number + 1; // 0-based sequence → 1-based label
    const ids: string[] = [
      ...(p.photo_ids ?? []).filter((x): x is string => !!x),
      ...(p.layout_config?.overlays ?? []).map((o) => o.photoId).filter((x): x is string => !!x),
    ];
    for (const id of ids) {
      referenced += 1;
      const code = checkPhoto(id);
      if (code) {
        issues.push({
          code,
          page: pageNo,
          ref: id,
          message:
            code === 'photo_missing'
              ? `Page ${pageNo} references a photo that no longer exists.`
              : code === 'photo_not_ready'
                ? `Page ${pageNo} has a photo that is still processing.`
                : `Page ${pageNo} has a photo whose file is unavailable.`,
        });
      }
    }
  });

  if (templatePages.length === 0) {
    issues.push({ code: 'no_pages', message: 'This album has no printable pages yet.' });
  }

  // ── Front cover asset ───────────────────────────────────────────────────────────
  // Resolution order MIRRORS the print route: chosen photo → template artwork → CSS background /
  // default. The default (title + typography on the brand background) is ALWAYS renderable, so the
  // front cover only fails when it explicitly points at a broken photo or a vanished template.
  if (cover.photoId) {
    referenced += 1;
    const code = checkPhoto(cover.photoId);
    if (code) {
      issues.push({ code: 'cover_photo_unresolved', cover: 'front', ref: cover.photoId, message: 'The front-cover photo is unavailable.' });
    }
  } else if (!cover.background && album.cover_template_id) {
    const { data: tpl } = await client
      .from('cover_templates')
      .select('image_key')
      .eq('id', album.cover_template_id)
      .maybeSingle();
    const key = (tpl as { image_key: string | null } | null)?.image_key ?? null;
    if (!key) {
      issues.push({
        code: 'cover_template_missing',
        cover: 'front',
        ref: album.cover_template_id,
        message: 'The selected cover design is no longer available.',
      });
    }
  }
  // else: default green product cover (title/typography on the brand background) — always renderable.

  // ── Back cover asset (optional; only fails on a broken explicit photo) ───────────
  if (cover.back.photoId) {
    referenced += 1;
    const code = checkPhoto(cover.back.photoId);
    if (code) {
      issues.push({ code: 'back_cover_photo_unresolved', cover: 'back', ref: cover.back.photoId, message: 'The back-cover photo is unavailable.' });
    }
  }

  const ready = photos.filter((p) => p.status === 'ready' && p.sanitized_key).length;
  return {
    renderable: issues.length === 0,
    issues,
    stats: { referenced, ready, pages: templatePages.length },
  };
}

/** Compact, customer-safe one-line summary of why an album isn't renderable (for logs / errors). */
export function summarizeRenderIssues(report: RenderReadinessReport): string {
  if (report.renderable) return 'renderable';
  return report.issues.map((i) => `• ${i.message}`).join('\n');
}
