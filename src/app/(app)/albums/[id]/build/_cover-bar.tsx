'use client';

import {
  Image as ImageIcon,
  Images,
  Palette,
  Type as TypeIcon,
  QrCode,
  Sticker as StickerIcon,
  ImagePlus,
  Trash2,
  LayoutGrid,
  BookOpen,
  Sparkles,
  AlignVerticalSpaceAround,
  Link2,
} from 'lucide-react';
import { CanvasBar, BarRow, BarBtn, BarSep, BarLabel, BarPopover } from './_canvas-bar';
import { ColorField } from './_color-picker';
import { ObjectBar, type BarProps } from './_context-bar';
import { BACKGROUNDS } from '@/lib/builder/elements';
import { COVER_LAYOUTS, COVER_LAYOUT_LABEL, SPINE_LEGACY_COLOR, type CoverLayout } from '@/lib/builder/cover';
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
  /**
   * Open the existing album-photo picker. With no argument it fills the FACE's backdrop; with an
   * `overlayId` it fills that overlay and nothing else. One picker, one call site, two subjects.
   */
  onPickPhoto: (target?: { overlayId: string }) => void;
  /** Open the cover-artwork gallery (the admin template catalog) in the rail. */
  onOpenArtwork: () => void;
  /** Create a photo overlay on the focused face and open the picker to fill it. */
  onAddOverlay: () => void;
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
    /**
     * REPLACE ACTS ON WHAT IS SELECTED. `PhotoBar` already says which overlay it means; this used
     * to discard that and open the BACKDROP picker, which — because storing a face photo clears
     * the face's background — turned "replace this overlay" into "replace the whole back cover".
     * The target is passed through untouched, exactly as the page canvas passes it through.
     */
    onReplace: (t) => p.onPickPhoto(t.overlayId ? { overlayId: t.overlayId } : undefined),
    onCrop: p.onCrop,
    cropping: p.cropping,
    onEndCrop: p.onEndCrop,
    onOpenProperties: p.onOpenProperties,
    propertiesOpen: p.propertiesOpen,
    onEscape: p.onEscape,
  };

  /**
   * The contextual row, or null when nothing is selected. `background` gets a cover-specific bar
   * (a page has no equivalent); everything else is the SHARED object bar a content spread uses.
   */
  const object =
    cover.selection.kind === 'background' ? (
      <BackgroundBar {...p} />
    ) : cover.selection.kind === 'none' ? null : (
      <ObjectBar {...bar} />
    );

  /* The same persistent stack a content spread has: the cover row never leaves, the object row
     appears beneath it, and the shell's bottom-anchoring shifts the cover row up to make room. */
  return (
    <CanvasBar anchor={anchor} label="Cover tools" onEscape={p.onEscape}>
      <BarRow tone="page">
        <CoverBar {...p} />
      </BarRow>
      {object && <BarRow key={cover.selection.kind}>{object}</BarRow>}
    </CanvasBar>
  );
}

// ── background ────────────────────────────────────────────────────────────────────

/**
 * THE BACKGROUND TOOLBAR. Colour, artwork, a photo, and the theme — the four ways a cover's
 * backdrop is decided, in the order people decide them. Everything here writes through `useCover`,
 * so each click is one history entry and rides the existing debounced save.
 */
function BackgroundBar(p: CoverBarProps) {
  const { cover } = p;
  const side = cover.side;
  const bg = cover.background;
  const linked = cover.linkBackgrounds;

  /**
   * ONE write path for every control in this bar. `applyBackground` is the thing that knows
   * whether "Apply to all" is on, so a swatch, the picker and a preset can never disagree about
   * how far a colour reaches.
   */
  const apply = (next: Background | null) => cover.applyBackground(next);

  return (
    <>
      <BarLabel>{COVER_SIDE_LABEL[side]}</BarLabel>
      <BarSep />

      <BarPopover label="Background colour" swatch={bgSwatch(bg, side)} width={252} overflowVisible>
        <div className="space-y-3 p-3">
          <ColorField
            value={bg?.kind === 'color' ? bg.value : bgSwatch(bg, side)}
            onChange={(hex) => hex !== 'transparent' && apply({ kind: 'color', value: hex })}
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
                  onClick={() => apply(swatchToBackground(s.key, s.kind))}
                  className="h-7 w-full rounded-md ring-1 ring-border transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-studio-bright"
                  style={s.swatch}
                />
              ))}
            </div>
          </div>
          {/* THE LINK, where the colours are. Off by default and never persisted: the three faces
              own their colours independently, and this only widens where the NEXT one lands. */}
          <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-border/70 bg-secondary/40 p-2.5">
            <input
              type="checkbox"
              checked={linked}
              onChange={(e) => cover.setLinkBackgrounds(e.target.checked)}
              className="mt-0.5 h-3.5 w-3.5 accent-[hsl(var(--studio))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-studio-bright"
            />
            <span className="min-w-0">
              <span className="block text-[12px] font-medium leading-tight text-foreground">Apply to all three</span>
              <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">
                Front, spine and back take the next colour together. Turn it off to keep editing one face at a time.
              </span>
            </span>
          </label>
        </div>
      </BarPopover>

      <BarBtn
        label={linked ? 'Colours are landing on all three faces' : 'Apply the next colour to front, spine and back'}
        icon={<Link2 />}
        text="Link all"
        active={linked}
        onClick={() => cover.setLinkBackgrounds(!linked)}
      />

      {side !== 'spine' && <BarBtn label="Use one of your photos" icon={<Images />} text="Photo" onClick={() => p.onPickPhoto()} />}
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
          <BarBtn
            label={side === 'spine' ? 'Back to the default spine colour' : 'Clear the background'}
            icon={<Trash2 />}
            destructive
            onClick={() => apply(null)}
          />
        </>
      )}
    </>
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

/**
 * The dot the toolbar shows for a face's backdrop. An unset SPINE is not "no colour" — it is the
 * legacy paint the renderer falls back to — so the swatch shows what will actually print.
 */
const bgSwatch = (bg: Background | null, side: CoverSide): string =>
  bg?.kind === 'color' ? bg.value : side === 'spine' ? SPINE_LEGACY_COLOR : '#1e3a2f';

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
  const { cover } = p;
  return (
    <>
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

      {/* COLOUR IS AVAILABLE ON ALL THREE FACES. The spine is a printed surface like the other
          two; only the photo and artwork sources stay front/back-only, because a spine a few
          millimetres wide has nowhere to put a picture. */}
      <BarBtn
        label="Choose this face's background"
        icon={<Palette />}
        text="Background"
        onClick={() => cover.setSelection({ kind: 'background' })}
      />
      {cover.side !== 'spine' && (
        <>
          <BarBtn label="Use one of your photos" icon={<Images />} onClick={() => p.onPickPhoto()} />
          {cover.side === 'front' && <BarBtn label="Choose cover artwork" icon={<ImageIcon />} onClick={p.onOpenArtwork} />}
        </>
      )}
      <BarSep />

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
          {/* ADD OVERLAY. `Photo` above sets the face's BACKDROP — one image, edge to edge. This
              places a picture in its own movable, resizable frame on top of it, which is what the
              back cover had no way to express. It creates the container and opens the album photo
              picker, exactly as the page canvas's Add-photo does. */}
          <BarBtn label="Add a photo overlay" icon={<ImagePlus />} text="Add overlay" onClick={p.onAddOverlay} />
          <BarBtn
            label={cover.config.back.showLogo ? 'Hide the Malnad Stories mark' : 'Print the Malnad Stories mark'}
            icon={<BookOpen />}
            text="Studio mark"
            active={cover.config.back.showLogo}
            onClick={() => cover.setShowLogo(!cover.config.back.showLogo)}
          />
        </>
      )}
    </>
  );
}
