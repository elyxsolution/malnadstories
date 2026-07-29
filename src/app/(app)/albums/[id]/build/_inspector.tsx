'use client';

import {
  ArrowUp,
  ArrowDown,
  Trash2,
  Copy,
  Frame,
  SlidersHorizontal,
  Layers,
  Type as TypeIcon,
  Image as ImageIcon,
  QrCode,
  RotateCcw,
} from 'lucide-react';
import { Section, Row, Slider, Toggle } from './_controls';
import { TextInspector, StickerInspector, fmt } from './_element-inspectors';
import { ColorField } from './_color-picker';
import { TEMPLATE_LABEL, type Block, type EditConfig } from '@/lib/builder/model';
import type { Photo } from '@/lib/builder/photo';
import type { BuilderApi, Selection } from './_use-builder';

/**
 * The right Inspector — a single panel that switches on what's selected:
 *   nothing → page settings · photo → adjustments · text → typography · QR → code settings.
 * Photo adjustments update live (local) and persist on release; text/QR edits flow through
 * the history-backed builder hook and save with the layout.
 */
export default function Inspector({
  api,
  block,
  index,
  total,
  size,
  selection,
  photoMap,
  showGuides,
  onToggleGuides,
  onSelect,
  onEditPhoto,
  onPhotoChange,
  onPhotoCommit,
}: {
  api: BuilderApi;
  block: Block | undefined;
  index: number;
  total: number;
  size: number;
  selection: Selection;
  photoMap: Map<string, Photo>;
  showGuides: boolean;
  onToggleGuides: () => void;
  onSelect: (s: Selection) => void;
  onEditPhoto: (photoId: string) => void;
  onPhotoChange: (photoId: string, edit: EditConfig) => void;
  onPhotoCommit: (photoId: string, edit: EditConfig) => void;
}) {
  if (!block) {
    return (
      <div className="grid flex-1 place-items-center p-6 text-center">
        <p className="text-sm text-muted-foreground">Add a spread to start editing.</p>
      </div>
    );
  }

  // Resolve the selected photo id (base slot or overlay) for the photo inspector.
  const selectedPhotoId =
    selection.kind === 'base'
      ? selection.slot === 'right'
        ? block.photoIds[1]
        : block.photoIds[0]
      : selection.kind === 'overlay'
        ? block.overlays.find((o) => o.id === selection.id)?.photoId
        : undefined;

  if (selection.kind === 'text') {
    const el = block.texts.find((t) => t.id === selection.id);
    if (el)
      return (
        <TextInspector
          el={el}
          onChange={(patch) => api.patchText(block.key, el.id, patch)}
          onDelete={() => {
            api.removeText(block.key, el.id);
            onSelect({ kind: 'none' });
          }}
        />
      );
  }
  if (selection.kind === 'qr') {
    const el = block.qrs.find((q) => q.id === selection.id);
    if (el) return <QrInspector api={api} blockKey={block.key} el={el} onClose={() => onSelect({ kind: 'none' })} />;
  }
  if (selection.kind === 'sticker') {
    const el = block.stickers.find((s) => s.id === selection.id);
    if (el)
      return (
        <StickerInspector
          el={el}
          onChange={(patch) => api.patchSticker(block.key, el.id, patch)}
          onDelete={() => {
            api.removeSticker(block.key, el.id);
            onSelect({ kind: 'none' });
          }}
          onDuplicate={() => {
            const ni = api.duplicateSticker(block.key, el.id);
            if (ni) onSelect({ kind: 'sticker', id: ni });
          }}
          onForward={() => api.reorderSticker(block.key, el.id, 1)}
          onBackward={() => api.reorderSticker(block.key, el.id, -1)}
        />
      );
  }
  if (selectedPhotoId && photoMap.has(selectedPhotoId)) {
    const photo = photoMap.get(selectedPhotoId)!;
    // Overlay identity is an id; its POSITION is looked up only for the forward/backward
    // affordances, which are inherently about order.
    const ovId = selection.kind === 'overlay' ? selection.id : null;
    const ovIndex = ovId ? block.overlays.findIndex((o) => o.id === ovId) : -1;
    const overlay =
      ovId && ovIndex >= 0
        ? {
            onDelete: () => {
              api.removeOverlay(block.key, ovId);
              onSelect({ kind: 'none' });
            },
            onDuplicate: () => {
              const ni = api.duplicateOverlay(block.key, ovId);
              if (ni !== undefined) onSelect({ kind: 'overlay', id: ni });
            },
            onForward: ovIndex < block.overlays.length - 1 ? () => api.reorderOverlay(block.key, ovId, 1) : undefined,
            onBackward: ovIndex > 0 ? () => api.reorderOverlay(block.key, ovId, -1) : undefined,
          }
        : undefined;
    return (
      <PhotoInspector
        photoId={photo.id}
        edit={photo.edit ?? {}}
        isOverlay={selection.kind === 'overlay'}
        overlay={overlay}
        onEditPhoto={onEditPhoto}
        onChange={onPhotoChange}
        onCommit={onPhotoCommit}
      />
    );
  }

  return (
    <PageInspector
      api={api}
      block={block}
      index={index}
      total={total}
      size={size}
      showGuides={showGuides}
      onToggleGuides={onToggleGuides}
    />
  );
}

// Each sub-panel scrolls with the quiet builder scrollbar.

// ── Page ───────────────────────────────────────────────────────────────────────
function PageInspector({
  api,
  block,
  index,
  total,
  size,
  showGuides,
  onToggleGuides,
}: {
  api: BuilderApi;
  block: Block;
  index: number;
  total: number;
  size: number;
  showGuides: boolean;
  onToggleGuides: () => void;
}) {
  return (
    <div className="ms-scroll flex-1 overflow-y-auto">
      <Section>
        <div className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-secondary text-[12px] font-semibold tabular-nums text-foreground ring-1 ring-border">
            {index + 1}
          </span>
          <div>
            <p className="text-sm font-semibold tracking-tight text-foreground">Spread {index + 1}</p>
            <p className="text-[11px] text-muted-foreground">
              {TEMPLATE_LABEL[block.template]} · of {total}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Layers className="h-3.5 w-3.5" /> {block.overlays.length} photo overlay{block.overlays.length === 1 ? '' : 's'}
          </span>
          <span className="inline-flex items-center gap-1">
            <TypeIcon className="h-3.5 w-3.5" /> {block.texts.length} text
          </span>
          <span className="inline-flex items-center gap-1">
            <QrCode className="h-3.5 w-3.5" /> {block.qrs.length} QR
          </span>
        </div>
      </Section>

      <Section title="Arrange">
        <div className="grid grid-cols-2 gap-2">
          <ActionBtn icon={<ArrowUp />} label="Move up" disabled={index === 0} onClick={() => api.moveBlock(block.key, -1)} />
          <ActionBtn icon={<ArrowDown />} label="Move down" disabled={index >= total - 1} onClick={() => api.moveBlock(block.key, 1)} />
          <ActionBtn
            icon={<Copy />}
            label="Duplicate"
            disabled={api.blocks.length * 2 + 2 > size}
            onClick={() => api.duplicateBlock(block.key, size)}
          />
          <ActionBtn icon={<Trash2 />} label="Delete" destructive onClick={() => api.removeBlock(block.key)} />
        </div>
      </Section>

      <Section title="View">
        <button
          type="button"
          onClick={onToggleGuides}
          className={`flex w-full items-center justify-center gap-1.5 rounded-lg border py-2 text-[12px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-studio-bright ${
            showGuides ? 'border-studio/30 bg-studio-soft text-studio' : 'border-border bg-card text-foreground hover:bg-secondary'
          }`}
        >
          <Frame className="h-3.5 w-3.5" /> {showGuides ? 'Hide guides' : 'Show guides'}
        </button>
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Select any element on the page to edit it — or use the left panel to add photos, layouts, text, backgrounds and QR codes.
        </p>
      </Section>
    </div>
  );
}

// ── Photo ─────────────────────────────────────────────────────────────────────
type OverlayActions = {
  onDelete: () => void;
  onDuplicate: () => void;
  onForward?: () => void;
  onBackward?: () => void;
};

function PhotoInspector({
  photoId,
  edit,
  isOverlay,
  overlay,
  onEditPhoto,
  onChange,
  onCommit,
}: {
  photoId: string;
  edit: EditConfig;
  isOverlay: boolean;
  overlay?: OverlayActions;
  onEditPhoto: (id: string) => void;
  onChange: (id: string, edit: EditConfig) => void;
  onCommit: (id: string, edit: EditConfig) => void;
}) {
  const set = (patch: Partial<EditConfig>) => onChange(photoId, { ...edit, ...patch });
  const commit = () => onCommit(photoId, edit);

  const adj: { key: keyof EditConfig; label: string; min: number; max: number; def: number }[] = [
    { key: 'brightness', label: 'Brightness', min: 0.4, max: 1.8, def: 1 },
    { key: 'contrast', label: 'Contrast', min: 0.4, max: 1.8, def: 1 },
    { key: 'saturation', label: 'Saturation', min: 0, max: 2, def: 1 },
    { key: 'sharpness', label: 'Sharpness', min: 0, max: 2, def: 0 },
    { key: 'opacity', label: 'Opacity', min: 0.1, max: 1, def: 1 },
    { key: 'borderRadius', label: 'Round corners', min: 0, max: 0.5, def: 0 },
    { key: 'shadow', label: 'Shadow', min: 0, max: 1, def: 0 },
  ];

  return (
    <div className="ms-scroll flex-1 overflow-y-auto">
      <Section>
        <div className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-studio/10 text-studio">
            <ImageIcon className="h-4 w-4" />
          </span>
          <p className="text-sm font-semibold tracking-tight text-foreground">{isOverlay ? 'Overlay photo' : 'Photo'}</p>
        </div>
        <button
          type="button"
          onClick={() => onEditPhoto(photoId)}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-studio px-3 py-2 text-[12px] font-semibold text-studio-foreground shadow-xs transition-all hover:bg-[hsl(150_48%_29%)] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-studio-bright"
        >
          <SlidersHorizontal className="h-3.5 w-3.5" /> Crop, rotate &amp; flip
        </button>
      </Section>

      {overlay && (
        <Section title="Overlay">
          <div className="grid grid-cols-3 gap-2">
            <ActionBtn icon={<Copy />} label="Duplicate" onClick={overlay.onDuplicate} />
            <ActionBtn icon={<ArrowUp />} label="Forward" disabled={!overlay.onForward} onClick={() => overlay.onForward?.()} />
            <ActionBtn icon={<ArrowDown />} label="Backward" disabled={!overlay.onBackward} onClick={() => overlay.onBackward?.()} />
          </div>
          <button
            type="button"
            onClick={overlay.onDelete}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-[12.5px] font-semibold text-destructive transition-colors hover:bg-destructive hover:text-destructive-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/40"
          >
            <Trash2 className="h-4 w-4" /> Delete overlay
          </button>
        </Section>
      )}

      <Section title="Adjust">
        {adj.map((a) => (
          <Row key={a.key} label={a.label} hint={fmt(((edit[a.key] as number) ?? a.def))}>
            <Slider
              value={(edit[a.key] as number) ?? a.def}
              min={a.min}
              max={a.max}
              step={0.01}
              ariaLabel={a.label}
              onChange={(v) => set({ [a.key]: v } as Partial<EditConfig>)}
              onCommit={commit}
            />
          </Row>
        ))}
        <Toggle label="Black & white" checked={(edit.grayscale ?? 0) > 0} onChange={(v) => { set({ grayscale: v ? 1 : 0 }); onCommit(photoId, { ...edit, grayscale: v ? 1 : 0 }); }} />
      </Section>

      <Section>
        <button
          type="button"
          onClick={() => {
            const reset = { ...edit, brightness: 1, contrast: 1, saturation: 1, grayscale: 0, sharpness: 0, opacity: 1, borderRadius: 0, shadow: 0 };
            onChange(photoId, reset);
            onCommit(photoId, reset);
          }}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-border bg-card py-2 text-[12px] font-medium text-foreground transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-studio-bright"
        >
          <RotateCcw className="h-3.5 w-3.5" /> Reset adjustments
        </button>
      </Section>
    </div>
  );
}

// ── QR ─────────────────────────────────────────────────────────────────────────
function QrInspector({
  api,
  blockKey,
  el,
  onClose,
}: {
  api: BuilderApi;
  blockKey: string;
  el: Block['qrs'][number];
  onClose: () => void;
}) {
  const set = (patch: Partial<Block['qrs'][number]>) => api.patchQr(blockKey, el.id, patch);
  return (
    <div className="ms-scroll flex-1 overflow-y-auto">
      <Section>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-studio/10 text-studio">
              <QrCode className="h-4 w-4" />
            </span>
            <p className="text-sm font-semibold tracking-tight text-foreground">QR code</p>
          </div>
          <button type="button" onClick={() => { api.removeQr(blockKey, el.id); onClose(); }} aria-label="Delete QR" className="grid h-8 w-8 place-items-center rounded-lg text-destructive hover:bg-destructive/10">
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
        <input
          type="text"
          value={el.data}
          onChange={(e) => set({ data: e.target.value })}
          placeholder="https://…"
          maxLength={1024}
          className="h-9 w-full rounded-lg border border-input bg-card px-3 text-sm text-foreground shadow-xs outline-none transition-all placeholder:text-muted-foreground focus-visible:border-studio-bright focus-visible:ring-2 focus-visible:ring-studio-bright/40"
        />
      </Section>

      <Section title="Colour">
        <Row label="Code">
          <ColorField value={el.fg} onChange={(hex) => set({ fg: hex === 'transparent' ? el.fg : hex })} />
        </Row>
        <Row label="Background">
          <ColorField value={el.bg} allowTransparent onChange={(hex) => set({ bg: hex })} />
        </Row>
      </Section>

      <Section title="Style">
        <Row label="Padding" hint={fmt(el.padding)}>
          <Slider value={el.padding} min={0} max={0.4} step={0.01} ariaLabel="Padding" onChange={(v) => set({ padding: v })} />
        </Row>
        <Row label="Corner radius" hint={fmt(el.radius * 2)}>
          <Slider value={el.radius} min={0} max={0.5} step={0.01} ariaLabel="Corner radius" onChange={(v) => set({ radius: v })} />
        </Row>
      </Section>
    </div>
  );
}

// ── shared bits ─────────────────────────────────────────────────────────────────
function ActionBtn({
  icon,
  label,
  onClick,
  disabled,
  destructive,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center justify-center gap-1.5 rounded-lg border py-2 text-[12px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 [&_svg]:h-3.5 [&_svg]:w-3.5 ${
        destructive
          ? 'border-destructive/20 bg-destructive/10 text-destructive hover:bg-destructive/15 focus-visible:ring-destructive/40'
          : 'border-border bg-card text-foreground hover:bg-secondary focus-visible:ring-studio-bright'
      } disabled:pointer-events-none disabled:opacity-40`}
    >
      {icon}
      {label}
    </button>
  );
}
