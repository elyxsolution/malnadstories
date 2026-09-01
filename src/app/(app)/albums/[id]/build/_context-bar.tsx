'use client';

import { useCallback, useState } from 'react';

import {
  Replace,
  Crop,
  Maximize,
  Minimize,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  RotateCw,
  FlipHorizontal,
  FlipVertical,
  Copy,
  Trash2,
  SlidersHorizontal,
  Type as TypeIcon,
  ImagePlus,
  QrCode,
  LayoutGrid,
  Shuffle,
  Frame,
  ArrowUp,
  ArrowDown,
  Check,
  Bold,
  Italic,
  Underline,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Lock,
  LockOpen,
} from 'lucide-react';
import { CanvasBar, BarRow, BarBtn, BarSep, BarLabel, BarPopover, PAGE_BAR_GAP, type BarBand } from './_canvas-bar';
import LayerMenu, { type LayerSibling } from './_layer-menu';
import { layerIndexOf, layerStack } from '@/lib/builder/layers';
import FontPicker from './_font-picker';
import FontSizeField from './_font-size-field';
import { ColorField } from './_color-picker';
import { MAX_ZOOM, type Block, type EditConfig, type Overlay, type TextElement } from '@/lib/builder/model';
import type { LayerAction } from '@/lib/builder/elements';
import { textSizePatch } from '@/lib/builder/text-size';
import type { Photo } from '@/lib/builder/photo';
import type { Anchor } from './_use-anchor-rect';
import type { BuilderApi, BaseSlot, Selection } from './_use-builder';
import type { CommandsApi } from './_use-commands';
import { orientedAspect } from './_photo-state';

/**
 * THE CONTEXT BAR — what replaced the right-hand Inspector.
 *
 * ONE RULE decides everything here: show the tools for what is selected, and nothing else. The
 * old panel was a router too, but it routed into a permanent 300px column that was mostly empty
 * mostly of the time — a text element's typography and a page's arrange buttons occupied the same
 * fixed real estate whether you needed them or not. The same routing now happens in a bar that
 * appears at the selection and disappears with it.
 *
 * IT DISPATCHES, IT DOES NOT DECIDE. Delete runs `commands.deleteSelection` — the priority-
 * resolved one, so an overlay's Delete button and the Delete key are the same code path. Rotate
 * runs `rotateBy`. Every geometry action goes through `applyPhotoEdit`, the command layer's
 * single photo-write path. Layer order goes through `commands.moveLayer` — one batched,
 * undoable implementation shared by photos, text, stickers and QR. No editing logic lives in
 * this file — only the decision of which buttons a given selection deserves.
 *
 * ONE EDITING PHILOSOPHY (Pass 3). Every object type follows the same split: COMMON actions
 * live on the bar itself (text gets its full everyday typography — font, size, weight, style,
 * alignment, colour — right here), and DETAILED properties open the docked right-hand
 * properties panel via `onOpenProperties`. The popover-hosted inspectors are gone from content
 * pages; the same inspector components now render in the panel, unchanged.
 */

/**
 * ── WHAT A TOOLBAR ACTUALLY NEEDS (Cover Editor 2.0) ───────────────────────────────────────
 *
 * The object bars used to take the whole `BuilderApi` and the whole `CommandsApi`, both of which
 * are bound to `Block[]`. That was fine while the only surface with objects was a content spread.
 * The cover has objects but no blocks — its text lives in `cover_config`, its photo crop lives in
 * `cover_config.imageEdit` rather than on the photo row — so the wide types were the only thing
 * standing between "the cover reuses the Text toolbar" and "the cover gets a second Text toolbar
 * that will drift."
 *
 * So the bars now ask for exactly what they use. `BuilderApi` satisfies `BarApi` by construction
 * (it is a `Pick` of it), and the cover supplies a small adapter of the same shape — which is why
 * `TextBar`, `StickerBar`, `QrBar` and `PhotoBar` below are literally the same components on both
 * surfaces rather than lookalikes.
 */
export type BarApi = Pick<
  BuilderApi,
  'patchText' | 'patchSticker' | 'patchQr' | 'patchOverlays' | 'duplicateText' | 'duplicateSticker' | 'duplicateOverlay' | 'batch'
>;

export type BarCommands = {
  /** Write a photo edit. Pages write `photos.edit_config`; the cover writes `imageEdit`. */
  applyPhotoEdit: (photoId: string, patch: Partial<EditConfig>) => void;
  rotateBy: (dir: 1 | -1) => void;
  moveLayer: (target: { kind: 'overlay' | 'text' | 'sticker' | 'qr'; blockKey: string; id: string }, action: LayerAction) => void;
  /** The priority-resolved delete for the current selection — the same one the Delete key runs. */
  deleteSelection: { label: string; enabled: boolean; run: () => void | Promise<void> };
};

/** Everything an object bar needs, on either surface. */
export type BarProps = {
  anchor: Anchor | null;
  block: Block;
  api: BarApi;
  commands: BarCommands;
  selection: Selection;
  onSelect: (s: Selection) => void;
  photoMap: Map<string, Photo>;
  selectedPhoto: Photo | undefined;
  pairAspect: number;
  onReplace: (target: { slot?: BaseSlot; overlayId?: string }) => void;
  onCrop: () => void;
  cropping: boolean;
  onEndCrop: () => void;
  onOpenProperties: () => void;
  propertiesOpen: boolean;
  onEscape: () => void;
};

export type ContextBarProps = {
  anchor: Anchor | null;
  /**
   * The SELECTED OVERLAY's measured box, when one is selected. Present ⇒ the overlay's tools
   * detach from the persistent stack and float above the overlay itself. Absent (or any other
   * selection) ⇒ the row stays in the stack. See the note in `ContextBar`.
   */
  overlayAnchor?: Anchor | null;
  block: Block | undefined;
  index: number;
  total: number;
  size: number;
  api: BuilderApi;
  commands: CommandsApi;
  selection: Selection;
  onSelect: (s: Selection) => void;
  photoMap: Map<string, Photo>;
  /** The photo in the selected frame, when the selection is a photo frame. */
  selectedPhoto: Photo | undefined;
  pairAspect: number;
  showGuides: boolean;
  onToggleGuides: () => void;
  /** Open the existing photo picker for this frame (Replace). */
  onReplace: (target: { slot?: BaseSlot; overlayId?: string }) => void;
  /** Enter / leave in-canvas crop mode for the selected frame. */
  onCrop: () => void;
  cropping: boolean;
  onEndCrop: () => void;
  /** Page-level "add" actions, reusing the builder's existing add paths. */
  onAddText: () => void;
  onAddPhotoOverlay: () => void;
  onAddQr: () => void;
  onOpenLayouts: () => void;
  /**
   * Step this spread to the next curated layout in its cycle (Original → 1 → 2 → 3 → Original).
   * `cyclePosition` is the confirmation — which of the alternatives is currently on screen — and
   * is shown on the control itself rather than in a separate badge, so the answer to "which
   * layout am I looking at?" is where the question is asked.
   */
  onCycleLayout: () => void;
  canCycleLayout: boolean;
  cyclePosition: string | null;
  /** The name of the curated layout this spread currently sits on — shown in the Layout menu. */
  layoutLabel: string;
  /** Step to the nearest curated layout holding fewer (-1) or more (+1) photos. */
  onLayoutDensity: (dir: -1 | 1) => void;
  canFewerPhotos: boolean;
  canMorePhotos: boolean;
  /** Open the selected object's detailed controls in the right-hand properties panel. */
  onOpenProperties: () => void;
  propertiesOpen: boolean;
  /** Return focus to the canvas when the bar is dismissed with Escape. */
  onEscape: () => void;
};

/** Adapt the page surface's wide `CommandsApi` to the narrow shape the object bars consume. */
export function pageBarCommands(commands: CommandsApi): BarCommands {
  return {
    applyPhotoEdit: commands.applyPhotoEdit,
    rotateBy: commands.rotateBy,
    moveLayer: commands.moveLayer,
    deleteSelection: commands.commands.deleteSelection,
  };
}

/**
 * THE STACK — a persistent page row, plus a contextual object row when something is selected.
 *
 * The page toolbar used to be an ALTERNATIVE to the object toolbars: selecting a photo replaced
 * it wholesale, so the entire control surface changed identity on every click and the UI jumped.
 * They are different scopes, not different states of one thing — page-level actions (add, arrange,
 * layout, guides, delete spread) remain equally relevant while a photo is selected — so both are
 * rendered, stacked, in one shell.
 *
 * The shell is bottom-anchored (see `_canvas-bar`), which is what makes the page row appear to
 * shift upward as the object row appears beneath it. Nothing is swapped and nothing is remounted:
 * `PageRowControls` keeps the same position in the tree whatever is selected, so its popovers and
 * roving focus survive a selection change.
 */
export default function ContextBar(props: ContextBarProps) {
  const { anchor, block, selection, overlayAnchor } = props;

  /*
   * THE PAGE BAR'S OCCUPIED BAND, so the detached overlay bar can refuse to share it.
   *
   * The two shells are independent positioners: each one only knew its own anchor, so an overlay
   * near the top of the spread put its bar exactly where the page bar already was. Neither could
   * see the other. The page bar now reports where it landed and the overlay bar avoids it — the
   * overlay bar flips below its overlay instead, wherever that overlay happens to be.
   *
   * Hooks run before the early return below, and the setter is identity-guarded so the layout
   * effect that feeds it cannot loop.
   */
  const [pageBand, setPageBand] = useState<BarBand | null>(null);
  const reportPageBand = useCallback((band: BarBand | null) => {
    setPageBand((prev) =>
      prev === band || (prev && band && prev.top === band.top && prev.bottom === band.bottom) ? prev : band,
    );
  }, []);

  if (!anchor || !block) return null;
  const bar: BarProps = { ...props, block, commands: pageBarCommands(props.commands) };
  const object = objectControls(bar);

  /**
   * THE ONE EXCEPTION: A SELECTED PHOTO OVERLAY.
   *
   * Every other selection is edited in place on a fixed spread — a base slot IS half the page, a
   * background is the whole of it — so tools that sit at a known spot are faster than tools that
   * chase the pointer. A floating overlay is different: it is small, it moves, and the whole job
   * is nudging it against the photo underneath. Tools three hundred pixels away turn that into a
   * round trip per adjustment.
   *
   * So an overlay's row detaches into its own shell anchored to the OVERLAY, and the page row
   * stays exactly where it always is. Same `CanvasBar`, same `useAnchorRect` — the flip-below,
   * viewport-clamping and scroll tracking all come for free, and the row follows the overlay
   * through a drag because the anchor is recomputed from its live rect.
   */
  const detached = selection.kind === 'overlay' && !!overlayAnchor;

  return (
    <>
      <CanvasBar
        anchor={anchor}
        label={`Spread ${props.index + 1} tools`}
        onEscape={props.onEscape}
        /* Sits clear of the book rather than on its edge, leaving the object bar its own lane. */
        gap={PAGE_BAR_GAP}
        onPlaced={reportPageBand}
      >
        <BarRow tone="page">
          <PageBar {...props} block={block} />
        </BarRow>
        {/* Keyed on the selection KIND so switching from a photo to a text replays the entrance
            animation; moving between two photos does not, because nothing about the row changed. */}
        {object && !detached && <BarRow key={selection.kind}>{object}</BarRow>}
      </CanvasBar>

      {detached && object && (
        <CanvasBar
          anchor={overlayAnchor}
          label="Overlay photo tools"
          onEscape={props.onEscape}
          avoid={pageBand}
        >
          <BarRow>{object}</BarRow>
        </CanvasBar>
      )}
    </>
  );
}

/**
 * The controls for whatever is selected — or null when nothing is.
 *
 * `ContextBar` above is the PAGE entry point (it also owns the page row). The cover enters through
 * `ObjectBar` with the same `BarProps`, so both surfaces reach the identical `PhotoBar` /
 * `TextBar` / `StickerBar` / `QrBar` — one implementation of "what tools does a text object get",
 * not two that agree today.
 */
function objectControls(p: BarProps): React.ReactNode {
  switch (p.selection.kind) {
    case 'base':
    case 'overlay':
      return <PhotoBar {...p} />;
    case 'text':
      return <TextBar {...p} />;
    case 'sticker':
      return <StickerBar {...p} />;
    case 'qr':
      return <QrBar {...p} />;
    default:
      return null;
  }
}

/** The object row on its own, for a host that supplies its own shell (the cover). */
export function ObjectBar(p: BarProps) {
  return <>{objectControls(p)}</>;
}

type PageBarProps = ContextBarProps & { block: Block };

/** Human labels for the Layers menu's "Move above/below…" sibling lists. */
/**
 * THE SURFACE'S WHOLE STACK, back to front — every object of every type, named.
 *
 * There used to be four of these, one per family, because layering could only move an object
 * within its own array. The Layers menu therefore listed "the other photos" or "the other texts"
 * and could never offer "put this behind that sticker". With one unified order
 * (`lib/builder/layers`) there is one list, and Bring-to-front / Move-above genuinely span types.
 *
 * It takes a `Block`, which is what both surfaces present — a content spread directly, and a
 * cover face through `useCover`'s adapter — so the menu needs no idea which one it is on.
 */
const stackSiblings = (block: Block, photoMap: Map<string, Photo>): LayerSibling[] => {
  const counts: Record<string, number> = { overlay: 0, text: 0, qr: 0, sticker: 0 };
  return layerStack(block).map(({ kind, id }) => {
    const n = ++counts[kind];
    if (kind === 'overlay') {
      const o = block.overlays.find((el) => el.id === id);
      const name = o?.photoId ? photoMap.get(o.photoId)?.filename : undefined;
      return { id, label: name || (o?.photoId ? `Photo ${n}` : `Empty frame ${n}`) };
    }
    if (kind === 'text') {
      const preview = (block.texts.find((el) => el.id === id)?.text ?? '').trim().replace(/\s+/g, ' ');
      return { id, label: preview ? (preview.length > 22 ? `${preview.slice(0, 22)}…` : preview) : `Text ${n}` };
    }
    return { id, label: kind === 'qr' ? `QR code ${n}` : `Sticker ${n}` };
  });
};

/** Where one object sits in that stack, and how deep the stack is — the menu's two numbers. */
const stackPos = (block: Block, id: string) => {
  const stack = layerStack(block);
  return { index: layerIndexOf(stack, id), total: stack.length };
};

// ── photo (base slot or overlay) ──────────────────────────────────────────────────

function PhotoBar(p: BarProps) {
  const { api, block, commands, selection, selectedPhoto, pairAspect } = p;
  const isOverlay = selection.kind === 'overlay';
  const overlayId = isOverlay ? selection.id : null;
  const ovIndex = overlayId ? block.overlays.findIndex((o) => o.id === overlayId) : -1;
  const overlay: Overlay | undefined = ovIndex >= 0 ? block.overlays[ovIndex] : undefined;
  const slot = selection.kind === 'base' ? selection.slot : undefined;

  // Editing geometry is authored against the worker's sanitized master, so the transform
  // controls wait for it — the same gate the modal editors have always enforced.
  const ready = selectedPhoto?.status === 'ready';
  const edit = selectedPhoto?.edit ?? {};
  const zoom = edit.zoom ?? 1;

  const apply = (patch: Partial<EditConfig>) => {
    if (selectedPhoto) commands.applyPhotoEdit(selectedPhoto.id, patch);
  };

  /**
   * FIT TO PHOTO — reshape the OVERLAY to the photo's aspect so nothing is cropped away.
   *
   * The renderer is cover-fit by construction (`computeFrameLayout`); there is no "contain" mode
   * and adding one would change every surface including the PDF. Reshaping the frame reaches the
   * same outcome the user wants — the whole photo visible, no crop — using geometry the model
   * already stores. A base slot's shape is fixed by its template, so this is overlay-only.
   */
  const fitToPhoto = () => {
    if (!overlay || !overlayId || !selectedPhoto) return;
    const aspect = orientedAspect(selectedPhoto);
    if (!aspect) return;
    // Overlay pixel aspect = (w · pairAspect) / h  ⇒  h = w · pairAspect / aspect.
    const h = (overlay.w * pairAspect) / aspect;
    const clamped = Math.max(0.04, Math.min(h, 1 - overlay.y));
    api.batch(() =>
      api.patchOverlays(
        block.key,
        block.overlays.map((o) => (o.id === overlayId ? { ...o, h: clamped } : o)),
      ),
    );
  };

  if (p.cropping) {
    // CROP MODE gets its own minimal bar: the only thing you can do is adjust and finish, so
    // showing twelve unrelated buttons would be noise at the exact moment focus matters most.
    return (
        <>
        <BarLabel>Drag to reposition · scroll to zoom</BarLabel>
        <BarSep />
        <BarBtn label="Zoom out" icon={<ZoomOut />} disabled={zoom <= 1} onClick={() => apply({ zoom: Math.max(1, zoom - 0.15) })} />
        <span className="w-10 text-center text-[11px] tabular-nums text-muted-foreground">{zoom.toFixed(2)}×</span>
        <BarBtn label="Zoom in" icon={<ZoomIn />} disabled={zoom >= MAX_ZOOM} onClick={() => apply({ zoom: Math.min(MAX_ZOOM, zoom + 0.15) })} />
        <BarSep />
        <BarBtn label="Reset position" icon={<RotateCcw />} onClick={() => apply({ zoom: 1, offsetX: 0, offsetY: 0 })} />
        <BarBtn label="Done" icon={<Check />} text="Done" onClick={p.onEndCrop} />
      </>
    );
  }

  return (
    <>
      <BarBtn
        label="Replace photo"
        icon={<Replace />}
        text="Replace"
        onClick={() => p.onReplace(isOverlay ? { overlayId: overlayId ?? undefined } : { slot })}
      />
      <BarBtn label={ready ? 'Crop — drag to reposition' : 'Available once the photo finishes uploading'} icon={<Crop />} disabled={!ready} onClick={p.onCrop} />
      <BarSep />

      <BarBtn label="Fill frame — reset crop and zoom" icon={<Maximize />} disabled={!ready} onClick={() => apply({ zoom: 1, offsetX: 0, offsetY: 0, crop: undefined })} />
      <BarBtn
        label={isOverlay ? 'Fit frame to the photo’s shape' : 'Fit is available on overlays — a page slot’s shape is fixed'}
        icon={<Minimize />}
        disabled={!ready || !isOverlay}
        onClick={fitToPhoto}
      />
      <BarBtn label="Zoom out" icon={<ZoomOut />} disabled={!ready || zoom <= 1} onClick={() => apply({ zoom: Math.max(1, zoom - 0.25) })} />
      <BarBtn label="Zoom in" icon={<ZoomIn />} disabled={!ready || zoom >= MAX_ZOOM} onClick={() => apply({ zoom: Math.min(MAX_ZOOM, zoom + 0.25) })} />
      <BarSep />

      <BarBtn label="Rotate left" icon={<RotateCcw />} disabled={!ready} onClick={() => commands.rotateBy(-1)} />
      <BarBtn label="Rotate right" icon={<RotateCw />} disabled={!ready} onClick={() => commands.rotateBy(1)} />
      <BarBtn label="Flip horizontally" icon={<FlipHorizontal />} active={!!edit.flipH} disabled={!ready} onClick={() => apply({ flipH: !edit.flipH })} />
      <BarBtn label="Flip vertically" icon={<FlipVertical />} active={!!edit.flipV} disabled={!ready} onClick={() => apply({ flipV: !edit.flipV })} />
      <BarSep />

      {/* Detailed tone + finish → the docked properties panel (PhotoAdjustInspector). */}
      <BarBtn
        label="Adjust colour and finish"
        icon={<SlidersHorizontal />}
        text="Adjust"
        active={p.propertiesOpen}
        disabled={!ready}
        onClick={p.onOpenProperties}
      />

      {isOverlay && overlayId && (
        <>
          <BarSep />
          <LayerMenu
            {...stackPos(block, overlayId)}
            siblings={stackSiblings(block, p.photoMap)}
            onMove={(a) => commands.moveLayer({ kind: 'overlay', blockKey: block.key, id: overlayId }, a)}
          />
          <BarBtn
            label="Duplicate overlay"
            icon={<Copy />}
            onClick={() => {
              const id = api.duplicateOverlay(block.key, overlayId);
              if (id) p.onSelect({ kind: 'overlay', id });
            }}
          />
        </>
      )}

      <BarSep />
      {/* The SAME priority-resolved command the Delete key runs — an overlay's Delete removes
          the overlay, a base slot's returns the photo to the tray. One implementation. */}
      <BarBtn
        label={commands.deleteSelection.label}
        icon={<Trash2 />}
        destructive
        disabled={!commands.deleteSelection.enabled}
        onClick={() => void commands.deleteSelection.run()}
      />
    </>
  );
}

// ── text ──────────────────────────────────────────────────────────────────────────

/** Alignment cycles left → centre → right — one compact control showing the current state. */
const NEXT_ALIGN: Record<TextElement['align'], TextElement['align']> = { left: 'center', center: 'right', right: 'left' };
const ALIGN_ICON: Record<TextElement['align'], React.ReactNode> = {
  left: <AlignLeft />,
  center: <AlignCenter />,
  right: <AlignRight />,
};


/**
 * THE TEXT TOOLBAR (Pass 3) — everyday typography without leaving the canvas.
 *
 * Font, size, weight, style, alignment and colour all live on the bar itself, so normal text
 * editing never opens a panel. The right-hand properties panel ("Advanced") carries only what
 * has no business on a toolbar: letter spacing, line height, opacity, rotation, shadow.
 */
function TextBar(p: BarProps) {
  const { api, block, selection, commands } = p;
  if (selection.kind !== 'text') return null;
  const el = block.texts.find((t) => t.id === selection.id);
  if (!el) return null;
  // The element's position now comes from the SURFACE's stack (stackPos), not from its index
  // inside block.texts — layering spans object types.
  const set = (patch: Partial<typeof el>) => api.patchText(block.key, el.id, patch);

  return (
    <>
      <FontPicker compact value={el.font} onChange={(v) => set({ font: v })} />
      <FontSizeField compact barItem value={el.size} onChange={(v) => set(textSizePatch(el, v))} />
      <BarSep />
      <BarBtn label="Bold" icon={<Bold />} active={el.weight >= 700} onClick={() => set({ weight: el.weight >= 700 ? 400 : 700 })} />
      <BarBtn label="Italic" icon={<Italic />} active={el.italic} onClick={() => set({ italic: !el.italic })} />
      <BarBtn label="Underline" icon={<Underline />} active={el.underline} onClick={() => set({ underline: !el.underline })} />
      <BarBtn
        label={`Alignment — ${el.align === 'left' ? 'left' : el.align === 'center' ? 'centre' : 'right'}`}
        icon={ALIGN_ICON[el.align]}
        onClick={() => set({ align: NEXT_ALIGN[el.align] })}
      />
      <BarSep />
      <BarPopover label="Text colour" swatch={el.color} width={252} overflowVisible>
        <div className="p-3">
          <ColorField value={el.color} onChange={(hex) => set({ color: hex })} />
        </div>
      </BarPopover>
      <BarSep />
      <LayerMenu
        {...stackPos(block, el.id)}
        siblings={stackSiblings(block, p.photoMap)}
        onMove={(a) => commands.moveLayer({ kind: 'text', blockKey: block.key, id: el.id }, a)}
      />
      <BarBtn
        label="Duplicate text"
        icon={<Copy />}
        onClick={() => {
          const id = api.duplicateText(block.key, el.id);
          if (id) p.onSelect({ kind: 'text', id });
        }}
      />
      <BarBtn
        label="Advanced typography — spacing, opacity, shadow"
        icon={<SlidersHorizontal />}
        active={p.propertiesOpen}
        onClick={p.onOpenProperties}
      />
      <BarSep />
      <BarBtn
        label="Delete text"
        icon={<Trash2 />}
        destructive
        onClick={() => void p.commands.deleteSelection.run()}
      />
    </>
  );
}

// ── sticker ───────────────────────────────────────────────────────────────────────

function StickerBar(p: BarProps) {
  const { api, block, selection, commands } = p;
  if (selection.kind !== 'sticker') return null;
  const el = block.stickers.find((s) => s.id === selection.id);
  if (!el) return null;
  const i = block.stickers.findIndex((s) => s.id === el.id);
  const set = (patch: Partial<typeof el>) => api.patchSticker(block.key, el.id, patch);

  return (
    <>
      <BarBtn label="Flip horizontally" icon={<FlipHorizontal />} active={!!el.flipH} onClick={() => set({ flipH: !el.flipH })} />
      <BarBtn label="Flip vertically" icon={<FlipVertical />} active={!!el.flipV} onClick={() => set({ flipV: !el.flipV })} />
      <BarBtn
        label={el.locked ? 'Unlock sticker' : 'Lock sticker'}
        icon={el.locked ? <LockOpen /> : <Lock />}
        active={!!el.locked}
        onClick={() => set({ locked: !el.locked })}
      />
      <BarSep />
      <BarBtn
        label="Sticker settings — opacity and rotation"
        icon={<SlidersHorizontal />}
        text="Adjust"
        active={p.propertiesOpen}
        onClick={p.onOpenProperties}
      />
      <BarSep />
      <LayerMenu
        index={i}
        total={block.stickers.length}
        siblings={stackSiblings(block, p.photoMap)}
        onMove={(a) => commands.moveLayer({ kind: 'sticker', blockKey: block.key, id: el.id }, a)}
      />
      <BarBtn
        label="Duplicate sticker"
        icon={<Copy />}
        onClick={() => {
          const id = api.duplicateSticker(block.key, el.id);
          if (id) p.onSelect({ kind: 'sticker', id });
        }}
      />
      <BarSep />
      <BarBtn label="Delete sticker" icon={<Trash2 />} destructive onClick={() => void p.commands.deleteSelection.run()} />
    </>
  );
}

// ── QR ────────────────────────────────────────────────────────────────────────────

function QrBar(p: BarProps) {
  const { block, selection, commands } = p;
  if (selection.kind !== 'qr') return null;
  const el = block.qrs.find((q) => q.id === selection.id);
  if (!el) return null;
  const i = block.qrs.findIndex((q) => q.id === el.id);

  return (
    <>
      <BarBtn
        label="QR settings — link, colours, style"
        icon={<QrCode />}
        text="QR settings"
        active={p.propertiesOpen}
        onClick={p.onOpenProperties}
      />
      <BarSep />
      <LayerMenu
        index={i}
        total={block.qrs.length}
        siblings={stackSiblings(block, p.photoMap)}
        onMove={(a) => commands.moveLayer({ kind: 'qr', blockKey: block.key, id: el.id }, a)}
      />
      <BarSep />
      <BarBtn label="Delete QR code" icon={<Trash2 />} destructive onClick={() => void p.commands.deleteSelection.run()} />
    </>
  );
}

// ── page (nothing selected) ───────────────────────────────────────────────────────

/**
 * THE LAYOUT CONTROL — one button where there were four.
 *
 * Layout, Shuffle, Fewer and More are all the same question ("arrange this spread differently")
 * asked at different granularities, and spreading them across four always-visible buttons spent a
 * third of the page toolbar on one concept. They collapse into a single `Layout ▾` whose popover
 * states the current layout, offers the three quick actions, and hands off to the existing
 * Layouts panel for browsing.
 *
 * IT OWNS NO LAYOUT LOGIC. Shuffle is the existing `onCycleLayout`; fewer/more are
 * `layoutByDensity` (built on the same catalog, capacity and geometry-key maths the cycle uses)
 * applied through the same `applyPreset` command; Browse opens the same rail panel. Every one of
 * them lands in history as an ordinary layout change, so undo and redo are unchanged.
 */
function LayoutMenu(p: PageBarProps) {
  const quick = (label: string, hint: string, icon: React.ReactNode, enabled: boolean, run: () => void, close: () => void) => (
    <button
      type="button"
      disabled={!enabled}
      title={hint}
      onClick={() => {
        run();
        close();
      }}
      className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[12px] text-foreground transition-colors hover:bg-secondary disabled:pointer-events-none disabled:opacity-40 [&_svg]:h-3.5 [&_svg]:w-3.5 [&_svg]:text-muted-foreground"
    >
      {icon}
      {label}
    </button>
  );

  return (
    <BarPopover label="Layout for this spread" icon={<LayoutGrid />} text="Layout" width={232}>
      {(close) => (
        <div className="p-1.5">
          <div className="px-2.5 pb-1.5 pt-1">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Current layout</p>
            <p className="truncate text-[12.5px] font-medium text-foreground">{p.layoutLabel}</p>
          </div>
          <div className="my-1 h-px bg-border/70" />
          {quick(
            p.cyclePosition ? `Shuffle layout · ${p.cyclePosition}` : 'Shuffle layout',
            p.canCycleLayout
              ? 'Try the next curated layout for this spread — your photos come with it'
              : 'No alternative layouts are available for this spread',
            <Shuffle />,
            p.canCycleLayout,
            p.onCycleLayout,
            close,
          )}
          {quick(
            'Fewer photos',
            p.canFewerPhotos ? 'Switch to the nearest layout that holds fewer photos' : 'No simpler layout is available',
            <Minimize />,
            p.canFewerPhotos,
            () => p.onLayoutDensity(-1),
            close,
          )}
          {quick(
            'More photos',
            p.canMorePhotos ? 'Switch to the nearest layout that holds more photos' : 'No denser layout is available',
            <Maximize />,
            p.canMorePhotos,
            () => p.onLayoutDensity(1),
            close,
          )}
          <div className="my-1 h-px bg-border/70" />
          {/* The Layouts rail remains the single source of truth for choosing a layout — this is a
              hand-off to it, never a second gallery. */}
          {quick('Browse all layouts…', 'Open the Layouts panel', <LayoutGrid />, true, p.onOpenLayouts, close)}
        </div>
      )}
    </BarPopover>
  );
}

function PageBar(p: PageBarProps) {
  const { api, block, index, total, size } = p;
  return (
    <>
      <BarLabel>
        Spread {index + 1} / {total}
      </BarLabel>
      <BarSep />
      <BarBtn label="Add a photo overlay" icon={<ImagePlus />} text="Photo" onClick={p.onAddPhotoOverlay} />
      <BarBtn label="Add text" icon={<TypeIcon />} text="Text" onClick={p.onAddText} />
      <BarBtn label="Add a QR code" icon={<QrCode />} onClick={p.onAddQr} />
      <LayoutMenu {...p} />
      <BarSep />
      <BarBtn label="Move spread earlier" icon={<ArrowUp />} disabled={index === 0} onClick={() => api.moveBlock(block.key, -1)} />
      <BarBtn label="Move spread later" icon={<ArrowDown />} disabled={index >= total - 1} onClick={() => api.moveBlock(block.key, 1)} />
      <BarBtn
        label="Duplicate spread"
        icon={<Copy />}
        disabled={api.blocks.length * 2 + 2 > size}
        onClick={() => api.duplicateBlock(block.key, size)}
      />
      <BarSep />
      <BarBtn label={p.showGuides ? 'Hide guides' : 'Show guides'} icon={<Frame />} active={p.showGuides} onClick={p.onToggleGuides} />
      <BarBtn label="Delete this spread" icon={<Trash2 />} destructive onClick={() => api.removeBlock(block.key)} />
    </>
  );
}
