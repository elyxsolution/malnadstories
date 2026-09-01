/**
 * ONE STACKING ORDER FOR EVERY VISUAL OBJECT.
 *
 * ── WHAT WAS WRONG ─────────────────────────────────────────────────────────────────────────
 *
 * A surface (a page pair, or one cover face) keeps its objects in four arrays — `overlays`,
 * `texts`, `qrs`, `stickers` — and every renderer drew them by mapping those arrays IN A FIXED
 * SEQUENCE. Paint order was therefore decided by which array an object happened to live in, not
 * by anything the customer could change:
 *
 *     stickers    always on top
 *     qrs
 *     texts
 *     overlays    always at the bottom
 *
 * The Layers menu was real, but it could only reorder an object WITHIN ITS OWN ARRAY. "Bring to
 * front" on a photo overlay brought it to the front of the overlays and left it underneath every
 * text and every sticker, with no way to say otherwise. Putting a sticker behind a photo was not
 * a missing button — it was unrepresentable.
 *
 * ── THE MODEL ──────────────────────────────────────────────────────────────────────────────
 *
 * The four arrays stay exactly as they are — they are the persistence model, the Zod schemas, the
 * jsonb shape and every existing reader. What is added is a single ORDER: `layerOrder`, a list of
 * element ids from BACK to FRONT that spans all four families. It is a permutation, not a second
 * copy of the data, so it cannot disagree with the arrays about what exists — `layerStack` derives
 * the truth from the arrays and uses `layerOrder` only to sort them.
 *
 * ── WHY IT IS BACKWARDS-COMPATIBLE BY CONSTRUCTION ─────────────────────────────────────────
 *
 * `layerOrder` is OPTIONAL, and absent means `LEGACY_LAYER_ORDER` — the exact family sequence
 * above. So every album, page and cover saved before this renders byte-for-byte as it did, with
 * no migration and no backfill. An album only gains a `layerOrder` when someone actually moves
 * something across families, and even then the ordering is stored as ids the arrays already hold.
 *
 * Two reconciliations keep a stored order honest against arrays that changed underneath it:
 *   - ids naming an object that no longer exists are DROPPED (deleted text cannot hold a slot);
 *   - objects the order does not name are APPENDED ON TOP, in legacy order — so a newly added
 *     sticker lands in front, which is what "add" has always meant on both surfaces.
 * Neither can lose an object: the stack is built from the arrays, so everything in them appears
 * exactly once whatever the stored order says.
 *
 * PURE — no React, no I/O, structural parameter types. Shared by the page canvas, the cover
 * canvas, the shared read-only renderers, both PDF routes, the command layer and `useCover`.
 */
import { resolveLayerIndex, type LayerAction } from './elements';

/** The four object families that participate in stacking. Base photo slots are the page itself. */
export const LAYER_KINDS = ['overlay', 'text', 'qr', 'sticker'] as const;
export type LayerKind = (typeof LAYER_KINDS)[number];

/** One object's place in the stack. */
export type LayerObject = { kind: LayerKind; id: string };

/**
 * THE HISTORICAL PAINT ORDER, back to front — the meaning of an absent `layerOrder`.
 *
 * Read off the renderers rather than chosen: `_pair-frame` and `_cover-render` both map overlays,
 * then texts, then QR codes, then stickers. `tests/unified-layers.test.ts` pins that this list and
 * those components still agree, so the compatibility default cannot quietly stop being the truth.
 */
export const LEGACY_LAYER_ORDER: readonly LayerKind[] = ['overlay', 'text', 'qr', 'sticker'];

/**
 * The shape every stacking surface has. Structural on purpose: a page `Block`, the cover's
 * `Block` adapter and a raw `CoverSideElements` all satisfy it without importing each other.
 */
export type LayerSurface = {
  readonly overlays?: readonly { id?: string }[];
  readonly texts?: readonly { id: string }[];
  readonly qrs?: readonly { id: string }[];
  readonly stickers?: readonly { id: string }[];
  /** Ids back-to-front across ALL families. Absent ⇒ `LEGACY_LAYER_ORDER`. */
  readonly layerOrder?: readonly string[];
};

/** Every object on the surface in legacy paint order. The set the stack is always built from. */
function legacyStack(s: LayerSurface): LayerObject[] {
  const out: LayerObject[] = [];
  for (const kind of LEGACY_LAYER_ORDER) {
    const list =
      kind === 'overlay' ? s.overlays : kind === 'text' ? s.texts : kind === 'qr' ? s.qrs : s.stickers;
    for (const el of list ?? []) if (el.id) out.push({ kind, id: el.id });
  }
  return out;
}

/**
 * THE surface's objects, back to front. This is what every renderer and every layer control reads.
 *
 * Stable and total: exactly the objects the arrays hold, each once, in the stored order where one
 * exists and the legacy order otherwise.
 */
export function layerStack(s: LayerSurface): LayerObject[] {
  const legacy = legacyStack(s);
  if (!s.layerOrder || s.layerOrder.length === 0) return legacy;

  const byId = new Map(legacy.map((o) => [o.id, o]));
  const seen = new Set<string>();
  const out: LayerObject[] = [];
  // Stored order first — dropping ids whose object is gone, and ignoring a duplicate id.
  for (const id of s.layerOrder) {
    const o = byId.get(id);
    if (!o || seen.has(id)) continue;
    seen.add(id);
    out.push(o);
  }
  // Anything the order does not name is NEW: it goes on top, in legacy order among themselves.
  for (const o of legacy) if (!seen.has(o.id)) out.push(o);
  return out;
}

/** Where `id` sits in the stack (0 = back), or −1. */
export function layerIndexOf(stack: readonly LayerObject[], id: string): number {
  return stack.findIndex((o) => o.id === id);
}

/**
 * The `layerOrder` to STORE after moving `id` — or `null` when the move is a no-op.
 *
 * The index arithmetic is `resolveLayerIndex`, the same pure function the per-family menu used and
 * the cover shared with it. Only the LIST it operates on changed: the unified stack instead of one
 * family. So "forward", "front", "above X" and "below X" mean exactly what they always meant, and
 * there is still one definition of each.
 */
export function applyLayerAction(s: LayerSurface, id: string, action: LayerAction): string[] | null {
  const stack = layerStack(s);
  const j = resolveLayerIndex(stack, id, action);
  if (j === null) return null;
  const i = layerIndexOf(stack, id);
  const next = stack.map((o) => o.id);
  const [moved] = next.splice(i, 1);
  next.splice(j, 0, moved);
  return next;
}

/**
 * THE Z-INDEX EACH OBJECT PAINTS AT — `id → 1..N`, back to front.
 *
 * Renderers keep their four separate `.map()` calls (which carry genuinely different props per
 * family) and take their paint order from this instead of from the order those maps run in. Using
 * an explicit `z-index` rather than restructuring the markup is deliberate: it is the CSS
 * primitive for exactly this question, it leaves selection chrome, drag handling, drop targets and
 * the crop layers untouched, and it works identically on the editing canvases and in Chromium's
 * PDF render.
 *
 * Values start at 1 so that 0 / `auto` (the page background, the base photo slots) stays beneath
 * every object. Callers put the object layer in its own stacking context (`isolation: isolate`),
 * which is what keeps this band from competing with the editor's chrome z-indexes.
 */
export function layerZIndexes(s: LayerSurface): Map<string, number> {
  const z = new Map<string, number>();
  layerStack(s).forEach((o, i) => z.set(o.id, i + 1));
  return z;
}

/**
 * THE FLOOR FOR CHROME DRAWN INSIDE A SURFACE'S OBJECT BAND.
 *
 * Objects take z-indexes 1..N, and N can reach the sum of the element caps (50 + 30 + 10 + 30 =
 * 120). Anything that must stay ABOVE every object while living inside the same stacking context —
 * the page numbers, the trim and safe-area guides, the fold, the cover's face label — needs a value
 * clear of that ceiling. Before the unified stack those were small numbers (2, 6, 7, 8) that
 * happened to beat objects because objects had no z-index at all; a page with more than a handful
 * of objects would now bury them.
 *
 * Chrome drawn OUTSIDE the isolated layer (the selection handles, the adjustment ghost, the trim
 * ring) needs nothing: isolation already contains the band.
 */
export const LAYER_CHROME_Z = 200;

/**
 * Normalize a `layerOrder` for STORAGE: keep only ids the surface still holds, and drop it
 * entirely when it says nothing the legacy order would not have said.
 *
 * That second half is what keeps existing albums byte-identical. A page whose objects have never
 * been reordered across families serializes no `layerOrder` at all, so its `layout_config` is
 * exactly the object it was before this feature existed.
 */
export function trimLayerOrder(s: LayerSurface): string[] | undefined {
  const legacy = legacyStack(s).map((o) => o.id);
  const stack = layerStack(s).map((o) => o.id);
  if (stack.length === legacy.length && stack.every((id, i) => id === legacy[i])) return undefined;
  return stack;
}
