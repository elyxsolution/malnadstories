/**
 * CURATED LAYOUT CYCLE — "show me this spread arranged differently", one click at a time.
 *
 * This is NOT a randomizer and NOT a second layout engine. It picks up to three CURATED
 * alternatives for the spread you are on and cycles through them:
 *
 *     Original → Alternative 1 → Alternative 2 → Alternative 3 → Original
 *
 * Where the alternatives come from (in priority order):
 *   1. The ADMIN catalog — the active `layout_templates` rows already loaded into the builder
 *      for the Layouts panel. Which layouts exist, what category they carry and their order are
 *      all administrator-configured in `/admin/templates`; this module only reads that list.
 *   2. The built-in `LAYOUT_PRESETS`, as a fallback so the control still does something useful
 *      on an install whose catalog is empty.
 *
 * Ranking is deterministic — the same spread always offers the same three alternatives in the
 * same order, which is what makes a CYCLE (rather than a shuffle) comprehensible. Candidates
 * that hold exactly as many photos as the spread currently has are preferred, so cycling keeps
 * every placed photo on the page instead of returning some to the tray.
 *
 * Applying an alternative reuses the existing `applyPreset` command (photo preservation,
 * history, dirty/save pipeline); returning to Original restores the snapshot taken when the
 * cycle started. Nothing here writes to the server or knows the renderer exists.
 */

import { requiredBaseCount, type Block, type LayoutTemplate, type Rect } from './model';
import { LAYOUT_PRESETS, type LayoutPreset } from './elements';

/** How many alternatives a layout can offer, per the spec. */
export const MAX_ALTERNATIVES = 3;

/**
 * The shape this module needs from an admin catalog row. Declared structurally rather than
 * importing `ActiveTemplate`, which lives behind `server-only`.
 */
export type CatalogTemplate = {
  id: string;
  name: string;
  geometry: { base: LayoutTemplate; overlays: Rect[] };
};

/** One step of the cycle. Index 0 is always the spread as the user left it. */
export type CycleStep = {
  /** 0 = Original, 1..3 = the curated alternatives. */
  index: number;
  label: string;
  /** Absent on the Original step — that step restores the snapshot instead of applying a preset. */
  preset?: LayoutPreset;
};

const geometryKey = (base: LayoutTemplate, overlays: readonly Rect[]): string =>
  `${base}|${overlays.map((o) => [o.x, o.y, o.w, o.h].map((n) => n.toFixed(4)).join(',')).join(';')}`;

/** How many photos a preset can hold: its base slots plus one per overlay container. */
const capacityOf = (preset: LayoutPreset): number => requiredBaseCount(preset.base) + preset.overlays.length;

/** How many photos this spread currently holds (base slots + filled overlays). */
export function placedCount(block: Block): number {
  return block.photoIds.filter(Boolean).length + block.overlays.filter((o) => o.photoId).length;
}

/**
 * Catalog row → the preset shape `applyPreset` already takes.
 *
 * The key is stamped onto the block and persisted, where `BlockSchema.preset` caps it at 40
 * characters — `t:` plus a uuid is 38, and the slice guarantees the bound holds even if template
 * ids ever get longer. `CATALOG_KEY_PREFIX` is exported so callers can tell a curated catalog
 * layout from one of the built-in presets.
 */
export const CATALOG_KEY_PREFIX = 't:';
const MAX_PRESET_KEY = 40;

const fromCatalog = (t: CatalogTemplate): LayoutPreset => ({
  key: `${CATALOG_KEY_PREFIX}${t.id}`.slice(0, MAX_PRESET_KEY),
  label: t.name,
  hint: t.name,
  base: t.geometry.base,
  overlays: t.geometry.overlays,
});

/**
 * The up-to-three curated alternatives for `block`.
 *
 * Excludes any candidate whose geometry already matches the spread — cycling into a layout
 * identical to the one you are looking at reads as a broken button.
 */
export function layoutAlternatives(block: Block, catalog: readonly CatalogTemplate[]): LayoutPreset[] {
  const pool: LayoutPreset[] = catalog.length > 0 ? catalog.map(fromCatalog) : LAYOUT_PRESETS;
  const currentKey = geometryKey(block.template, block.overlays);
  const want = placedCount(block);

  const candidates = pool.filter((p) => geometryKey(p.base, p.overlays) !== currentKey);

  // Stable rank: exact-fit capacity first, then the same base primitive, then catalog order.
  // `map`-then-`sort` on the index keeps it a stable sort on every engine.
  return candidates
    .map((preset, i) => ({
      preset,
      i,
      fits: capacityOf(preset) === want ? 0 : 1,
      sameBase: preset.base === block.template ? 0 : 1,
    }))
    .sort((a, b) => a.fits - b.fits || a.sameBase - b.sameBase || a.i - b.i)
    .slice(0, MAX_ALTERNATIVES)
    .map((c) => c.preset);
}

/** The full cycle for a spread: Original followed by its alternatives. */
export function layoutCycleSteps(block: Block, catalog: readonly CatalogTemplate[]): CycleStep[] {
  const alts = layoutAlternatives(block, catalog);
  return [
    { index: 0, label: 'Original' },
    ...alts.map((preset, i) => ({ index: i + 1, label: preset.label, preset })),
  ];
}

/** Wrap to the next step. With no alternatives the cycle is a single step and never moves. */
export function nextCycleIndex(current: number, steps: readonly CycleStep[]): number {
  return steps.length === 0 ? 0 : (current + 1) % steps.length;
}

/**
 * THE NEAREST CURATED LAYOUT THAT HOLDS FEWER / MORE PHOTOS.
 *
 * "Less photos" and "More photos" are a different question from the cycle — not "arrange this
 * differently" but "arrange this with a different number of frames" — and they are the two people
 * reach for most. They are NOT a second layout system: the pool, the geometry key and the
 * capacity maths are the ones above, and the result is an ordinary `LayoutPreset` applied through
 * the same `applyPreset` command with the same photo preservation, history and save pipeline.
 *
 * `dir` is -1 for fewer and +1 for more. The answer is the candidate whose capacity is CLOSEST in
 * that direction, so repeated presses walk the catalog one density step at a time rather than
 * jumping to the extreme. Null when nothing lies that way — which is what disables the control
 * instead of offering a press that does nothing.
 */
export function layoutByDensity(
  block: Block,
  catalog: readonly CatalogTemplate[],
  dir: -1 | 1,
): LayoutPreset | null {
  const pool: LayoutPreset[] = catalog.length > 0 ? catalog.map(fromCatalog) : LAYOUT_PRESETS;
  const currentKey = geometryKey(block.template, block.overlays);
  // The spread's own capacity, by the SAME definition presets are measured with.
  const current = requiredBaseCount(block.template) + block.overlays.length;

  const candidates = pool
    .filter((p) => geometryKey(p.base, p.overlays) !== currentKey)
    .map((preset, i) => ({ preset, i, capacity: capacityOf(preset) }))
    .filter((c) => (dir < 0 ? c.capacity < current : c.capacity > current));
  if (candidates.length === 0) return null;

  // Closest capacity in the requested direction; catalog order breaks ties, so the choice is
  // deterministic and pressing the opposite button returns you the way you came.
  candidates.sort((a, b) => Math.abs(a.capacity - current) - Math.abs(b.capacity - current) || a.i - b.i);
  return candidates[0].preset;
}

/** The label for whichever curated layout this spread is currently sitting on. */
export function currentLayoutLabel(block: Block, catalog: readonly CatalogTemplate[]): string {
  const pool: LayoutPreset[] = catalog.length > 0 ? catalog.map(fromCatalog) : LAYOUT_PRESETS;
  const key = geometryKey(block.template, block.overlays);
  const match = pool.find((p) => geometryKey(p.base, p.overlays) === key);
  if (match) return match.label;
  return block.template === 'double-spread' ? 'Double page' : 'Single page';
}
