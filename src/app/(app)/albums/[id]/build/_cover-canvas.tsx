'use client';

import { useRef, useState } from 'react';
import CoverDesign, { BackCoverDesign, SpineDesign } from './_cover-render';
import {
  COVER_FINISHED_SPREAD,
  COVER_FOLD_FRACTIONS,
  COVER_PANEL_FRACTIONS,
  COVER_SPINE_MM,
  GUIDE_STYLE,
  type CoverPanelName,
} from '@/lib/print/spec';
import Movable, { SnapGuides, type SnapLine } from './_movable';
import { TextContent, StickerContent, QrContent } from './_elements-render';
import { InlineTextEditor } from './_element-bits';
import { useBuilderDimensions } from './_dimensions';
import { fitBlockWidth, useMeasuredBox } from './_use-fit-scale';
import { PASTEBOARD_ESCAPE } from '@/lib/builder/edit-bounds';
import { squareQrHeight } from '@/lib/builder/elements';
import { coverSideElements, coverSideImage, roleLabel, type CoverSide } from '@/lib/builder/cover-objects';
import { spinePrintBackgroundStyle, type CoverConfig } from '@/lib/builder/cover';
import type { Selection } from './_use-builder';
import type { CoverApi } from './_use-cover';

export type { CoverSide };

/**
 * THE COVER CANVAS — the printed cover as three editable surfaces, and nothing else.
 *
 * BACK · hinge · SPINE · hinge · FRONT, at the printed case's true widths (210 · 10 · 13 · 10 ·
 * 210 mm of a 453 mm finished spread), with black dotted reference lines on the four folds. Every
 * visible thing on it is an object: the title, the subtitle, the author line and the
 * spine text as much as the stickers and QR codes, because `migrateCoverConfig` turned the old
 * structured fields into `TextElement`s before this component was handed the config.
 *
 * ── WHY THIS IS NOT A SECOND EDITOR ────────────────────────────────────────────────────────
 *
 * It owns geometry and nothing else. Movement, resizing, rotation, snapping, the pasteboard and
 * the clip/chrome split all come from the SAME `Movable` engine the page canvas uses, with the
 * same `travelBounds`/`commitBounds` and the same unclipped chrome layer. Selection is the
 * builder's own `Selection` union. Mutations go through `useCover`, which is history-backed like
 * `useBlocks`. The toolbars are the shared `ContextBar`. What is left here is: how wide is the
 * spine, and which face did you click.
 *
 * ── CLICKING A FACE ────────────────────────────────────────────────────────────────────────
 *
 * A face's backdrop is a selectable object, which is new and deliberate: the background is one of
 * the two or three decisions that actually make a cover, so it should answer a click with tools
 * rather than hide in a panel. A face with a photo resolves that click to the PHOTO (`base`), a
 * face without one to the BACKGROUND. Clicking the pasteboard around the book clears to nothing,
 * which is what surfaces the cover-level toolbar.
 */

export type CoverCanvasProps = {
  cover: CoverApi;
  frontImageUrl: string | null;
  backImageUrl: string | null;
  /**
   * The album's leaf count. Still accepted so every call site is unchanged, but the cover's
   * printed geometry no longer depends on it: the spine is 13 mm for every supported page count.
   */
  size?: number;
  zoomPct?: number;
  stickerUrlFor?: (stickerId: string) => string | undefined;
  /** Publishes the focused face's element upward so the floating toolbar can anchor to it. */
  onFaceEl?: (el: HTMLDivElement | null) => void;
};

/** The caption under the book, plus the flex gap above it. Vertical furniture the fit must clear. */
const COVER_CAPTION_PX = 36;

export default function CoverCanvas({
  cover,
  frontImageUrl,
  backImageUrl,
  zoomPct = 100,
  stickerUrlFor,
  onFaceEl,
}: CoverCanvasProps) {
  /**
   * THE CANVAS IS COMPOSED FROM THE PRINT SPECIFICATION.
   *
   * It used to be composed from `coverSpreadMetrics` — two product-proportioned pages either side
   * of a spine whose width came from `spineWidthFor`, an advisory proportion that thickens with
   * page count. The printed case is not that: it is a fixed 453 mm finished spread of
   * `210 · 10 · 13 · 10 · 210`, identical for every product and every page count.
   *
   * With the fold guides now drawn, that gap stopped being harmless — a dotted "spine" boundary
   * at 13 mm over a painted strip of a different width is two contradictory answers to the same
   * question. So the canvas draws the real geometry, the guides land exactly on the strips they
   * name, and what the customer designs against is what the printer receives.
   *
   * NOTHING STORED CHANGES. Each face keeps its own normalized 0..1 space, so every saved
   * position, photo, text and sticker means precisely what it did before; only how many pixels
   * wide each face is drawn changes. `coverSpreadMetrics` is untouched and still serves the
   * timeline thumbnail, and the preview PDF's spine page still uses `spineWidthFor` — neither is
   * in this file's scope.
   */
  const aspect = COVER_FINISHED_SPREAD.w / COVER_FINISHED_SPREAD.h;
  const pct = (name: CoverPanelName) =>
    COVER_PANEL_FRACTIONS.find((p) => p.name === name)!.width * 100;
  const spineBandPct = pct('hinge-left') + pct('spine') + pct('hinge-right');

  /**
   * FIT, then zoom — the same rule the page canvas follows, so switching between the cover and a
   * spread does not change how the workspace behaves. A cover spread is much wider than it is
   * tall, so it was usually the WIDTH that ran out here; solving both axes at once covers either.
   * The caption line below the book is the only vertical furniture to budget for.
   */
  const canvas = useMeasuredBox<HTMLDivElement>();
  const fitWidth = fitBlockWidth(canvas.box, { aspect, chromePx: COVER_CAPTION_PX, maxPx: 740 });

  return (
    <div
      ref={canvas.ref}
      className="ms-scroll relative min-h-0 flex-1 overflow-auto p-6 lg:p-10"
      /* The pasteboard around the book: a click out here means "nothing selected", which is the
         cover-level toolbar — the same rule the page canvas follows. */
      onPointerDown={() => cover.setSelection({ kind: 'none' })}
    >
      <div
        className="mx-auto flex flex-col items-center gap-4"
        style={fitWidth ? { width: (fitWidth * zoomPct) / 100 } : { width: `min(${Math.round(7.4 * zoomPct)}px, 96%)` }}
      >
        {/* No `overflow-hidden`: each face clips its own content at its own trim, and clipping the
            whole spread would take the selection handles of anything near the outer edge with it. */}
        <div
          className="relative w-full select-none shadow-[0_2px_4px_rgb(16_24_20/0.06),0_26px_70px_-30px_rgb(16_24_20/0.55)] ring-1 ring-black/10"
          style={{ aspectRatio: String(aspect) }}
        >
          {/*
            back · hinge · SPINE · hinge · front, at their true printed widths. The two hinges are
            the folding grooves of the case: they carry no editable content, so they are inert
            strips painted with the spine's own colour — exactly what the cover export puts there
            (`COVER_HINGE_FILL`). The three real faces are unchanged and still own every click.
          */}
          <div className="flex h-full w-full">
            <Face
              side="back"
              widthPct={pct('back')}
              cover={cover}
              imageUrl={backImageUrl}
              stickerUrlFor={stickerUrlFor}
              onFaceEl={onFaceEl}
            />
            <Hinge cover={cover} />
            <Face
              side="spine"
              widthPct={pct('spine')}
              cover={cover}
              imageUrl={null}
              stickerUrlFor={stickerUrlFor}
              onFaceEl={onFaceEl}
            />
            <Hinge cover={cover} />
            <Face
              side="front"
              widthPct={pct('front')}
              cover={cover}
              imageUrl={frontImageUrl}
              stickerUrlFor={stickerUrlFor}
              onFaceEl={onFaceEl}
            />
          </div>

          {/* Spine-edge depth so the spread reads as a bound book — across the whole bound band
              (hinge · spine · hinge), which is the part that actually curves into the binding.
              Inert: the spine face underneath is a real surface and must stay clickable. */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 z-[3]"
            style={{
              left: `${pct('back')}%`,
              width: `${spineBandPct}%`,
              boxShadow: 'inset 0 0 3cqw rgba(0,0,0,0.3)',
            }}
          />

          {/* The printed case's fold geometry — see CoverFoldGuides. */}
          <CoverFoldGuides />
        </div>
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
          Back cover · hinge · spine · hinge · front cover — the whole printed cover
        </p>
      </div>
    </div>
  );
}

/**
 * A HINGE — one of the two 10 mm folding grooves either side of the spine.
 *
 * Not a face: it holds no objects, has no selection, and is not in `COVER_SIDES`. It paints the
 * spine's chosen colour, which is what the export paints there, so the bound band reads as one
 * continuous surface on screen and on paper. A pointer-down passes through to the pasteboard
 * handler, i.e. it deselects — the same thing clicking any non-face area does.
 */
function Hinge({ cover }: { cover: CoverApi }) {
  const width = COVER_PANEL_FRACTIONS.find((p) => p.name === 'hinge-left')!.width * 100;
  return (
    <div
      aria-hidden
      className="relative h-full"
      style={{ width: `${width}%`, ...spinePrintBackgroundStyle(cover.config.spine.background) }}
    />
  );
}

/**
 * THE COVER'S PRINT GEOMETRY, shown on the canvas.
 *
 * A printed case is not back | spine | front — it is
 *
 *     back 210 · hinge 10 · SPINE 13 · hinge 10 · front 210   (mm, of the 453 mm finished spread)
 *
 * and until now none of that was visible while designing. These are black dotted reference lines
 * at the four folds, plus a label for each region, so "where does the back cover end?" and "how
 * wide is the spine really?" are answerable by looking.
 *
 * ── OVERLAY ONLY ──────────────────────────────────────────────────────────────────────────────
 *
 * Nothing here changes the canvas's composition, the faces' widths, the saved `cover_config`, or
 * where a photo sits. The three editable faces underneath are untouched; this draws on top,
 * `pointer-events-none`, so every click, drag, resize and text edit still reaches the face.
 *
 * ── THE SAME NUMBERS THE EXPORTER USES ────────────────────────────────────────────────────────
 *
 * `COVER_FOLD_FRACTIONS` are the folds as fractions of the finished spread, derived in
 * `lib/print/spec` by walking the very panel table the cover PDF is composed from. There is no
 * second copy of the geometry to drift.
 *
 * ── WHAT IT DOES NOT CLAIM ────────────────────────────────────────────────────────────────────
 *
 * The canvas draws its spine strip at the builder's own advisory proportion (`spineWidthFor`,
 * which thickens with page count) while print fixes the spine at 13 mm. Rather than silently
 * contradict the strip, the guides are drawn against the PRINT spread and the spine band is
 * labelled, so the printed truth is the thing on screen with a number attached to it.
 */
function CoverFoldGuides() {
  const [backEnd, spineStart, spineEnd, frontStart] = COVER_FOLD_FRACTIONS;
  const dash = GUIDE_STYLE.fold.dashMm.map((n) => n * 2).join(' ');
  const regions: { label: string; from: number; to: number }[] = [
    { label: 'Back', from: 0, to: backEnd },
    { label: 'Hinge', from: backEnd, to: spineStart },
    { label: `Spine ${COVER_SPINE_MM}mm`, from: spineStart, to: spineEnd },
    { label: 'Hinge', from: spineEnd, to: frontStart },
    { label: 'Front', from: frontStart, to: 1 },
  ];

  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 z-[6]">
      <svg className="absolute inset-0 h-full w-full" preserveAspectRatio="none" viewBox="0 0 100 100">
        {COVER_FOLD_FRACTIONS.map((f) => (
          <line
            key={f}
            x1={f * 100}
            y1={0}
            x2={f * 100}
            y2={100}
            stroke="currentColor"
            className="text-foreground/70"
            strokeWidth={0.18}
            strokeDasharray={dash}
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>
      {/* Region names, small and low-contrast — legible when looked for, invisible when not. */}
      <div className="absolute inset-x-0 bottom-0 h-0">
        {regions.map((r, i) => (
          <span
            key={i}
            className="absolute bottom-1 -translate-x-1/2 whitespace-nowrap text-[7px] font-semibold uppercase tracking-wider text-foreground/45"
            style={{ left: `${((r.from + r.to) / 2) * 100}%` }}
          >
            {r.label}
          </span>
        ))}
      </div>
    </div>
  );
}

/** One face of the cover: its backdrop, its objects, and the chrome layer above both. */
function Face({
  side,
  widthPct,
  cover,
  imageUrl,
  stickerUrlFor,
  onFaceEl,
}: {
  side: CoverSide;
  widthPct: number;
  cover: CoverApi;
  imageUrl: string | null;
  stickerUrlFor?: (stickerId: string) => string | undefined;
  onFaceEl?: (el: HTMLDivElement | null) => void;
}) {
  const { page } = useBuilderDimensions();
  const ref = useRef<HTMLDivElement>(null);
  const [chromeEl, setChromeEl] = useState<HTMLDivElement | null>(null);
  const [snap, setSnap] = useState<SnapLine[]>([]);
  const [editingText, setEditingText] = useState<string | null>(null);

  const config: CoverConfig = cover.config;
  const { texts, stickers, qrs } = coverSideElements(config, side);
  const image = coverSideImage(config, side);
  const focused = cover.side === side;
  const sel = (s: Selection) => focused && cover.selection.kind === s.kind && JSON.stringify(cover.selection) === JSON.stringify(s);

  /** Focus this face and select something on it — the single place both are kept in step. */
  const pick = (s: Selection) => {
    cover.setSide(side);
    cover.setSelection(s);
  };

  /**
   * A click on the face itself. Resolves to the PHOTO when there is one and the BACKGROUND when
   * there isn't — the same object either way, described by whichever of the two is actually
   * carrying the look.
   *
   * The spine used to select nothing, because it had no backdrop to select. It has one now, so it
   * behaves like its two neighbours: click it and you get the colour tools for it.
   */
  const pickBackdrop = () => {
    if (side === 'spine') pick({ kind: 'background' });
    else pick(image.photoId || imageUrl ? { kind: 'base', slot: 'image' } : { kind: 'background' });
  };

  /** Every movable box on this face — one alignment pool, exactly as a content page has. */
  const peerBoxes = [
    ...texts.map((t) => ({ id: t.id, x: t.x, y: t.y, w: t.w, h: t.h })),
    ...stickers.map((s) => ({ id: s.id, x: s.x, y: s.y, w: s.w, h: s.h })),
    ...qrs.map((q) => ({ id: q.id, x: q.x, y: q.y, w: q.w, h: q.h })),
  ];
  const peersExcept = (id: string) => peerBoxes.filter((p) => p.id !== id);

  const key = `cover:${side}`;
  const backdropSelected = focused && (cover.selection.kind === 'background' || cover.selection.kind === 'base');

  return (
    <div
      ref={(el) => {
        (ref as React.MutableRefObject<HTMLDivElement | null>).current = el;
        if (focused) onFaceEl?.(el);
      }}
      onPointerDown={(e) => {
        // Stop the pasteboard's deselect: a click that reaches the face means the face.
        e.stopPropagation();
        pickBackdrop();
      }}
      className="relative h-full"
      style={{ width: `${widthPct}%`, containerType: side === 'spine' ? 'size' : 'inline-size' }}
    >
      {/* ── RENDER LAYER, CLIPPED AT THE TRIM ────────────────────────────────────────────
          Everything that draws, cut where the cover ends — identical to a content page, so an
          object pushed off the edge shows only the part that will print. */}
      <div className="absolute inset-0 overflow-hidden">
        {side === 'spine' ? (
          <SpineDesign config={config} renderElements={false} />
        ) : side === 'front' ? (
          <CoverDesign
            imageUrl={imageUrl}
            imageEdit={config.imageEdit}
            background={config.background}
            layout={config.layout}
            renderElements={false}
          />
        ) : (
          <BackCoverDesign back={config.back} imageUrl={imageUrl} renderElements={false} />
        )}

        {/* Text objects — including the title / subtitle / author metadata views, which are
            dragged, resized and rotated exactly like any other text. */}
        {texts.map((t) => (
          <Movable
            key={t.id}
            rect={t}
            rotation={t.rotation}
            rotatable
            minW={0.06}
            minH={0.03}
            selected={sel({ kind: 'text', id: t.id })}
            containerRef={ref}
            chromeContainer={chromeEl}
            pageSpan={1}
            escape={PASTEBOARD_ESCAPE}
            ariaLabel={roleLabel(t.role) ?? 'Text'}
            peers={peersExcept(t.id)}
            onSelect={() => pick({ kind: 'text', id: t.id })}
            onChange={(r) => cover.patchText(key, t.id, r)}
            onRotate={(deg) => cover.patchText(key, t.id, { rotation: deg })}
            onSnap={setSnap}
            onDoubleClick={() => setEditingText(t.id)}
          >
            {editingText === t.id ? (
              <InlineTextEditor
                initial={t.text}
                el={t}
                onCommit={(text) => {
                  // Editing the title object's words here IS renaming the album — `useCover`
                  // reads the metadata back out of the objects on every write.
                  cover.patchText(key, t.id, { text });
                  setEditingText(null);
                }}
              />
            ) : (
              <TextContent el={t} />
            )}
          </Movable>
        ))}

        {qrs.map((q) => (
          <Movable
            key={q.id}
            rect={q}
            keepSquare
            squareRatio={page}
            minW={0.06}
            selected={sel({ kind: 'qr', id: q.id })}
            containerRef={ref}
            chromeContainer={chromeEl}
            pageSpan={1}
            escape={PASTEBOARD_ESCAPE}
            ariaLabel="QR code"
            peers={peersExcept(q.id)}
            onSelect={() => pick({ kind: 'qr', id: q.id })}
            onChange={(r) => cover.patchQr(key, q.id, { ...r, h: squareQrHeight(r.w, page) })}
            onSnap={setSnap}
          >
            <QrContent el={q} />
          </Movable>
        ))}

        {stickers.map((s) => (
          <Movable
            key={s.id}
            rect={s}
            rotation={s.rotation}
            rotatable
            locked={s.locked}
            minW={0.04}
            minH={0.04}
            selected={sel({ kind: 'sticker', id: s.id })}
            containerRef={ref}
            chromeContainer={chromeEl}
            pageSpan={1}
            escape={PASTEBOARD_ESCAPE}
            ariaLabel="Sticker"
            peers={peersExcept(s.id)}
            onSelect={() => pick({ kind: 'sticker', id: s.id })}
            onChange={(r) => cover.patchSticker(key, s.id, r)}
            onRotate={(deg) => cover.patchSticker(key, s.id, { rotation: deg })}
            onSnap={setSnap}
          >
            <StickerContent el={s} url={stickerUrlFor?.(s.stickerId)} />
          </Movable>
        ))}

        {/* Quiet face label, so the three surfaces are nameable at a glance. */}
        {side !== 'spine' && (
          <span className="pointer-events-none absolute left-2 top-2 z-[2] rounded bg-foreground/35 px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-wide text-white opacity-70">
            {side === 'front' ? 'Front cover' : 'Back cover'}
          </span>
        )}
      </div>
      {/* ── end of the clipped render layer ─────────────────────────────────────────── */}

      {/* THE BACKDROP'S OWN SELECTION RING. The background is an object now, so it gets the same
          feedback every other object gets — inset, so it reads as "this surface" rather than as a
          border drawn on the artwork. */}
      {backdropSelected && (
        <span aria-hidden className="pointer-events-none absolute inset-0 z-[20] ring-2 ring-inset ring-studio-bright" />
      )}

      {/* The face's trim edge, so "where does the cover end?" stays legible through an object
          that hangs off it. */}
      <span aria-hidden className="pointer-events-none absolute inset-0 z-[10] ring-1 ring-inset ring-black/10" />

      {/* EDITING LAYER — selection chrome only, never clipped, so an object hanging off the cover
          keeps its outline and handles out on the pasteboard. */}
      <div ref={setChromeEl} className="pointer-events-none absolute inset-0 z-[30]" />

      <SnapGuides lines={snap} />

      {/* An unfocused face is dimmed a hair, so the one you are editing is unambiguous without
          any of them being hidden. Inert. */}
      {!focused && <span aria-hidden className="pointer-events-none absolute inset-0 z-[25] bg-foreground/[0.06]" />}
    </div>
  );
}
