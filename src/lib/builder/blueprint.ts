/**
 * Album Blueprint — PURE model + producer (no React, no I/O). Extends the layout-template concept
 * from a single-spread preset to a WHOLE album, and produces the existing `Block[]` on apply, so
 * nothing new ever reaches the renderer / saveLayout / PDF / worker. Mirrors auto-layout.ts (a
 * producer, not a data model the renderer sees).
 *
 * A Blueprint is a sequence of page units. Each unit is one of the existing renderer primitives
 * (single-pair | double-spread) plus EMPTY overlay slots (geometry only, no photo) and decorative
 * elements (texts / QR / stickers / background). Applying a blueprint assigns uploaded photos to
 * the base + overlay slots, emitting ordinary album Block[].
 */
import {
  PAGE_COST,
  requiredBaseCount,
  cryptoId,
  type Background,
  type Block,
  type LayoutTemplate,
  type QrElement,
  type Rect,
  type StickerElement,
  type TextElement,
} from './model';
import { LAYOUT_PRESETS } from './elements';
import { normalizeCoverConfig, type CoverConfig } from './cover';

export const BLUEPRINT_VERSION = 1 as const;

/**
 * THE BLUEPRINT'S FRONT COVER — design state only, never album state.
 *
 * A blueprint used to describe interior pages alone, so "the design" and "the cover" were two
 * separate admin products. The blueprint now owns its cover, which is what makes it the single
 * customer-facing design entity. The stored value is an ordinary `CoverConfig` — the exact type
 * `albums.cover_config` already holds — so the canonical renderer, the builder, the preview and
 * both PDFs draw a blueprint's cover through the code they already draw an album's cover through.
 * There is no second cover model and no second renderer.
 *
 * WHAT MUST NEVER BE STORED HERE. A `CoverConfig` can name a specific customer's photos:
 * `photoId` / `imageEdit` on the front, the same pair on the back, and `back.overlays[].photoId`.
 * Those are ALBUM state — a row in `photos`, owned by one customer, scoped by RLS. A blueprint is
 * global, admin-authored and (in a later phase) publicly browsable, so a photo id reaching it
 * would be both meaningless to every other album and a reference to private data on a public
 * surface. `blueprintCoverFromConfig` is the ONE gate that strips them, and it is applied on the
 * way IN (authoring) as well as on the way OUT (normalisation), so a hand-edited or imported row
 * cannot smuggle one past.
 *
 * Sticker ids are deliberately KEPT: a sticker is admin-managed artwork resolved by id at render
 * time (exactly as the builder, the print route and the admin preview already resolve it), not
 * customer data.
 */
export function blueprintCoverFromConfig(raw: unknown): CoverConfig {
  // Normalise first so a partial/legacy/hand-written object becomes a complete CoverConfig, then
  // deep-clone so the caller's object can never be aliased into the blueprint (the album-snapshot
  // rule in reverse — see `applyCoverTemplateToAlbum`).
  const cover: CoverConfig = JSON.parse(JSON.stringify(normalizeCoverConfig(raw as Parameters<typeof normalizeCoverConfig>[0])));
  cover.photoId = null;
  cover.imageEdit = null;
  cover.back.photoId = null;
  cover.back.imageEdit = null;
  // An overlay is a CONTAINER plus a photo. The geometry is design; the photo is album state. The
  // container is preserved with an empty photo — exactly what `applyBlueprint` does for an interior
  // overlay slot — so a designed back-cover composition survives without naming anyone's picture.
  cover.back.overlays = cover.back.overlays.map((o) => ({ ...o, photoId: null }));
  return cover;
}

/** One page unit of a blueprint — a layout primitive + empty overlay slots + decorative elements. */
export type BlueprintBlock = {
  template: LayoutTemplate;
  caption: string;
  overlaySlots: Rect[]; // empty overlay geometry (0..1) — photos assigned on apply
  texts: TextElement[];
  qrs: QrElement[];
  stickers: StickerElement[];
  background: Background | null;
  // The LAYOUT PRESET id this block was built from — stored so breakdowns/editing/analytics are
  // accurate (recommendation). Falls back to inference for legacy blocks with no stored preset.
  preset?: string;
};

/** Infer a preset key from a block's geometry when none was stored (legacy/manual blocks). */
export function inferPresetKey(template: LayoutTemplate, overlayCount: number): string {
  const match = LAYOUT_PRESETS.find((p) => p.base === template && p.overlays.length === overlayCount);
  if (match) return match.key;
  return template === 'double-spread' ? 'full-bleed' : 'single';
}

/** Human label for a preset key (from the LAYOUT_PRESETS catalog). */
export function presetLabel(key: string): string {
  return LAYOUT_PRESETS.find((p) => p.key === key)?.label ?? key;
}

export type Blueprint = {
  version: typeof BLUEPRINT_VERSION;
  blocks: BlueprintBlock[];
  /**
   * The design's FRONT COVER (and back/spine), as an ordinary `CoverConfig`.
   *
   * OPTIONAL, AND ABSENT MEANS EXACTLY WHAT IT ALWAYS MEANT. Every blueprint authored before this
   * field existed has no `cover`, loads unchanged, and behaves unchanged — which is why the
   * version stays at 1 rather than bumping: an optional additive key is already inside the
   * existing versioning contract, and a bump would force a rewrite of rows that need none.
   * Consumers must treat `undefined` as "this blueprint does not define a cover" and fall back to
   * whatever they did before (the album's own default), never invent one.
   */
  cover?: CoverConfig;
};

export type BlueprintStats = {
  pageCount: number; // physical content leaves (Σ PAGE_COST)
  slotCount: number; // total photo slots (base + overlays) = capacity
  recommendedPhotos: number; // sensible target = capacity
};

/**
 * Layout-type breakdown of a blueprint (PURE) — derived from the primitives it uses. The renderer
 * has two primitives (single-pair = two facing pages, double-spread = one image across the fold);
 * everything else is overlay insets. Drives the "layout breakdown" shown on blueprint cards.
 */
export type BlueprintBreakdown = { key: string; label: string; count: number }[];
export function blueprintBreakdown(bp: Blueprint): BlueprintBreakdown {
  // Count by the actual LAYOUT PRESET each block was built from (stored id → label), inferring for
  // any legacy block without one. Gives accurate "12 Panorama · 8 Full bleed · 6 Collage" breakdowns.
  const counts = new Map<string, number>();
  for (const b of bp.blocks) {
    const key = b.preset ?? inferPresetKey(b.template, b.overlaySlots.length);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([key, count]) => ({ key, label: presetLabel(key), count }))
    .sort((a, b) => b.count - a.count);
}

/** Derived stats — NEVER hand-entered. Capacity = every base slot + every overlay slot. */
export function blueprintStats(bp: Blueprint): BlueprintStats {
  let pageCount = 0;
  let slotCount = 0;
  for (const b of bp.blocks) {
    pageCount += PAGE_COST[b.template];
    slotCount += requiredBaseCount(b.template) + b.overlaySlots.length;
  }
  return { pageCount, slotCount, recommendedPhotos: slotCount };
}

/**
 * Distill an album's live Block[] into a reusable Blueprint: keep the page sequence, layouts,
 * overlay GEOMETRY, and decorative elements; DROP the photos (base ids + overlay photo ids →
 * empty slots). This is how "Save current album as Blueprint" reuses the builder for authoring.
 */
export function blueprintFromBlocks(blocks: Block[], cover?: unknown): Blueprint {
  return {
    version: BLUEPRINT_VERSION,
    // The cover is captured through the SAME gate normalisation uses, so the authoring path and
    // the read path cannot disagree about what a blueprint cover is allowed to contain. Passing
    // nothing (or null) leaves the blueprint cover-less, which is the pre-existing behaviour.
    ...(cover === undefined || cover === null ? {} : { cover: blueprintCoverFromConfig(cover) }),
    blocks: blocks.map((b) => ({
      template: b.template,
      caption: b.caption ?? '',
      overlaySlots: b.overlays.map((o) => ({ x: o.x, y: o.y, w: o.w, h: o.h })),
      texts: b.texts ?? [],
      qrs: b.qrs ?? [],
      stickers: b.stickers ?? [],
      background: b.background ?? null,
      // Store the preset id (explicit, or inferred from geometry) so it survives round-trips.
      preset: b.preset ?? inferPresetKey(b.template, b.overlays.length),
    })),
  };
}

/**
 * Fit assessment for the picker (Step 6) — PURE. Compares an album's uploaded photo count against a
 * blueprint's capacity (slot_count) and recommended count. Drives a visual "match" badge; no I/O.
 */
export type BlueprintMatchTone = 'best' | 'great' | 'good' | 'few' | 'over';
export type BlueprintMatch = { label: string; tone: BlueprintMatchTone };

export function blueprintMatch(uploaded: number, slotCount: number, recommended: number): BlueprintMatch {
  if (slotCount <= 0) return { label: 'Great Match', tone: 'great' };
  if (uploaded > slotCount) return { label: "Some photos won't fit", tone: 'over' };
  if (uploaded === 0) return { label: 'Add photos to place', tone: 'few' };
  if (uploaded === slotCount) return { label: 'Great Match', tone: 'great' };
  const ref = recommended > 0 ? recommended : slotCount;
  const ratio = uploaded / ref;
  if (ratio >= 0.85) return { label: 'Recommended', tone: 'best' };
  if (ratio >= 0.5) return { label: 'Good Match', tone: 'good' };
  return { label: 'Requires more photos', tone: 'few' };
}

/** Deterministic seeded shuffle (Fisher–Yates, mulberry32) so "Randomize" is reproducible per seed. */
export function shuffleIds(ids: string[], seed: number): string[] {
  const out = [...ids];
  let s = seed >>> 0;
  const rand = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Apply a blueprint to a set of photos → album Block[]. Fills base slots then overlay slots in
 * page order, each photo used at most once. Slots beyond the supplied photos stay EMPTY but the
 * container is preserved: a base slot as a missing `photoIds` index, an overlay slot as a
 * PLACEHOLDER overlay (`photoId: null`). This is the architectural fix — an overlay slot is
 * geometry that exists independently of a photo, so applying a blueprint with 0 photos (the
 * edit-open + thumbnail paths) rebuilds the FULL overlay geometry instead of dropping it. Extra
 * photos beyond capacity are ignored. Decorative elements copy verbatim. The result is ordinary
 * Block[] — persisted via the existing saveLayout, rendered by the existing pipeline.
 */
export function applyBlueprint(bp: Blueprint, photoIds: string[]): Block[] {
  const queue = [...photoIds];
  const next = (): string | null => (queue.length ? queue.shift()! : null);

  return bp.blocks.map((b, i) => {
    const photoIdsForBase: string[] = [];
    for (let s = 0; s < requiredBaseCount(b.template); s++) {
      const id = next();
      if (id) photoIdsForBase.push(id);
    }
    // EVERY overlay slot becomes an overlay — filled if a photo remains, else a null placeholder.
    // Never `break`: the geometry is the point of a blueprint, with or without photos.
    const overlays = b.overlaySlots.map((slot) => ({
      photoId: next(),
      x: slot.x,
      y: slot.y,
      w: slot.w,
      h: slot.h,
    }));
    return {
      key: `bp-${i}`,
      template: b.template,
      photoIds: photoIdsForBase,
      caption: b.caption ?? '',
      overlays,
      texts: b.texts ?? [],
      qrs: b.qrs ?? [],
      stickers: b.stickers ?? [],
      background: b.background ?? null,
      preset: b.preset ?? inferPresetKey(b.template, b.overlaySlots.length),
    } satisfies Block;
  });
}

/** Normalize arbitrary stored JSON into a safe Blueprint (defensive; pairs with the Zod gate). */
export function normalizeBlueprint(raw: unknown): Blueprint | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as { version?: unknown; blocks?: unknown; cover?: unknown };
  if (!Array.isArray(r.blocks)) return null;
  const blocks: BlueprintBlock[] = [];
  for (const b of r.blocks as Record<string, unknown>[]) {
    const template = b.template === 'double-spread' ? 'double-spread' : 'single-pair';
    const overlaySlots = Array.isArray(b.overlaySlots)
      ? (b.overlaySlots as Rect[]).map((o) => ({ x: o.x, y: o.y, w: o.w, h: o.h }))
      : [];
    blocks.push({
      template,
      caption: typeof b.caption === 'string' ? b.caption : '',
      overlaySlots,
      texts: Array.isArray(b.texts) ? (b.texts as TextElement[]) : [],
      qrs: Array.isArray(b.qrs) ? (b.qrs as QrElement[]) : [],
      stickers: Array.isArray(b.stickers) ? (b.stickers as StickerElement[]) : [],
      background: (b.background as Background | null) ?? null,
      preset: typeof b.preset === 'string' ? b.preset : inferPresetKey(template, overlaySlots.length),
    });
  }
  // A cover is optional. When present it is re-sanitised rather than trusted: this function is the
  // boundary every stored blueprint crosses (catalog reads, the preview route, edit-open, apply),
  // so stripping album state here means no consumer can ever receive a blueprint cover naming a
  // customer photo — including rows written before the gate existed, or edited by hand in SQL.
  const cover =
    r.cover && typeof r.cover === 'object' ? blueprintCoverFromConfig(r.cover) : undefined;
  return { version: BLUEPRINT_VERSION, blocks, ...(cover ? { cover } : {}) };
}

// Re-export so callers building fresh blocks have a stable id source (parity with auto-layout).
export { cryptoId };
