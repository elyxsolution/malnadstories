'use client';

import { useCallback, useState } from 'react';
import { useHistoryState } from './_history';
import {
  canAdd,
  cryptoId,
  makeBlock,
  requiredBaseCount,
  makeOverlayId,
  withOverlayIds,
  stripOverlayIds,
  DEFAULT_OVERLAY_GEOM,
  type Background,
  type Block,
  type LayoutTemplate,
  type Overlay,
  type QrElement,
  type StickerElement,
  type TextElement,
  type TextVariant,
} from '@/lib/builder/model';
import { makeQr, makeSticker, makeText, PAIR_ASPECT, type LayoutPreset } from '@/lib/builder/elements';

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

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

/** Remove a photo from every base slot + overlay across all blocks (placed-once invariant). */
function stripPhoto(list: Block[], id: string): Block[] {
  return list.map((b) => {
    const inBase = b.photoIds.includes(id);
    const overlays = b.overlays.filter((o) => o.photoId !== id);
    if (!inBase && overlays.length === b.overlays.length) return b;
    return { ...b, photoIds: b.photoIds.filter((pid) => pid !== id), overlays };
  });
}

/**
 * The builder's editable layout state — history-backed (undo/redo), with every block- and
 * element-level mutation in one reusable place. UI components receive these callbacks and
 * stay presentational. Persistence is unchanged: the orchestrator serializes + calls the
 * existing `saveLayout`. No new persistence path is introduced here.
 */
export function useBlocks(initial: Block[], pairRatio: number = PAIR_ASPECT) {
  // Normalize on entry: every overlay inside builder state carries a stable id from here on.
  const hist = useHistoryState<Block[]>(withOverlayIds(initial));
  const blocks = hist.value;
  const [dirty, setDirty] = useState(false);

  const mutate = useCallback(
    (updater: (prev: Block[]) => Block[]) => {
      hist.set(updater);
      setDirty(true);
    },
    [hist],
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
  const addBlock = (template: LayoutTemplate, size: number) => {
    if (!canAdd(blocks, size, template)) return;
    // A manually-added spread maps to the base preset (Single / Full bleed) for accurate breakdowns.
    const preset = template === 'double-spread' ? 'full-bleed' : 'single';
    mutate((prev) => [...prev, { ...makeBlock(template), preset }]);
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
      next.splice(Math.max(0, Math.min(index, next.length)), 0, makeBlock(template));
      return next;
    });
  };

  /**
   * Duplicate a page's LAYOUT (template, background, text, QR — with fresh ids) directly
   * after it. Photos are NOT copied: a photo is placed at most once across the album, so a
   * duplicate starts with empty photo slots (the user fills them with other photos).
   */
  const duplicateBlock = (key: string, size: number) => {
    const src = blocks.find((b) => b.key === key);
    if (!src || !canAdd(blocks, size, src.template)) return;
    const clone: Block = {
      ...makeBlock(src.template),
      background: src.background,
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
  const assignBaseSlot = (key: string, slot: BaseSlot, photoId: string) =>
    mutate((prev) =>
      stripPhoto(prev, photoId).map((b) => {
        if (b.key !== key) return b;
        if (slot === 'image') return { ...b, photoIds: [photoId] };
        const ids = [...b.photoIds];
        let idx = slot === 'left' ? 0 : 1;
        if (idx === 1 && !ids[0]) idx = 0; // no left → fill left first
        ids[idx] = photoId;
        return { ...b, photoIds: ids.slice(0, 2) };
      }),
    );

  const clearBaseSlot = (key: string, slot: BaseSlot) =>
    mutate((prev) =>
      prev.map((b) => {
        if (b.key !== key) return b;
        if (slot === 'image' || slot === 'left') return { ...b, photoIds: b.photoIds.slice(1) };
        return { ...b, photoIds: b.photoIds.slice(0, 1) };
      }),
    );

  // ── overlays ───────────────────────────────────────────────────────────────
  // Every operation below addresses an overlay by its STABLE ID rather than its array
  // position. Behaviour is identical for a single overlay, but an id survives reordering and
  // deletion — which array indices do not, and which is what made index-based selection unsafe
  // to build multi-selection on.
  /** Append an overlay. Returns its new id so the caller can select it immediately. */
  const addOverlay = (key: string, photoId: string) => {
    const id = makeOverlayId();
    mutate((prev) =>
      stripPhoto(prev, photoId).map((b) => {
        if (b.key !== key) return b;
        const n = b.overlays.length;
        const { w, h } = DEFAULT_OVERLAY_GEOM;
        const overlay: Overlay = {
          id,
          photoId,
          x: clamp01(Math.min(DEFAULT_OVERLAY_GEOM.x + (n % 5) * 0.04, 1 - w)),
          y: clamp01(Math.min(DEFAULT_OVERLAY_GEOM.y + (n % 5) * 0.04, 1 - h)),
          w,
          h,
        };
        return { ...b, overlays: [...b.overlays, overlay] };
      }),
    );
    return id;
  };

  const replaceOverlay = (key: string, overlayId: string, photoId: string) =>
    mutate((prev) =>
      stripPhoto(prev, photoId).map((b) =>
        b.key === key ? { ...b, overlays: b.overlays.map((o) => (o.id === overlayId ? { ...o, photoId } : o)) } : b,
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
   * Duplicate an overlay — copies its frame AND photo, offset slightly, appended on top.
   * Unlike base slots, an overlay may legitimately reuse a photo (it's purely decorative;
   * `saveLayout` has no uniqueness constraint and edits are per-photo), so we deliberately
   * do NOT stripPhoto here. Returns the new overlay's ID (previously its index).
   */
  const duplicateOverlay = (key: string, overlayId: string) => {
    let newId: string | undefined;
    mutate((prev) =>
      prev.map((b) => {
        if (b.key !== key) return b;
        const src = b.overlays.find((o) => o.id === overlayId);
        if (!src) return b;
        const clone: Overlay = {
          ...src,
          id: makeOverlayId(),
          x: clamp01(Math.min(src.x + 0.03, 1 - src.w)),
          y: clamp01(Math.min(src.y + 0.03, 1 - src.h)),
        };
        newId = clone.id;
        return { ...b, overlays: [...b.overlays, clone] };
      }),
    );
    return newId;
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

  const removeText = (key: string, id: string) =>
    mutate((prev) => prev.map((b) => (b.key === key ? { ...b, texts: b.texts.filter((t) => t.id !== id) } : b)));

  const duplicateText = (key: string, id: string) => {
    let newId: string | undefined;
    mutate((prev) =>
      prev.map((b) => {
        if (b.key !== key) return b;
        const src = b.texts.find((t) => t.id === id);
        if (!src) return b;
        const clone = { ...src, id: cryptoId(), x: clamp01(src.x + 0.03), y: clamp01(src.y + 0.03) };
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

  const removeSticker = (key: string, id: string) =>
    mutate((prev) => prev.map((b) => (b.key === key ? { ...b, stickers: b.stickers.filter((s) => s.id !== id) } : b)));

  const duplicateSticker = (key: string, id: string) => {
    let newId: string | undefined;
    mutate((prev) =>
      prev.map((b) => {
        if (b.key !== key) return b;
        const src = b.stickers.find((s) => s.id === id);
        if (!src) return b;
        const clone = { ...src, id: cryptoId(), x: clamp01(src.x + 0.03), y: clamp01(src.y + 0.03) };
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
    const baseFilled = block.photoIds.filter(Boolean);
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
    patchBlock(key, { template: preset.base, photoIds: keptBase, overlays: newOverlays, preset: preset.key });
  };

  /**
   * Run several mutations as ONE undo entry (Phase 6). Every bulk command wraps its work in
   * this, so "remove 12 photos from their pages" is one ⌘Z, not twelve. Nesting is safe.
   */
  const batch = useCallback(
    (fn: () => void) => {
      hist.batch(fn);
      setDirty(true);
    },
    [hist],
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
        for (const f of mine) {
          if (f.slot) {
            // Clearing a base slot preserves the OTHER slot's photo — index-safe by construction.
            const keepLeft = f.slot === 'right';
            photoIds = keepLeft ? photoIds.slice(0, 1) : photoIds.slice(1);
          } else if (f.overlayId) {
            // An overlay keeps its CONTAINER (geometry is the user's layout work); only the
            // photo reference is cleared — same rule the serialization boundary uses.
            overlays = overlays.map((o) => (o.id === f.overlayId ? { ...o, photoId: null } : o));
          }
        }
        return { ...b, photoIds, overlays };
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
      photoIds: b.photoIds.filter(Boolean),
      caption: b.caption,
      // Overlay ids are CLIENT-ONLY identity (like `Block.key`) — stripped here so the payload
      // reaching `saveLayout` is byte-identical to what it was before overlays gained ids.
      overlays: stripOverlayIds(b.overlays),
      texts: b.texts,
      qrs: b.qrs,
      stickers: b.stickers,
      background: b.background,
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
    addOverlay,
    replaceOverlay,
    patchOverlays,
    removeOverlay,
    reorderOverlay,
    duplicateOverlay,
    addText,
    patchText,
    removeText,
    duplicateText,
    reorderText,
    addQr,
    patchQr,
    removeQr,
    reorderQr,
    addSticker,
    patchSticker,
    removeSticker,
    duplicateSticker,
    reorderSticker,
    setBackground,
    setBackgroundAll,
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
