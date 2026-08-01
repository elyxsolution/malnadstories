'use client';

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
import { CanvasBar, BarBtn, BarSep, BarLabel, BarPopover } from './_canvas-bar';
import LayerMenu, { type LayerSibling } from './_layer-menu';
import FontPicker from './_font-picker';
import { ColorField } from './_color-picker';
import { MAX_ZOOM, type Block, type EditConfig, type Overlay, type TextElement } from '@/lib/builder/model';
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

export type ContextBarProps = {
  anchor: Anchor | null;
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
  /** Open the selected object's detailed controls in the right-hand properties panel. */
  onOpenProperties: () => void;
  propertiesOpen: boolean;
  /** Return focus to the canvas when the bar is dismissed with Escape. */
  onEscape: () => void;
};

export default function ContextBar(props: ContextBarProps) {
  const { anchor, block, selection } = props;
  if (!anchor || !block) return null;

  switch (selection.kind) {
    case 'base':
    case 'overlay':
      return <PhotoBar {...props} block={block} />;
    case 'text':
      return <TextBar {...props} block={block} />;
    case 'sticker':
      return <StickerBar {...props} block={block} />;
    case 'qr':
      return <QrBar {...props} block={block} />;
    default:
      return <PageBar {...props} block={block} />;
  }
}

type BarProps = ContextBarProps & { block: Block };

/** Human labels for the Layers menu's "Move above/below…" sibling lists. */
const overlaySiblings = (block: Block, photoMap: Map<string, Photo>): LayerSibling[] =>
  block.overlays.map((o, i) => ({
    id: o.id ?? String(i),
    label: o.photoId ? (photoMap.get(o.photoId)?.filename || `Photo ${i + 1}`) : `Empty frame ${i + 1}`,
  }));

const textSiblings = (block: Block): LayerSibling[] =>
  block.texts.map((t, i) => {
    const preview = t.text.trim().replace(/\s+/g, ' ');
    return { id: t.id, label: preview ? (preview.length > 22 ? `${preview.slice(0, 22)}…` : preview) : `Text ${i + 1}` };
  });

const stickerSiblings = (block: Block): LayerSibling[] => block.stickers.map((s, i) => ({ id: s.id, label: `Sticker ${i + 1}` }));

const qrSiblings = (block: Block): LayerSibling[] => block.qrs.map((q, i) => ({ id: q.id, label: `QR code ${i + 1}` }));

// ── photo (base slot or overlay) ──────────────────────────────────────────────────

function PhotoBar(p: BarProps) {
  const { api, block, commands, selection, selectedPhoto, anchor, pairAspect } = p;
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
      <CanvasBar anchor={anchor} label="Crop photo" onEscape={p.onEndCrop}>
        <BarLabel>Drag to reposition · scroll to zoom</BarLabel>
        <BarSep />
        <BarBtn label="Zoom out" icon={<ZoomOut />} disabled={zoom <= 1} onClick={() => apply({ zoom: Math.max(1, zoom - 0.15) })} />
        <span className="w-10 text-center text-[11px] tabular-nums text-muted-foreground">{zoom.toFixed(2)}×</span>
        <BarBtn label="Zoom in" icon={<ZoomIn />} disabled={zoom >= MAX_ZOOM} onClick={() => apply({ zoom: Math.min(MAX_ZOOM, zoom + 0.15) })} />
        <BarSep />
        <BarBtn label="Reset position" icon={<RotateCcw />} onClick={() => apply({ zoom: 1, offsetX: 0, offsetY: 0 })} />
        <BarBtn label="Done" icon={<Check />} text="Done" onClick={p.onEndCrop} />
      </CanvasBar>
    );
  }

  return (
    <CanvasBar anchor={anchor} label={isOverlay ? 'Overlay photo tools' : 'Photo tools'} onEscape={p.onEscape}>
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
            index={ovIndex}
            total={block.overlays.length}
            siblings={overlaySiblings(block, p.photoMap)}
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
        label={commands.commands.deleteSelection.label}
        icon={<Trash2 />}
        destructive
        disabled={!commands.commands.deleteSelection.enabled}
        onClick={() => void commands.commands.deleteSelection.run()}
      />
    </CanvasBar>
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
 * Editable font size — type a number, press ↑/↓, or use the native spinner. Clamped to the
 * same 10–160 range the inspector slider uses; writes through the same `patchText` callback.
 */
function SizeInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <input
      type="number"
      data-bar-item
      min={10}
      max={160}
      step={1}
      value={Math.round(value)}
      aria-label="Font size"
      title="Font size"
      onChange={(e) => {
        const v = Math.round(Number(e.target.value));
        if (Number.isFinite(v)) onChange(Math.max(10, Math.min(160, v)));
      }}
      onKeyDown={(e) => {
        // The bar's roving focus uses ←/→ — keep them for the caret inside the field.
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') e.stopPropagation();
      }}
      className="h-7 w-12 rounded-lg bg-transparent px-1.5 text-center text-[12px] tabular-nums text-foreground outline-none transition-colors hover:bg-secondary focus-visible:ring-2 focus-visible:ring-studio-bright [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
    />
  );
}

/**
 * THE TEXT TOOLBAR (Pass 3) — everyday typography without leaving the canvas.
 *
 * Font, size, weight, style, alignment and colour all live on the bar itself, so normal text
 * editing never opens a panel. The right-hand properties panel ("Advanced") carries only what
 * has no business on a toolbar: letter spacing, line height, opacity, rotation, shadow.
 */
function TextBar(p: BarProps) {
  const { api, block, selection, anchor, commands } = p;
  if (selection.kind !== 'text') return null;
  const el = block.texts.find((t) => t.id === selection.id);
  if (!el) return null;
  const i = block.texts.findIndex((t) => t.id === el.id);
  const set = (patch: Partial<typeof el>) => api.patchText(block.key, el.id, patch);

  return (
    <CanvasBar anchor={anchor} label="Text tools" onEscape={p.onEscape}>
      <FontPicker compact value={el.font} onChange={(v) => set({ font: v })} />
      <SizeInput value={el.size} onChange={(v) => set({ size: v })} />
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
        index={i}
        total={block.texts.length}
        siblings={textSiblings(block)}
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
        onClick={() => void p.commands.commands.deleteSelection.run()}
      />
    </CanvasBar>
  );
}

// ── sticker ───────────────────────────────────────────────────────────────────────

function StickerBar(p: BarProps) {
  const { api, block, selection, anchor, commands } = p;
  if (selection.kind !== 'sticker') return null;
  const el = block.stickers.find((s) => s.id === selection.id);
  if (!el) return null;
  const i = block.stickers.findIndex((s) => s.id === el.id);
  const set = (patch: Partial<typeof el>) => api.patchSticker(block.key, el.id, patch);

  return (
    <CanvasBar anchor={anchor} label="Sticker tools" onEscape={p.onEscape}>
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
        siblings={stickerSiblings(block)}
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
      <BarBtn label="Delete sticker" icon={<Trash2 />} destructive onClick={() => void p.commands.commands.deleteSelection.run()} />
    </CanvasBar>
  );
}

// ── QR ────────────────────────────────────────────────────────────────────────────

function QrBar(p: BarProps) {
  const { block, selection, anchor, commands } = p;
  if (selection.kind !== 'qr') return null;
  const el = block.qrs.find((q) => q.id === selection.id);
  if (!el) return null;
  const i = block.qrs.findIndex((q) => q.id === el.id);

  return (
    <CanvasBar anchor={anchor} label="QR code tools" onEscape={p.onEscape}>
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
        siblings={qrSiblings(block)}
        onMove={(a) => commands.moveLayer({ kind: 'qr', blockKey: block.key, id: el.id }, a)}
      />
      <BarSep />
      <BarBtn label="Delete QR code" icon={<Trash2 />} destructive onClick={() => void p.commands.commands.deleteSelection.run()} />
    </CanvasBar>
  );
}

// ── page (nothing selected) ───────────────────────────────────────────────────────

function PageBar(p: BarProps) {
  const { api, block, index, total, size, anchor } = p;
  return (
    <CanvasBar anchor={anchor} label={`Spread ${index + 1} tools`} onEscape={p.onEscape}>
      <BarLabel>
        Spread {index + 1} / {total}
      </BarLabel>
      <BarSep />
      <BarBtn label="Add a photo overlay" icon={<ImagePlus />} text="Photo" onClick={p.onAddPhotoOverlay} />
      <BarBtn label="Add text" icon={<TypeIcon />} text="Text" onClick={p.onAddText} />
      <BarBtn label="Add a QR code" icon={<QrCode />} onClick={p.onAddQr} />
      <BarBtn label="Change this spread’s layout" icon={<LayoutGrid />} onClick={p.onOpenLayouts} />
      <BarBtn
        label={
          p.canCycleLayout
            ? 'Try the next curated layout for this spread — your photos come with it'
            : 'No alternative layouts are available for this spread'
        }
        icon={<Shuffle />}
        text={p.cyclePosition ?? undefined}
        disabled={!p.canCycleLayout}
        active={!!p.cyclePosition}
        onClick={p.onCycleLayout}
      />
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
    </CanvasBar>
  );
}
