'use client';

import {
  Trash2,
  Bold,
  Italic,
  Underline,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Type as TypeIcon,
  Sticker as StickerIcon,
  QrCode,
  Copy,
  ArrowUp,
  ArrowDown,
  FlipHorizontal,
  FlipVertical,
  Lock,
  LockOpen,
  RotateCcw,
  Image as ImageIcon,
} from 'lucide-react';
import { Section, Row, Slider, Toggle } from './_controls';
import FontPicker from './_font-picker';
import { ColorField } from './_color-picker';
import type { EditConfig, QrElement, StickerElement, TextElement } from '@/lib/builder/model';

/**
 * Generic, callback-driven element inspectors — NOT bound to the page (`BuilderApi`) or the
 * cover hook. Every host renders these with its own `onChange`/`onDelete`, so an element's
 * controls are byte-for-byte identical wherever they appear.
 *
 * PASS 2 made this the single home for detailed element controls. The right-hand Inspector
 * panel is gone; these components now render inside the floating context bar's popovers on
 * content pages, and inside the right rail on the cover — same components, two hosts. That is
 * what "relocate, don't remove" means in practice: not one control was rewritten or dropped,
 * they simply stopped needing a permanent column to live in.
 */

export function fmt(v: number) {
  return `${Math.round(v * 100)}%`;
}

export function IconToggle({
  active,
  label,
  onClick,
  children,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={label}
      onClick={onClick}
      className={`grid h-8 w-8 place-items-center rounded-md transition-colors [&_svg]:h-4 [&_svg]:w-4 ${
        active ? 'bg-studio text-studio-foreground' : 'bg-secondary/60 text-muted-foreground hover:text-foreground'
      }`}
    >
      {children}
    </button>
  );
}

/**
 * Typography editor for one text element. Used on pages AND the cover.
 *
 * `advanced` (Pass 3) is the content-page form: the floating text toolbar now owns font,
 * size, weight, style, alignment and colour, so the panel shows only what the toolbar
 * doesn't — content, spacing, and finish. Same component, same callbacks, conditional
 * sections — the cover (which has no text toolbar) keeps the full inspector by default.
 */
export function TextInspector({
  el,
  onChange,
  onDelete,
  advanced = false,
}: {
  el: TextElement;
  onChange: (patch: Partial<TextElement>) => void;
  /**
   * Omitted when the object cannot be deleted. That is the cover's title and spine: they render
   * album metadata that always prints, so offering Delete would be offering something the model
   * refuses. Absent ⇒ the control is not drawn, rather than drawn and inert.
   */
  onDelete?: () => void;
  advanced?: boolean;
}) {
  const set = onChange;
  return (
    <div className="ms-scroll flex-1 overflow-y-auto">
      <Section>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-studio/10 text-studio">
              <TypeIcon className="h-4 w-4" />
            </span>
            <p className="text-sm font-semibold tracking-tight text-foreground">Text</p>
          </div>
          {onDelete && (
            <button
              type="button"
              onClick={onDelete}
              aria-label="Delete text"
              className="grid h-8 w-8 place-items-center rounded-lg text-destructive hover:bg-destructive/10"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
        <textarea
          value={el.text}
          onChange={(e) => set({ text: e.target.value })}
          rows={2}
          placeholder="Type your text…"
          className="w-full resize-none rounded-lg border border-input bg-card px-3 py-2 text-sm text-foreground shadow-xs outline-none transition-all placeholder:text-muted-foreground focus-visible:border-studio-bright focus-visible:ring-2 focus-visible:ring-studio-bright/40"
        />
      </Section>

      {!advanced && (
        <Section title="Font">
          <FontPicker value={el.font} onChange={(v) => set({ font: v })} />
          <Row label="Size" hint={`${Math.round(el.size)}`}>
            <Slider value={el.size} min={10} max={160} step={1} ariaLabel="Font size" onChange={(v) => set({ size: v })} />
          </Row>
          <div className="flex items-center gap-1.5">
            <IconToggle active={el.weight >= 700} label="Bold" onClick={() => set({ weight: el.weight >= 700 ? 400 : 700 })}>
              <Bold />
            </IconToggle>
            <IconToggle active={el.italic} label="Italic" onClick={() => set({ italic: !el.italic })}>
              <Italic />
            </IconToggle>
            <IconToggle active={el.underline} label="Underline" onClick={() => set({ underline: !el.underline })}>
              <Underline />
            </IconToggle>
            <span className="mx-0.5 h-5 w-px bg-border" />
            <IconToggle active={el.align === 'left'} label="Align left" onClick={() => set({ align: 'left' })}>
              <AlignLeft />
            </IconToggle>
            <IconToggle active={el.align === 'center'} label="Align centre" onClick={() => set({ align: 'center' })}>
              <AlignCenter />
            </IconToggle>
            <IconToggle active={el.align === 'right'} label="Align right" onClick={() => set({ align: 'right' })}>
              <AlignRight />
            </IconToggle>
          </div>
        </Section>
      )}

      {!advanced && (
        <Section title="Colour">
          <ColorField value={el.color} onChange={(hex) => set({ color: hex })} />
        </Section>
      )}

      <Section title="Spacing & finish">
        <Row label="Letter spacing" hint={el.letterSpacing.toFixed(2)}>
          <Slider value={el.letterSpacing} min={-0.05} max={0.4} step={0.01} ariaLabel="Letter spacing" onChange={(v) => set({ letterSpacing: v })} />
        </Row>
        <Row label="Line height" hint={el.lineHeight.toFixed(2)}>
          <Slider value={el.lineHeight} min={0.9} max={2.2} step={0.05} ariaLabel="Line height" onChange={(v) => set({ lineHeight: v })} />
        </Row>
        <Row label="Opacity" hint={fmt(el.opacity)}>
          <Slider value={el.opacity} min={0.1} max={1} step={0.05} ariaLabel="Opacity" onChange={(v) => set({ opacity: v })} />
        </Row>
        <Row label="Rotation" hint={`${Math.round(el.rotation)}°`}>
          <Slider value={el.rotation} min={-180} max={180} step={1} ariaLabel="Rotation" onChange={(v) => set({ rotation: v })} />
        </Row>
        <Toggle label="Shadow" checked={el.shadow} onChange={(v) => set({ shadow: v })} />
      </Section>
    </div>
  );
}

/**
 * PHOTO ADJUSTMENTS — tone, finish and reset for one placed photo.
 *
 * Moved here verbatim from the old right-hand `Inspector` (Pass 2) and made callback-driven so
 * it matches its siblings above. Nothing about the controls changed: same seven sliders, same
 * ranges, same live-then-commit contract (`onChange` updates local state on every frame,
 * `onCommit` persists on release through the existing `savePhotoEdit`). Only its host moved —
 * from a permanent column to a popover on the canvas context bar.
 *
 * GEOMETRY IS DELIBERATELY ABSENT. Crop, zoom, rotate and flip are now direct-manipulation
 * actions on the canvas itself, so putting duplicates of them in a panel would be exactly the
 * property-panel habit this pass exists to remove.
 */
export function PhotoAdjustInspector({
  edit,
  onChange,
  onCommit,
}: {
  edit: EditConfig;
  onChange: (edit: EditConfig) => void;
  onCommit: (edit: EditConfig) => void;
}) {
  const set = (patch: Partial<EditConfig>) => onChange({ ...edit, ...patch });

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
      <Section title="Adjust">
        {adj.map((a) => (
          <Row key={a.key} label={a.label} hint={fmt((edit[a.key] as number) ?? a.def)}>
            <Slider
              value={(edit[a.key] as number) ?? a.def}
              min={a.min}
              max={a.max}
              step={0.01}
              ariaLabel={a.label}
              onChange={(v) => set({ [a.key]: v } as Partial<EditConfig>)}
              onCommit={() => onCommit(edit)}
            />
          </Row>
        ))}
        <Toggle
          label="Black & white"
          checked={(edit.grayscale ?? 0) > 0}
          onChange={(v) => {
            const next = { ...edit, grayscale: v ? 1 : 0 };
            onChange(next);
            onCommit(next);
          }}
        />
      </Section>

      <Section>
        <button
          type="button"
          onClick={() => {
            const reset = {
              ...edit,
              brightness: 1,
              contrast: 1,
              saturation: 1,
              grayscale: 0,
              sharpness: 0,
              opacity: 1,
              borderRadius: 0,
              shadow: 0,
            };
            onChange(reset);
            onCommit(reset);
          }}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-border bg-card py-2 text-[12px] font-medium text-foreground transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-studio-bright"
        >
          <RotateCcw className="h-3.5 w-3.5" /> Reset adjustments
        </button>
      </Section>
    </div>
  );
}

/** Icon marker re-exported so the context bar can label the photo popover consistently. */
export const PhotoAdjustIcon = ImageIcon;

/** Sticker editor (opacity / rotation / layer order / duplicate / delete). Used on pages AND the cover. */
export function StickerInspector({
  el,
  onChange,
  onDelete,
  onDuplicate,
  onForward,
  onBackward,
}: {
  el: StickerElement;
  onChange: (patch: Partial<StickerElement>) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onForward?: () => void;
  onBackward?: () => void;
}) {
  return (
    <div className="ms-scroll flex-1 overflow-y-auto">
      <Section>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-studio/10 text-studio">
              <StickerIcon className="h-4 w-4" />
            </span>
            <p className="text-sm font-semibold tracking-tight text-foreground">Sticker</p>
          </div>
          <button
            type="button"
            onClick={onDelete}
            aria-label="Delete sticker"
            className="grid h-8 w-8 place-items-center rounded-lg text-destructive hover:bg-destructive/10"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <StickerActionBtn label="Duplicate" onClick={onDuplicate}>
            <Copy />
          </StickerActionBtn>
          <StickerActionBtn label="Forward" disabled={!onForward} onClick={() => onForward?.()}>
            <ArrowUp />
          </StickerActionBtn>
          <StickerActionBtn label="Backward" disabled={!onBackward} onClick={() => onBackward?.()}>
            <ArrowDown />
          </StickerActionBtn>
        </div>
        {/* Flip + Lock. Lock freezes canvas drag/resize/rotate (Movable honours el.locked); the
            inspector stays available so it can always be unlocked. */}
        <div className="grid grid-cols-3 gap-2">
          <StickerActionBtn label="Flip H" active={!!el.flipH} onClick={() => onChange({ flipH: !el.flipH })}>
            <FlipHorizontal />
          </StickerActionBtn>
          <StickerActionBtn label="Flip V" active={!!el.flipV} onClick={() => onChange({ flipV: !el.flipV })}>
            <FlipVertical />
          </StickerActionBtn>
          <StickerActionBtn label={el.locked ? 'Unlock' : 'Lock'} active={!!el.locked} onClick={() => onChange({ locked: !el.locked })}>
            {el.locked ? <LockOpen /> : <Lock />}
          </StickerActionBtn>
        </div>
      </Section>

      <Section title="Adjust">
        <Row label="Opacity" hint={fmt(el.opacity)}>
          <Slider value={el.opacity} min={0.1} max={1} step={0.05} ariaLabel="Opacity" onChange={(v) => onChange({ opacity: v })} />
        </Row>
        <Row label="Rotation" hint={`${Math.round(el.rotation)}°`}>
          <Slider value={el.rotation} min={-180} max={180} step={1} ariaLabel="Rotation" onChange={(v) => onChange({ rotation: v })} />
        </Row>
      </Section>
    </div>
  );
}

/*
 * The `SpineInspector` that stood here is gone (Cover Editor 2.0). The spine used to be two
 * scalar fields with a bespoke form; it is a `TextElement` with `role: 'spine'` now, so it is
 * edited by the SAME `TextInspector` and the same Text toolbar as any other text object — which
 * is exactly the duplication this pass set out to remove.
 */
/** QR editor (link/text · code & background colour · padding · radius). Callback-driven, used on the cover. */
export function QrInspector({
  el,
  onChange,
  onDelete,
}: {
  el: QrElement;
  onChange: (patch: Partial<QrElement>) => void;
  onDelete: () => void;
}) {
  const set = onChange;
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
          <button
            type="button"
            onClick={onDelete}
            aria-label="Delete QR"
            className="grid h-8 w-8 place-items-center rounded-lg text-destructive hover:bg-destructive/10"
          >
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

function StickerActionBtn({
  label,
  onClick,
  disabled,
  active,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-pressed={active}
      className={`flex items-center justify-center gap-1.5 rounded-lg border py-2 text-[12px] font-medium shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-studio-bright disabled:pointer-events-none disabled:opacity-40 [&_svg]:h-3.5 [&_svg]:w-3.5 ${
        active
          ? 'border-studio-bright bg-studio-soft text-studio'
          : 'border-border bg-card text-foreground hover:bg-secondary'
      }`}
    >
      {children}
      {label}
    </button>
  );
}
