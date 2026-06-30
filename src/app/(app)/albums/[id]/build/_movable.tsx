'use client';

import { useRef, type ReactNode, type PointerEvent as ReactPointerEvent } from 'react';
import type { Rect } from '@/lib/builder/model';

/**
 * A reusable, normalized (0..1) draggable / resizable / rotatable box — the interaction
 * engine behind every on-canvas element (photo overlays, text, QR). Coordinates are
 * fractions of the open-pair box (`containerRef`), so the same element renders identically
 * across the canvas, preview, and PDF. Selection, snapping, and the floating control bar
 * are handled here; callers supply only the visual `children` and the `controls`.
 */

export type SnapLine = { axis: 'x' | 'y'; pos: number };

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const SNAP_T = 0.012; // snap threshold (fraction of the pair)
// Snap targets: page centres (0.25 / 0.75), the centre fold (0.5), and the safe margins.
const SNAP_X = [0.05, 0.25, 0.5, 0.75, 0.95];
const SNAP_Y = [0.06, 0.5, 0.94];

function snapAxis(centre: number, half: number, targets: number[]): { value: number; line: number | null } {
  for (const t of targets) {
    if (Math.abs(centre - t) <= SNAP_T) return { value: t - half, line: t };
  }
  return { value: centre - half, line: null };
}

export default function Movable({
  rect,
  rotation = 0,
  selected,
  locked = false,
  minW = 0.04,
  minH = 0.04,
  keepSquare = false,
  squareRatio = 1, // h = w * squareRatio for square pixels on a non-square pair
  rotatable = false,
  containerRef,
  onSelect,
  onChange,
  onCommit,
  onRotate,
  onSnap,
  onDoubleClick,
  className = '',
  zIndex,
  ariaLabel,
  children,
  controls,
}: {
  rect: Rect;
  rotation?: number;
  selected: boolean;
  locked?: boolean;
  minW?: number;
  minH?: number;
  keepSquare?: boolean;
  squareRatio?: number;
  rotatable?: boolean;
  containerRef: React.RefObject<HTMLElement>;
  onSelect: () => void;
  onChange: (rect: Rect) => void;
  onCommit?: () => void;
  onRotate?: (deg: number) => void;
  onSnap?: (lines: SnapLine[]) => void;
  onDoubleClick?: () => void;
  className?: string;
  zIndex?: number;
  ariaLabel?: string;
  children: ReactNode;
  controls?: ReactNode;
}) {
  const drag = useRef<{ mode: 'move' | 'resize' | 'rotate'; sx: number; sy: number; start: Rect; cx: number; cy: number } | null>(
    null,
  );

  const begin = (mode: 'move' | 'resize' | 'rotate') => (e: ReactPointerEvent) => {
    if (locked) return;
    e.stopPropagation();
    onSelect();
    const box = containerRef.current?.getBoundingClientRect();
    drag.current = {
      mode,
      sx: e.clientX,
      sy: e.clientY,
      start: rect,
      cx: box ? box.left + (rect.x + rect.w / 2) * box.width : 0,
      cy: box ? box.top + (rect.y + rect.h / 2) * box.height : 0,
    };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onMove = (e: ReactPointerEvent) => {
    const d = drag.current;
    const box = containerRef.current?.getBoundingClientRect();
    if (!d || !box) return;
    const dx = (e.clientX - d.sx) / box.width;
    const dy = (e.clientY - d.sy) / box.height;

    if (d.mode === 'move') {
      let nx = clamp(d.start.x + dx, 0, 1 - d.start.w);
      let ny = clamp(d.start.y + dy, 0, 1 - d.start.h);
      const lines: SnapLine[] = [];
      const sx = snapAxis(nx + d.start.w / 2, d.start.w / 2, SNAP_X);
      const sy = snapAxis(ny + d.start.h / 2, d.start.h / 2, SNAP_Y);
      if (sx.line !== null) {
        nx = clamp(sx.value, 0, 1 - d.start.w);
        lines.push({ axis: 'x', pos: sx.line });
      }
      if (sy.line !== null) {
        ny = clamp(sy.value, 0, 1 - d.start.h);
        lines.push({ axis: 'y', pos: sy.line });
      }
      onSnap?.(lines);
      onChange({ ...d.start, x: nx, y: ny });
    } else if (d.mode === 'resize') {
      let nw = clamp(d.start.w + dx, minW, 1 - d.start.x);
      const nh = keepSquare ? clamp(nw * squareRatio, minH, 1 - d.start.y) : clamp(d.start.h + dy, minH, 1 - d.start.y);
      if (keepSquare && nh === 1 - d.start.y) nw = clamp(nh / squareRatio, minW, 1 - d.start.x);
      onChange({ ...d.start, w: nw, h: nh });
    } else if (d.mode === 'rotate' && onRotate) {
      const angle = (Math.atan2(e.clientY - d.cy, e.clientX - d.cx) * 180) / Math.PI + 90;
      const snapped = Math.abs(((angle % 90) + 90) % 90) < 4 || Math.abs((((angle % 90) + 90) % 90) - 90) < 4
        ? Math.round(angle / 90) * 90
        : Math.round(angle);
      onRotate(clamp(snapped, -180, 180));
    }
  };

  const end = (e: ReactPointerEvent) => {
    if (!drag.current) return;
    drag.current = null;
    onSnap?.([]);
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    onCommit?.();
  };

  return (
    <div
      role="button"
      tabIndex={-1}
      aria-label={ariaLabel}
      onPointerDown={begin('move')}
      onPointerMove={onMove}
      onPointerUp={end}
      onPointerCancel={end}
      onDoubleClick={onDoubleClick}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      className={`group/movable absolute touch-none ${locked ? '' : 'cursor-move'} ${className}`}
      style={{
        left: `${rect.x * 100}%`,
        top: `${rect.y * 100}%`,
        width: `${rect.w * 100}%`,
        height: `${rect.h * 100}%`,
        transform: rotation ? `rotate(${rotation}deg)` : undefined,
        zIndex: selected ? 50 : zIndex,
        outline: selected ? '2px solid hsl(var(--studio-bright))' : undefined,
        outlineOffset: '1px',
        boxShadow: selected ? '0 0 0 4px hsl(var(--studio-bright) / 0.18)' : undefined,
        borderRadius: '2px',
      }}
    >
      {children}

      {selected && !locked && (
        <>
          {/* Floating control bar */}
          {controls && (
            <div
              onPointerDown={(e) => e.stopPropagation()}
              className="animate-scale-in absolute -top-9 left-1/2 z-[60] flex -translate-x-1/2 items-center gap-0.5 rounded-lg border border-border bg-card/95 p-0.5 shadow-elevated backdrop-blur-sm"
            >
              {controls}
            </div>
          )}
          {/* Resize handle (SE) */}
          <span
            onPointerDown={begin('resize')}
            onPointerMove={onMove}
            onPointerUp={end}
            onPointerCancel={end}
            className="absolute -bottom-1.5 -right-1.5 z-[55] h-3.5 w-3.5 cursor-nwse-resize rounded-full border-2 border-card bg-studio shadow-sm transition-transform hover:scale-110"
          />
          {/* Rotate handle */}
          {rotatable && onRotate && (
            <span
              onPointerDown={begin('rotate')}
              onPointerMove={onMove}
              onPointerUp={end}
              onPointerCancel={end}
              className="absolute -top-1.5 left-1/2 z-[55] h-3.5 w-3.5 -translate-x-1/2 -translate-y-4 cursor-grab rounded-full border-2 border-card bg-studio shadow-sm transition-transform hover:scale-110"
            />
          )}
        </>
      )}
    </div>
  );
}

/** Render the active snap guide lines across the page box (presentation only). */
export function SnapGuides({ lines }: { lines: SnapLine[] }) {
  if (lines.length === 0) return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-[45]">
      {lines.map((l, i) =>
        l.axis === 'x' ? (
          <span key={i} className="absolute top-0 h-full w-px bg-studio-bright/80" style={{ left: `${l.pos * 100}%` }} />
        ) : (
          <span key={i} className="absolute left-0 w-full border-t border-studio-bright/80" style={{ top: `${l.pos * 100}%` }} />
        ),
      )}
    </div>
  );
}
