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
  ChevronUp,
  ChevronDown,
  SlidersHorizontal,
  Type as TypeIcon,
  ImagePlus,
  QrCode,
  LayoutGrid,
  Frame,
  ArrowUp,
  ArrowDown,
  Check,
  Sticker as StickerIcon,
  Lock,
  LockOpen,
} from 'lucide-react';
import { CanvasBar, BarBtn, BarSep, BarLabel, BarPopover } from './_canvas-bar';
import {
  TextInspector,
  StickerInspector,
  QrInspector,
  PhotoAdjustInspector,
} from './_element-inspectors';
import { MAX_ZOOM, type Block, type EditConfig, type Overlay } from '@/lib/builder/model';
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
 * single photo-write path. Layer order, duplicate and element removal call the same `api.*`
 * primitives the old inspector called. No editing logic lives in this file — only the decision
 * of which buttons a given selection deserves.
 *
 * DETAIL LIVES IN POPOVERS. Typography, photo tone, sticker adjust and QR settings are not
 * re-authored as bar controls: the existing inspector components render INSIDE a popover,
 * unchanged. That is the whole "relocate, don't remove" contract — the same components, a
 * different host.
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
  /** Live + persisted photo-edit writes (the inspector's original contract). */
  onPhotoChange: (photoId: string, edit: EditConfig) => void;
  onPhotoCommit: (photoId: string, edit: EditConfig) => void;
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

      <BarPopover label="Adjust colour and finish" icon={<SlidersHorizontal />}>
        {selectedPhoto ? (
          <PhotoAdjustInspector
            edit={edit}
            onChange={(next) => p.onPhotoChange(selectedPhoto.id, next)}
            onCommit={(next) => p.onPhotoCommit(selectedPhoto.id, next)}
          />
        ) : null}
      </BarPopover>

      {isOverlay && overlayId && (
        <>
          <BarSep />
          <BarBtn
            label="Send backward"
            icon={<ChevronDown />}
            disabled={ovIndex <= 0}
            onClick={() => api.reorderOverlay(block.key, overlayId, -1)}
          />
          <BarBtn
            label="Bring forward"
            icon={<ChevronUp />}
            disabled={ovIndex >= block.overlays.length - 1}
            onClick={() => api.reorderOverlay(block.key, overlayId, 1)}
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

function TextBar(p: BarProps) {
  const { api, block, selection, anchor } = p;
  if (selection.kind !== 'text') return null;
  const el = block.texts.find((t) => t.id === selection.id);
  if (!el) return null;
  const i = block.texts.findIndex((t) => t.id === el.id);
  const set = (patch: Partial<typeof el>) => api.patchText(block.key, el.id, patch);

  return (
    <CanvasBar anchor={anchor} label="Text tools" onEscape={p.onEscape}>
      <BarPopover label="Typography" icon={<TypeIcon />} text="Type" width={288}>
        <TextInspector
          el={el}
          onChange={set}
          onDelete={() => {
            api.removeText(block.key, el.id);
            p.onSelect({ kind: 'none' });
          }}
        />
      </BarPopover>
      <BarSep />
      <BarBtn label="Bold" icon={<span className="text-[13px] font-bold leading-none">B</span>} active={el.weight >= 700} onClick={() => set({ weight: el.weight >= 700 ? 400 : 700 })} />
      <BarBtn label="Italic" icon={<span className="font-serif text-[13px] italic leading-none">I</span>} active={el.italic} onClick={() => set({ italic: !el.italic })} />
      <BarBtn label="Underline" icon={<span className="text-[13px] leading-none underline">U</span>} active={el.underline} onClick={() => set({ underline: !el.underline })} />
      <BarSep />
      <BarBtn label="Align left" icon={<span className="text-[11px] leading-none">◧</span>} active={el.align === 'left'} onClick={() => set({ align: 'left' })} />
      <BarBtn label="Align centre" icon={<span className="text-[11px] leading-none">▣</span>} active={el.align === 'center'} onClick={() => set({ align: 'center' })} />
      <BarBtn label="Align right" icon={<span className="text-[11px] leading-none">◨</span>} active={el.align === 'right'} onClick={() => set({ align: 'right' })} />
      <BarSep />
      <BarBtn label="Send backward" icon={<ChevronDown />} disabled={i <= 0} onClick={() => api.reorderText(block.key, el.id, -1)} />
      <BarBtn label="Bring forward" icon={<ChevronUp />} disabled={i >= block.texts.length - 1} onClick={() => api.reorderText(block.key, el.id, 1)} />
      <BarBtn
        label="Duplicate text"
        icon={<Copy />}
        onClick={() => {
          const id = api.duplicateText(block.key, el.id);
          if (id) p.onSelect({ kind: 'text', id });
        }}
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
  const { api, block, selection, anchor } = p;
  if (selection.kind !== 'sticker') return null;
  const el = block.stickers.find((s) => s.id === selection.id);
  if (!el) return null;
  const i = block.stickers.findIndex((s) => s.id === el.id);
  const set = (patch: Partial<typeof el>) => api.patchSticker(block.key, el.id, patch);

  return (
    <CanvasBar anchor={anchor} label="Sticker tools" onEscape={p.onEscape}>
      <BarPopover label="Sticker settings" icon={<StickerIcon />} text="Adjust">
        <StickerInspector
          el={el}
          onChange={set}
          onDelete={() => {
            api.removeSticker(block.key, el.id);
            p.onSelect({ kind: 'none' });
          }}
          onDuplicate={() => {
            const id = api.duplicateSticker(block.key, el.id);
            if (id) p.onSelect({ kind: 'sticker', id });
          }}
          onForward={i < block.stickers.length - 1 ? () => api.reorderSticker(block.key, el.id, 1) : undefined}
          onBackward={i > 0 ? () => api.reorderSticker(block.key, el.id, -1) : undefined}
        />
      </BarPopover>
      <BarSep />
      <BarBtn label="Flip horizontally" icon={<FlipHorizontal />} active={!!el.flipH} onClick={() => set({ flipH: !el.flipH })} />
      <BarBtn label="Flip vertically" icon={<FlipVertical />} active={!!el.flipV} onClick={() => set({ flipV: !el.flipV })} />
      <BarBtn
        label={el.locked ? 'Unlock sticker' : 'Lock sticker'}
        icon={el.locked ? <LockOpen /> : <Lock />}
        active={!!el.locked}
        onClick={() => set({ locked: !el.locked })}
      />
      <BarSep />
      <BarBtn label="Send backward" icon={<ChevronDown />} disabled={i <= 0} onClick={() => api.reorderSticker(block.key, el.id, -1)} />
      <BarBtn label="Bring forward" icon={<ChevronUp />} disabled={i >= block.stickers.length - 1} onClick={() => api.reorderSticker(block.key, el.id, 1)} />
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
  const { api, block, selection, anchor } = p;
  if (selection.kind !== 'qr') return null;
  const el = block.qrs.find((q) => q.id === selection.id);
  if (!el) return null;

  return (
    <CanvasBar anchor={anchor} label="QR code tools" onEscape={p.onEscape}>
      <BarPopover label="QR settings" icon={<QrCode />} text="QR settings">
        <QrInspector
          el={el}
          onChange={(patch) => api.patchQr(block.key, el.id, patch)}
          onDelete={() => {
            api.removeQr(block.key, el.id);
            p.onSelect({ kind: 'none' });
          }}
        />
      </BarPopover>
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
