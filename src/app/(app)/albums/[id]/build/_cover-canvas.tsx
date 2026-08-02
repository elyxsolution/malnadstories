'use client';

import { useRef, useState } from 'react';
import CoverDesign, { BackCoverDesign, SpineDesign, coverSpreadMetrics } from './_cover-render';
import Movable, { SnapGuides, type SnapLine } from './_movable';
import { TextContent, StickerContent, QrContent } from './_elements-render';
import { InlineTextEditor } from './_element-bits';
import { useBuilderDimensions } from './_dimensions';
import { commitBounds, travelBounds, type EditableKind } from '@/lib/builder/edit-bounds';
import { squareQrHeight } from '@/lib/builder/elements';
import { COVER_SIDES, coverSideElements, coverSideImage, isPermanentRole, roleLabel, type CoverSide } from '@/lib/builder/cover-objects';
import type { CoverConfig } from '@/lib/builder/cover';
import type { Selection } from './_use-builder';
import type { CoverApi } from './_use-cover';

export type { CoverSide };

/**
 * THE COVER CANVAS — the printed cover as three editable surfaces, and nothing else.
 *
 * BACK (left) · SPINE (centre) · FRONT (right), in true book proportions for the album's leaf
 * count. Every visible thing on it is an object: the title, the subtitle, the author line and the
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

const escapeFor = (kind: EditableKind) => ({ edit: travelBounds(kind), commit: commitBounds(kind) });

export type CoverCanvasProps = {
  cover: CoverApi;
  frontImageUrl: string | null;
  backImageUrl: string | null;
  size: number;
  zoomPct?: number;
  stickerUrlFor?: (stickerId: string) => string | undefined;
  /** Publishes the focused face's element upward so the floating toolbar can anchor to it. */
  onFaceEl?: (el: HTMLDivElement | null) => void;
};

export default function CoverCanvas({
  cover,
  frontImageUrl,
  backImageUrl,
  size,
  zoomPct = 100,
  stickerUrlFor,
  onFaceEl,
}: CoverCanvasProps) {
  const { page } = useBuilderDimensions();
  const { pagePct, spinePct, aspect } = coverSpreadMetrics(size, page);

  return (
    <div
      className="ms-scroll relative min-h-0 flex-1 overflow-auto p-6 lg:p-10"
      /* The pasteboard around the book: a click out here means "nothing selected", which is the
         cover-level toolbar — the same rule the page canvas follows. */
      onPointerDown={() => cover.setSelection({ kind: 'none' })}
    >
      <div className="mx-auto flex flex-col items-center gap-4" style={{ width: `min(${Math.round(7.4 * zoomPct)}px, 96%)` }}>
        {/* No `overflow-hidden`: each face clips its own content at its own trim, and clipping the
            whole spread would take the selection handles of anything near the outer edge with it. */}
        <div
          className="relative w-full select-none shadow-[0_2px_4px_rgb(16_24_20/0.06),0_26px_70px_-30px_rgb(16_24_20/0.55)] ring-1 ring-black/10"
          style={{ aspectRatio: String(aspect) }}
        >
          <div className="flex h-full w-full">
            {COVER_SIDES.map((s) => (
              <Face
                key={s}
                side={s}
                widthPct={s === 'spine' ? spinePct : pagePct}
                cover={cover}
                imageUrl={s === 'front' ? frontImageUrl : s === 'back' ? backImageUrl : null}
                stickerUrlFor={stickerUrlFor}
                onFaceEl={onFaceEl}
              />
            ))}
          </div>

          {/* Spine-edge depth so the spread reads as a bound book. Inert — the spine itself is a
              real surface underneath and must stay clickable. */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 z-[3]"
            style={{ left: `${pagePct}%`, width: `${spinePct}%`, boxShadow: 'inset 0 0 3cqw rgba(0,0,0,0.3)' }}
          />
        </div>
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
          Back cover · spine · front cover — the whole printed cover
        </p>
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
   * carrying the look. The spine has neither, so it selects nothing and leaves the cover toolbar up.
   */
  const pickBackdrop = () => {
    if (side === 'spine') pick({ kind: 'none' });
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
          <SpineDesign spine={config.spine} renderElements={false} />
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
            escape={escapeFor('text')}
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
            escape={escapeFor('qr')}
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
            escape={escapeFor('sticker')}
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

/** Legacy export kept for the admin designer's selection plumbing. */
export const COVER_NO_SELECTION: Selection = { kind: 'none' };
export const coverTextIsPermanent = isPermanentRole;
