/**
 * Central Album Validation Service — the ONE source of album completeness, print-readiness, PDF
 * integrity, structured issues, statistics and a 0–100 readiness score. Every consumer (builder
 * dialog, submitAlbum, PDF generation, admin dashboard, checkout) uses this; there is no parallel
 * validator.
 *
 *   • `evaluateAlbum(input, rules?)` — PURE (no I/O). Client + server share it.
 *   • `loadAlbumValidation(client, albumId, rules?)` — authoritative server loader.
 *
 * SEPARATION OF CONCERNS (business states):
 *   • Submission ("customer finished editing") is a user decision → `canSubmit` is ALWAYS true.
 *   • Print-readiness ("satisfies every print requirement") is decided here, independently →
 *     `printReady`. `canGeneratePdf === printReady`, so an incomplete album can be submitted but
 *     never produces a broken PDF.
 *
 * SEVERITY (three levels):
 *   • critical — the album is corrupt/unrenderable (invalid layout, no pages). Blocks everything.
 *   • warning  — a real print requirement is unmet (missing photos/cover, incomplete/short pages).
 *                Blocks PRINT, never submission.
 *   • info     — advisory / optional (blank back cover, missing cover title). Blocks nothing.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { PAGE_COST, LAYOUT_TEMPLATES, type LayoutTemplate } from '@/lib/builder/model';
import { hasFrontCover, hasBackCover, resolveCoverResolution, type CoverResolution } from './cover';

/** Bump when the rule set changes so stored/streamed reports are unambiguous. */
export const VALIDATION_VERSION = 2;

export type Severity = 'critical' | 'warning' | 'info';
export type IssueCategory = 'cover' | 'pages' | 'photos' | 'layout' | 'structure';

/** One-click navigation target for an issue (consumed by the builder). */
export type IssueAction =
  | { type: 'goto-page'; page: number }
  | { type: 'goto-layout'; page: number }
  | { type: 'goto-photo'; page: number }
  | { type: 'goto-front-cover' }
  | { type: 'goto-back-cover' }
  | null;

/** Structured, navigable validation issue (metadata, not just a string). */
export type ValidationIssue = {
  id: string; // stable, unique within a report (e.g. 'incomplete_page:8')
  severity: Severity;
  category: IssueCategory;
  title: string; // short label for grouped lists
  description: string; // fuller, customer-facing sentence
  page?: number; // 1-based content page, when applicable
  cover?: 'front' | 'back';
  action: IssueAction;
};

export type AlbumStatistics = {
  expectedPages: number;
  currentPages: number;
  completedPages: number;
  incompletePages: number[]; // 1-based
  expectedPhotos: number;
  placedPhotos: number;
  missingPhotos: number;
  frontCover: boolean;
  backCover: boolean;
  /** Pure content progress (photos placed) — 0..100. */
  completionPercentage: number;
  /** Holistic 0..100 print-readiness score (photos + pages + front cover, capped low if corrupt). */
  score: number;
};

export type AlbumValidationReport = {
  version: number;
  /** All issues, ordered critical → warning → info. */
  issues: ValidationIssue[];
  critical: ValidationIssue[];
  warnings: ValidationIssue[];
  info: ValidationIssue[];
  cover: { front: boolean; back: boolean };
  statistics: AlbumStatistics;
  // Business-state flags (derived, single source):
  canSubmit: boolean; // ALWAYS true — submission is a user decision.
  printReady: boolean; // no critical AND no warning.
  canGeneratePdf: boolean; // === printReady (PDF integrity gate).
};

/** Configurable business rules (CHANGE 11) — defaults keep today's behaviour. */
export type ValidationRules = {
  /** When true, a blank back cover becomes a print-blocking WARNING instead of advisory INFO. */
  requireBackCover?: boolean;
};
const DEFAULT_RULES: Required<ValidationRules> = { requireBackCover: false };

/**
 * One content unit, as the validator needs to see it.
 *
 * It gained the page's OTHER contents because the definition of "incomplete" moved. A page used
 * to be a photo container, so "incomplete" meant an unfilled base slot. A page is now a
 * background that photos are placed ONTO, as overlay frames — so an empty base half is an
 * ordinary finished design, and the thing that is genuinely unfinished is an overlay CONTAINER
 * the customer placed and never filled. Judging that needs the overlays; judging "this page is
 * completely blank" needs the rest.
 *
 * Every added field is optional, so a caller that cannot supply them degrades to reporting only
 * what it can see rather than inventing issues.
 */
export type EvalBlock = {
  template: LayoutTemplate | string | null;
  photoIds: (string | null | undefined)[];
  overlays?: readonly { photoId?: string | null }[];
  texts?: readonly unknown[];
  qrs?: readonly unknown[];
  stickers?: readonly unknown[];
  background?: unknown;
};
export type AlbumEvalInput = { size: number; blocks: EvalBlock[]; cover: CoverResolution };

const isTemplate = (t: unknown): t is LayoutTemplate => !!t && (LAYOUT_TEMPLATES as readonly string[]).includes(t as string);
const SEVERITY_ORDER: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };

/** PURE evaluator — the single rule set. */
export function evaluateAlbum(input: AlbumEvalInput, rules: ValidationRules = {}): AlbumValidationReport {
  const r = { ...DEFAULT_RULES, ...rules };
  const issues: ValidationIssue[] = [];

  // ── Cover (canonical resolver) ───────────────────────────────────────────────────
  // `hasFrontCover` is now ALWAYS true (Section 3): the default green product cover is a first-class,
  // printable cover, so there is never a "front cover missing" print-blocker — every album has at
  // least the default. The only cover advisory left is the (optional) title and the blank back cover.
  const front = hasFrontCover(input.cover);
  const back = hasBackCover(input.cover);
  if (!back) {
    issues.push({
      id: 'back_cover_missing',
      severity: r.requireBackCover ? 'warning' : 'info',
      category: 'cover',
      title: 'Back cover is blank',
      description: r.requireBackCover
        ? 'This product requires a designed back cover — add a photo, background, or text.'
        : 'Your back cover will print as a clean blank page. Add a photo, background, or text if you’d like a design.',
      cover: 'back',
      action: { type: 'goto-back-cover' },
    });
  }
  if (input.cover.title.trim() === '') {
    issues.push({
      id: 'cover_title_missing',
      severity: 'info',
      category: 'cover',
      title: 'Cover title not set',
      description: 'A title normally prints on the front cover — add one for a finished look.',
      cover: 'front',
      action: { type: 'goto-front-cover' },
    });
  }

  // ── Pages + photos ────────────────────────────────────────────────────────────────
  let currentPages = 0;
  let expectedPhotos = 0;
  let placedPhotos = 0;
  let completedPages = 0;
  const incompletePages: number[] = [];

  input.blocks.forEach((b, i) => {
    const pageNo = i + 1;
    if (!isTemplate(b.template)) {
      issues.push({
        id: `invalid_layout:${pageNo}`,
        severity: 'critical',
        category: 'layout',
        title: `Page ${pageNo} has an invalid layout`,
        description: 'This page’s layout is missing or unrecognised and cannot be printed.',
        page: pageNo,
        action: { type: 'goto-layout', page: pageNo },
      });
      return;
    }
    currentPages += PAGE_COST[b.template];

    /**
     * A page's PHOTO CONTAINERS are the base images it actually carries plus every overlay frame
     * on it — filled or not. Empty base halves are deliberately NOT counted as expected photos:
     * demanding two photos from every spread described the old page-as-container model, and under
     * the current one it would report a perfectly finished page (a colour, a caption, one framed
     * photo) as missing something.
     */
    const overlays = b.overlays ?? [];
    const baseFilled = (b.photoIds ?? []).filter(Boolean).length;
    const overlaysFilled = overlays.filter((o) => !!o.photoId).length;
    const emptyFrames = overlays.length - overlaysFilled;

    expectedPhotos += baseFilled + overlays.length;
    placedPhotos += baseFilled + overlaysFilled;

    const designed =
      baseFilled > 0 ||
      overlays.length > 0 ||
      (b.texts?.length ?? 0) > 0 ||
      (b.qrs?.length ?? 0) > 0 ||
      (b.stickers?.length ?? 0) > 0 ||
      !!b.background;

    if (emptyFrames > 0) {
      // A frame the customer placed and never filled — the one genuinely unfinished thing a page
      // can now contain. It prints as nothing, so it is a print warning, not a corruption.
      incompletePages.push(pageNo);
      issues.push({
        id: `incomplete_page:${pageNo}`,
        severity: 'warning',
        category: 'pages',
        title: `Page ${pageNo} has an empty photo frame`,
        description: `${emptyFrames} photo frame${emptyFrames === 1 ? '' : 's'} on page ${pageNo} ${
          emptyFrames === 1 ? 'has' : 'have'
        } no photo yet — add one, or remove the frame.`,
        page: pageNo,
        action: { type: 'goto-page', page: pageNo },
      });
    } else if (!designed) {
      // Nothing on it at all — not even a background. A blank page is a legitimate CHOICE, but an
      // untouched one is almost always a page the customer has not reached yet, so it is surfaced.
      incompletePages.push(pageNo);
      issues.push({
        id: `empty_page:${pageNo}`,
        severity: 'warning',
        category: 'pages',
        title: `Page ${pageNo} is blank`,
        description: `Page ${pageNo} has nothing on it — add a photo, a background or some text.`,
        page: pageNo,
        action: { type: 'goto-page', page: pageNo },
      });
    } else {
      completedPages += 1;
    }
  });

  if (input.blocks.length === 0) {
    issues.push({
      id: 'no_pages',
      severity: 'warning',
      category: 'structure',
      title: 'No pages yet',
      description: 'Your album has no content pages — add pages before printing.',
      action: null,
    });
  }
  if (currentPages !== input.size) {
    issues.push({
      id: 'page_count',
      severity: 'warning',
      category: 'structure',
      title: `${currentPages} of ${input.size} pages`,
      description: `Your album currently has ${currentPages} of the required ${input.size} pages.`,
      action: null,
    });
  }

  const missingPhotos = Math.max(0, expectedPhotos - placedPhotos);
  if (missingPhotos > 0) {
    issues.push({
      id: 'missing_photos',
      severity: 'warning',
      category: 'photos',
      title: `${missingPhotos} empty photo frame${missingPhotos === 1 ? '' : 's'}`,
      description: `You’ve filled ${placedPhotos} of the ${expectedPhotos} photo frames you’ve placed.`,
      action: incompletePages.length ? { type: 'goto-page', page: incompletePages[0] } : null,
    });
  }

  // ── Buckets + derived state ─────────────────────────────────────────────────────
  issues.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  const critical = issues.filter((i) => i.severity === 'critical');
  const warnings = issues.filter((i) => i.severity === 'warning');
  const info = issues.filter((i) => i.severity === 'info');
  const printReady = critical.length === 0 && warnings.length === 0;

  const completionPercentage = expectedPhotos > 0 ? Math.round((placedPhotos / expectedPhotos) * 100) : front ? 100 : 0;
  const score = computeScore({ expectedPhotos, placedPhotos, expectedPages: input.size, currentPages, front, hasCritical: critical.length > 0 });

  return {
    version: VALIDATION_VERSION,
    issues,
    critical,
    warnings,
    info,
    cover: { front, back },
    statistics: {
      expectedPages: input.size,
      currentPages,
      completedPages,
      incompletePages,
      expectedPhotos,
      placedPhotos,
      missingPhotos,
      frontCover: front,
      backCover: back,
      completionPercentage,
      score,
    },
    canSubmit: true,
    printReady,
    canGeneratePdf: printReady,
  };
}

/** Weighted 0–100 readiness score: photos (45%) · pages (35%) · front cover (20%); corrupt → ≤10. */
function computeScore(x: {
  expectedPhotos: number;
  placedPhotos: number;
  expectedPages: number;
  currentPages: number;
  front: boolean;
  hasCritical: boolean;
}): number {
  const photo = x.expectedPhotos > 0 ? x.placedPhotos / x.expectedPhotos : x.front ? 1 : 0;
  const page = x.expectedPages > 0 ? Math.min(x.currentPages, x.expectedPages) / x.expectedPages : 0;
  const cover = x.front ? 1 : 0;
  const raw = Math.round(100 * (0.45 * photo + 0.35 * page + 0.2 * cover));
  return x.hasCritical ? Math.min(raw, 10) : Math.max(0, Math.min(100, raw));
}

// ── Server loader (authoritative) ─────────────────────────────────────────────────
type AlbumRow = { id: string; size: number; title: string | null; cover_template_id: string | null; cover_config: unknown };
type PageRow = {
  layout_template: string | null;
  photo_ids: (string | null)[] | null;
  /** Overlays + text / QR / stickers / background — see `EvalBlock` for why they are needed. */
  layout_config: {
    overlays?: { photoId?: string | null }[];
    texts?: unknown[];
    qrs?: unknown[];
    stickers?: unknown[];
    background?: unknown;
  } | null;
};

/**
 * Load + evaluate an album authoritatively. `client` may be the user's RLS client (builder/submit)
 * or the service-role client (PDF generation / admin). Returns null when the album isn't visible.
 */
export async function loadAlbumValidation(
  client: SupabaseClient,
  albumId: string,
  rules?: ValidationRules,
): Promise<AlbumValidationReport | null> {
  const { data: albumData } = await client
    .from('albums')
    .select('id, size, title, cover_template_id, cover_config')
    .eq('id', albumId)
    .maybeSingle();
  const album = albumData as AlbumRow | null;
  if (!album) return null;

  const [{ data: pageData }, cover] = await Promise.all([
    client
      .from('album_pages')
      .select('layout_template, photo_ids, layout_config')
      .eq('album_id', albumId)
      .order('page_number', { ascending: true }),
    resolveCoverResolution(client, album),
  ]);

  const blocks: EvalBlock[] = ((pageData ?? []) as PageRow[]).map((p) => ({
    template: p.layout_template,
    photoIds: p.photo_ids ?? [],
    overlays: p.layout_config?.overlays ?? [],
    texts: p.layout_config?.texts ?? [],
    qrs: p.layout_config?.qrs ?? [],
    stickers: p.layout_config?.stickers ?? [],
    background: p.layout_config?.background ?? null,
  }));
  return evaluateAlbum({ size: album.size, blocks, cover }, rules);
}
