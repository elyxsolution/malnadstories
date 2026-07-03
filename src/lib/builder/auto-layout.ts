/**
 * Smart Album Creation — deterministic auto-layout engine.
 *
 * PURE functions only: no React, no I/O, no network, no persistence, no side effects.
 * It is a PRODUCER — it emits the existing `Block[]` the Builder already edits and the
 * PDF route already renders. Persistence stays solely with `saveLayout` (which
 * re-validates placed-once / overflow / ownership via SaveLayoutSchema). No AI/LLM.
 *
 * Heuristics use only data the backend already stores: EXIF `takenAt`, image
 * `width`/`height` (orientation), and input order (upload-order fallback).
 */

import {
  type Block,
  type LayoutTemplate,
  type Overlay,
  type Rect,
  PAGE_COST,
  requiredBaseCount,
  placedPhotoIds,
} from './model';

/**
 * A renderer-safe layout preset the engine MAY draw overlay-slot geometry from (Phase 9E).
 * Structurally identical to a layout_templates row's geometry, declared locally so the
 * builder layer never depends on the templates module. Optional everywhere — when no
 * templates are supplied the engine behaves byte-for-byte as before (fixed OVERLAY_SLOTS).
 */
export type TemplateChoice = { base: LayoutTemplate; overlays: Rect[] };

/** Minimal photo shape the engine needs (a projection of the real photos row). */
export type EnginePhoto = {
  id: string;
  width?: number | null;
  height?: number | null;
  takenAt?: string | null;
};

export type PhotoClass = 'pano' | 'landscape' | 'portrait' | 'square';

/** Orientation from dimensions. Unknown dims → 'square' (neutral; pairs cleanly). */
export function classify(p: EnginePhoto): PhotoClass {
  const w = p.width ?? 0;
  const h = p.height ?? 0;
  if (w <= 0 || h <= 0) return 'square';
  const r = w / h;
  if (r >= 2) return 'pano';
  if (r >= 1.2) return 'landscape';
  if (r <= 0.83) return 'portrait';
  return 'square';
}

/** Stable chronological order: takenAt asc (undated last), ties keep upload order. */
export function sortPhotos(photos: EnginePhoto[]): EnginePhoto[] {
  return photos
    .map((p, idx) => ({ p, idx, t: p.takenAt ? Date.parse(p.takenAt) : NaN }))
    .sort((a, b) => {
      const an = Number.isNaN(a.t);
      const bn = Number.isNaN(b.t);
      if (an && bn) return a.idx - b.idx; // both undated → upload order
      if (an) return 1; // undated last
      if (bn) return -1;
      if (a.t !== b.t) return a.t - b.t;
      return a.idx - b.idx;
    })
    .map((x) => x.p);
}

// Four deterministic overlay positions, normalized 0..1 across the open pair. They sit
// clear of the centre gutter (x ≈ 0.5) and within bounds, so they always validate.
const OVERLAY_SLOTS: { x: number; y: number; w: number; h: number }[] = [
  { x: 0.06, y: 0.07, w: 0.2, h: 0.26 },
  { x: 0.74, y: 0.07, w: 0.2, h: 0.26 },
  { x: 0.06, y: 0.67, w: 0.2, h: 0.26 },
  { x: 0.74, y: 0.67, w: 0.2, h: 0.26 },
];

function mk(i: number, template: LayoutTemplate, photoIds: string[], overlays: Overlay[]): Block {
  // Deterministic key (no randomness) — keys are client identity only, never persisted.
  // Rich-element fields start empty (auto-layout only arranges photos).
  return {
    key: `auto-${i}`,
    template,
    photoIds: photoIds.filter(Boolean),
    caption: '',
    overlays,
    texts: [],
    qrs: [],
    stickers: [],
    background: null,
  };
}

/**
 * Generate a full layout that fills exactly `size` content leaves (size/2 blocks).
 * `strategyIndex` selects a deterministic pairing strategy (used by "Suggest another"):
 *   0 — orientation-driven: pano/landscape → double-spread, else pair
 *   1 — pairs-first: everything paired (only pano stays a double-spread)
 *   2 — spread-heavy: anything non-portrait → double-spread, portraits pair
 * Extra photos beyond the base slots become overlays (≤4/spread). Each photo is used at
 * most once; if photos run short, empty single-pair blocks pad to size (a valid draft).
 */
export function autoLayout(
  photos: EnginePhoto[],
  size: number,
  strategyIndex = 0,
  templates: TemplateChoice[] = [],
): Block[] {
  const sorted = sortPhotos(photos);
  const blocksNeeded = Math.max(0, Math.floor(size / 2));
  const mode = ((strategyIndex % 3) + 3) % 3;
  const used = new Set<string>();
  const blocks: Block[] = [];

  let i = 0;
  while (blocks.length < blocksNeeded && i < sorted.length) {
    const a = sorted[i];
    const ca = classify(a);
    const wantsDouble =
      mode === 1 ? ca === 'pano' : mode === 2 ? ca !== 'portrait' : ca === 'pano' || ca === 'landscape';

    if (wantsDouble) {
      blocks.push(mk(blocks.length, 'double-spread', [a.id], []));
      used.add(a.id);
      i += 1;
    } else {
      const b = sorted[i + 1];
      const ids = b ? [a.id, b.id] : [a.id];
      blocks.push(mk(blocks.length, 'single-pair', ids, []));
      used.add(a.id);
      if (b) used.add(b.id);
      i += b ? 2 : 1;
    }
  }

  // Pad to the exact leaf budget so consumed === size (empty slots = a valid draft).
  while (blocks.length < blocksNeeded) blocks.push(mk(blocks.length, 'single-pair', [], []));

  // Per-spread overlay slot geometry. With no templates this returns the fixed
  // OVERLAY_SLOTS for every spread (identical to the original behavior). With active
  // templates, each spread deterministically adopts a matching template's overlay slots,
  // so auto-layout "chooses from active templates" without any randomness.
  const slotsFor = makeSlotsFor(blocks, templates, strategyIndex);

  // Leftover photos → overlays, round-robin across spreads, capped at each spread's slot count.
  const leftovers = sorted.filter((p) => !used.has(p.id));
  distributeOverlays(blocks, leftovers, used, slotsFor);

  return blocks;
}

/** Choose, per spread index, the overlay slot rects to use (template-driven or default). */
function makeSlotsFor(
  blocks: Block[],
  templates: TemplateChoice[],
  strategyIndex: number,
): (index: number) => { x: number; y: number; w: number; h: number }[] {
  if (templates.length === 0) return () => OVERLAY_SLOTS;
  return (index: number) => {
    const base = blocks[index]?.template;
    // Prefer templates whose base matches this spread; fall back to any template.
    const matches = templates.filter((t) => t.base === base);
    const pool = matches.length ? matches : templates;
    const chosen = pool[(index + strategyIndex) % pool.length];
    return chosen.overlays.length ? chosen.overlays : OVERLAY_SLOTS;
  };
}

function distributeOverlays(
  blocks: Block[],
  leftovers: EnginePhoto[],
  used: Set<string>,
  slotsFor: (index: number) => { x: number; y: number; w: number; h: number }[],
): void {
  if (blocks.length === 0) return;
  let bi = 0;
  for (const p of leftovers) {
    let tries = 0;
    while (blocks[bi % blocks.length].overlays.length >= slotsFor(bi % blocks.length).length && tries < blocks.length) {
      bi += 1;
      tries += 1;
    }
    if (tries >= blocks.length) break; // every spread is full
    const idx = bi % blocks.length;
    const block = blocks[idx];
    const slots = slotsFor(idx);
    const slot = slots[block.overlays.length % slots.length];
    block.overlays.push({ photoId: p.id, ...slot });
    used.add(p.id);
    bi += 1;
  }
}

/**
 * Fill empty photo CONTAINERS in the EXISTING blocks from `available` (unplaced ready photos),
 * left-to-right: first every empty BASE slot, then every empty OVERLAY PLACEHOLDER (photoId=null).
 * Overlay geometry and block order are untouched — only unassigned containers receive a photo — so
 * it composes with manual edits and turns a freshly-applied blueprint (placeholders) into a filled
 * album while leaving surplus placeholders visibly empty when photos run short. Placed-once holds
 * (one shared queue). This is the "Auto Fill" action.
 */
export function fillEmptyFrames(blocks: Block[], available: EnginePhoto[]): Block[] {
  const queue = [...available];
  // Pass 1 — base slots across all blocks (preserves the original left-to-right base priority).
  const withBases = blocks.map((b) => {
    const need = requiredBaseCount(b.template);
    const ids = [...b.photoIds];
    for (let i = 0; i < need; i++) {
      if (!ids[i] && queue.length) ids[i] = queue.shift()!.id;
    }
    return { ...b, photoIds: ids.filter(Boolean) };
  });
  // Pass 2 — empty overlay placeholders, in page/overlay order, from whatever photos remain.
  return withBases.map((b) => ({
    ...b,
    overlays: b.overlays.map((o) => (o.photoId || !queue.length ? o : { ...o, photoId: queue.shift()!.id })),
  }));
}

/**
 * Reorder spreads by the earliest capture date among their photos (base ∪ overlay).
 * Undated spreads sink to the end. Reordering never changes which photo sits in which
 * slot → placed-once is preserved.
 */
export function orderByDate(blocks: Block[], photos: EnginePhoto[]): Block[] {
  const time = new Map(photos.map((p) => [p.id, p.takenAt ? Date.parse(p.takenAt) : NaN]));
  const keyTime = (b: Block): number => {
    const ids = [...b.photoIds, ...b.overlays.map((o) => o.photoId)].filter((id): id is string => !!id);
    const ts = ids.map((id) => time.get(id)).filter((t): t is number => typeof t === 'number' && !Number.isNaN(t));
    return ts.length ? Math.min(...ts) : Number.POSITIVE_INFINITY;
  };
  return blocks
    .map((b, idx) => ({ b, idx, t: keyTime(b) }))
    .sort((a, b) => a.t - b.t || a.idx - b.idx)
    .map((x) => x.b);
}

/** "Suggest another structure" — a deterministic alternate full layout. */
export function regenerate(
  photos: EnginePhoto[],
  size: number,
  strategyIndex: number,
  templates: TemplateChoice[] = [],
): Block[] {
  return autoLayout(photos, size, strategyIndex, templates);
}

/** Derived, read-only summary of a generated layout (for the proposal card). Not a data model. */
export function summarizePlan(blocks: Block[], photosAnalyzed: number) {
  const placed = placedPhotoIds(blocks).size;
  const overlaysAdded = blocks.reduce((s, b) => s + b.overlays.length, 0);
  const pagesPlanned = blocks.reduce((s, b) => s + PAGE_COST[b.template], 0);
  return {
    photosAnalyzed,
    pagesPlanned,
    spreadsCreated: blocks.length,
    overlaysAdded,
    photosPlaced: placed,
    unplaced: Math.max(0, photosAnalyzed - placed),
  };
}

/** Serialize Block[] into the exact shape saveLayout expects (placed-once re-validated there). */
export function serializeBlocks(blocks: Block[]) {
  return blocks.map((b) => ({
    template: b.template,
    photoIds: b.photoIds.filter(Boolean),
    caption: b.caption,
    overlays: b.overlays,
  }));
}
