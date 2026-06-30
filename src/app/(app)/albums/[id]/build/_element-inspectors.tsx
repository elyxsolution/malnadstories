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
} from 'lucide-react';
import { Section, Row, Slider, Toggle } from './_controls';
import FontPicker from './_font-picker';
import { ColorField } from './_color-picker';
import type { QrElement, StickerElement, TextElement } from '@/lib/builder/model';

/**
 * Generic, callback-driven element inspectors — NOT bound to the page (`BuilderApi`) or the
 * cover hook. Both the page Inspector and the cover Inspector render these with their own
 * `onChange`/`onDelete`, so text styling is byte-for-byte identical on a content page and on
 * the cover (the "one continuous editor" requirement).
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

/** Typography editor for one text element. Used on pages AND the cover. */
export function TextInspector({
  el,
  onChange,
  onDelete,
}: {
  el: TextElement;
  onChange: (patch: Partial<TextElement>) => void;
  onDelete: () => void;
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
          <button
            type="button"
            onClick={onDelete}
            aria-label="Delete text"
            className="grid h-8 w-8 place-items-center rounded-lg text-destructive hover:bg-destructive/10"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
        <textarea
          value={el.text}
          onChange={(e) => set({ text: e.target.value })}
          rows={2}
          placeholder="Type your text…"
          className="w-full resize-none rounded-lg border border-input bg-card px-3 py-2 text-sm text-foreground shadow-xs outline-none transition-all placeholder:text-muted-foreground focus-visible:border-studio-bright focus-visible:ring-2 focus-visible:ring-studio-bright/40"
        />
      </Section>

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

      <Section title="Colour">
        <ColorField value={el.color} onChange={(hex) => set({ color: hex })} />
      </Section>

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

/** Spine editor — the book's bound edge: the text printed vertically + its colour. Cover-only. */
export function SpineInspector({
  spineTitle,
  spineColor,
  fallbackTitle,
  onChange,
}: {
  spineTitle: string;
  spineColor: string;
  fallbackTitle: string;
  onChange: (patch: { spineTitle?: string; spineColor?: string }) => void;
}) {
  return (
    <div className="ms-scroll flex-1 overflow-y-auto">
      <Section>
        <div className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-studio/10 text-studio">
            <TypeIcon className="h-4 w-4" />
          </span>
          <div>
            <p className="text-sm font-semibold tracking-tight text-foreground">Spine</p>
            <p className="text-[11px] text-muted-foreground">The book&rsquo;s bound edge</p>
          </div>
        </div>
        <input
          type="text"
          value={spineTitle}
          onChange={(e) => onChange({ spineTitle: e.target.value })}
          placeholder={fallbackTitle || 'Printed on the spine'}
          maxLength={80}
          className="h-9 w-full rounded-lg border border-input bg-card px-3 text-sm text-foreground shadow-xs outline-none transition-all placeholder:text-muted-foreground focus-visible:border-studio-bright focus-visible:ring-2 focus-visible:ring-studio-bright/40"
        />
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Leave blank to print the album title. Thickness follows the page count.
        </p>
      </Section>

      <Section title="Colour">
        <ColorField value={spineColor} onChange={(hex) => hex !== 'transparent' && onChange({ spineColor: hex })} />
      </Section>
    </div>
  );
}

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
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      className="flex items-center justify-center gap-1.5 rounded-lg border border-border bg-card py-2 text-[12px] font-medium text-foreground shadow-xs transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-studio-bright disabled:pointer-events-none disabled:opacity-40 [&_svg]:h-3.5 [&_svg]:w-3.5"
    >
      {children}
      {label}
    </button>
  );
}
