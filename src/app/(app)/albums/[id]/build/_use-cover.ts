'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useHistoryState } from './_history';
import {
  makeQr,
  makeSticker,
  makeText,
  offsetDuplicate,
  reorderById,
  type LayerAction,
} from '@/lib/builder/elements';
import {
  COVER_SIDE_LABEL,
  addCoverOverlay,
  applyTitleLayout,
  coverSideBackground,
  coverSideElements,
  coverSideImage,
  isPermanentRole,
  metadataFromCoverObjects,
  migrateCoverConfig,
  removeCoverOverlay,
  replaceCoverOverlayPhoto,
  withAllCoverBackgrounds,
  withCoverOverlayIds,
  withCoverSideElements,
  type CoverSide,
} from '@/lib/builder/cover-objects';
import type { CoverConfig, CoverLayout } from '@/lib/builder/cover';
import {
  cryptoId,
  makeOverlayId,
  nextOverlayGeom,
  type Background,
  type Block,
  type EditConfig,
  type Overlay,
  type QrElement,
  type StickerElement,
  type TextElement,
  type TextVariant,
} from '@/lib/builder/model';
import type { Selection } from './_use-builder';

/**
 * THE COVER AS A CANVAS — one hook, replacing an entire second editor.
 *
 * ── WHAT THIS REPLACES ─────────────────────────────────────────────────────────────────────
 *
 * The cover used to be driven by a bag of ~20 handlers on the builder (`updateCover`,
 * `writeSide`, `patchCoverText`, `duplicateCoverSticker`, …), a bespoke `CoverSelection` union
 * that no other surface understood, and a permanent 300px sidebar of sliders. None of it went
 * through the builder's history, so the cover was the one place ⌘Z did nothing. None of it went
 * through the command layer, so the cover was the one place the floating toolbar could not
 * appear. That is what "it behaves like a different application" actually meant, mechanically.
 *
 * ── WHAT IT IS NOW ─────────────────────────────────────────────────────────────────────────
 *
 * A cover is three surfaces (back · spine · front) of objects. This hook owns them the way
 * `useBlocks` owns pages, and deliberately mirrors it:
 *
 *   • the config lives in `useHistoryState`, so the cover has real undo/redo and `batch()`
 *     collapses a compound edit into one entry — the SAME container pages use;
 *   • selection is the builder's own `Selection` union, not a private one;
 *   • `block` presents the focused surface as an ordinary `Block`, and `barApi` / `barCommands`
 *     present the mutations in the shape the existing toolbars already consume. The toolbars are
 *     therefore literally the same components, not lookalikes;
 *   • metadata stays synchronised in both directions on every write (see `syncMeta`).
 *
 * Persistence is UNCHANGED: every mutation lands in `onChange`, which the builder debounces into
 * the existing `saveCoverDesign`. No new server action, no new table, no new column.
 */

/**
 * THE RESOLVED SUBJECT of a photo action on the cover.
 *
 * `Back cover background ≠ back cover overlay`, stated as a type. Every photo command reads this
 * instead of assuming the face's backdrop, which is what stopped Replace/crop/rotate from reaching
 * past a selected overlay and rewriting the face.
 */
export type CoverPhotoTarget =
  | { kind: 'backdrop'; photoId: string | null }
  | { kind: 'overlay'; overlayId: string; photoId: string | null };

export type CoverHostDeps = {
  initialConfig: CoverConfig;
  /** `albums.title` — canonical, and the words the `role: 'title'` object renders. */
  title: string;
  /** One cover page's width / height. Migration + square elements need it. */
  pageAspect: number;
  /**
   * Persist. Called after every state change with the FULL next state — the builder owns the
   * debounce and the existing `saveCoverDesign`, exactly as before.
   */
  onChange: (next: { config: CoverConfig; title: string }) => void;
  /** The canvas renamed the album (the title object's words changed). Keeps the header in step. */
  onTitleChange: (title: string) => void;
  /**
   * Edit ONE ALBUM PHOTO's `edit_config` — the builder's own `commands.applyPhotoEdit`.
   *
   * A face's backdrop image keeps its edits in `cover_config.imageEdit`, deliberately independent
   * of wherever that photo also sits on a page. A cover OVERLAY is not that: it is an ordinary
   * album photo placed in a frame, so its crop/rotate belongs on the `photos` row exactly as a
   * page overlay's does. Without this the shared `PhotoBar` would silently rotate the face's
   * backdrop while an overlay was selected.
   */
  onPhotoEdit?: (photoId: string, patch: Partial<EditConfig>) => void;
  /**
   * Rotate ONE ALBUM PHOTO by a quarter turn. Separate from `onPhotoEdit` because the next
   * rotation depends on the photo's CURRENT one, and the host is what holds the photos — this hook
   * deliberately knows nothing about them.
   */
  onPhotoRotate?: (photoId: string, dir: 1 | -1) => void;
};

export function useCover({
  initialConfig,
  title,
  pageAspect,
  onChange,
  onTitleChange,
  onPhotoEdit,
  onPhotoRotate,
}: CoverHostDeps) {
  /**
   * MIGRATION RUNS ONCE, AT THE DOOR. Everything downstream — the canvas, the toolbars, the
   * renderers — may assume objects exist. `useState`'s initializer form means a legacy config is
   * converted on mount and never re-converted, which also makes the conversion undoable-past:
   * the first history entry is already the object model, so ⌘Z can't rewind into a v1 shape.
   */
  const hist = useHistoryState<CoverConfig>(() =>
    // Overlay ids are client-only and never persisted (`OverlaySchema` has none), so they are
    // minted at the door here for the same reason `withOverlayIds` mints a page's on load.
    withCoverOverlayIds(migrateCoverConfig(initialConfig, { title }, pageAspect)),
  );
  const config = hist.value;

  const [side, setSide] = useState<CoverSide>('front');
  const [selection, setSelection] = useState<Selection>({ kind: 'none' });

  /**
   * "APPLY TO ALL" — an EDITING MODE, not a stored relationship.
   *
   * The three faces each own their colour permanently; this only decides where the NEXT colour
   * you pick lands. That distinction is the whole requirement: once a face has been given its own
   * colour, nothing may drag it back into lockstep with the others. So this is ephemeral UI state
   * (off on every open), the config stores three independent backgrounds either way, and turning
   * it off leaves every face exactly as it was.
   */
  const [linkBackgrounds, setLinkBackgrounds] = useState(false);

  /** The album title as the CANVAS currently states it. */
  const titleRef = useRef(title);

  /**
   * THE SYNCHRONISATION POINT — the only place a cover write is allowed to happen.
   *
   * Every mutation funnels through here so metadata can never drift from the objects. After the
   * caller's edit is applied, the role objects are read back (`metadataFromCoverObjects`) and
   * their words become the config's metadata fields: deleting the subtitle object DOES clear
   * `cover_config.subtitle`, because the object WAS the field.
   *
   * It is a pure state transition — no I/O, no callbacks — so React is free to invoke it twice.
   * Persistence is a separate, declarative step below, which is also what makes undo and redo
   * persist without either of them having to remember to.
   */
  const write = useCallback(
    (updater: (prev: CoverConfig) => CoverConfig) => {
      hist.set((prev) => {
        const next = updater(prev);
        if (next === prev) return prev;
        const meta = metadataFromCoverObjects(next);
        return { ...next, subtitle: meta.subtitle, author: meta.author, spineTitle: meta.spineTitle };
      });
    },
    [hist],
  );

  /**
   * PERSISTENCE, AND THE OTHER HALF OF THE TWO-WAY BINDING.
   *
   * Declarative on purpose. Every path that changes the cover — a drag, a toolbar click, undo,
   * redo, applying a template — lands here exactly once, so none of them can forget to save and
   * undo is not a special case that silently doesn't.
   *
   * The album title is derived from the title OBJECT here, which is what makes "editing the title
   * on the canvas updates album.title" true, and true through undo as well. One guard: an empty
   * title object must never blank `albums.title` — it is required server-side and names the album
   * on the dashboard, the order and the invoice. An empty cover line is allowed to look wrong; the
   * album's name is not allowed to disappear.
   *
   * The mount pass is skipped deliberately. Migration happens on load, and saving it immediately
   * would touch `updated_at` on every album merely opened — reordering the customer's dashboard
   * for a change they did not make. Renderers migrate in memory anyway, so the row can stay v1
   * until the first genuine edit.
   */
  const lastSaved = useRef<CoverConfig | null>(null);
  useEffect(() => {
    if (lastSaved.current === null) {
      lastSaved.current = config;
      return;
    }
    if (lastSaved.current === config) return;
    lastSaved.current = config;

    const proposed = metadataFromCoverObjects(config).title;
    const nextTitle = proposed !== null && proposed.trim() !== '' ? proposed : titleRef.current;
    if (nextTitle !== titleRef.current) {
      titleRef.current = nextTitle;
      onTitleChange(nextTitle);
    }
    onChange({ config, title: nextTitle });
  }, [config, onChange, onTitleChange]);

  const batch = useCallback((fn: () => void) => hist.batch(fn), [hist]);

  // ── surfaces ────────────────────────────────────────────────────────────────────
  const elements = useMemo(() => coverSideElements(config, side), [config, side]);
  const background = coverSideBackground(config, side); // a stored reference — no churn
  // Memoized because it BUILDS an object: an unmemoized one would hand every consumer a new
  // identity on each render and defeat their own memos.
  const image = useMemo(() => coverSideImage(config, side), [config, side]);

  /** Decode the side a toolbar callback refers to. Keys are minted as `cover:<side>`. */
  const sideOfKey = useCallback((key: string): CoverSide => {
    const s = key.split(':')[1];
    return s === 'front' || s === 'back' || s === 'spine' ? s : side;
  }, [side]);

  const writeSide = useCallback(
    (target: CoverSide, patch: Partial<{ texts: TextElement[]; stickers: StickerElement[]; qrs: QrElement[] }>) =>
      write((prev) => withCoverSideElements(prev, target, patch)),
    [write],
  );

  // ── text ────────────────────────────────────────────────────────────────────────
  const addText = useCallback(
    (variant: TextVariant) => {
      const el = makeText(variant);
      write((prev) => withCoverSideElements(prev, side, { texts: [...coverSideElements(prev, side).texts, el] }));
      setSelection({ kind: 'text', id: el.id });
      return el.id;
    },
    [write, side],
  );

  const patchText = useCallback(
    (key: string, id: string, patch: Partial<TextElement>) => {
      const target = sideOfKey(key);
      write((prev) =>
        withCoverSideElements(prev, target, {
          // `role` is structural, not editable — a client patch must never be able to steal or
          // forge a metadata binding (two title objects would make synchronisation ambiguous).
          texts: coverSideElements(prev, target).texts.map((t) => (t.id === id ? { ...t, ...patch, role: t.role } : t)),
        }),
      );
    },
    [write, sideOfKey],
  );

  /**
   * `patchText` as a CORRECTION rather than an action — no undo entry (see `amend`). Auto-fit's
   * write, identical on both surfaces so a tightened box behaves the same on a cover as on a page.
   */
  const amendText = useCallback(
    (key: string, id: string, patch: Partial<TextElement>) => {
      const target = sideOfKey(key);
      hist.amend((prev) =>
        withCoverSideElements(prev, target, {
          texts: coverSideElements(prev, target).texts.map((t) => (t.id === id ? { ...t, ...patch, role: t.role } : t)),
        }),
      );
    },
    [hist, sideOfKey],
  );

  const removeText = useCallback(
    (key: string, id: string) => {
      const target = sideOfKey(key);
      write((prev) => {
        const el = coverSideElements(prev, target).texts.find((t) => t.id === id);
        // The title and the spine are structural: the printed cover always carries them, so the
        // toolbars never offer Delete for them and this refuses it a second time.
        if (el && isPermanentRole(el.role)) return prev;
        return withCoverSideElements(prev, target, { texts: coverSideElements(prev, target).texts.filter((t) => t.id !== id) });
      });
    },
    [write, sideOfKey],
  );

  const duplicateText = useCallback(
    (key: string, id: string) => {
      const target = sideOfKey(key);
      const src = coverSideElements(config, target).texts.find((t) => t.id === id);
      if (!src) return undefined;
      // A duplicate is a FREE object: copying the title would create a second view of the same
      // metadata, and editing either one would fight the other. The words are copied, the binding
      // is not — which is also the escape hatch for "I want a second line styled like the title".
      const clone: TextElement = offsetDuplicate({ ...src, id: cryptoId(), role: undefined });
      write((prev) => withCoverSideElements(prev, target, { texts: [...coverSideElements(prev, target).texts, clone] }));
      setSelection({ kind: 'text', id: clone.id });
      return clone.id;
    },
    [write, sideOfKey, config],
  );

  // ── stickers ────────────────────────────────────────────────────────────────────
  const addSticker = useCallback(
    (stickerId: string) => {
      const el = makeSticker(stickerId, pageAspect);
      write((prev) => withCoverSideElements(prev, side, { stickers: [...coverSideElements(prev, side).stickers, el] }));
      setSelection({ kind: 'sticker', id: el.id });
      return el.id;
    },
    [write, side, pageAspect],
  );

  const patchSticker = useCallback(
    (key: string, id: string, patch: Partial<StickerElement>) => {
      const target = sideOfKey(key);
      write((prev) =>
        withCoverSideElements(prev, target, {
          stickers: coverSideElements(prev, target).stickers.map((s) => (s.id === id ? { ...s, ...patch } : s)),
        }),
      );
    },
    [write, sideOfKey],
  );

  const removeSticker = useCallback(
    (key: string, id: string) => {
      const target = sideOfKey(key);
      write((prev) => withCoverSideElements(prev, target, { stickers: coverSideElements(prev, target).stickers.filter((s) => s.id !== id) }));
    },
    [write, sideOfKey],
  );

  const duplicateSticker = useCallback(
    (key: string, id: string) => {
      const target = sideOfKey(key);
      const src = coverSideElements(config, target).stickers.find((s) => s.id === id);
      if (!src) return undefined;
      const clone: StickerElement = offsetDuplicate({ ...src, id: cryptoId() });
      write((prev) => withCoverSideElements(prev, target, { stickers: [...coverSideElements(prev, target).stickers, clone] }));
      setSelection({ kind: 'sticker', id: clone.id });
      return clone.id;
    },
    [write, sideOfKey, config],
  );

  // ── photo overlays ──────────────────────────────────────────────────────────────
  /**
   * ADD A PHOTO OVERLAY to the focused face — the cover's half of the page canvas's `addOverlay`.
   *
   * It creates the CONTAINER and nothing else, exactly as the page action does: the caller then
   * opens the ordinary `PhotoPicker` and fills it through `replaceOverlay`. Geometry comes from
   * the shared `nextOverlayGeom`, so a new frame lands in the same place, at the same size, with
   * the same cascade as one added to a spread.
   *
   * A face that does not store overlays (front, spine) writes nothing — `withCoverSideElements`
   * drops the key — so there is no face-specific branch here to keep in step.
   */
  const addOverlay = useCallback(
    (photoId: string | null = null, at?: { x: number; y: number } | 'center') => {
      const id = makeOverlayId();
      write((prev) =>
        addCoverOverlay(prev, side, {
          id,
          photoId,
          ...nextOverlayGeom(coverSideElements(prev, side).overlays.length, at),
        }),
      );
      setSelection({ kind: 'overlay', id });
      return id;
    },
    [write, side],
  );

  /**
   * Replace the whole overlay array for a face. The shape `Movable` and the shared `PhotoBar`
   * already speak (`api.patchOverlays`), so the cover needs no toolbar of its own.
   */
  const patchOverlays = useCallback(
    (key: string, overlays: Overlay[]) => {
      const target = sideOfKey(key);
      write((prev) => withCoverSideElements(prev, target, { overlays }));
    },
    [write, sideOfKey],
  );

  /**
   * Point one overlay at a photo — the picker's callback, and the drop target's.
   *
   * It patches ONE `photoId` and nothing else. In particular it does NOT touch the face's
   * backdrop: `setPhoto` clears `background` when it stores a photo, so an overlay replacement
   * that reached it would erase the customer's background colour, which is exactly the bug this
   * routing was fixed to prevent.
   */
  const replaceOverlay = useCallback(
    (key: string, overlayId: string, photoId: string) => {
      const target = sideOfKey(key);
      write((prev) => replaceCoverOverlayPhoto(prev, target, overlayId, photoId));
    },
    [write, sideOfKey],
  );

  const removeOverlay = useCallback(
    (key: string, overlayId: string) => {
      const target = sideOfKey(key);
      write((prev) => removeCoverOverlay(prev, target, overlayId));
    },
    [write, sideOfKey],
  );

  const duplicateOverlay = useCallback(
    (key: string, overlayId: string) => {
      const target = sideOfKey(key);
      const src = coverSideElements(config, target).overlays.find((o) => o.id === overlayId);
      if (!src) return undefined;
      // A page overlay may legitimately reuse a photo (it is decorative, and edits are per-photo);
      // the cover follows the same rule, so the clone keeps its picture.
      const clone: Overlay = offsetDuplicate({ ...src, id: makeOverlayId() });
      write((prev) =>
        withCoverSideElements(prev, target, { overlays: [...coverSideElements(prev, target).overlays, clone] }),
      );
      setSelection({ kind: 'overlay', id: clone.id as string });
      return clone.id;
    },
    [write, sideOfKey, config],
  );

  // ── QR ──────────────────────────────────────────────────────────────────────────
  const addQr = useCallback(
    (data: string) => {
      const el = makeQr(data, { h: Math.min(1, 0.14 * pageAspect) }, pageAspect);
      write((prev) => withCoverSideElements(prev, side, { qrs: [...coverSideElements(prev, side).qrs, el] }));
      setSelection({ kind: 'qr', id: el.id });
      return el.id;
    },
    [write, side, pageAspect],
  );

  const patchQr = useCallback(
    (key: string, id: string, patch: Partial<QrElement>) => {
      const target = sideOfKey(key);
      write((prev) =>
        withCoverSideElements(prev, target, { qrs: coverSideElements(prev, target).qrs.map((q) => (q.id === id ? { ...q, ...patch } : q)) }),
      );
    },
    [write, sideOfKey],
  );

  const removeQr = useCallback(
    (key: string, id: string) => {
      const target = sideOfKey(key);
      write((prev) => withCoverSideElements(prev, target, { qrs: coverSideElements(prev, target).qrs.filter((q) => q.id !== id) }));
    },
    [write, sideOfKey],
  );

  /* There is deliberately no `duplicateQr`: neither the page nor the cover QR toolbar offers
     Duplicate, and a capability only one surface could reach is the asymmetry this pass removes. */

  // ── backdrop + base image ───────────────────────────────────────────────────────
  /** Set the face's CSS backdrop. Choosing a colour clears the photo — one backdrop at a time. */
  const setBackground = useCallback(
    (bg: Background | null, target: CoverSide = side) =>
      write((prev) =>
        target === 'front'
          ? { ...prev, background: bg, photoId: bg ? null : prev.photoId }
          : target === 'back'
            ? { ...prev, back: { ...prev.back, background: bg, photoId: bg ? null : prev.back.photoId } }
            : { ...prev, spine: { ...prev.spine, background: bg } },
      ),
    [write, side],
  );

  /** Paint all three faces at once. ONE `write`, so it is ONE undo entry and one save. */
  const setAllBackgrounds = useCallback((bg: Background | null) => write((prev) => withAllCoverBackgrounds(prev, bg)), [write]);

  /**
   * THE ONE ENTRY POINT the background toolbar uses, so "which faces does this colour reach?" is
   * answered in a single place rather than at each of the swatch / picker / preset call sites.
   */
  const applyBackground = useCallback(
    (bg: Background | null) => (linkBackgrounds ? setAllBackgrounds(bg) : setBackground(bg)),
    [linkBackgrounds, setAllBackgrounds, setBackground],
  );

  /** Put an album photo on this face (or clear it). Clears the CSS backdrop, as above. */
  const setPhoto = useCallback(
    (photoId: string | null, target: CoverSide = side) =>
      write((prev) =>
        target === 'front'
          ? { ...prev, photoId, background: photoId ? null : prev.background, imageEdit: photoId ? prev.imageEdit : null }
          : target === 'back'
            ? {
                ...prev,
                back: {
                  ...prev.back,
                  photoId,
                  background: photoId ? null : prev.back.background,
                  imageEdit: photoId ? prev.back.imageEdit : null,
                },
              }
            : prev,
      ),
    [write, side],
  );

  /**
   * Crop / zoom / rotate the face's image.
   *
   * It writes `cover_config.imageEdit`, NOT `photos.edit_config` — a cover crop has always been
   * independent of how the same photo is cropped on a page, and that must survive the toolbars
   * now driving it. This is exactly why `barCommands.applyPhotoEdit` exists as a seam rather than
   * the page implementation being reused directly.
   */
  const patchImageEdit = useCallback(
    (patch: Partial<EditConfig>, target: CoverSide = side) =>
      write((prev) =>
        target === 'front'
          ? { ...prev, imageEdit: { ...(prev.imageEdit ?? {}), ...patch } }
          : target === 'back'
            ? { ...prev, back: { ...prev.back, imageEdit: { ...(prev.back.imageEdit ?? {}), ...patch } } }
            : prev,
      ),
    [write, side],
  );

  const setShowLogo = useCallback(
    (on: boolean) => write((prev) => ({ ...prev, back: { ...prev.back, showLogo: on } })),
    [write],
  );

  /** Re-arrange the metadata objects into a house layout, and record it as the cover's theme. */
  const applyLayout = useCallback(
    (layout: CoverLayout) => write((prev) => applyTitleLayout(prev, layout, pageAspect)),
    [write, pageAspect],
  );

  /** Escape hatch for whole-config writes (applying a cover template, choosing artwork). */
  const update = useCallback(
    (patch: Partial<CoverConfig>) => write((prev) => migrateCoverConfig({ ...prev, ...patch }, { title: titleRef.current }, pageAspect)),
    [write, pageAspect],
  );

  /**
   * Metadata edited OUTSIDE the canvas (Album Settings' title field) → the objects.
   * The read direction of the two-way binding; `migrateCoverConfig` already does exactly this.
   */
  const applyTitle = useCallback(
    (nextTitle: string) => {
      titleRef.current = nextTitle;
      hist.set((prev) => migrateCoverConfig(prev, { title: nextTitle }, pageAspect));
    },
    [hist, pageAspect],
  );

  // ── layer ordering ──────────────────────────────────────────────────────────────
  const moveLayer = useCallback(
    (target: { kind: 'overlay' | 'text' | 'sticker' | 'qr'; blockKey: string; id: string }, action: LayerAction) => {
      const s = sideOfKey(target.blockKey);
      write((prev) => {
        const e = coverSideElements(prev, s);
        if (target.kind === 'text') {
          const next = reorderById(e.texts, target.id, action);
          return next ? withCoverSideElements(prev, s, { texts: next }) : prev;
        }
        if (target.kind === 'sticker') {
          const next = reorderById(e.stickers, target.id, action);
          return next ? withCoverSideElements(prev, s, { stickers: next }) : prev;
        }
        if (target.kind === 'qr') {
          const next = reorderById(e.qrs, target.id, action);
          return next ? withCoverSideElements(prev, s, { qrs: next }) : prev;
        }
        if (target.kind === 'overlay') {
          const next = reorderById(e.overlays, target.id, action);
          return next ? withCoverSideElements(prev, s, { overlays: next }) : prev;
        }
        return prev;
      });
    },
    [write, sideOfKey],
  );

  // ── delete, resolved exactly like a page's ──────────────────────────────────────
  const selectedText = selection.kind === 'text' ? elements.texts.find((t) => t.id === selection.id) : undefined;
  const deletable =
    selection.kind === 'sticker' ||
    selection.kind === 'qr' ||
    selection.kind === 'overlay' ||
    (selection.kind === 'text' && !isPermanentRole(selectedText?.role)) ||
    (selection.kind === 'base' && !!image.photoId);

  const deleteLabel =
    selection.kind === 'sticker'
      ? 'Delete sticker'
      : selection.kind === 'overlay'
        ? 'Delete photo overlay'
      : selection.kind === 'qr'
        ? 'Delete QR code'
        : selection.kind === 'text'
          ? selectedText?.role
            ? `Remove ${selectedText.role}`
            : 'Delete text'
          : selection.kind === 'base'
            ? 'Remove cover photo'
            : 'Delete';

  const deleteSelection = useCallback(() => {
    const key = `cover:${side}`;
    if (selection.kind === 'sticker') removeSticker(key, selection.id);
    else if (selection.kind === 'overlay') removeOverlay(key, selection.id);
    else if (selection.kind === 'qr') removeQr(key, selection.id);
    else if (selection.kind === 'text') removeText(key, selection.id);
    else if (selection.kind === 'base') setPhoto(null);
    else return;
    setSelection({ kind: 'none' });
  }, [selection, side, removeSticker, removeOverlay, removeQr, removeText, setPhoto]);

  // ── adapters: the focused surface, in the shapes the shared toolbars consume ────
  /**
   * THE FOCUSED FACE AS A `Block`.
   *
   * This is what lets the cover reuse `ContextBar`'s Text / Sticker / QR / Photo toolbars
   * verbatim instead of growing cover-shaped copies of them. A face has a backdrop, an optional
   * base photo and three element arrays — which is a Block with no overlays. The base image maps
   * to the single `image` slot, so `selection.kind === 'base'` means the same thing on both
   * surfaces and `PhotoBar` needs to know nothing about covers.
   */
  const block = useMemo<Block>(
    () => ({
      key: `cover:${side}`,
      template: 'double-spread',
      photoIds: image.photoId ? [image.photoId] : [],
      caption: '',
      // Real overlays now, on a face that stores them — which is what makes the SHARED `PhotoBar`
      // work on a cover overlay with no cover-specific branch anywhere in the toolbar.
      overlays: elements.overlays,
      texts: elements.texts,
      qrs: elements.qrs,
      stickers: elements.stickers,
      background,
    }),
    [side, image.photoId, elements, background],
  );

  const barApi = useMemo(
    () => ({
      patchText,
      patchSticker,
      patchQr,
      duplicateText,
      duplicateSticker,
      duplicateOverlay,
      patchOverlays,
      batch,
    }),
    [patchText, patchSticker, patchQr, duplicateText, duplicateSticker, duplicateOverlay, patchOverlays, batch],
  );

  /**
   * WHAT IS THE PHOTO TOOLBAR ACTING ON? — resolved ONCE, before any command runs.
   *
   * THE BUG THIS EXISTS TO KILL. Every photo action on the cover used to be pointed at the face's
   * BACKDROP, because that is the only photo a cover used to have. With overlays that became
   * actively destructive rather than merely wrong: `PhotoBar`'s Replace already tells the host
   * which overlay it means, the cover's adapter threw that argument away and opened the BACKDROP
   * picker, and `setPhoto` clears `background` when it stores a photo — so "replace this overlay"
   * silently became "make this the whole back cover and erase the colour behind it". Deleting the
   * overlay afterwards then revealed a null background, which the renderer draws as the default
   * colour: the "my background reset itself" report, same single cause.
   *
   * So the target is a value, not a branch repeated per action. Everything downstream — the
   * selected photo the toolbar describes, the crop it opens, the edits it applies, the rotation,
   * the picker Replace opens — reads THIS.
   *
   *   selection 'base'    → the face's backdrop (edits live in `cover_config.imageEdit`)
   *   selection 'overlay' → that overlay (edits live on the `photos` row, like a page overlay)
   */
  const photoTarget = useMemo<CoverPhotoTarget | null>(() => {
    if (selection.kind === 'overlay') {
      const o = elements.overlays.find((ov) => ov.id === selection.id);
      return o ? { kind: 'overlay', overlayId: selection.id, photoId: o.photoId } : null;
    }
    if (selection.kind === 'base') return { kind: 'backdrop', photoId: image.photoId };
    return null;
  }, [selection, elements.overlays, image.photoId]);

  const barCommands = useMemo(
    () => ({
      /**
       * The photo id is IGNORED in favour of the resolved target. `PhotoBar` passes the id of the
       * photo it is describing, which is correct — but the destination of the write is decided by
       * WHAT is selected, and only the target knows that.
       */
      applyPhotoEdit: (photoId: string, patch: Partial<EditConfig>) => {
        if (photoTarget?.kind === 'overlay') {
          if (photoTarget.photoId && onPhotoEdit) onPhotoEdit(photoTarget.photoId, patch);
          return;
        }
        patchImageEdit(patch);
      },
      rotateBy: (dir: 1 | -1) => {
        if (photoTarget?.kind === 'overlay') {
          if (photoTarget.photoId && onPhotoRotate) onPhotoRotate(photoTarget.photoId, dir);
          return;
        }
        const cur = image.edit?.rotate ?? 0;
        patchImageEdit({ rotate: (((cur + dir * 90 + 360) % 360) as 0 | 90 | 180 | 270) });
      },
      moveLayer,
      deleteSelection: { label: deleteLabel, enabled: deletable, run: deleteSelection },
    }),
    [patchImageEdit, image.edit?.rotate, photoTarget, onPhotoEdit, onPhotoRotate, moveLayer, deleteLabel, deletable, deleteSelection],
  );

  return {
    config,
    side,
    setSide,
    sideLabel: COVER_SIDE_LABEL[side],
    selection,
    setSelection,
    elements,
    background,
    image,
    /** WHAT a photo action acts on — see above. The host resolves the toolbar's photo from it. */
    photoTarget,
    block,
    barApi,
    barCommands,
    // history — same names as `BuilderApi`, so the shortcut layer treats both surfaces alike
    canUndo: hist.canUndo,
    canRedo: hist.canRedo,
    undo: hist.undo,
    redo: hist.redo,
    batch,
    // mutations
    addText,
    patchText,
    amendText,
    removeText,
    duplicateText,
    addOverlay,
    patchOverlays,
    replaceOverlay,
    removeOverlay,
    duplicateOverlay,
    addSticker,
    patchSticker,
    removeSticker,
    duplicateSticker,
    addQr,
    patchQr,
    removeQr,
    setBackground,
    setAllBackgrounds,
    applyBackground,
    linkBackgrounds,
    setLinkBackgrounds,
    setPhoto,
    patchImageEdit,
    setShowLogo,
    applyLayout,
    update,
    applyTitle,
    moveLayer,
    deleteSelection,
    writeSide,
  };
}

export type CoverApi = ReturnType<typeof useCover>;
