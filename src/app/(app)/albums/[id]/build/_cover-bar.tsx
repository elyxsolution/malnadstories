'use client';

import {
  Image as ImageIcon,
  Images,
  Palette,
  Type as TypeIcon,
  QrCode,
  Sticker as StickerIcon,
  Trash2,
  LayoutGrid,
  BookOpen,
  Sparkles,
  AlignVerticalSpaceAround,
} from 'lucide-react';
import { CanvasBar, BarBtn, BarSep, BarLabel, BarPopover } from './_canvas-bar';
import { ColorField } from './_color-picker';
import { ObjectBar, type BarProps } from './_context-bar';
import { BACKGROUNDS } from '@/lib/builder/elements';
import { COVER_LAYOUTS, COVER_LAYOUT_LABEL, type CoverLayout } from '@/lib/builder/cover';
import { COVER_SIDES, COVER_SIDE_LABEL, type CoverSide } from '@/lib/builder/cover-objects';
import type { Background } from '@/lib/builder/model';
import type { Anchor } from './_use-anchor-rect';
import type { Photo } from '@/lib/builder/photo';
import type { CoverApi } from './_use-cover';

/**
 * THE COVER'S TOOLBARS — the same bar, told about a different surface.
 *
 * There is deliberately no cover-specific Text, Sticker, QR or Photo toolbar here. Selecting cover
 * text shows the SAME `TextBar` a caption on page 7 shows; selecting the cover photo shows the
 * SAME `PhotoBar`. That is the whole point of Cover Editor 2.0 and the reason `_context-bar`
 * narrowed its props: the cover hands those components a `Block`-shaped view of the focused face
 * and an api/commands adapter, and they cannot tell the difference.
 *
 * What IS here is the two things a content spread has no equivalent of:
 *
 *   • BACKGROUND — a real, selectable object on the cover, with colour / artwork / photo / theme.
 *     On a page the background is a page setting; on a cover it is most of the design.
 *   • COVER — the surface-level bar shown when nothing is selected, which is where the face
 *     switcher, the add-object actions and the title layouts live. It is the cover's answer to
 *     `PageBar`, and it replaces the entire deprecated 300px sidebar.
 */

export type CoverBarProps = {
  anchor: Anchor | null;
  cover: CoverApi;
  /** The photo backing the focused face's image, when it has one. */
  selectedPhoto: Photo | undefined;
  photoMap: Map<string, Photo>;
  pageAspect: number;
  /** Open the existing album-photo picker to set this face's image. */
  onPickPhoto: () => void;
  /** Open the cover-artwork gallery (the admin template catalog) in the rail. */
  onOpenArtwork: () => void;
  /** Open the rail on a given tool — the cover's add-object actions reuse the existing panels. */
  onOpenRail: (tab: 'text' | 'stickers' | 'qr' | 'backgrounds') => void;
  onCrop: () => void;
  cropping: boolean;
  onEndCrop: () => void;
  onOpenProperties: () => void;
  propertiesOpen: boolean;
  onEscape: () => void;
};

export default function CoverContextBar(p: CoverBarProps) {
  const { anchor, cover } = p;
  if (!anchor) return null;

  /**
   * The focused face, dressed as a `Block`, plus adapters of the shapes the shared bars consume.
   * `useCover` builds all three; this is only the hand-off.
   */
  const bar: BarProps = {
    anchor,
    block: cover.block,
    api: cover.barApi,
    commands: cover.barCommands,
    selection: cover.selection,
    onSelect: cover.setSelection,
    photoMap: p.photoMap,
    selectedPhoto: p.selectedPhoto,
    pairAspect: p.pageAspect,
    onReplace: p.onPickPhoto,
    onCrop: p.onCrop,
    cropping: p.cropping,
    onEndCrop: p.onEndCrop,
    onOpenProperties: p.onOpenProperties,
    propertiesOpen: p.propertiesOpen,
    onEscape: p.onEscape,
  };

  switch (cover.selection.kind) {
    case 'text':
    case 'sticker':
    case 'qr':
    case 'base':
      // The shared object bars, unchanged. `ObjectBar` routes on `selection.kind` exactly as it
      // does for a spread; `background` and `none` are intercepted below because a cover answers
      // those two differently from a page.
      return <ObjectBar {...bar} />;
    case 'background':
      return <BackgroundBar {...p} />;
    default:
      return <CoverBar {...p} />;
  }
}

// ── background ────────────────────────────────────────────────────────────────────

/**
 * THE BACKGROUND TOOLBAR. Colour, artwork, a photo, and the theme — the four ways a cover's
 * backdrop is decided, in the order people decide them. Everything here writes through `useCover`,
 * so each click is one history entry and rides the existing debounced save.
 */
function BackgroundBar(p: CoverBarProps) {
  const { cover, anchor } = p;
  const side = cover.side;
  const bg = cover.background;

  return (
    <CanvasBar anchor={anchor} label={`${COVER_SIDE_LABEL[side]} background`} onEscape={p.onEscape}>
      <BarLabel>{COVER_SIDE_LABEL[side]}</BarLabel>
      <BarSep />

      <BarPopover label="Background colour" swatch={bgSwatch(bg)} width={252} overflowVisible>
        <div className="space-y-3 p-3">
          <ColorField
            value={bg?.kind === 'color' ? bg.value : '#1e3a2f'}
            onChange={(hex) => hex !== 'transparent' && cover.setBackground({ kind: 'color', value: hex })}
          />
          <div>
            <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Presets</p>
            <div className="grid grid-cols-6 gap-1.5">
              {BACKGROUNDS.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  title={s.label}
                  aria-label={s.label}
                  onClick={() => cover.setBackground(swatchToBackground(s.key, s.kind))}
                  className="h-7 w-full rounded-md ring-1 ring-border transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-studio-bright"
                  style={s.swatch}
                />
              ))}
            </div>
          </div>
        </div>
      </BarPopover>

      <BarBtn label="Use one of your photos" icon={<Images />} text="Photo" onClick={p.onPickPhoto} />
      {side === 'front' && <BarBtn label="Choose cover artwork" icon={<ImageIcon />} text="Artwork" onClick={p.onOpenArtwork} />}
      <BarSep />

      {/* THEME. All that remains of the old `layout` enum: it no longer positions anything (the
          title objects own their geometry now), it chooses the scrim that keeps text legible. */}
      <BarPopover label="Cover theme" icon={<Sparkles />} text="Theme" width={200}>
        <div className="p-1.5">
          {COVER_LAYOUTS.map((l) => (
            <ThemeRow key={l} layout={l} active={cover.config.layout === l} onPick={() => cover.applyLayout(l)} />
          ))}
        </div>
      </BarPopover>

      {bg && (
        <>
          <BarSep />
          <BarBtn label="Clear the background" icon={<Trash2 />} destructive onClick={() => cover.setBackground(null)} />
        </>
      )}
    </CanvasBar>
  );
}

function ThemeRow({ layout, active, onPick }: { layout: CoverLayout; active: boolean; onPick: () => void }) {
  return (
    <button
      type="button"
      onClick={onPick}
      className={`flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-[12px] transition-colors ${
        active ? 'bg-studio-soft font-medium text-studio' : 'text-foreground hover:bg-secondary'
      }`}
    >
      {COVER_LAYOUT_LABEL[layout]}
      {active && <span className="text-[10px] uppercase tracking-wide text-studio">Current</span>}
    </button>
  );
}

const bgSwatch = (bg: Background | null): string =>
  bg?.kind === 'color' ? bg.value : bg ? '#1e3a2f' : '#1e3a2f';

/** Resolve a catalog swatch key back to a `Background`. Mirrors the Backgrounds rail's apply. */
function swatchToBackground(key: string, kind: Background['kind']): Background {
  return { kind, value: key } as Background;
}

// ── cover (nothing selected) ──────────────────────────────────────────────────────

/**
 * THE COVER TOOLBAR — what the deprecated sidebar became.
 *
 * Face switcher, add-object actions, title layouts, and the back cover's one unique setting. It
 * appears when nothing is selected and disappears the moment something is, which is the same
 * contract `PageBar` has on a content spread.
 */
function CoverBar(p: CoverBarProps) {
  const { cover, anchor } = p;
  return (
    <CanvasBar anchor={anchor} label="Cover tools" onEscape={p.onEscape}>
      {/* WHICH FACE. Clicking a face on the canvas focuses it too; this is the keyboard-reachable
          equivalent and the label that says which one you are on. */}
      <div className="flex items-center gap-0.5 rounded-lg bg-secondary/60 p-0.5">
        {COVER_SIDES.map((s) => (
          <button
            key={s}
            type="button"
            data-bar-item
            onClick={() => {
              cover.setSide(s);
              cover.setSelection({ kind: 'none' });
            }}
            aria-pressed={cover.side === s}
            className={`rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
              cover.side === s ? 'bg-card text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {s === 'front' ? 'Front' : s === 'spine' ? 'Spine' : 'Back'}
          </button>
        ))}
      </div>
      <BarSep />

      {cover.side !== 'spine' && (
        <>
          <BarBtn
            label="Choose this face's background"
            icon={<Palette />}
            text="Background"
            onClick={() => cover.setSelection({ kind: 'background' })}
          />
          <BarBtn label="Use one of your photos" icon={<Images />} onClick={p.onPickPhoto} />
          {cover.side === 'front' && <BarBtn label="Choose cover artwork" icon={<ImageIcon />} onClick={p.onOpenArtwork} />}
          <BarSep />
        </>
      )}

      <BarBtn label="Add text" icon={<TypeIcon />} text="Text" onClick={() => p.onOpenRail('text')} />
      {cover.side !== 'spine' && (
        <>
          <BarBtn label="Add a sticker" icon={<StickerIcon />} onClick={() => p.onOpenRail('stickers')} />
          <BarBtn label="Add a QR code" icon={<QrCode />} onClick={() => p.onOpenRail('qr')} />
        </>
      )}

      {cover.side === 'front' && (
        <>
          <BarSep />
          {/* TITLE LAYOUTS. Presets are now an ACTION that arranges the title objects, not a mode
              that owns their position — apply one, then drag anything it placed. */}
          <BarPopover label="Arrange the title block" icon={<LayoutGrid />} text="Title layout" width={200}>
            <div className="p-1.5">
              {COVER_LAYOUTS.map((l) => (
                <ThemeRow key={l} layout={l} active={cover.config.layout === l} onPick={() => cover.applyLayout(l)} />
              ))}
            </div>
          </BarPopover>
          <BarBtn
            label="Tidy this face — centre and space its objects evenly"
            icon={<AlignVerticalSpaceAround />}
            onClick={() => cover.applyLayout(cover.config.layout)}
          />
        </>
      )}

      {cover.side === 'back' && (
        <>
          <BarSep />
          <BarBtn
            label={cover.config.back.showLogo ? 'Hide the Malnad Stories mark' : 'Print the Malnad Stories mark'}
            icon={<BookOpen />}
            text="Studio mark"
            active={cover.config.back.showLogo}
            onClick={() => cover.setShowLogo(!cover.config.back.showLogo)}
          />
        </>
      )}
    </CanvasBar>
  );
}

export { CoverBar, BackgroundBar };
export type { CoverSide };
