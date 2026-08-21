/**
 * THE SELECTION MODEL — pure types and set algebra for "what is the user acting on".
 *
 * WHY IT REPLACES THE OLD SHAPE RATHER THAN SITTING BESIDE IT. Before Phase 6 the builder held a
 * single `Selection` discriminated union, implicitly scoped to the focused spread. Multi-selection
 * cannot be bolted onto that without a second, parallel piece of state — and two selection stores
 * drift the moment one of them forgets to clear. So the union becomes a TARGET, the state becomes
 * a SET of targets, and the old single-selection consumers read `primary` (the most recently added
 * target). One store, one truth, and the inspector keeps working unchanged.
 *
 * IDENTITY IS THE WHOLE POINT. Every target is addressed by a stable id — `blockKey` for the
 * spread, the Phase 5.5 overlay id, an element id, or a photo id. Nothing is addressed by array
 * position, which is what makes selection survive reordering, deletion, page navigation, undo/redo
 * and the optimistic temp→real id swap.
 */

import type { BaseSlot, Selection } from './_use-builder';

/**
 * One selectable thing. `blockKey` is carried explicitly (rather than implied by the focused
 * spread) so a selection can span pages and survive navigation.
 */
export type SelectionTarget =
  | { kind: 'base'; blockKey: string; slot: BaseSlot }
  | { kind: 'overlay'; blockKey: string; id: string }
  | { kind: 'text'; blockKey: string; id: string }
  | { kind: 'qr'; blockKey: string; id: string }
  | { kind: 'sticker'; blockKey: string; id: string }
  /** A photo in the tray — not placed on any page. */
  | { kind: 'photo'; photoId: string };

export type SelectionKind = SelectionTarget['kind'];

/**
 * Narrow a cross-page TARGET down to the focused spread's single `Selection` — the shape the
 * contextual toolbar and the inspectors read.
 *
 * The two stores describe the same thing at different scopes, and every surface that changes one
 * must change the other or they drift (that drift is what once let Delete act on an element the
 * user had visibly deselected). Having the conversion in ONE function means a caller can no
 * longer get it subtly wrong. A tray photo has no on-page selection, so it maps to `none`.
 */
export function selectionFromTarget(t: SelectionTarget): Selection {
  switch (t.kind) {
    case 'base':
      return { kind: 'base', slot: t.slot };
    case 'overlay':
    case 'text':
    case 'qr':
    case 'sticker':
      return { kind: t.kind, id: t.id };
    case 'photo':
      return { kind: 'none' };
  }
}

/** A stable, comparable key for set membership. Two targets are the same iff their keys match. */
export function targetKey(t: SelectionTarget): string {
  switch (t.kind) {
    case 'base':
      return `base:${t.blockKey}:${t.slot}`;
    case 'photo':
      return `photo:${t.photoId}`;
    default:
      return `${t.kind}:${t.blockKey}:${t.id}`;
  }
}

/**
 * The selection state: an ORDERED list, because order carries meaning the set does not —
 * `primary` (the last-added target) drives the inspector, and shift-range extension needs an
 * anchor. Membership tests use the derived key set.
 */
export type SelectionState = {
  targets: readonly SelectionTarget[];
  /** Where a shift-range began. Null when the last action wasn't a plain click. */
  anchor: SelectionTarget | null;
};

export const EMPTY_SELECTION: SelectionState = { targets: [], anchor: null };

export function isSelected(sel: SelectionState, t: SelectionTarget): boolean {
  const key = targetKey(t);
  return sel.targets.some((x) => targetKey(x) === key);
}

/** The target the single-selection inspector should describe: the most recent one. */
export function primaryTarget(sel: SelectionState): SelectionTarget | null {
  return sel.targets.length > 0 ? sel.targets[sel.targets.length - 1] : null;
}

/** Replace the selection with exactly this target (a plain click). */
export function selectOnly(t: SelectionTarget): SelectionState {
  return { targets: [t], anchor: t };
}

/** Ctrl/Cmd-click: add if absent, remove if present. The anchor follows the toggled target. */
export function toggleTarget(sel: SelectionState, t: SelectionTarget): SelectionState {
  const key = targetKey(t);
  const without = sel.targets.filter((x) => targetKey(x) !== key);
  if (without.length !== sel.targets.length) {
    // Was selected → deselect. Anchor moves to whatever is now primary.
    return { targets: without, anchor: without.length > 0 ? without[without.length - 1] : null };
  }
  return { targets: [...sel.targets, t], anchor: t };
}

/**
 * Shift-click: select the inclusive range between the anchor and `t` within `ordered`.
 *
 * `ordered` is the caller's visual order (tray order, or the flattened page order), because
 * "everything between these two" only means something relative to what the user can see.
 * Falls back to a plain selection when either end isn't in the list.
 */
export function extendRange(
  sel: SelectionState,
  t: SelectionTarget,
  ordered: readonly SelectionTarget[],
): SelectionState {
  const anchor = sel.anchor;
  if (!anchor) return selectOnly(t);
  const keys = ordered.map(targetKey);
  const from = keys.indexOf(targetKey(anchor));
  const to = keys.indexOf(targetKey(t));
  if (from < 0 || to < 0) return selectOnly(t);
  const [lo, hi] = from <= to ? [from, to] : [to, from];
  // The anchor is deliberately kept, so repeated shift-clicks pivot around the same origin.
  return { targets: ordered.slice(lo, hi + 1), anchor };
}

/** Select everything in `ordered` (Select All). */
export function selectAll(ordered: readonly SelectionTarget[]): SelectionState {
  return { targets: [...ordered], anchor: ordered.length > 0 ? ordered[0] : null };
}

/**
 * Drop targets that no longer exist — the mechanism that makes selection survive deletions,
 * undo/redo and cancelled optimistic uploads without anyone remembering to clear it.
 */
export function pruneSelection(sel: SelectionState, exists: (t: SelectionTarget) => boolean): SelectionState {
  const targets = sel.targets.filter(exists);
  if (targets.length === sel.targets.length) return sel; // identity preserved — no re-render
  const anchor = sel.anchor && exists(sel.anchor) ? sel.anchor : null;
  return { targets, anchor };
}

/**
 * Rewrite photo ids inside a selection — the optimistic temp→real swap.
 *
 * Only `photo` targets carry a photo id; frames and overlays reference photos through the block,
 * so they need no rewriting. Returns the same object when nothing matched.
 */
export function remapSelectionPhotoId(sel: SelectionState, fromId: string, toId: string): SelectionState {
  let changed = false;
  const swap = (t: SelectionTarget): SelectionTarget => {
    if (t.kind === 'photo' && t.photoId === fromId) {
      changed = true;
      return { kind: 'photo', photoId: toId };
    }
    return t;
  };
  const targets = sel.targets.map(swap);
  const anchor = sel.anchor ? swap(sel.anchor) : null;
  return changed ? { targets, anchor } : sel;
}

// ── convenience readers ───────────────────────────────────────────────────────────

export function selectedPhotoIds(sel: SelectionState): string[] {
  return sel.targets.filter((t): t is Extract<SelectionTarget, { kind: 'photo' }> => t.kind === 'photo').map((t) => t.photoId);
}

/** Frame-like targets (base slots + overlays) — the things that HOLD a photo on a page. */
export function selectedFrames(sel: SelectionState): Extract<SelectionTarget, { kind: 'base' | 'overlay' }>[] {
  return sel.targets.filter(
    (t): t is Extract<SelectionTarget, { kind: 'base' | 'overlay' }> => t.kind === 'base' || t.kind === 'overlay',
  );
}

/** Element targets (text / QR / sticker). */
export function selectedElements(sel: SelectionState): Extract<SelectionTarget, { kind: 'text' | 'qr' | 'sticker' }>[] {
  return sel.targets.filter(
    (t): t is Extract<SelectionTarget, { kind: 'text' | 'qr' | 'sticker' }> =>
      t.kind === 'text' || t.kind === 'qr' || t.kind === 'sticker',
  );
}

/**
 * Find the frame currently holding `photoId`, if any.
 *
 * The "placed at most once" invariant means there is either exactly one or none, which is what
 * makes dragging a photo back to the tray unambiguous: there is precisely one frame to clear.
 */
export function findFrameHolding(
  blocks: readonly {
    key: string;
    template: string;
    photoIds: (string | null)[];
    overlays: readonly { id?: string; photoId: string | null }[];
  }[],
  photoId: string,
): { blockKey: string; slot?: BaseSlot; overlayId?: string } | null {
  for (const b of blocks) {
    // The TEMPLATE names the slot, not the row's length. Length worked only while base rows were
    // compact; a row can now be [null, id], and inferring "image" from a one-entry row would name
    // a slot a single-pair does not have.
    if (b.photoIds[0] === photoId) return { blockKey: b.key, slot: b.template === 'double-spread' ? 'image' : 'left' };
    if (b.photoIds[1] === photoId) return { blockKey: b.key, slot: 'right' };
    const ov = b.overlays.find((o) => o.photoId === photoId);
    if (ov?.id) return { blockKey: b.key, overlayId: ov.id };
  }
  return null;
}

/** Distinct block keys touched by the selection — used to scope bulk page operations. */
export function selectedBlockKeys(sel: SelectionState): string[] {
  const keys = new Set<string>();
  for (const t of sel.targets) if (t.kind !== 'photo') keys.add(t.blockKey);
  return Array.from(keys);
}
