'use client';

import { useCallback, useRef, useState } from 'react';
import { useHistoryState } from './_history';
import {
  canAdd,
  cryptoId,
  makeBlock,
  requiredBaseCount,
  makeOverlayId,
  withOverlayIds,
  stripOverlayIds,
  trimBaseIds,
  nextOverlayGeom,
  newUnitOverlayGeoms,
  trimBaseEdits,
  type Background,
  type EditConfig,
  type Block,
  type LayoutTemplate,
  type Overlay,
  type QrElement,
  type StickerElement,
  type TextElement,
  type TextVariant,
} from '@/lib/builder/model';
import { makeQr, makeSticker, makeText, offsetDuplicate, PAIR_ASPECT, type LayoutPreset } from '@/lib/builder/elements';
import { applyLayerAction, trimLayerOrder } from '@/lib/builder/layers';
import type { LayerAction } from '@/lib/builder/elements';

/** Only for a NEW overlay's default placement, which should always start on the page. */

/** A base slot within a block: left/right pages (single-pair) or the spread image. */
export type BaseSlot = 'left' | 'right' | 'image';

/**
 * What is currently selected on the focused spread. Drives the right Inspector:
 * `none` → page settings · `base`/`overlay` → photo tool · `text` → typography · `qr` → QR.
 */
export type Selection =
  | { kind: 'none' }
  | { kind: 'base'; slot: BaseSlot }
  | { kind: 'overlay'; id: string }
  | { kind: 'text'; id: string }
  | { kind: 'qr'; id: string }
  | { kind: 'sticker'; id: string }
  /**
   * The surface's backdrop itself (Cover Editor 2.0). A cover's background is a design decision
   * you make as often as any other — colour, artwork, a photo — so it needs to be a thing you can
   * click and get tools for, not a setting buried in a panel. Content pages do not select it
   * today, which is why every consumer is written with a `default` branch; adding it here is
   * additive and inert for them.
   */
  | { kind: 'background' };

export const NO_SELECTION: Selection = { kind: 'none' };

/**
 * Remove a photo from every base slot + overlay across all blocks.
 *
 * THIS IS NO LONGER A PLACEMENT RULE — it is the DELETION path. A photo is a reusable source
 * asset now, so putting it in a frame no longer takes it out of the frame it was already in; the
 * only thing that still has to reach every placement at once is the photo ceasing to exist
 * (deleted from the tray, or a failed upload cancelled). Assignment does its own local write.
 *
 * The base half VACATES the slot rather than removing it. Filtering the id out used to compact
 * the array, so taking a photo off the LEFT page slid the right page's photo onto the left —
 * an edit to one page silently moving a different page's picture. The hole stays; trailing ones
 * are trimmed so an emptied unit still persists as `[]`. A vacated slot also drops its placement
 * edit: the frame is empty, and the crop described a photo that no longer exists.
 */
function stripPhoto(list: Block[], id: string): Block[] {
  return list.map((b) => {
    const inBase = b.photoIds.includes(id);
    const overlays = b.overlays.filter((o) => o.photoId !== id);
    if (!inBase && overlays.length === b.overlays.length) return b;
    const baseEdits = inBase
      ? trimBaseEdits((b.baseEdits ?? []).map((e, i) => (b.photoIds[i] === id ? null : e)))
      : b.baseEdits;
    return {
      ...b,
      photoIds: trimBaseIds(b.photoIds.map((pid) => (pid === id ? null : pid))),
      baseEdits,
      overlays,
    };
  });
}

/**
 * Write one positional base-slot edit, keeping the array parallel to `photoIds`.
 *
 * Positional for exactly the reason `photoIds` is: index 0 is the left page and 1 the right, and
 * a compacting array would make clearing the left page's crop apply the right page's crop to it.
 * Trailing nulls are trimmed, so a unit that has never forked stores nothing at all.
 */
function withBaseEdit(b: Block, index: number, edit: EditConfig | null): Block {
  const next = [...(b.baseEdits ?? [])];
  while (next.length <= index) next.push(null);
  next[index] = edit;
  return { ...b, baseEdits: trimBaseEdits(next) };
}

/** Index of a named base slot. `'image'` (double-spread) and `'left'` are both slot 0. */
const slotIndex = (slot: BaseSlot): number => (slot === 'right' ? 1 : 0);

/**
 * The builder's editable layout state — history-backed (undo/redo), with every block- and
 * element-level mutation in one reusable place. UI components receive these callbacks and
 * stay presentational. Persistence is unchanged: the orchestrator serializes + calls the
 * existing `saveLayout`. No new persistence path is introduced here.
 */
export function useBlocks(initial: Block[], pairRatio: number = PAIR_ASPECT, onEntry?: () => void) {
  // Normalize on entry: every overlay inside builder state carries a stable id from here on.
  const hist = useHistoryState<Block[]>(withOverlayIds(initial));
  const blocks = hist.value;
  const [dirty, setDirty] = useState(false);

  /**
   * The layout's history is no longer the only one — image adjustments have their own (see
   * `_use-photo-edits`). `onEntry` reports each new layout step to the shared timeline that
   * orders the two, so one ⌘Z always undoes whatever actually happened last. Called from the
   * two gates that create an entry — an unbatched mutation, and the opening of a batch — so a
   * bulk command stays one step here exactly as it is one step in `useHistoryState`.
   */
  const onEntryRef = useRef(onEntry);
  onEntryRef.current = onEntry;
  const batching = useRef(0);
  const noteEntry = useCallback(() => {
    if (batching.current === 0) onEntryRef.current?.();
  }, []);

  const mutate = useCallback(
    (updater: (prev: Block[]) => Block[]) => {
      noteEntry();
      hist.set(updater);
      setDirty(true);
    },
    [hist, noteEntry],
  );


  const undo = useCallback(() => {
    hist.undo();
    setDirty(true);
  }, [hist]);
  const redo = useCallback(() => {
    hist.redo();
    setDirty(true);
  }, [hist]);

  const patchBlockByKey = (prev: Block[], key: string, patch: Partial<Block>) =>
    prev.map((b) => (b.key === key ? { ...b, ...patch } : b));

  // ── blocks ─────────────────────────────────────────────────────────────────
  /**
   * A FRESH SPREAD'S STARTING FRAMES: one empty full-page photo frame PER PAGE.
   *
   * They carry no photo and create no photo record — they are containers, exactly like ones the
   * customer places by hand, and the pages underneath stay backgrounds. That is the whole point of
   * them being overlays rather than a return of `Block.photoIds`: each can be moved, resized,
   * cropped, replaced, deleted and undone independently, and they round-trip through
   * `layout_config` with every other overlay. See `newUnitOverlayGeoms` for why a pair gets two
   * and a panorama gets one.
   */
  const newUnitOverlays = (template: LayoutTemplate): Overlay[] =>
    newUnitOverlayGeoms(template).map((geom) => ({ id: makeOverlayId(), photoId: null, ...geom }));

  const addBlock = (template: LayoutTemplate, size: number) => {
    if (!canAdd(blocks, size, template)) return;
    // A manually-added spread maps to the base preset (Single / Full bleed) for accurate breakdowns.
    const preset = template === 'double-spread' ? 'full-bleed' : 'single';
    mutate((prev) => [...prev, { ...makeBlock(template), preset, overlays: newUnitOverlays(template) }]);
  };

  const patchBlock = (key: string, patch: Partial<Block>) => mutate((prev) => patchBlockByKey(prev, key, patch));

  const removeBlock = (key: string) => mutate((prev) => prev.filter((b) => b.key !== key));

  const moveBlock = (key: string, dir: -1 | 1) =>
    mutate((prev) => {
      const i = prev.findIndex((b) => b.key === key);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  const reorderBlocks = (from: number, to: number) =>
    mutate((prev) => {
      if (from === to || from < 0 || to < 0 || from >= prev.length || to >= prev.length) return prev;
      const next = [...prev];
      const [m] = next.splice(from, 1);
      next.splice(to, 0, m);
      return next;
    });

  const insertBlockAt = (index: number, template: LayoutTemplate, size: number) => {
    if (!canAdd(blocks, size, template)) return;
    mutate((prev) => {
      const next = [...prev];
      // Inserted pages are new pages — same starting frames as `addBlock`, or "insert here" would
      // hand back a blank sheet while the Add button hands back a usable one.
      next.splice(Math.max(0, Math.min(index, next.length)), 0, { ...makeBlock(template), overlays: newUnitOverlays(template) });
      return next;
    });
  };

  /**
   * Duplicate a page's LAYOUT (template, background, text, QR — with fresh ids) directly after it.
   *
   * Photos are NOT copied, and the duplicate's frames start empty.
   *
   * That used to be forced: a photo could be placed at most once, so a copy was impossible. It is
   * possible now — a duplicated frame would simply be a second placement with its own edit — and
   * this is DELIBERATELY left as it was, because "duplicate this page" is a layout command and
   * silently doubling every photo in the book is not what it has ever meant. Changing it is a
   * product decision, not a consequence of the placement model.
   */
  const duplicateBlock = (key: string, size: number) => {
    const src = blocks.find((b) => b.key === key);
    if (!src || !canAdd(blocks, size, src.template)) return;
    const clone: Block = {
      ...makeBlock(src.template),
      background: src.background,
      // Photo FRAMES are layout and are copied; the photos in them are not (see above). The
      // frame's own edit goes with its photo — a crop describes a picture, and there is none here.
      overlays: src.overlays.map((o) => ({ ...o, id: makeOverlayId(), photoId: null, edit: null })),
      texts: src.texts.map((t) => ({ ...t, id: cryptoId() })),
      qrs: src.qrs.map((q) => ({ ...q, id: cryptoId() })),
      stickers: src.stickers.map((s) => ({ ...s, id: cryptoId() })),
    };
    mutate((prev) => {
      const i = prev.findIndex((b) => b.key === key);
      const next = [...prev];
      next.splice(i + 1, 0, clone);
      return next;
    });
    return clone.key;
  };

  // ── base photo slots ─────────────────────────────────────────────────────────
  /**
   * Put a photo in ONE named slot. Strictly positional: "right" means index 1, even when index 0
   * is empty. The old "no left → fill left first" redirect made a page's photo land somewhere
   * other than where it was dropped, which is the same class of surprise as the compaction below.
   */
  const assignBaseSlot = (key: string, slot: BaseSlot, photoId: string) =>
    mutate((prev) =>
      // NO `stripPhoto`. Placing a photo used to take it out of wherever it already was, because
      // a photo could be placed only once. It is a reusable source asset now, so this writes ONE
      // frame and leaves every other placement of the same image exactly as it is.
      prev.map((b) => {
        if (b.key !== key) return b;
        const i = slotIndex(slot);
        // A DIFFERENT photo arriving in the frame resets the frame's own edit: the crop, zoom and
        // pan described the picture that was here, and carrying them onto a new one would frame it
        // by numbers chosen for something else. Re-placing the SAME photo changes nothing.
        const changed = (b.photoIds[i] ?? null) !== photoId;
        const withPhoto =
          slot === 'image'
            ? { ...b, photoIds: [photoId] }
            : (() => {
                const ids: (string | null)[] = [b.photoIds[0] ?? null, b.photoIds[1] ?? null];
                ids[i] = photoId;
                return { ...b, photoIds: trimBaseIds(ids) };
              })();
        return changed ? withBaseEdit(withPhoto, i, null) : withPhoto;
      }),
    );

  /**
   * Empty ONE slot, leaving the other page exactly where it is.
   *
   * This is the fix for the reported migration: clearing the left photo used to `slice(1)`, which
   * moved the right page's photo to index 0 — onto the left page. Deleting a picture from one page
   * must never rearrange another page, so the slot becomes a hole and the neighbour keeps its
   * index. Trailing holes are trimmed, so emptying the last photo returns the unit to `[]` and
   * the page renders as its background alone.
   */
  const clearBaseSlot = (key: string, slot: BaseSlot) =>
    mutate((prev) =>
      prev.map((b) => {
        if (b.key !== key) return b;
        const i = slotIndex(slot);
        const emptied =
          slot === 'image'
            ? { ...b, photoIds: [] }
            : (() => {
                const ids: (string | null)[] = [b.photoIds[0] ?? null, b.photoIds[1] ?? null];
                ids[i] = null;
                return { ...b, photoIds: trimBaseIds(ids) };
              })();
        // The placement is gone, so its edit goes with it — an edit at an empty index describes
        // nothing, and leaving it would silently re-frame whatever is dropped in next.
        return withBaseEdit(emptied, i, null);
      }),
    );

  // ── overlays ───────────────────────────────────────────────────────────────
  // Every operation below addresses an overlay by its STABLE ID rather than its array
  // position. Behaviour is identical for a single overlay, but an id survives reordering and
  // deletion — which array indices do not, and which is what made index-based selection unsafe
  // to build multi-selection on.
  /**
   * Append an overlay. Returns its new id so the caller can select it immediately.
   *
   * `photoId` may be NULL — an empty container is a first-class overlay (`Overlay.photoId` has
   * always been nullable, which is what lets a blueprint store geometry with no photos). "Add
   * overlay" creates one of these and the customer fills it afterwards; no photo record exists
   * until a photo is actually attached.
   *
   * `at` says WHERE:
   *   `{x, y}`   the normalized CENTRE the customer chose — a drop point. Dropping a photo onto
   *              the page is the ordinary way a photo reaches a page, so "it appears where I
   *              dropped it" is the only acceptable answer.
   *   `'center'` the middle of the page, cascaded slightly per existing overlay so repeated adds
   *              are visibly separate rather than stacked exactly. This is what "Add overlay"
   *              with nothing else selected means.
   *   omitted    the original cascading default placement, unchanged.
   */
  const addOverlay = (key: string, photoId: string | null, at?: { x: number; y: number } | 'center') => {
    const id = makeOverlayId();
    mutate((prev) =>
      // NOTHING IS DISPLACED. A new container takes a REFERENCE to the source photo; every frame
      // already showing that photo keeps showing it, each with its own edit.
      prev.map((b) => {
        if (b.key !== key) return b;
        // `nextOverlayGeom` is shared with the cover's add-overlay, so a new frame starts in the
        // same place and at the same size whichever surface asked for it.
        const overlay: Overlay = { id, photoId, ...nextOverlayGeom(b.overlays.length, at) };
        return { ...b, overlays: [...b.overlays, overlay] };
      }),
    );
    return id;
  };

  const replaceOverlay = (key: string, overlayId: string, photoId: string) =>
    mutate((prev) =>
      prev.map((b) =>
        b.key === key
          ? {
              ...b,
              overlays: b.overlays.map((o) =>
                o.id === overlayId
                  ? // A different photo resets this frame's own edit, for the same reason a base
                    // slot's does; re-picking the same photo leaves the framing alone.
                    { ...o, photoId, ...(o.photoId === photoId ? {} : { edit: null }) }
                  : o,
              ),
            }
          : b,
      ),
    );

  // Whole-array patch (drag/resize commits the full set). Ids are preserved because the caller
  // maps over the existing overlays; normalized anyway as a backstop.
  const patchOverlays = (key: string, overlays: Overlay[]) =>
    mutate((prev) =>
      patchBlockByKey(prev, key, { overlays: overlays.map((o) => (o.id ? o : { ...o, id: makeOverlayId() })) }),
    );

  const removeOverlay = (key: string, overlayId: string) =>
    mutate((prev) =>
      prev.map((b) => (b.key === key ? { ...b, overlays: b.overlays.filter((o) => o.id !== overlayId) } : b)),
    );

  const reorderOverlay = (key: string, overlayId: string, dir: -1 | 1) =>
    mutate((prev) =>
      prev.map((b) => {
        if (b.key !== key) return b;
        const i = b.overlays.findIndex((o) => o.id === overlayId);
        const j = i + dir;
        if (i < 0 || j < 0 || j >= b.overlays.length) return b;
        const ov = [...b.overlays];
        [ov[i], ov[j]] = [ov[j], ov[i]];
        return { ...b, overlays: ov };
      }),
    );

  /**
   * Duplicate an overlay — copies its frame, its photo AND its placement edit, offset slightly,
   * appended on top. Returns the new overlay's id.
   *
   * This always intended to produce a SECOND PLACEMENT of the same photo, and it was the one
   * operation that already did. It was also, until placements existed, unsaveable: the copy made
   * the id appear twice and `SaveLayoutSchema`'s placed-once refinement rejected the next save.
   * With one image reusable it is an ordinary second instance — it starts out identical (the edit
   * is copied) and diverges the moment either copy is adjusted.
   */
  const duplicateOverlay = (key: string, overlayId: string) => {
    let newId: string | undefined;
    mutate((prev) =>
      prev.map((b) => {
        if (b.key !== key) return b;
        const src = b.overlays.find((o) => o.id === overlayId);
        if (!src) return b;
        const clone: Overlay = offsetDuplicate({ ...src, id: makeOverlayId() });
        newId = clone.id;
        return { ...b, overlays: [...b.overlays, clone] };
      }),
    );
    return newId;
  };

  // ── placement edits ────────────────────────────────────────────────────────────
  /**
   * WRITE ONE FRAME'S OWN EDIT — the single mutation behind every image adjustment on a page.
   *
   * It is addressed by FRAME (block + slot | overlay), not by photo, and that is the whole point:
   * the same photo can be in four frames, and adjusting one of them must leave the other three
   * untouched. The old path wrote `photos.edit_config`, which is shared by construction, so it
   * could not express this at all.
   *
   * Passing `null` un-forks the frame, returning it to inheriting the source photo's edit — which
   * is what "reset this placement" means and what clearing a slot does.
   */
  const patchFrameEdit = (
    key: string,
    ref: { slot?: BaseSlot; overlayId?: string },
    edit: EditConfig | null,
  ) =>
    mutate((prev) =>
      prev.map((b) => {
        if (b.key !== key) return b;
        if (ref.slot) return withBaseEdit(b, slotIndex(ref.slot), edit);
        if (ref.overlayId) {
          return { ...b, overlays: b.overlays.map((o) => (o.id === ref.overlayId ? { ...o, edit } : o)) };
        }
        return b;
      }),
    );

  /**
   * The same write as `patchFrameEdit`, but as a CORRECTION rather than an action — it amends the
   * present without pushing a layout undo entry (see `useHistoryState.amend` and `amendText`).
   *
   * Image adjustments have their OWN undo lane (`usePhotoEditHistory`), which is what orders a
   * crop against a page move in the shared timeline. Now that an adjustment lands in `Block[]`
   * rather than on the `photos` row, going through `mutate` would push a SECOND entry for the
   * same gesture and one ⌘Z would appear to do nothing. So the geometry lane records it and the
   * layout lane merely carries the value.
   */
  const amendFrameEdit = (
    key: string,
    ref: { slot?: BaseSlot; overlayId?: string },
    edit: EditConfig | null,
  ) => {
    hist.amend((prev) =>
      prev.map((b) => {
        if (b.key !== key) return b;
        if (ref.slot) return withBaseEdit(b, slotIndex(ref.slot), edit);
        if (ref.overlayId) {
          return { ...b, overlays: b.overlays.map((o) => (o.id === ref.overlayId ? { ...o, edit } : o)) };
        }
        return b;
      }),
    );
    setDirty(true);
  };

  /** Read a frame's own (possibly absent) edit — the `before` half of an adjustment gesture. */
  const frameEdit = (key: string, ref: { slot?: BaseSlot; overlayId?: string }): EditConfig | null | undefined => {
    const b = blocks.find((x) => x.key === key);
    if (!b) return undefined;
    if (ref.slot) return (b.baseEdits ?? [])[slotIndex(ref.slot)];
    if (ref.overlayId) return b.overlays.find((o) => o.id === ref.overlayId)?.edit;
    return undefined;
  };

  // ── text ─────────────────────────────────────────────────────────────────────
  const addText = (key: string, variant: TextVariant, overrides: Partial<TextElement> = {}) => {
    const el = makeText(variant, overrides);
    mutate((prev) => prev.map((b) => (b.key === key ? { ...b, texts: [...b.texts, el] } : b)));
    return el.id;
  };

  const patchText = (key: string, id: string, patch: Partial<TextElement>) =>
    mutate((prev) =>
      prev.map((b) =>
        b.key === key ? { ...b, texts: b.texts.map((t) => (t.id === id ? { ...t, ...patch } : t)) } : b,
      ),
    );

  /**
   * The SAME write as `patchText`, but as a CORRECTION rather than an action: it amends the
   * present without pushing an undo entry (see `useHistoryState.amend`). Auto-fit is its caller —
   * the box tightening around freshly-measured text is a consequence of the size change the user
   * made, not a second edit for them to undo. It still marks the album dirty, so the corrected
   * geometry is saved like any other.
   */
  const amendText = (key: string, id: string, patch: Partial<TextElement>) => {
    hist.amend((prev) =>
      prev.map((b) =>
        b.key === key ? { ...b, texts: b.texts.map((t) => (t.id === id ? { ...t, ...patch } : t)) } : b,
      ),
    );
    setDirty(true);
  };

  const removeText = (key: string, id: string) =>
    mutate((prev) => prev.map((b) => (b.key === key ? { ...b, texts: b.texts.filter((t) => t.id !== id) } : b)));

  const duplicateText = (key: string, id: string) => {
    let newId: string | undefined;
    mutate((prev) =>
      prev.map((b) => {
        if (b.key !== key) return b;
        const src = b.texts.find((t) => t.id === id);
        if (!src) return b;
        const clone = offsetDuplicate({ ...src, id: cryptoId() });
        newId = clone.id;
        return { ...b, texts: [...b.texts, clone] };
      }),
    );
    return newId;
  };

  const reorderText = (key: string, id: string, dir: -1 | 1) =>
    mutate((prev) =>
      prev.map((b) => {
        if (b.key !== key) return b;
        const i = b.texts.findIndex((t) => t.id === id);
        const j = i + dir;
        if (i < 0 || j < 0 || j >= b.texts.length) return b;
        const ts = [...b.texts];
        [ts[i], ts[j]] = [ts[j], ts[i]];
        return { ...b, texts: ts };
      }),
    );

  // ── QR ───────────────────────────────────────────────────────────────────────
  const addQr = (key: string, data: string, overrides: Partial<QrElement> = {}) => {
    const el = makeQr(data, overrides, pairRatio);
    mutate((prev) => prev.map((b) => (b.key === key ? { ...b, qrs: [...b.qrs, el] } : b)));
    return el.id;
  };

  const patchQr = (key: string, id: string, patch: Partial<QrElement>) =>
    mutate((prev) =>
      prev.map((b) => (b.key === key ? { ...b, qrs: b.qrs.map((q) => (q.id === id ? { ...q, ...patch } : q)) } : b)),
    );

  const removeQr = (key: string, id: string) =>
    mutate((prev) => prev.map((b) => (b.key === key ? { ...b, qrs: b.qrs.filter((q) => q.id !== id) } : b)));

  const reorderQr = (key: string, id: string, dir: -1 | 1) =>
    mutate((prev) =>
      prev.map((b) => {
        if (b.key !== key) return b;
        const i = b.qrs.findIndex((q) => q.id === id);
        const j = i + dir;
        if (i < 0 || j < 0 || j >= b.qrs.length) return b;
        const qs = [...b.qrs];
        [qs[i], qs[j]] = [qs[j], qs[i]];
        return { ...b, qrs: qs };
      }),
    );

  // ── stickers ───────────────────────────────────────────────────────────────────
  const addSticker = (key: string, stickerId: string, overrides: Partial<StickerElement> = {}) => {
    const el = makeSticker(stickerId, pairRatio, overrides);
    mutate((prev) => prev.map((b) => (b.key === key ? { ...b, stickers: [...b.stickers, el] } : b)));
    return el.id;
  };

  const patchSticker = (key: string, id: string, patch: Partial<StickerElement>) =>
    mutate((prev) =>
      prev.map((b) =>
        b.key === key ? { ...b, stickers: b.stickers.map((s) => (s.id === id ? { ...s, ...patch } : s)) } : b,
      ),
    );

  /**
   * The same write as `patchSticker`, but as a CORRECTION — no undo entry (see
   * `useHistoryState.amend` and `amendText`).
   *
   * Its caller is the sticker box fit: a placed sticker's box is created pixel-square and then
   * tightened onto the artwork's real aspect once the image has been measured. That tightening is
   * a consequence of placing the sticker, not a second thing the customer did — pushing it as its
   * own entry would make the first ⌘Z appear to do nothing.
   */
  const amendSticker = (key: string, id: string, patch: Partial<StickerElement>) => {
    hist.amend((prev) =>
      prev.map((b) =>
        b.key === key ? { ...b, stickers: b.stickers.map((s) => (s.id === id ? { ...s, ...patch } : s)) } : b,
      ),
    );
    setDirty(true);
  };

  const removeSticker = (key: string, id: string) =>
    mutate((prev) => prev.map((b) => (b.key === key ? { ...b, stickers: b.stickers.filter((s) => s.id !== id) } : b)));

  const duplicateSticker = (key: string, id: string) => {
    let newId: string | undefined;
    mutate((prev) =>
      prev.map((b) => {
        if (b.key !== key) return b;
        const src = b.stickers.find((s) => s.id === id);
        if (!src) return b;
        const clone = offsetDuplicate({ ...src, id: cryptoId() });
        newId = clone.id;
        return { ...b, stickers: [...b.stickers, clone] };
      }),
    );
    return newId;
  };

  const reorderSticker = (key: string, id: string, dir: -1 | 1) =>
    mutate((prev) =>
      prev.map((b) => {
        if (b.key !== key) return b;
        const i = b.stickers.findIndex((s) => s.id === id);
        const j = i + dir;
        if (i < 0 || j < 0 || j >= b.stickers.length) return b;
        const ss = [...b.stickers];
        [ss[i], ss[j]] = [ss[j], ss[i]];
        return { ...b, stickers: ss };
      }),
    );

  // ── layer order ───────────────────────────────────────────────────────────────
  /**
   * MOVE ONE OBJECT THROUGH THE PAGE'S UNIFIED STACK.
   *
   * The old implementation reordered an object inside ITS OWN family array, which is why a photo
   * overlay could never be brought in front of a text: the renderers painted the families in a
   * fixed sequence, so "front" only ever meant "front of the overlays". This writes `layerOrder`
   * — one permutation of ids spanning overlays, texts, QR codes and stickers — and the renderers
   * take their paint order from it.
   *
   * The element arrays are NOT touched. They remain the persistence model, so nothing about the
   * schemas, the jsonb shape or any existing reader changes, and an object cannot be lost by a
   * reorder. `trimLayerOrder` drops the field again whenever the resulting stack is the legacy
   * one, so an album that has never been reordered stays byte-identical on disk.
   */
  const moveLayer = (key: string, id: string, action: LayerAction) =>
    mutate((prev) =>
      prev.map((b) => {
        if (b.key !== key) return b;
        const next = applyLayerAction(b, id, action);
        if (!next) return b;
        return { ...b, layerOrder: trimLayerOrder({ ...b, layerOrder: next }) };
      }),
    );

  // ── background ────────────────────────────────────────────────────────────────
  const setBackground = (key: string, background: Background | null) => patchBlock(key, { background });

  const setBackgroundAll = (background: Background | null) =>
    mutate((prev) => prev.map((b) => ({ ...b, background })));

  // ── presets (reuses the existing apply-template-to-one-block flow) ─────────────
  /**
   * Apply a layout preset to a block. Sets the base primitive, keeps base photos that
   * still fit, and fills the preset's overlay slots from (existing overlays → dropped
   * base → available tray photos). Photos that don't fit return to the tray — never lost.
   */
  const applyPreset = (key: string, preset: LayoutPreset, availablePhotoIds: string[]) => {
    const block = blocks.find((b) => b.key === key);
    if (!block) return;
    const need = requiredBaseCount(preset.base);
    const baseFilled = block.photoIds.filter((id): id is string => !!id);
    const keptBase = baseFilled.slice(0, need);
    const droppedBase = baseFilled.slice(need);

    const seen = new Set<string>(keptBase);
    const pool = [...block.overlays.map((o) => o.photoId), ...droppedBase, ...availablePhotoIds].filter(
      (id) => id && !seen.has(id) && (seen.add(id), true),
    );

    // Keep EVERY preset overlay slot — filled from the pool, else an empty placeholder (photoId=null)
    // so the layout's containers stay visible and fillable when photos are insufficient.
    const newOverlays: Overlay[] = preset.overlays.map((slot, i) => ({
      id: makeOverlayId(),
      photoId: pool[i] ?? null,
      x: slot.x,
      y: slot.y,
      w: slot.w,
      h: slot.h,
    }));

    // Stamp the preset id so blueprint breakdowns are accurate + the choice survives round-trips.
    // `baseEdits` is dropped: `keptBase` COMPACTS the base row (it filters holes before slicing),
    // so an index that meant "the right page" before the preset may mean "the left page" after it.
    // Positional edits that no longer describe their slot are worse than none, and the frames are
    // being rebuilt anyway — every slot goes back to inheriting its photo's own edit.
    patchBlock(key, {
      template: preset.base,
      photoIds: keptBase,
      baseEdits: undefined,
      overlays: newOverlays,
      preset: preset.key,
    });
  };

  /**
   * Run several mutations as ONE undo entry (Phase 6). Every bulk command wraps its work in
   * this, so "remove 12 photos from their pages" is one ⌘Z, not twelve. Nesting is safe.
   *
   * It is also one entry in the SHARED timeline: the depth counter suppresses the per-mutation
   * report from `mutate`, so a twelve-frame command contributes exactly one step there too.
   */
  const batch = useCallback(
    (fn: () => void) => {
      if (batching.current > 0) {
        hist.batch(fn);
        setDirty(true);
        return;
      }
      noteEntry();
      batching.current += 1;
      try {
        hist.batch(fn);
      } finally {
        batching.current -= 1;
      }
      setDirty(true);
    },
    [hist, noteEntry],
  );

  // ── photos lifecycle (block side only — photo rows are owned by the orchestrator) ──
  const removePhotoEverywhere = (id: string) => mutate((prev) => stripPhoto(prev, id));

  /**
   * Clear a set of frames in one pass — the block-side primitive behind "remove from page" and
   * "clear placement". Doing it as a single `mutate` (rather than N calls) keeps it to one
   * history entry even outside a batch, and touches each block at most once.
   */
  const clearFrames = (frames: readonly { blockKey: string; slot?: BaseSlot; overlayId?: string }[]) =>
    mutate((prev) =>
      prev.map((b) => {
        const mine = frames.filter((f) => f.blockKey === b.key);
        if (mine.length === 0) return b;
        let photoIds = b.photoIds;
        let overlays = b.overlays;
        let baseEdits = b.baseEdits;
        for (const f of mine) {
          if (f.slot) {
            // Vacate the named slot and leave the other page untouched — the same positional
            // rule `clearBaseSlot` uses. Slicing used to shift the survivor onto the wrong page.
            const i = slotIndex(f.slot);
            if (f.slot === 'image') photoIds = [];
            else {
              const ids: (string | null)[] = [photoIds[0] ?? null, photoIds[1] ?? null];
              ids[i] = null;
              photoIds = trimBaseIds(ids);
            }
            baseEdits = trimBaseEdits((baseEdits ?? []).map((e, j) => (j === i ? null : e)));
          } else if (f.overlayId) {
            // An overlay keeps its CONTAINER (geometry is the user's layout work); the photo
            // reference AND the framing chosen for that photo are what get cleared.
            overlays = overlays.map((o) => (o.id === f.overlayId ? { ...o, photoId: null, edit: null } : o));
          }
        }
        return { ...b, photoIds, baseEdits, overlays };
      }),
    );

  /** Remove a set of photos from every page at once (bulk delete's block-side half). */
  const removePhotosEverywhere = (ids: readonly string[]) =>
    mutate((prev) => ids.reduce((acc, id) => stripPhoto(acc, id), prev));

  /**
   * Swap an optimistic photo id for the real one the server just issued (Phase 3).
   *
   * Rewrites the WHOLE history stack, not just the present, and deliberately does NOT go
   * through `mutate`: a remap is bookkeeping, not an edit. It must not create an undo step,
   * must not mark the album dirty, and must not be undoable — undoing "the photo got its
   * real id" is meaningless, and leaving old snapshots on the temp id would make undo
   * resurrect an id that no longer exists.
   */
  const remapPhotoId = useCallback(
    (fromId: string, toId: string) => {
      if (fromId === toId) return;
      hist.rewrite((list) => {
        let touched = false;
        const next = list.map((b) => {
          const inBase = b.photoIds.includes(fromId);
          const inOverlay = b.overlays.some((o) => o.photoId === fromId);
          if (!inBase && !inOverlay) return b;
          touched = true;
          return {
            ...b,
            photoIds: b.photoIds.map((pid) => (pid === fromId ? toId : pid)),
            overlays: b.overlays.map((o) => (o.photoId === fromId ? { ...o, photoId: toId } : o)),
          };
        });
        return touched ? next : list;
      });
    },
    [hist],
  );

  // ── persistence shape ──────────────────────────────────────────────────────────
  const serialize = () =>
    blocks.map((b) => ({
      template: b.template,
      // Trailing holes only — an interior `null` IS the layout ("right page filled, left empty")
      // and compacting it here would re-introduce the page-to-page slide on the next reload.
      photoIds: trimBaseIds(b.photoIds),
      // Positional per-slot edits, trimmed away entirely when nothing has forked — so a block that
      // has never been adjusted serializes exactly the object it always did.
      baseEdits: trimBaseEdits(b.baseEdits),
      caption: b.caption,
      // Overlay ids are CLIENT-ONLY identity (like `Block.key`) — stripped here so the payload
      // reaching `saveLayout` is byte-identical to what it was before overlays gained ids.
      overlays: stripOverlayIds(b.overlays),
      texts: b.texts,
      qrs: b.qrs,
      stickers: b.stickers,
      background: b.background,
      // The unified stacking order — normalized on the way out, so a page whose objects still sit
      // in the legacy family order serializes no `layerOrder` at all.
      layerOrder: trimLayerOrder(b),
      preset: b.preset,
    }));

  const replaceAll = (next: Block[]) => mutate(() => withOverlayIds(next));

  return {
    blocks,
    dirty,
    setDirty,
    canUndo: hist.canUndo,
    canRedo: hist.canRedo,
    undo,
    redo,
    addBlock,
    insertBlockAt,
    patchBlock,
    removeBlock,
    moveBlock,
    reorderBlocks,
    duplicateBlock,
    assignBaseSlot,
    clearBaseSlot,
    patchFrameEdit,
    amendFrameEdit,
    frameEdit,
    addOverlay,
    replaceOverlay,
    patchOverlays,
    removeOverlay,
    reorderOverlay,
    duplicateOverlay,
    addText,
    patchText,
    amendText,
    removeText,
    duplicateText,
    reorderText,
    addQr,
    patchQr,
    removeQr,
    reorderQr,
    addSticker,
    patchSticker,
    amendSticker,
    removeSticker,
    duplicateSticker,
    reorderSticker,
    setBackground,
    setBackgroundAll,
    moveLayer,
    applyPreset,
    batch,
    clearFrames,
    removePhotosEverywhere,
    removePhotoEverywhere,
    remapPhotoId,
    serialize,
    replaceAll,
  };
}

export type BuilderApi = ReturnType<typeof useBlocks>;
