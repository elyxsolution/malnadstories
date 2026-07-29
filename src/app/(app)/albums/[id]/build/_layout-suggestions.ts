'use client';

import { LAYOUT_PRESETS, type LayoutPreset } from '@/lib/builder/elements';
import type { Photo } from '@/lib/builder/photo';
import { orientedAspect } from './_photo-state';
import { orientationOf, type OrientationFilter } from './_tray-filters';

/**
 * SMART LAYOUT SUGGESTIONS — recommendation from metadata, and nothing else.
 *
 * No model, no service, no inference. The only inputs are facts the builder already holds: how
 * many photos are in play, what shape each one is (`orientationOf`, which reads the worker's
 * dimensions or the browser's advisory ones), and whether one of them is dramatically wider or
 * larger than the rest. Those four facts are enough to answer the question a photographer is
 * actually asking — "what goes well with THIS handful of pictures" — and they are enough because
 * layout is mostly a shape problem.
 *
 * TWO RULES THIS MODULE OBEYS.
 *
 *   1. It NEVER changes a layout. It returns ranked suggestions with a reason; applying one is
 *      the user clicking it, which goes through the same `applyPreset` path as the ordinary
 *      grid. A tool that rearranged someone's spread because it had an opinion would be worse
 *      than no tool.
 *
 *   2. Every suggestion carries its WHY, in the photographer's own terms ("four landscape
 *      photos — a 2×2 grid keeps them all the same size"). A recommendation you can't audit is
 *      just a mystery, and the reason is what lets someone disagree with it quickly.
 *
 * The output is ordinary `LayoutPreset` objects from the existing catalog — no new geometry
 * ever reaches the renderer, `saveLayout`, or the schema.
 */

export type LayoutSuggestion = {
  preset: LayoutPreset;
  /** The sentence shown under the preview. Always specific, never "recommended for you". */
  why: string;
  /** Ranking score — internal, not displayed. */
  score: number;
};

/** What the pool of photos looks like, in the only terms layout cares about. */
export type ShapeProfile = {
  count: number;
  portrait: number;
  landscape: number;
  square: number;
  unknown: number;
  /** The widest aspect present — a panorama gives itself away here. */
  widest: number | null;
  /** True when one photo is far wider than every other (a sweeping frame worth the fold). */
  hasPanorama: boolean;
  /** The dominant orientation, when one clearly leads. */
  dominant: OrientationFilter | null;
};

const byKey = (key: string): LayoutPreset | undefined => LAYOUT_PRESETS.find((p) => p.key === key);

/** Summarize a pool of photos into the shape facts the rules below read. */
export function profileShapes(photos: readonly Photo[]): ShapeProfile {
  let portrait = 0;
  let landscape = 0;
  let square = 0;
  let unknown = 0;
  let widest: number | null = null;
  const aspects: number[] = [];

  for (const p of photos) {
    const o = orientationOf(p);
    if (o === 'portrait') portrait += 1;
    else if (o === 'landscape') landscape += 1;
    else if (o === 'square') square += 1;
    else unknown += 1;

    const a = orientedAspect(p);
    if (a !== null) {
      aspects.push(a);
      if (widest === null || a > widest) widest = a;
    }
  }

  const known = portrait + landscape + square;
  const dominant: OrientationFilter | null =
    known === 0
      ? null
      : portrait / known >= 0.6
        ? 'portrait'
        : landscape / known >= 0.6
          ? 'landscape'
          : square / known >= 0.6
            ? 'square'
            : null;

  // A panorama is not just "wide" — it is wide RELATIVE to its neighbours. A set of 16:9
  // frames has no hero; one 3:1 among 4:3s does.
  const median = aspects.length > 0 ? [...aspects].sort((a, b) => a - b)[Math.floor(aspects.length / 2)] : null;
  const hasPanorama = widest !== null && widest >= 2 && (median === null || widest >= median * 1.6);

  return { count: photos.length, portrait, landscape, square, unknown, widest, hasPanorama, dominant };
}

/**
 * Rank the catalog against a shape profile. Returns at most `limit` suggestions, each with the
 * reason it was chosen. An empty pool returns nothing at all rather than a generic default —
 * a suggestion with no evidence behind it is noise.
 */
export function suggestLayouts(profile: ShapeProfile, limit = 3): LayoutSuggestion[] {
  if (profile.count === 0) return [];
  const out: LayoutSuggestion[] = [];
  const add = (key: string, score: number, why: string) => {
    const preset = byKey(key);
    if (preset) out.push({ preset, score, why });
  };

  const { count, portrait, landscape, square, dominant, hasPanorama } = profile;
  const n = (v: number, word: string) => `${v} ${word}${v === 1 ? '' : 's'}`;

  // ── one hero image ────────────────────────────────────────────────────────────
  if (count === 1) {
    if (hasPanorama || (profile.widest ?? 0) >= 1.6) {
      add('full-bleed', 100, 'One wide photo — running it across the fold gives it the whole spread.');
    } else {
      add('single', 96, 'A single photo — one page each side keeps it uncluttered.');
      add('full-bleed', 84, 'Or let it fill both pages edge to edge for a statement opener.');
    }
  }

  // ── a panorama in the pool ────────────────────────────────────────────────────
  if (hasPanorama && count > 1) {
    add('panorama', 94, `One photo is far wider than the rest — a band across the fold suits it.`);
    add('full-bleed', 78, 'A sweeping frame also carries a full-bleed spread on its own.');
  }

  // ── portrait-heavy ────────────────────────────────────────────────────────────
  if (dominant === 'portrait') {
    add('two-vertical', 92, `${n(portrait, 'portrait photo')} — two tall insets match their shape without cropping.`);
    add('single', 74, 'Portraits also sit comfortably one to a page.');
  }

  // ── landscape-heavy ───────────────────────────────────────────────────────────
  if (dominant === 'landscape') {
    if (count >= 4) {
      add('four-grid', 90, `${n(landscape, 'landscape photo')} — a 2×2 grid keeps them all the same size.`);
      add('two-horizontal', 80, 'Two wide bands give each one more room if you prefer fewer per spread.');
    } else {
      add('two-horizontal', 88, `${n(landscape, 'landscape photo')} — stacked bands suit wide frames.`);
    }
  }

  // ── many squares ──────────────────────────────────────────────────────────────
  if (square >= 3 || (dominant === 'square' && count >= 3)) {
    add('four-grid', 89, `${n(square, 'square photo')} — an even grid is the tidiest way to show them.`);
    add('three-grid', 76, 'A trio arrangement works too when you have three to a spread.');
  }

  // ── mixed shapes ──────────────────────────────────────────────────────────────
  if (dominant === null && count >= 4) {
    add('collage', 85, 'Mixed shapes — a scattered five-up absorbs different sizes gracefully.');
    add('three-grid', 72, 'A trio is a calmer option for a mixed set.');
  }

  // ── plain count heuristics, as a floor ────────────────────────────────────────
  if (count >= 5) add('collage', 70, `${n(count, 'photo')} to place — a collage fits the most per spread.`);
  else if (count === 3) add('three-grid', 82, 'Three photos — a trio arrangement fits them exactly.');
  else if (count === 2) add('two-vertical', 78, 'Two photos — one inset on each page.');

  // Highest score wins per preset; a preset suggested twice keeps its best reason.
  const best = new Map<string, LayoutSuggestion>();
  for (const s of out) {
    const cur = best.get(s.preset.key);
    if (!cur || s.score > cur.score) best.set(s.preset.key, s);
  }
  return Array.from(best.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
