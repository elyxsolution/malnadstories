/**
 * THE COVER OBJECT MODEL — what turns the cover from a form into a canvas.
 *
 * ── THE PROBLEM THIS SOLVES ────────────────────────────────────────────────────────────────
 *
 * A cover used to be TWO incompatible things at once. Stickers, QR codes and free text were real
 * objects: normalized rects, draggable, restyleable, layered. The title, subtitle, author and
 * spine were not — they were scalar fields on `CoverConfig`, drawn by a hardcoded flex column
 * anchored at `posY`, positionable only through a sidebar of sliders and segmented controls. That
 * split is the entire reason the cover editor felt like a different application: half of what you
 * could see could be grabbed, and the important half could not.
 *
 * Here they become the same thing. Title / subtitle / author / spine are ordinary `TextElement`s,
 * indistinguishable from any other text object to the renderer, to `Movable`, to the toolbars, to
 * the command layer and to the save pipeline — except for one field: `role`.
 *
 * ── WHY `role` INSTEAD OF JUST DELETING THE SCALARS ────────────────────────────────────────
 *
 * `albums.title` is not decoration. It names the album on the dashboard, on the order, in the
 * admin console and in the PDF; validation requires it; checkout prints it. The cover must show
 * that exact string, and typing a new title on the cover must BE renaming the album. A plain text
 * object cannot express that: it owns its own words. `role` is the binding — "this object renders
 * metadata field X" — and everything else about the object stays free. The same applies, less
 * critically, to the subtitle, the author line and the spine text.
 *
 * So the metadata still lives where it always lived (`albums.title`, and `cover_config.subtitle`
 * / `.author` / `.spineTitle`), and the objects are a synchronized VIEW of it. Nothing that reads
 * album metadata today — readiness, validation, checkout, the admin console — has to change or
 * learn what an object is.
 *
 * ── MIGRATION IS LAZY, PURE AND IDEMPOTENT ─────────────────────────────────────────────────
 *
 * `migrateCoverConfig` converts a v1 config to objects. It is a pure function with no I/O and no
 * database backfill, and it is called by the BUILDER **and by every renderer** — the flipbook, the
 * in-app preview, review mode, the admin preview and the PDF print route. That is what makes the
 * migration free: an album whose owner never opens the builder again still renders identically
 * everywhere, because the surface that draws it migrates in memory first. The first cover save
 * after that persists `v: 2`, and the function becomes a no-op for that row forever.
 *
 * It is also STABLE: when there is nothing to do it returns the input reference, so calling it in
 * a render path costs one integer comparison and creates no new object to churn React memos.
 *
 * PURE — no I/O, no 'use client' / 'server-only'. Safe to import anywhere.
 */
import {
  COVER_SCHEMA_VERSION,
  DEFAULT_SPINE,
  type CoverConfig,
  type CoverLayout,
} from './cover';
import {
  cryptoId,
  freeTexts,
  type Background,
  type CoverTextRole,
  type QrElement,
  type StickerElement,
  type TextElement,
} from './model';

export { freeTexts };

// ── the three printable faces of a cover ────────────────────────────────────────────────────
/**
 * A cover is a spread of three surfaces, and the spine is now one of them rather than a strip of
 * chrome between two of them. Each has its own element arrays and its own normalized 0..1 box, so
 * "which face am I editing?" is the only thing that differs between them.
 */
export const COVER_SIDES = ['back', 'spine', 'front'] as const;
export type CoverSide = (typeof COVER_SIDES)[number];

export const COVER_SIDE_LABEL: Record<CoverSide, string> = {
  front: 'Front cover',
  spine: 'Spine',
  back: 'Back cover',
};

/** Objects on one face. The spine carries text only — there is no room for anything else. */
export type CoverSideElements = {
  texts: TextElement[];
  stickers: StickerElement[];
  qrs: QrElement[];
};

export function coverSideElements(c: CoverConfig, side: CoverSide): CoverSideElements {
  if (side === 'front') return { texts: c.texts, stickers: c.stickers, qrs: c.qrs };
  if (side === 'back') return { texts: c.back.texts, stickers: c.back.stickers, qrs: c.back.qrs };
  return { texts: c.spine.texts, stickers: [], qrs: [] };
}

/** Write one face's element arrays back into the config, leaving the other two untouched. */
export function withCoverSideElements(c: CoverConfig, side: CoverSide, patch: Partial<CoverSideElements>): CoverConfig {
  if (side === 'front') return { ...c, ...patch };
  if (side === 'back') return { ...c, back: { ...c.back, ...patch } };
  return { ...c, spine: { texts: patch.texts ?? c.spine.texts } };
}

/** The face's backdrop. The spine has none of its own — it is the bound edge. */
export function coverSideBackground(c: CoverConfig, side: CoverSide): Background | null {
  if (side === 'front') return c.background;
  if (side === 'back') return c.back.background;
  return null;
}

/** The face's base photo + its independent crop. */
export function coverSideImage(c: CoverConfig, side: CoverSide): { photoId: string | null; edit: CoverConfig['imageEdit'] } {
  if (side === 'front') return { photoId: c.photoId, edit: c.imageEdit };
  if (side === 'back') return { photoId: c.back.photoId, edit: c.back.imageEdit };
  return { photoId: null, edit: null };
}

// ── role helpers ────────────────────────────────────────────────────────────────────────────

export const findRole = (texts: TextElement[], role: CoverTextRole): TextElement | undefined =>
  texts.find((t) => t.role === role);

/** Role objects are structural: the title and the spine always exist and cannot be deleted. */
export const isPermanentRole = (role: CoverTextRole | undefined): boolean => role === 'title' || role === 'spine';

/** Human name for a role object, used by toolbars, the layer menu and aria labels. */
export function roleLabel(role: CoverTextRole | undefined): string | null {
  switch (role) {
    case 'title':
      return 'Album title';
    case 'subtitle':
      return 'Subtitle';
    case 'author':
      return 'Author';
    case 'spine':
      return 'Spine text';
    default:
      return null;
  }
}

// ── geometry ────────────────────────────────────────────────────────────────────────────────
/**
 * Font sizes are authored in px at `REF_PAIR_W` (1000) and rendered as `cqw` against the surface
 * — so `size / 10` IS the element's font size in `cqw`. The legacy title block was written
 * directly in `cqw` (8.5 / 3.6 / 2.9), which makes the conversion exact rather than eyeballed.
 */
const CQW_TO_SIZE = 10;
export const TITLE_CQW = 8.5;
export const SUBTITLE_CQW = 3.6;
export const AUTHOR_CQW = 2.9;
const SPINE_CQH = 5;

/** Side padding of the legacy title block (`px-[9%]`), preserved so migrated covers don't shift. */
const SAFE_X = 0.09;
const SAFE_W = 1 - SAFE_X * 2;

/**
 * A line box's height as a fraction of the PAGE HEIGHT.
 *
 * `cqw` is a fraction of the page WIDTH, and an element's rect is normalized to the page box, so
 * the two only agree once the page aspect (width / height) is folded in. Getting this wrong is
 * how a migrated title ends up the right size but the wrong shape.
 */
const lineFrac = (cqw: number, pageAspect: number, lineHeight: number) => (cqw / 100) * pageAspect * lineHeight;

type RoleSpec = { role: CoverTextRole; cqw: number; lineHeight: number; lines: number; gapCqw: number };

/** The legacy title block, described as data — the single source both migration and presets use. */
const FRONT_ROLES: RoleSpec[] = [
  { role: 'title', cqw: TITLE_CQW, lineHeight: 1.04, lines: 2, gapCqw: 0 },
  { role: 'subtitle', cqw: SUBTITLE_CQW, lineHeight: 1.2, lines: 1.6, gapCqw: 2.4 },
  { role: 'author', cqw: AUTHOR_CQW, lineHeight: 1.3, lines: 1.6, gapCqw: 3 },
];

/**
 * Lay the front-cover metadata objects out as the legacy structured block did: a column centred
 * on `posY`, inset by the same safe padding, in the order title → subtitle → author.
 *
 * This is BOTH the migration geometry (so a converted cover looks like it did) and the
 * "Title layout" presets the Cover toolbar offers (so re-applying one puts things back). One
 * implementation means a preset can never disagree with what migration produced.
 */
export function titleBlockRects(
  present: CoverTextRole[],
  opts: { posY: number; pageAspect: number },
): Record<string, { x: number; y: number; w: number; h: number }> {
  const specs = FRONT_ROLES.filter((s) => present.includes(s.role));
  const heights = specs.map((s) => lineFrac(s.cqw, opts.pageAspect, s.lineHeight) * s.lines);
  const gaps = specs.map((s, i) => (i === 0 ? 0 : (s.gapCqw / 100) * opts.pageAspect));
  const total = heights.reduce((a, b) => a + b, 0) + gaps.reduce((a, b) => a + b, 0);

  let y = opts.posY - total / 2;
  const out: Record<string, { x: number; y: number; w: number; h: number }> = {};
  specs.forEach((s, i) => {
    y += gaps[i];
    out[s.role] = { x: SAFE_X, y: clamp(y, -0.5, 1), w: SAFE_W, h: Math.min(1, heights[i]) };
    y += heights[i];
  });
  return out;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Where each layout preset anchors the title column — the legacy `posY` defaults, named. */
export const LAYOUT_POS_Y: Record<CoverLayout, number> = {
  classic: 0.8,
  spotlight: 0.5,
  banner: 0.72,
  minimal: 0.22,
};

// ── object factories ────────────────────────────────────────────────────────────────────────

function makeRoleText(
  role: CoverTextRole,
  text: string,
  rect: { x: number; y: number; w: number; h: number },
  style: { font: CoverConfig['font']; color: string; align: CoverConfig['align'] },
): TextElement {
  const cqw = role === 'title' ? TITLE_CQW : role === 'subtitle' ? SUBTITLE_CQW : role === 'spine' ? SPINE_CQH : AUTHOR_CQW;
  return {
    id: cryptoId(),
    role,
    text,
    ...rect,
    // `variant` drives nothing but the add-text menu's defaults; roles map to the closest one so
    // an inspector that groups by variant still reads sensibly.
    variant: role === 'title' ? 'heading' : role === 'subtitle' ? 'subtitle' : 'paragraph',
    font: style.font,
    size: cqw * CQW_TO_SIZE,
    weight: role === 'title' ? 600 : 400,
    italic: false,
    underline: false,
    align: role === 'spine' ? 'center' : style.align,
    color: style.color,
    letterSpacing: role === 'subtitle' ? 0.12 : role === 'author' ? 0.04 : role === 'spine' ? 0.12 : -0.01,
    lineHeight: role === 'title' ? 1.04 : role === 'spine' ? 1 : 1.25,
    opacity: role === 'subtitle' ? 0.92 : role === 'author' ? 0.82 : role === 'spine' ? 0.92 : 1,
    rotation: 0,
    // The legacy block only shadowed text over a photo. Shadow is cheap, always improves
    // legibility over artwork, and is now a per-object toggle the customer can turn off.
    shadow: true,
  };
}

/** The spine's text object: the full height of the bound edge, rendered vertically. */
function makeSpineText(text: string, color: string): TextElement {
  return makeRoleText('spine', text, { x: 0.06, y: 0.08, w: 0.88, h: 0.84 }, {
    font: 'serif',
    color,
    align: 'center',
  });
}

// ── migration ───────────────────────────────────────────────────────────────────────────────

export type CoverMetadata = {
  /** `albums.title` — the album's canonical name. */
  title: string;
};

/**
 * Bring a cover config up to the object model, and keep the invariant that a cover ALWAYS has a
 * title object and a spine object.
 *
 * Two jobs, one function, because they are the same question asked of different rows:
 *
 *   v1 row  — the structured title block is converted into title / subtitle / author objects at
 *             the geometry `layout` + `posY` + `align` implied, so the cover looks unchanged; the
 *             spine scalars become a spine object. `v` becomes 2.
 *   v2 row  — the objects are already there; this only guarantees the two structural ones exist
 *             (a fresh album has none yet) and that every role object shows current metadata.
 *
 * IDEMPOTENT and STABLE: run it twice and the second call returns the identical reference.
 * Metadata is the source of truth here — this is the LOAD direction. The opposite direction
 * (canvas edit → metadata) is `metadataFromCoverObjects`.
 */
export function migrateCoverConfig(c: CoverConfig, meta: CoverMetadata, pageAspect: number): CoverConfig {
  const legacy = (c.v ?? 1) < COVER_SCHEMA_VERSION;

  // What each role should say right now. Empty string ⇒ the object should not exist.
  const wanted: Record<CoverTextRole, string> = {
    title: meta.title,
    subtitle: c.subtitle.trim(),
    author: c.author.trim(),
    spine: (c.spineTitle.trim() || meta.title).trim(),
  };

  let texts = c.texts;
  let spineTexts = c.spine.texts;
  let changed = false;

  // 1 — create the front metadata objects that should exist but don't.
  const missing = (['title', 'subtitle', 'author'] as const).filter(
    (r) => !findRole(texts, r) && (r === 'title' || wanted[r] !== ''),
  );
  if (missing.length > 0) {
    // A v1 row lays them out where the structured block was; a v2 row that is simply missing one
    // (a subtitle typed for the first time) drops it into the same column, which is where the
    // rest of the metadata already sits.
    const posY = legacy ? c.posY : (findRole(texts, 'title')?.y ?? LAYOUT_POS_Y[c.layout]) + 0.06;
    const present: CoverTextRole[] = legacy
      ? (['title', 'subtitle', 'author'] as const).filter((r) => r === 'title' || wanted[r] !== '')
      : missing;
    const rects = titleBlockRects(present, { posY, pageAspect });
    const created = missing.map((r) =>
      makeRoleText(r, wanted[r], rects[r] ?? { x: SAFE_X, y: 0.8, w: SAFE_W, h: 0.1 }, {
        font: c.font,
        color: c.color,
        align: c.align,
      }),
    );
    // Metadata objects go UNDER anything the customer has already placed: they are the cover's
    // base typography, not the most recent thing added.
    texts = [...created, ...texts];
    changed = true;
  }

  // 2 — the spine object.
  if (!findRole(spineTexts, 'spine')) {
    spineTexts = [makeSpineText(wanted.spine, c.spineColor), ...spineTexts];
    changed = true;
  }

  // 3 — role objects always show current metadata (the load direction).
  const synced = syncRoleTexts(texts, wanted);
  if (synced !== texts) {
    texts = synced;
    changed = true;
  }
  const syncedSpine = syncRoleTexts(spineTexts, wanted);
  if (syncedSpine !== spineTexts) {
    spineTexts = syncedSpine;
    changed = true;
  }

  if (!changed && !legacy) return c;
  return { ...c, v: COVER_SCHEMA_VERSION, texts, spine: { texts: spineTexts } };
}

/** Point every role object's `text` at the metadata it renders. Returns the input when in sync. */
function syncRoleTexts(texts: TextElement[], wanted: Record<CoverTextRole, string>): TextElement[] {
  let touched = false;
  const next = texts.map((t) => {
    if (!t.role) return t;
    const want = wanted[t.role];
    if (want === undefined || t.text === want) return t;
    touched = true;
    return { ...t, text: want };
  });
  return touched ? next : texts;
}

// ── metadata synchronisation ────────────────────────────────────────────────────────────────

/**
 * THE WRITE DIRECTION — read the album metadata back out of the objects.
 *
 * Called after any edit that can change a role object's words (inline editing on the canvas,
 * deleting a subtitle object). The result is folded into the config AND into `albums.title` by the
 * builder, so the canvas and the metadata can never drift: editing the title on the cover IS
 * renaming the album, and one save writes both.
 *
 * Deleting a subtitle or author object clears the corresponding metadata field, which is the only
 * consistent reading — the object was the field.
 */
export function metadataFromCoverObjects(c: CoverConfig): { title: string | null; subtitle: string; author: string; spineTitle: string } {
  const title = findRole(c.texts, 'title');
  const spine = findRole(c.spine.texts, 'spine');
  return {
    // Null = "no title object", which must NOT be read as "the album has no name". The album
    // title is mandatory; only an actual title object can propose a new one.
    title: title ? title.text : null,
    subtitle: findRole(c.texts, 'subtitle')?.text ?? '',
    author: findRole(c.texts, 'author')?.text ?? '',
    // The spine falls back to the album title when it is empty, so storing the album title
    // verbatim would turn a fallback into an override the customer never asked for.
    spineTitle: spine && spine.text.trim() !== title?.text.trim() ? spine.text : c.spineTitle,
  };
}

/**
 * THE READ DIRECTION — push metadata edited elsewhere (Album Settings) into the objects.
 *
 * The same guarantee from the other side: renaming the album in Settings retitles the cover
 * immediately, without a reload and without the cover having its own copy of the truth.
 */
export function applyMetadataToCoverObjects(c: CoverConfig, meta: CoverMetadata, pageAspect: number): CoverConfig {
  return migrateCoverConfig(c, meta, pageAspect);
}

// ── title-layout presets ────────────────────────────────────────────────────────────────────

/**
 * Re-arrange the metadata objects into one of the four house layouts.
 *
 * The presets used to be a stored `layout` enum that the renderer obeyed — which is exactly why
 * the title could not be moved: the layout owned its position. Now a preset is an ACTION that
 * writes geometry onto the objects and then gets out of the way. `layout` survives only as the
 * cover's theme (it still chooses the legibility scrim over a photo), and any object the preset
 * touches can be dragged somewhere else immediately afterwards.
 */
export function applyTitleLayout(c: CoverConfig, layout: CoverLayout, pageAspect: number): CoverConfig {
  const present = (['title', 'subtitle', 'author'] as const).filter((r) => findRole(c.texts, r));
  const rects = titleBlockRects(present, { posY: LAYOUT_POS_Y[layout], pageAspect });
  return {
    ...c,
    layout,
    posY: LAYOUT_POS_Y[layout],
    texts: c.texts.map((t) => (t.role && rects[t.role] ? { ...t, ...rects[t.role], rotation: 0 } : t)),
  };
}

/** A cover with no elements at all — used when a template/reset clears the design. */
export const EMPTY_SPINE = { ...DEFAULT_SPINE };
