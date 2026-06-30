'use client';

import { useCallback, useState } from 'react';
import { useHistoryState } from './_history';
import {
  canAdd,
  cryptoId,
  makeBlock,
  requiredBaseCount,
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
  | { kind: 'overlay'; index: number }
  | { kind: 'text'; id: string }
  | { kind: 'qr'; id: string }
  | { kind: 'sticker'; id: string };

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
export function useBlocks(initial: Block[]) {
  const hist = useHistoryState<Block[]>(initial);
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
    mutate((prev) => [...prev, makeBlock(template)]);
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
  const addOverlay = (key: string, photoId: string) =>
    mutate((prev) =>
      stripPhoto(prev, photoId).map((b) => {
        if (b.key !== key) return b;
        const n = b.overlays.length;
        const { w, h } = DEFAULT_OVERLAY_GEOM;
        const overlay: Overlay = {
          photoId,
          x: clamp01(Math.min(DEFAULT_OVERLAY_GEOM.x + (n % 5) * 0.04, 1 - w)),
          y: clamp01(Math.min(DEFAULT_OVERLAY_GEOM.y + (n % 5) * 0.04, 1 - h)),
          w,
          h,
        };
        return { ...b, overlays: [...b.overlays, overlay] };
      }),
    );

  const replaceOverlay = (key: string, index: number, photoId: string) =>
    mutate((prev) =>
      stripPhoto(prev, photoId).map((b) =>
        b.key === key ? { ...b, overlays: b.overlays.map((o, i) => (i === index ? { ...o, photoId } : o)) } : b,
      ),
    );

  const patchOverlays = (key: string, overlays: Overlay[]) => mutate((prev) => patchBlockByKey(prev, key, { overlays }));

  const removeOverlay = (key: string, index: number) =>
    mutate((prev) =>
      prev.map((b) => (b.key === key ? { ...b, overlays: b.overlays.filter((_, i) => i !== index) } : b)),
    );

  const reorderOverlay = (key: string, index: number, dir: -1 | 1) =>
    mutate((prev) =>
      prev.map((b) => {
        if (b.key !== key) return b;
        const j = index + dir;
        if (j < 0 || j >= b.overlays.length) return b;
        const ov = [...b.overlays];
        [ov[index], ov[j]] = [ov[j], ov[index]];
        return { ...b, overlays: ov };
      }),
    );

  /**
   * Duplicate an overlay — copies its frame AND photo, offset slightly, appended on top.
   * Unlike base slots, an overlay may legitimately reuse a photo (it's purely decorative;
   * `saveLayout` has no uniqueness constraint and edits are per-photo), so we deliberately
   * do NOT stripPhoto here. Returns the new overlay's index.
   */
  const duplicateOverlay = (key: string, index: number) => {
    let newIndex: number | undefined;
    mutate((prev) =>
      prev.map((b) => {
        if (b.key !== key) return b;
        const src = b.overlays[index];
        if (!src) return b;
        const clone: Overlay = {
          ...src,
          x: clamp01(Math.min(src.x + 0.03, 1 - src.w)),
          y: clamp01(Math.min(src.y + 0.03, 1 - src.h)),
        };
        newIndex = b.overlays.length;
        return { ...b, overlays: [...b.overlays, clone] };
      }),
    );
    return newIndex;
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
    const el = makeQr(data, overrides);
    mutate((prev) => prev.map((b) => (b.key === key ? { ...b, qrs: [...b.qrs, el] } : b)));
    return el.id;
  };

  const patchQr = (key: string, id: string, patch: Partial<QrElement>) =>
    mutate((prev) =>
      prev.map((b) => (b.key === key ? { ...b, qrs: b.qrs.map((q) => (q.id === id ? { ...q, ...patch } : q)) } : b)),
    );

  const removeQr = (key: string, id: string) =>
    mutate((prev) => prev.map((b) => (b.key === key ? { ...b, qrs: b.qrs.filter((q) => q.id !== id) } : b)));

  // ── stickers ───────────────────────────────────────────────────────────────────
  const addSticker = (key: string, stickerId: string, overrides: Partial<StickerElement> = {}) => {
    const el = makeSticker(stickerId, PAIR_ASPECT, overrides);
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

    const newOverlays: Overlay[] = preset.overlays
      .slice(0, pool.length)
      .map((slot, i) => ({ photoId: pool[i], x: slot.x, y: slot.y, w: slot.w, h: slot.h }));

    patchBlock(key, { template: preset.base, photoIds: keptBase, overlays: newOverlays });
  };

  // ── photos lifecycle (block side only — photo rows are owned by the orchestrator) ──
  const removePhotoEverywhere = (id: string) => mutate((prev) => stripPhoto(prev, id));

  // ── persistence shape ──────────────────────────────────────────────────────────
  const serialize = () =>
    blocks.map((b) => ({
      template: b.template,
      photoIds: b.photoIds.filter(Boolean),
      caption: b.caption,
      overlays: b.overlays,
      texts: b.texts,
      qrs: b.qrs,
      stickers: b.stickers,
      background: b.background,
    }));

  const replaceAll = (next: Block[]) => mutate(() => next);

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
    addSticker,
    patchSticker,
    removeSticker,
    duplicateSticker,
    reorderSticker,
    setBackground,
    setBackgroundAll,
    applyPreset,
    removePhotoEverywhere,
    serialize,
    replaceAll,
  };
}

export type BuilderApi = ReturnType<typeof useBlocks>;
