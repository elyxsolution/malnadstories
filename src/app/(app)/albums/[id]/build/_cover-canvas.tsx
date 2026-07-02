'use client';

import { useRef, useState } from 'react';
import { Pencil, Copy } from 'lucide-react';
import CoverDesign, { BackCoverDesign, coverSpreadMetrics } from './_cover-render';
import { fontStack } from '@/lib/builder/elements';
import Movable, { SnapGuides, type SnapLine } from './_movable';
import { TextContent, StickerContent, QrContent } from './_elements-render';
import { ElementControls, CtlBtn, InlineTextEditor } from './_element-bits';
import type { CoverConfig } from '@/lib/builder/cover';
import type { QrElement, StickerElement, TextElement } from '@/lib/builder/model';

/** Which page of the cover spread an element lives on. */
export type CoverSide = 'front' | 'back';

/** What's selected on the cover canvas — scoped to a side (front/back) or the spine. */
export type CoverSelection =
  | { kind: 'none' }
  | { kind: 'spine' }
  | { kind: 'text'; side: CoverSide; id: string }
  | { kind: 'sticker'; side: CoverSide; id: string }
  | { kind: 'qr'; side: CoverSide; id: string };
export const COVER_NO_SELECTION: CoverSelection = { kind: 'none' };

/** Square pixels for a QR/sticker box on a 3:4 cover page (page is taller than wide). */
const coverSquare = (w: number) => Math.min(1, w * (3 / 4));

export type CoverCanvasProps = {
  title: string;
  config: CoverConfig;
  frontImageUrl: string | null;
  backImageUrl: string | null;
  size: number;
  zoomPct?: number;
  stickerUrlFor?: (stickerId: string) => string | undefined;
  selection: CoverSelection;
  onSelect: (s: CoverSelection) => void;
  activeSide: CoverSide;
  onActiveSide: (s: CoverSide) => void;
  onChangeText: (side: CoverSide, id: string, patch: Partial<TextElement>) => void;
  onReorderText: (side: CoverSide, id: string, dir: -1 | 1) => void;
  onDeleteText: (side: CoverSide, id: string) => void;
  onDuplicateText: (side: CoverSide, id: string) => void;
  onChangeSticker: (side: CoverSide, id: string, patch: Partial<StickerElement>) => void;
  onReorderSticker: (side: CoverSide, id: string, dir: -1 | 1) => void;
  onDeleteSticker: (side: CoverSide, id: string) => void;
  onDuplicateSticker: (side: CoverSide, id: string) => void;
  onChangeQr: (side: CoverSide, id: string, patch: Partial<QrElement>) => void;
  onReorderQr: (side: CoverSide, id: string, dir: -1 | 1) => void;
  onDeleteQr: (side: CoverSide, id: string) => void;
  onDuplicateQr: (side: CoverSide, id: string) => void;
};

/**
 * The cover editing canvas — the WHOLE printed cover as PAGE 0 of one continuous editor:
 * BACK (left) · SPINE (centre) · FRONT (right), in true book proportions for the album's leaf
 * count. Each page's static base renders through the SAME renderers used by the flipbook + PDF
 * (`renderElements={false}` so they don't double-draw), and each page's free elements layer on
 * top as fully interactive `Movable` boxes — identical drag/resize/rotate/inline-edit to a
 * content page. WYSIWYG: what's drawn here is exactly what prints (front = page 1, back = last).
 */
export default function CoverCanvas(props: CoverCanvasProps) {
  const { title, config, size, zoomPct = 100, selection, onSelect } = props;
  const { pagePct, spinePct, aspect } = coverSpreadMetrics(size);
  const spineSelected = selection.kind === 'spine';

  return (
    <div className="ms-scroll relative min-h-0 flex-1 overflow-auto p-6 lg:p-10">
      <div className="mx-auto flex flex-col items-center gap-4" style={{ width: `min(${Math.round(7.4 * zoomPct)}px, 96%)` }}>
        <div
          className="relative w-full select-none overflow-hidden rounded-[14px] shadow-[0_2px_4px_rgb(16_24_20/0.06),0_26px_70px_-30px_rgb(16_24_20/0.55)] ring-1 ring-black/10"
          style={{ aspectRatio: String(aspect) }}
        >
          <div className="flex h-full w-full">
            {/* BACK page */}
            <SidePane
              side="back"
              widthPct={pagePct}
              label="Back cover"
              {...props}
            />

            {/* SPINE */}
            <button
              type="button"
              onClick={() => onSelect({ kind: 'spine' })}
              title="Edit spine"
              className={`relative h-full overflow-hidden outline-none ring-inset transition-shadow ${spineSelected ? 'ring-2 ring-studio-bright' : ''}`}
              style={{
                width: `${spinePct}%`,
                background:
                  'linear-gradient(90deg, rgba(0,0,0,0.22), rgba(0,0,0,0.04) 40%, rgba(0,0,0,0.04) 60%, rgba(0,0,0,0.22)), #1e3a2f',
                containerType: 'size',
              }}
            >
              {(config.spineTitle || title).trim() && (
                <span
                  className="absolute left-1/2 top-1/2"
                  style={{
                    transform: 'translate(-50%, -50%)',
                    writingMode: 'vertical-rl',
                    whiteSpace: 'nowrap',
                    color: config.spineColor,
                    fontFamily: fontStack('serif'),
                    fontSize: '5cqh',
                    letterSpacing: '0.12em',
                    opacity: 0.92,
                    textShadow: '0 0.4cqh 1cqh rgba(0,0,0,0.35)',
                  }}
                >
                  {config.spineTitle || title}
                </span>
              )}
            </button>

            {/* FRONT page */}
            <SidePane
              side="front"
              widthPct={pagePct}
              label="Front cover"
              {...props}
            />
          </div>

          {/* Spine-edge depth so the spread reads as a bound book. */}
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

/** One page of the cover spread: its static base + an interactive layer for its free elements. */
function SidePane({
  side,
  widthPct,
  label,
  title,
  config,
  frontImageUrl,
  backImageUrl,
  stickerUrlFor,
  selection,
  onSelect,
  onActiveSide,
  onChangeText,
  onReorderText,
  onDeleteText,
  onDuplicateText,
  onChangeSticker,
  onReorderSticker,
  onDeleteSticker,
  onDuplicateSticker,
  onChangeQr,
  onReorderQr,
  onDeleteQr,
  onDuplicateQr,
}: CoverCanvasProps & { side: CoverSide; widthPct: number; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [snap, setSnap] = useState<SnapLine[]>([]);
  const [editingText, setEditingText] = useState<string | null>(null);

  const texts = side === 'front' ? config.texts : config.back.texts;
  const stickers = side === 'front' ? config.stickers : config.back.stickers;
  const qrs = side === 'front' ? config.qrs : config.back.qrs;

  const selOf = (kind: 'text' | 'sticker' | 'qr', id: string) =>
    selection.kind === kind && 'side' in selection && selection.side === side && selection.id === id;

  const pick = (sel: CoverSelection) => {
    onActiveSide(side);
    onSelect(sel);
  };

  return (
    <div
      ref={ref}
      onPointerDown={() => {
        onActiveSide(side);
        onSelect({ kind: 'none' });
      }}
      className="relative h-full overflow-hidden"
      style={{ width: `${widthPct}%`, containerType: 'inline-size' }}
    >
      {/* Static base — image/background (+ the front's structured title). Elements drawn below. */}
      {side === 'front' ? (
        <CoverDesign
          imageUrl={frontImageUrl}
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
          renderElements={false}
        />
      ) : (
        <BackCoverDesign back={config.back} imageUrl={backImageUrl} renderElements={false} />
      )}

      {/* Text elements */}
      {texts.map((t) => (
        <Movable
          key={t.id}
          rect={t}
          rotation={t.rotation}
          rotatable
          minW={0.06}
          minH={0.03}
          selected={selOf('text', t.id)}
          containerRef={ref}
          ariaLabel="Text"
          onSelect={() => pick({ kind: 'text', side, id: t.id })}
          onChange={(r) => onChangeText(side, t.id, r)}
          onRotate={(deg) => onChangeText(side, t.id, { rotation: deg })}
          onSnap={setSnap}
          onDoubleClick={() => setEditingText(t.id)}
          controls={
            <ElementControls
              onForward={() => onReorderText(side, t.id, 1)}
              onBackward={() => onReorderText(side, t.id, -1)}
              onDelete={() => {
                onDeleteText(side, t.id);
                onSelect({ kind: 'none' });
              }}
              extra={
                <>
                  <CtlBtn label="Edit text" onClick={() => setEditingText(t.id)}>
                    <Pencil />
                  </CtlBtn>
                  <CtlBtn label="Duplicate" onClick={() => onDuplicateText(side, t.id)}>
                    <Copy />
                  </CtlBtn>
                </>
              }
            />
          }
        >
          {editingText === t.id ? (
            <InlineTextEditor
              initial={t.text}
              el={t}
              onCommit={(text) => {
                onChangeText(side, t.id, { text });
                setEditingText(null);
              }}
            />
          ) : (
            <TextContent el={t} />
          )}
        </Movable>
      ))}

      {/* QR elements (kept square for a 3:4 cover page) */}
      {qrs.map((q) => (
        <Movable
          key={q.id}
          rect={q}
          squareRatio={3 / 4}
          minW={0.06}
          selected={selOf('qr', q.id)}
          containerRef={ref}
          ariaLabel="QR code"
          onSelect={() => pick({ kind: 'qr', side, id: q.id })}
          onChange={(r) => onChangeQr(side, q.id, { ...r, h: coverSquare(r.w) })}
          onSnap={setSnap}
          controls={
            <ElementControls
              onForward={() => onReorderQr(side, q.id, 1)}
              onBackward={() => onReorderQr(side, q.id, -1)}
              onDelete={() => {
                onDeleteQr(side, q.id);
                onSelect({ kind: 'none' });
              }}
              extra={
                <CtlBtn label="Duplicate" onClick={() => onDuplicateQr(side, q.id)}>
                  <Copy />
                </CtlBtn>
              }
            />
          }
        >
          <QrContent el={q} />
        </Movable>
      ))}

      {/* Sticker elements */}
      {stickers.map((s) => (
        <Movable
          key={s.id}
          rect={s}
          rotation={s.rotation}
          rotatable
          locked={s.locked}
          minW={0.04}
          minH={0.04}
          selected={selOf('sticker', s.id)}
          containerRef={ref}
          ariaLabel="Sticker"
          onSelect={() => pick({ kind: 'sticker', side, id: s.id })}
          onChange={(r) => onChangeSticker(side, s.id, r)}
          onRotate={(deg) => onChangeSticker(side, s.id, { rotation: deg })}
          onSnap={setSnap}
          controls={
            <ElementControls
              onForward={() => onReorderSticker(side, s.id, 1)}
              onBackward={() => onReorderSticker(side, s.id, -1)}
              onDelete={() => {
                onDeleteSticker(side, s.id);
                onSelect({ kind: 'none' });
              }}
              extra={
                <CtlBtn label="Duplicate" onClick={() => onDuplicateSticker(side, s.id)}>
                  <Copy />
                </CtlBtn>
              }
            />
          }
        >
          <StickerContent el={s} url={stickerUrlFor?.(s.stickerId)} />
        </Movable>
      ))}

      <SnapGuides lines={snap} />

      {/* Quiet page label (top-left), hidden once anything is placed near it. */}
      <span className="pointer-events-none absolute left-2 top-2 z-[2] rounded bg-foreground/35 px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-wide text-white opacity-70">
        {label}
      </span>
    </div>
  );
}
