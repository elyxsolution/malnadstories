'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  Image as ImageIcon,
  Images,
  Palette,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Type as TypeIcon,
  Crop,
  BookOpen,
  PanelRightOpen,
} from 'lucide-react';
import { Section, Row, Slider, Segmented, Toggle } from './_controls';
import CoverDesign from './_cover-render';
import FontPicker from './_font-picker';
import { ColorField } from './_color-picker';
import LocationAutocomplete from './_location-autocomplete';
import { BACKGROUNDS, backgroundStyle } from '@/lib/builder/elements';
import { COVER_LAYOUTS, COVER_LAYOUT_LABEL, type CoverConfig, type CoverLayout } from '@/lib/builder/cover';
import type { Background, TextAlign } from '@/lib/builder/model';
import type { CoverSide } from './_cover-canvas';
import type { Photo } from '@/lib/builder/photo';
import { resolvePhotoUrl } from '@/lib/builder/photo-url';
import { type CoverOption } from '@/lib/covers';

type Source = 'artwork' | 'photo' | 'colour';

/**
 * The cover DESIGNER — a coffee-table-book cover editor for the WHOLE printed cover. A Front/Back
 * toggle switches which page the image-source controls target; the front also owns the structured
 * title block + layout presets; both pages share the spine + back-logo settings. Cover photos can
 * be cropped/zoomed/rotated (the crop lives in cover_config, independent of page placement). Every
 * change flows up via `onUpdate` and is persisted (debounced) by the builder through `saveCoverDesign`.
 */
export default function CoverPanel({
  title,
  coverId,
  config,
  covers,
  photos,
  photoMap,
  activeSide,
  onActiveSide,
  onUpdate,
  onEditImage,
  showPreview = true,
}: {
  title: string;
  coverId: string | null;
  config: CoverConfig;
  covers: CoverOption[];
  photos: Photo[];
  photoMap: Map<string, Photo>;
  activeSide: CoverSide;
  onActiveSide: (s: CoverSide) => void;
  onUpdate: (patch: { title?: string; coverId?: string | null; config?: Partial<CoverConfig> }) => void;
  onEditImage: (s: CoverSide) => void;
  /** Hide the inline preview when the host (the dedicated Cover Editor) shows its own spread. */
  showPreview?: boolean;
}) {
  const isFront = activeSide === 'front';
  // The active page's image source + chosen photo.
  const sideBackground = isFront ? config.background : config.back.background;
  const sidePhotoId = isFront ? config.photoId : config.back.photoId;

  const initialSource: Source = sideBackground ? 'colour' : sidePhotoId ? 'photo' : isFront ? 'artwork' : 'photo';
  const [source, setSource] = useState<Source>(initialSource);
  // Re-sync the source tabs when the user flips between front and back.
  useEffect(() => {
    setSource(sideBackground ? 'colour' : sidePhotoId ? 'photo' : isFront ? 'artwork' : 'photo');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSide]);

  const selectedCover = useMemo(() => covers.find((c) => c.id === coverId) ?? null, [covers, coverId]);
  const sidePhoto = sidePhotoId ? photoMap.get(sidePhotoId) : undefined;
  // The cover prints at full size, so it needs the worker's sanitized master — this gate is
  // unchanged. What's new is telling the user WHY a photo they just added isn't listed.
  const readyPhotos = photos.filter((p) => p.status === 'ready');
  const unprocessedPhotos = photos.length - readyPhotos.length;

  // The image actually shown for the active page (front: photo → artwork → none; back: photo → none).
  const previewImageUrl = sidePhotoId
    ? resolvePhotoUrl(sidePhoto, 'full')
    : sideBackground
      ? null
      : isFront
        ? selectedCover?.url ?? null
        : null;

  // Writes scoped to the active page (front = top-level; back = config.back).
  const pickArtwork = (id: string) => onUpdate({ coverId: id, config: { photoId: null, background: null, imageEdit: null } });
  const pickPhoto = (id: string) =>
    isFront
      ? onUpdate({ config: { photoId: id, background: null, imageEdit: null } })
      : onUpdate({ config: { back: { ...config.back, photoId: id, background: null, imageEdit: null } } });
  const pickBackground = (bg: Background | null) =>
    isFront
      ? onUpdate({ config: { background: bg, photoId: null } })
      : onUpdate({ config: { back: { ...config.back, background: bg, photoId: null } } });

  const switchSource = (s: Source) => {
    setSource(s);
    if (s === 'artwork' && isFront) onUpdate({ config: { photoId: null, background: null, imageEdit: null } });
    if (s === 'colour' && !sideBackground)
      pickBackground({ kind: 'gradient', value: 'gradient-forest' });
  };

  // The custom-colour picker reflects the active SOLID colour. Gradient/texture presets have no
  // single hex, so it falls back to the studio green — the picker still lets you choose any colour.
  const currentSolidHex =
    sideBackground?.kind === 'color' ? String(backgroundStyle(sideBackground).background ?? '#1e3a2f') : '#1e3a2f';

  return (
    <div className="ms-scroll flex-1 overflow-y-auto">
      {/* Which cover page is being edited */}
      <Section>
        <Segmented<CoverSide>
          value={activeSide}
          ariaLabel="Cover page"
          options={[
            { value: 'front', label: 'Front', icon: <BookOpen /> },
            { value: 'back', label: 'Back', icon: <PanelRightOpen /> },
          ]}
          onChange={onActiveSide}
        />
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          {isFront
            ? 'The book’s face — prints as page one.'
            : 'The back of the book — prints as the final page.'}
        </p>
      </Section>

      {/* Live preview (hidden when the dedicated Cover Editor shows its own large spread) */}
      {showPreview && isFront && (
        <Section>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Cover preview</p>
          <div className="mx-auto w-[72%] overflow-hidden rounded-[10px] shadow-card ring-1 ring-black/5">
            <div className="aspect-[3/4] w-full">
              <CoverDesign
                imageUrl={previewImageUrl}
                imageEdit={config.imageEdit}
                background={config.background}
                title={title}
                subtitle={config.subtitle}
                author={config.author}
                font={config.font}
                color={config.color}
                align={config.align}
                layout={config.layout}
                posY={config.posY}
              />
            </div>
          </div>
        </Section>
      )}

      {/* Image source for the active page */}
      <Section title={isFront ? 'Front image' : 'Back image'}>
        <Segmented<Source>
          value={source}
          ariaLabel="Cover image source"
          options={
            isFront
              ? [
                  { value: 'artwork', label: 'Artwork', icon: <Images /> },
                  { value: 'photo', label: 'Photo', icon: <ImageIcon /> },
                  { value: 'colour', label: 'Colour', icon: <Palette /> },
                ]
              : [
                  { value: 'photo', label: 'Photo', icon: <ImageIcon /> },
                  { value: 'colour', label: 'Colour', icon: <Palette /> },
                ]
          }
          onChange={switchSource}
        />

        {source === 'artwork' &&
          isFront &&
          (covers.length === 0 ? (
            <p className="rounded-xl border border-dashed bg-muted/40 px-3 py-6 text-center text-xs text-muted-foreground">No cover artwork is available yet.</p>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {covers.map((c) => {
                const active = coverId === c.id && !config.photoId && !config.background;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => pickArtwork(c.id)}
                    aria-pressed={active}
                    title={c.name}
                    className={`group relative overflow-hidden rounded-lg ring-1 transition-all duration-200 hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-studio-bright ${
                      active ? 'ring-2 ring-studio' : 'ring-border hover:ring-studio-bright/50'
                    }`}
                  >
                    <span className="block aspect-[3/4] w-full bg-muted">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={c.thumbUrl} alt={c.name} className="h-full w-full object-cover" />
                    </span>
                    {active && (
                      <span className="absolute right-1 top-1 grid h-4 w-4 place-items-center rounded-full bg-studio text-studio-foreground">
                        <CheckCircle2 className="h-3 w-3" />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}

        {source === 'photo' &&
          (readyPhotos.length === 0 ? (
            <p className="rounded-xl border border-dashed bg-muted/40 px-3 py-6 text-center text-xs text-muted-foreground">
              {unprocessedPhotos > 0
                ? `${unprocessedPhotos} photo${unprocessedPhotos === 1 ? '' : 's'} still processing. The cover is printed at full size, so a photo can only be chosen once it’s ready.`
                : 'Upload photos to use one on the cover.'}
            </p>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {readyPhotos.map((p) => {
                const active = sidePhotoId === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => pickPhoto(p.id)}
                    aria-pressed={active}
                    title={p.filename}
                    className={`relative overflow-hidden rounded-lg ring-1 transition-all duration-200 hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-studio-bright ${
                      active ? 'ring-2 ring-studio' : 'ring-border hover:ring-studio-bright/50'
                    }`}
                  >
                    <span className="block aspect-[3/4] w-full bg-muted">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={resolvePhotoUrl(p, 'thumb') ?? ''} alt={p.filename} className="h-full w-full object-cover" />
                    </span>
                    {active && (
                      <span className="absolute right-1 top-1 grid h-4 w-4 place-items-center rounded-full bg-studio text-studio-foreground">
                        <CheckCircle2 className="h-3 w-3" />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}

        {/* Adjust the chosen photo (crop / zoom / rotate) — parity with the page editor. */}
        {source === 'photo' && sidePhotoId && (
          <button
            type="button"
            onClick={() => onEditImage(activeSide)}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-border bg-card py-2 text-[12px] font-medium text-foreground shadow-xs transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-studio-bright [&_svg]:h-3.5 [&_svg]:w-3.5"
          >
            <Crop /> Adjust image
          </button>
        )}

        {source === 'colour' && (
          <div className="space-y-3.5">
            {/* Any colour — a full HSV picker (with its own recent + saved swatches). Stored exactly
                like a preset: a { kind:'color', value } Background, so the live preview, the print PDF
                and previously-created albums all stay fully compatible. */}
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 flex-col">
                <span className="text-[12px] font-medium text-foreground">Custom colour</span>
                <span className="text-[11px] text-muted-foreground">Choose any shade for the cover</span>
              </div>
              <ColorField value={currentSolidHex} onChange={(hex) => pickBackground({ kind: 'color', value: hex })} />
            </div>

            {/* Curated presets — solids, gradients and a paper texture, for one-tap selection. */}
            <div className="space-y-1.5">
              <span className="block text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Presets
              </span>
              <div className="flex flex-wrap gap-2">
                {BACKGROUNDS.map((b) => {
                  const active = sideBackground?.value === b.key;
                  return (
                    <button
                      key={b.key}
                      type="button"
                      onClick={() => pickBackground({ kind: b.kind, value: b.key })}
                      aria-pressed={active}
                      title={b.label}
                      style={b.swatch}
                      className={`h-9 w-9 rounded-lg ring-1 ring-inset ring-black/10 transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-studio-bright ${
                        active ? 'ring-2 ring-studio ring-offset-2 ring-offset-card' : ''
                      }`}
                    />
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </Section>

      {/* Album title — the canonical title (dashboard / checkout / orders) + the front title block. */}
      <Section title="Album title">
        <LocationAutocomplete
          value={title}
          onChange={(v) => onUpdate({ title: v })}
          placeholder="Your album title or a destination…"
          maxLength={100}
        />
      </Section>

      {/* Front-only: tagline, author, typography, layout */}
      {isFront ? (
        <>
          <Section title="Title text">
            <div className="space-y-1.5">
              <label className="text-[12px] font-medium text-foreground">Tagline</label>
              <input
                type="text"
                value={config.subtitle}
                maxLength={120}
                onChange={(e) => onUpdate({ config: { subtitle: e.target.value } })}
                placeholder="A subtitle or the dates…"
                className="h-9 w-full rounded-lg border border-input bg-card px-3 text-sm text-foreground shadow-xs outline-none transition-all placeholder:text-muted-foreground focus-visible:border-studio-bright focus-visible:ring-2 focus-visible:ring-studio-bright/40"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[12px] font-medium text-foreground">Author / name</label>
              <input
                type="text"
                value={config.author}
                maxLength={80}
                onChange={(e) => onUpdate({ config: { author: e.target.value } })}
                placeholder="e.g. by Asha R."
                className="h-9 w-full rounded-lg border border-input bg-card px-3 text-sm text-foreground shadow-xs outline-none transition-all placeholder:text-muted-foreground focus-visible:border-studio-bright focus-visible:ring-2 focus-visible:ring-studio-bright/40"
              />
            </div>
          </Section>

          <Section title="Typography">
            <FontPicker value={config.font} onChange={(v) => onUpdate({ config: { font: v } })} />
            <Row label="Text colour">
              <ColorField value={config.color} onChange={(hex) => hex !== 'transparent' && onUpdate({ config: { color: hex } })} />
            </Row>
            <Segmented<TextAlign>
              value={config.align}
              ariaLabel="Text alignment"
              options={[
                { value: 'left', icon: <AlignLeft />, title: 'Align left' },
                { value: 'center', icon: <AlignCenter />, title: 'Align centre' },
                { value: 'right', icon: <AlignRight />, title: 'Align right' },
              ]}
              onChange={(v) => onUpdate({ config: { align: v } })}
            />
            <Row label="Text position" hint={`${Math.round(config.posY * 100)}%`}>
              <Slider value={config.posY} min={0.12} max={0.92} step={0.01} ariaLabel="Text vertical position" onChange={(v) => onUpdate({ config: { posY: v } })} />
            </Row>
          </Section>

          <Section title="Layout">
            <div className="grid grid-cols-2 gap-2">
              {COVER_LAYOUTS.map((l) => {
                const active = config.layout === l;
                return (
                  <button
                    key={l}
                    type="button"
                    onClick={() => onUpdate({ config: { layout: l as CoverLayout } })}
                    aria-pressed={active}
                    className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-[12px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-studio-bright ${
                      active ? 'border-studio/30 bg-studio-soft text-studio' : 'border-border bg-card text-foreground hover:bg-secondary'
                    }`}
                  >
                    <TypeIcon className="h-3.5 w-3.5" /> {COVER_LAYOUT_LABEL[l]}
                  </button>
                );
              })}
            </div>
          </Section>
        </>
      ) : (
        <Section title="Back options">
          <Toggle label="Studio logo" checked={config.back.showLogo} onChange={(v) => onUpdate({ config: { back: { ...config.back, showLogo: v } } })} />
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Add text, stickers or a QR code to the back from the left rail.
          </p>
        </Section>
      )}

      {/* Spine — shared by both pages (the bound edge) */}
      <Section title="Spine">
        <div className="space-y-1.5">
          <label className="text-[12px] font-medium text-foreground">Spine text</label>
          <input
            type="text"
            value={config.spineTitle}
            maxLength={80}
            onChange={(e) => onUpdate({ config: { spineTitle: e.target.value } })}
            placeholder={title || 'Printed on the spine'}
            className="h-9 w-full rounded-lg border border-input bg-card px-3 text-sm text-foreground shadow-xs outline-none transition-all placeholder:text-muted-foreground focus-visible:border-studio-bright focus-visible:ring-2 focus-visible:ring-studio-bright/40"
          />
        </div>
        <Row label="Spine colour">
          <ColorField value={config.spineColor} onChange={(hex) => hex !== 'transparent' && onUpdate({ config: { spineColor: hex } })} />
        </Row>
        <p className="text-[11px] leading-relaxed text-muted-foreground">Leave blank to print the album title. Thickness follows the page count.</p>
      </Section>
    </div>
  );
}
