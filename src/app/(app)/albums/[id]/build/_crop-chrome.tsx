'use client';

import { useEffect, useRef } from 'react';
import { Move } from 'lucide-react';
import PhotoFrame from './_photo-frame';
import type { EditConfig } from '@/lib/builder/model';
import type { WheelLike } from './_use-canvas-crop';

/**
 * IN-CANVAS IMAGE ADJUSTMENT — the shared chrome, for every surface that has photo frames.
 *
 * These four pieces used to live inside `_block.tsx`, private to the content spread, because the
 * spread was the only surface with adjustable photo frames. The BACK COVER has them too — a cover
 * overlay is the same `Overlay` object, moved and resized by the same `Movable` engine — and it
 * had none of this: no press-and-hold, no adjust handle, no in-place pan/zoom, no ghost. That was
 * not a decision, it was where the code happened to sit.
 *
 * So they are here, unchanged, and both canvases import them. Reusing rather than re-implementing
 * is the point: the gesture, the capture surface, the ghost and the wheel-ownership rule are one
 * implementation, so a cover overlay and a page overlay cannot behave differently.
 */

/**
 * THE ADJUST HANDLE — the affordance for the thing the frame's edge handles do NOT do.
 *
 * A selected photo frame already says "you can move and resize this box": that is what eight
 * handles on its edge mean. Nothing said that the PICTURE inside the box is independently
 * movable, so the capability was there and invisible — you had to know to reach for Crop, or to
 * press and hold. This is that sentence, said where the gesture happens.
 *
 * It is CHROME, not an object: it has no id, is not in `Block`, is never persisted, and is drawn
 * from the frame's own geometry — so it stays centred through a resize and does not move when the
 * image inside is panned or zoomed. It opens the SAME adjustment state the toolbar's Crop button
 * and press-and-hold open (`beginCropOn`); there is no second editing mode behind it.
 *
 * Pointer-down is stopped so that grabbing it can never be read as the start of a drag of the
 * frame — the one way a centred control could damage an existing interaction.
 */
export function AdjustHandle({ onAdjust }: { onAdjust: () => void }) {
  return (
    <button
      type="button"
      aria-label="Adjust the photo inside this frame"
      title="Adjust the photo inside this frame — drag to reposition, scroll to zoom"
      /* A base slot is itself HTML-draggable (that is how a page→page move works); without this,
         pressing the handle and moving would start dragging the PHOTO instead of opening the
         adjustment. Stopping pointer-down covers the pointer gestures; this covers the drag. */
      draggable={false}
      onDragStart={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onAdjust();
      }}
      className="pointer-events-auto grid h-7 w-7 place-items-center rounded-full border border-white/70 bg-card/90 text-studio shadow-elevated backdrop-blur-sm transition-all duration-150 ease-glide hover:scale-105 hover:bg-card active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-studio-bright focus-visible:ring-offset-1"
    >
      <Move className="h-3.5 w-3.5" />
    </button>
  );
}

// ── Overlay content ─────────────────────────────────────────────────────────────────
/**
 * The inside of one overlay container. Renders the assigned photo, or — when empty — a dashed
 * placeholder that reads as a real drop zone. Accepts a dragged tray photo (`text/photo-id`)
 * exactly like a base slot, so a user fills a placeholder overlay by dragging onto it. Dropping
 * onto a filled overlay replaces its photo. The parent Movable still handles select/drag/resize.
 */
/**
 * Give the wheel to the image while a frame on this page is being adjusted, and to nobody else.
 *
 * A native, non-passive listener is the only thing that can actually stop the scroll (React's own
 * wheel listener is passive), and attaching it to the PAGE rather than to the frame means the
 * gesture keeps working when the pointer strays off a small overlay mid-zoom — which is most of
 * the time, since zooming in is exactly when the frame is smallest relative to the pointer.
 */
export function useCropWheel(page: React.RefObject<HTMLElement>, active: boolean, handlers?: CropHandlers) {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    const el = page.current;
    if (!el || !active) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault(); // requires `passive: false` — this is the whole reason for the listener
      e.stopPropagation();
      handlersRef.current?.onWheel(e);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [page, active]);
}

/** The pointer/keyboard surface `useCanvasCrop` supplies. Passed straight through to the layer. */
export type CropHandlers = {
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
  onWheel: (e: WheelLike) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
};

/**
 * IN-CANVAS CROP LAYER — a transparent capture surface laid over the frame being cropped.
 *
 * It draws NOTHING. Every visible part of adjustment mode — the bright frame boundary, the
 * rule-of-thirds grid, the dimmed rest of the page and the faint spill of the image beyond the
 * frame — is drawn by `CropBleed`, outside the page's clip, because most of it lies outside the
 * frame by definition and would simply be cut away here. What is left is the job this layer
 * actually has: capture the gesture over the frame, and nothing else.
 *
 * It takes focus on mount so arrow keys nudge and Escape finishes without touching the mouse.
 */
export function CropLayer({ handlers }: { handlers?: CropHandlers }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return (
    <div
      ref={ref}
      role="application"
      aria-label="Crop: drag to reposition, scroll or +/− to zoom, Escape to finish"
      tabIndex={0}
      onPointerDown={handlers?.onPointerDown}
      onPointerMove={handlers?.onPointerMove}
      onPointerUp={handlers?.onPointerUp}
      onPointerCancel={handlers?.onPointerUp}
      /* NO React `onWheel` here — see `useCropWheel`: React's wheel listener is passive, so the
         only place the scroll can actually be prevented is a native listener on the page. */
      onKeyDown={handlers?.onKeyDown}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      className="absolute inset-0 z-[9] cursor-move touch-none select-none outline-none"
    />
  );
}

/**
 * THE ADJUSTMENT GHOST — what the frame is choosing FROM.
 *
 * Repositioning a photo inside a fixed frame is a question about the part of the picture you
 * CANNOT currently see, and until now the canvas answered it with nothing: the page clips at the
 * frame, so you dragged blind and judged the result afterwards. This draws the rest of the image,
 * faintly, exactly where it sits — same `computeFrameLayout` geometry, same `EditConfig`, one
 * `bleed` flag — so the crop you are choosing is visible before you commit to it.
 *
 * Three layers, in this order, all inert:
 *   1. a scrim over the whole spread, so the frame is unmistakably the subject;
 *   2. the FULL image at low opacity, unclipped — the part that will not print;
 *   3. the frame itself, crisp, clipped to its real shape — the part that will.
 *
 * It is driven purely by a rect, so it is identical for a page half, a full-spread image and any
 * overlay of any shape or rotation-free geometry. There is no per-frame-type branch to keep in
 * step, which is the point: every photo container gets the same behaviour because they all reduce
 * to the same three values.
 */
export function CropBleed({
  rect,
  rounded,
  url,
  edit,
}: {
  rect: { x: number; y: number; w: number; h: number };
  /** Overlays carry the canvas's 6px container radius; page halves are square-cornered paper. */
  rounded: boolean;
  url: string;
  edit?: EditConfig | null;
}) {
  const box: React.CSSProperties = {
    left: `${rect.x * 100}%`,
    top: `${rect.y * 100}%`,
    width: `${rect.w * 100}%`,
    height: `${rect.h * 100}%`,
  };
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 z-[11]">
      <div className="absolute inset-0 bg-foreground/45 motion-safe:animate-fade-in" />

      {/* 2 — the whole picture, unclipped and faint. */}
      <div className="absolute opacity-[0.28]" style={box}>
        <PhotoFrame url={url} edit={edit} bleed alt="" />
      </div>

      {/* 3 — what will actually print, at full strength and clipped to the frame's own shape. */}
      <div className={`absolute overflow-hidden ${rounded ? 'rounded-md' : ''}`} style={box}>
        <PhotoFrame url={url} edit={edit} alt="" />
      </div>

      {/* The boundary + the one compositional aid worth drawing while repositioning. */}
      <div className={`absolute ring-2 ring-inset ring-studio-bright ${rounded ? 'rounded-md' : ''}`} style={box}>
        <span className="absolute inset-y-0 left-1/3 w-px bg-white/45" />
        <span className="absolute inset-y-0 left-2/3 w-px bg-white/45" />
        <span className="absolute inset-x-0 top-1/3 h-px bg-white/45" />
        <span className="absolute inset-x-0 top-2/3 h-px bg-white/45" />
      </div>
    </div>
  );
}
