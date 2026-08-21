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
import { COVER_SCHEMA_VERSION, type CoverConfig, type CoverLayout } from './cover';
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
type CoverSideElements = {
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
  // Spread the spine rather than rebuilding it: it carries a `background` now, and a literal
  // `{ texts }` here would silently erase the customer's spine colour on every text edit.
  return { ...c, spine: { ...c.spine, texts: patch.texts ?? c.spine.texts } };
}

/**
 * The face's backdrop. All three faces have one — the spine's used to be hardcoded in the
 * renderer, which is exactly why it could not be changed. `null` on the spine means "the legacy
 * paint"; `spineBackgroundStyle` is what turns that into CSS.
 */
export function coverSideBackground(c: CoverConfig, side: CoverSide): Background | null {
  if (side === 'front') return c.background;
  if (side === 'back') return c.back.background;
  return c.spine.background;
}

/**
 * Paint the SAME backdrop onto all three faces in one write — the "Apply to all" action.
 *
 * It deliberately touches only the backdrops. A face showing a photo has its photo cleared (one
 * backdrop at a time, the rule `setBackground` already enforces per face), but text, stickers and
 * QR codes are untouched: applying a colour is not a request to clear the design.
 */
export function withAllCoverBackgrounds(c: CoverConfig, bg: Background | null): CoverConfig {
  return {
    ...c,
    background: bg,
    photoId: bg ? null : c.photoId,
    imageEdit: bg ? null : c.imageEdit,
    spine: { ...c.spine, background: bg },
    back: { ...c.back, background: bg, photoId: bg ? null : c.back.photoId, imageEdit: bg ? null : c.back.imageEdit },
  };
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
const TITLE_CQW = 8.5;
const SUBTITLE_CQW = 3.6;
const AUTHOR_CQW = 2.9;
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

type RoleSpec = { role: CoverTextRole; cqw: number; lineHeight: number; gapCqw: number };

/** The legacy title block, described as data — the single source both migration and presets use. */
const FRONT_ROLES: RoleSpec[] = [
  { role: 'title', cqw: TITLE_CQW, lineHeight: 1.04, gapCqw: 0 },
  { role: 'subtitle', cqw: SUBTITLE_CQW, lineHeight: 1.2, gapCqw: 2.4 },
  { role: 'author', cqw: AUTHOR_CQW, lineHeight: 1.3, gapCqw: 3 },
];

/**
 * HOW MANY LINES THIS TEXT WILL WRAP TO, without measuring anything.
 *
 * The legacy title block was laid out by flow: its height was whatever the text needed. An object
 * has an explicit box, so migration has to predict that height — and the first version simply
 * assumed the title was two lines. That is wrong in both directions and visibly so: a one-line
 * title got a box twice as tall as its text, which pushed the whole column off the anchor it was
 * supposed to be centred on, and a genuinely long title was under-allocated and clipped.
 *
 * Estimating is enough, because the box only has to bound the text: it is vertically centred
 * inside it, so a small error moves nothing. `AVG_GLYPH` is the mean advance width across the
 * bundled families as a fraction of the font size — the usual ~0.5 for mixed-case Latin. Explicit
 * newlines are honoured, since a customer who typed one meant it.
 *
 * Deliberately NOT a measurement: migration runs during render on every surface including the PDF,
 * and a canvas/DOM measure there would cost a layout pass per cover and be unavailable server-side.
 */
const AVG_GLYPH = 0.5;

function estimateLines(text: string, cqw: number, boxWidthFrac: number): number {
  const t = text.trim();
  if (t === '') return 1;
  const charsPerLine = Math.max(1, Math.floor((boxWidthFrac * 100) / (cqw * AVG_GLYPH)));
  return t.split('\n').reduce((n, line) => n + Math.max(1, Math.ceil(line.trim().length / charsPerLine)), 0);
}

/** One role's contribution to the column: its words, and — for a preset — its current styling. */
type TitleBlockEntry = { role: CoverTextRole; text: string; cqw?: number; lineHeight?: number };

/**
 * Lay the front-cover metadata objects out as the legacy structured block did: a column centred
 * on `posY`, inset by the same safe padding, in the order title → subtitle → author.
 *
 * This is BOTH the migration geometry (so a converted cover looks like it did) and the "Title
 * layout" presets the Cover toolbar offers (so re-applying one puts things back). One
 * implementation means a preset can never disagree with what migration produced.
 *
 * `cqw`/`lineHeight` on an entry override the house spec, which is what makes a preset correct
 * for an object the customer has already restyled: re-arranging a title someone set to twice the
 * default size has to allocate twice the height, or the preset would clip what it just tidied.
 */
function titleBlockRects(
  entries: TitleBlockEntry[],
  opts: { posY: number; pageAspect: number },
): Record<string, { x: number; y: number; w: number; h: number }> {
  const rows = FRONT_ROLES.map((spec) => {
    const entry = entries.find((e) => e.role === spec.role);
    if (!entry) return null;
    const cqw = entry.cqw ?? spec.cqw;
    const lineHeight = entry.lineHeight ?? spec.lineHeight;
    // A quarter-line of slack so descenders and diacritics are never clipped by the box.
    const lines = estimateLines(entry.text, cqw, SAFE_W) + 0.25;
    return { role: spec.role, gapCqw: spec.gapCqw, height: lineFrac(cqw, opts.pageAspect, lineHeight) * lines };
  }).filter((r): r is NonNullable<typeof r> => r !== null);

  const gaps = rows.map((r, i) => (i === 0 ? 0 : (r.gapCqw / 100) * opts.pageAspect));
  const total = rows.reduce((a, r) => a + r.height, 0) + gaps.reduce((a, b) => a + b, 0);

  let y = opts.posY - total / 2;
  const out: Record<string, { x: number; y: number; w: number; h: number }> = {};
  rows.forEach((r, i) => {
    y += gaps[i];
    out[r.role] = { x: SAFE_X, y: clamp(y, -0.5, 1), w: SAFE_W, h: Math.min(1, r.height) };
    y += r.height;
  });
  return out;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Where each layout preset anchors the title column — the legacy `posY` defaults, named. */
const LAYOUT_POS_Y: Record<CoverLayout, number> = {
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

type CoverMetadata = {
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
  // A role object is created only when there is something for it to say. `title` used to be
  // exempted (always created, even blank) to guarantee a title object existed; with no album title
  // to fall back on that exemption fabricates an empty object the customer then has to find and
  // delete. Nothing depends on the object existing when it would be blank —
  // `metadataFromCoverObjects` already returns `title: null` for "no title object", and a
  // non-empty title arriving later creates it through this same path.
  const missing = (['title', 'subtitle', 'author'] as const).filter(
    (r) => !findRole(texts, r) && wanted[r] !== '',
  );
  if (missing.length > 0) {
    // A v1 row lays them out where the structured block was; a v2 row that is simply missing one
    // (a subtitle typed for the first time) drops it into the same column, which is where the
    // rest of the metadata already sits.
    const posY = legacy ? c.posY : (findRole(texts, 'title')?.y ?? LAYOUT_POS_Y[c.layout]) + 0.06;
    const present: CoverTextRole[] = legacy
      ? (['title', 'subtitle', 'author'] as const).filter((r) => wanted[r] !== '')
      : missing;
    // The WORDS matter to the geometry: the column's height is the sum of what each line wraps to.
    const rects = titleBlockRects(
      present.map((r) => ({ role: r, text: wanted[r] })),
      { posY, pageAspect },
    );
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

  // 2 — the spine object. Same rule: an empty spine (no `spineTitle` AND no album title) has
  // nothing to print, so no object is fabricated for it.
  if (!findRole(spineTexts, 'spine') && wanted.spine !== '') {
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
  // Spread the existing spine — it carries a `background` as well as its texts, and rebuilding
  // it from a literal would drop the customer's spine colour on every migration pass (which runs
  // in every renderer, on every load).
  return { ...c, v: COVER_SCHEMA_VERSION, texts, spine: { ...c.spine, texts: spineTexts } };
}

/**
 * The two roles whose text is DERIVED FROM `albums.title` rather than from the cover's own fields.
 *
 * `title` is `meta.title` verbatim; `spine` is `c.spineTitle || meta.title`. `subtitle` and
 * `author` are not here on purpose — they come from `c.subtitle` / `c.author`, where empty
 * genuinely means "this field is empty" and clearing it is the documented way to delete the object
 * (see `metadataFromCoverObjects`). Their semantics are unchanged.
 */
const TITLE_DERIVED_ROLES: ReadonlySet<CoverTextRole> = new Set<CoverTextRole>(['title', 'spine']);

/** Point every role object's `text` at the metadata it renders. Returns the input when in sync. */
function syncRoleTexts(texts: TextElement[], wanted: Record<CoverTextRole, string>): TextElement[] {
  let touched = false;
  const next = texts.map((t) => {
    if (!t.role) return t;
    const want = wanted[t.role];
    if (want === undefined || t.text === want) return t;
    // EMPTY METADATA IS "NO OPINION", NOT "ERASE" — for the album-title-derived roles only.
    //
    // This is the load direction, and it used to overwrite unconditionally. That made the cover's
    // title a projection of `albums.title` FOREVER, not just until the cover had its own object:
    // an empty title metadata blanked an explicit, already-migrated title object on the next read.
    // Retiring `albums.title` would therefore have silently emptied migrated covers, which is the
    // dependency this whole phase exists to remove.
    //
    // The WRITE direction already works this way — `saveCoverDesign` does `...(title ? { title } : {})`
    // precisely so a blank title is never read as an instruction to erase `albums.title`. This makes
    // the read direction agree with the write direction instead of contradicting it.
    //
    // A NON-EMPTY metadata title still wins, so renaming an album in Album Settings still renames
    // the cover — the two-way binding is intact.
    if (want === '' && TITLE_DERIVED_ROLES.has(t.role) && t.text !== '') return t;
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
  // Each object contributes its OWN words and its OWN styling, so re-applying a preset to a title
  // the customer has resized allocates the height that title actually needs.
  const entries = (['title', 'subtitle', 'author'] as const).flatMap<TitleBlockEntry>((role) => {
    const el = findRole(c.texts, role);
    return el ? [{ role, text: el.text, cqw: el.size / CQW_TO_SIZE, lineHeight: el.lineHeight }] : [];
  });
  const rects = titleBlockRects(entries, { posY: LAYOUT_POS_Y[layout], pageAspect });
  return {
    ...c,
    layout,
    posY: LAYOUT_POS_Y[layout],
    texts: c.texts.map((t) => (t.role && rects[t.role] ? { ...t, ...rects[t.role], rotation: 0 } : t)),
  };
}
