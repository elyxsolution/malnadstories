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

/**
 * A guide line. `kind` decides how it is DRAWN, because the three kinds mean different things
 * and blurring them is what makes guide systems feel noisy:
 *   • `center` — you are aligned to a page centre or the fold (solid, strongest)
 *   • `edge`   — you are aligned to a safe margin, or to another element's edge (solid, softer)
 *   • `spacing`— you are equidistant from neighbours (dashed, quietest)
 */
export type SnapLine = { axis: 'x' | 'y'; pos: number; kind?: 'center' | 'edge' | 'spacing' };

/** Another element's box, in pair-normalized coordinates — the input for peer alignment. */
export type PeerRect = { x: number; y: number; w: number; h: number };

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const SNAP_T = 0.012; // snap threshold (fraction of the pair)
// Structural targets: page centres (0.25 / 0.75), the centre fold (0.5), and the safe margins.
const CENTER_X = [0.25, 0.5, 0.75];
const CENTER_Y = [0.5];
const EDGE_X = [0.05, 0.95];
const EDGE_Y = [0.06, 0.94];

type Candidate = { pos: number; kind: 'center' | 'edge' | 'spacing' };

/**
 * Snap `centre` to the nearest candidate within threshold.
 *
 * Candidates are tried in the order given, so structural guides (page centres) win ties against
 * peer edges — being centred on the page is almost always the intent when both are within a
 * pixel of each other.
 */
function snapAxis(centre: number, half: number, candidates: Candidate[]): { value: number; line: Candidate | null } {
  let best: Candidate | null = null;
  let bestDist = SNAP_T;
  for (const c of candidates) {
    const d = Math.abs(centre - c.pos);
    if (d <= bestDist) {
      // Strictly-less keeps the FIRST candidate on a tie, preserving the priority order.
      if (d < bestDist || best === null) {
        best = c;
        bestDist = d;
      }
    }
  }
  return best ? { value: best.pos - half, line: best } : { value: centre - half, line: null };
}

/**
 * Build the candidate set for one axis: structural guides first, then alignment with the CENTRES
 * of sibling elements, then equal-spacing positions between the two nearest siblings.
 *
 * Peers are only considered when there are any, so a page with a single overlay shows exactly the
 * guides it did before — the system gets richer only where richness is meaningful.
 */
function candidatesFor(axis: 'x' | 'y', peers: PeerRect[]): Candidate[] {
  const structural: Candidate[] = (axis === 'x' ? CENTER_X : CENTER_Y).map((pos) => ({ pos, kind: 'center' as const }));
  const edges: Candidate[] = (axis === 'x' ? EDGE_X : EDGE_Y).map((pos) => ({ pos, kind: 'edge' as const }));
  const peerCentres: Candidate[] = peers.map((p) =>
    axis === 'x' ? { pos: p.x + p.w / 2, kind: 'edge' as const } : { pos: p.y + p.h / 2, kind: 'edge' as const },
  );
  // Equal spacing: the midpoint between each adjacent pair of peer centres.
  const sorted = peerCentres.map((c) => c.pos).sort((a, b) => a - b);
  const spacing: Candidate[] = [];
  for (let i = 0; i < sorted.length - 1; i += 1) {
    spacing.push({ pos: (sorted[i] + sorted[i + 1]) / 2, kind: 'spacing' });
  }
  return [...structural, ...edges, ...peerCentres, ...spacing];
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
  peers = [],
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
  /** Receives modifier state so the selection store — not this component — decides semantics. */
  onSelect: (mods?: { meta: boolean; shift: boolean }) => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  onChange: (rect: Rect) => void;
  onCommit?: () => void;
  onRotate?: (deg: number) => void;
  onSnap?: (lines: SnapLine[]) => void;
  /** Sibling boxes on the same page — enables edge + equal-spacing guides. Empty is fine. */
  peers?: PeerRect[];
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
      const sx = snapAxis(nx + d.start.w / 2, d.start.w / 2, candidatesFor('x', peers));
      const sy = snapAxis(ny + d.start.h / 2, d.start.h / 2, candidatesFor('y', peers));
      if (sx.line !== null) {
        nx = clamp(sx.value, 0, 1 - d.start.w);
        lines.push({ axis: 'x', pos: sx.line.pos, kind: sx.line.kind });
      }
      if (sy.line !== null) {
        ny = clamp(sy.value, 0, 1 - d.start.h);
        lines.push({ axis: 'y', pos: sy.line.pos, kind: sy.line.kind });
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

/**
 * Render the active guide lines across the page box (presentation only).
 *
 * The three kinds are visually ranked so a glance reads the STRONGEST alignment first: centre
 * guides are solid and full-strength, edge guides solid but softer, and spacing guides dashed
 * and quietest. They appear only while a drag is actively snapped and vanish the instant it
 * ends — there is no exit animation, because a guide lingering after the drop is noise.
 */
export function SnapGuides({ lines }: { lines: SnapLine[] }) {
  if (lines.length === 0) return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-[45]">
      {lines.map((l, i) => {
        const kind = l.kind ?? 'center';
        const colour =
          kind === 'center' ? 'bg-studio-bright/90' : kind === 'edge' ? 'bg-studio-bright/55' : 'bg-studio-bright/40';
        const dashed = kind === 'spacing';
        return l.axis === 'x' ? (
          <span
            key={`${l.axis}-${l.pos}-${i}`}
            className={`absolute top-0 h-full w-px motion-safe:animate-fade-in ${dashed ? '' : colour}`}
            style={{
              left: `${l.pos * 100}%`,
              ...(dashed
                ? { backgroundImage: 'repeating-linear-gradient(to bottom, hsl(var(--studio-bright)/0.5) 0 4px, transparent 4px 8px)' }
                : {}),
            }}
          />
        ) : (
          <span
            key={`${l.axis}-${l.pos}-${i}`}
            className={`absolute left-0 h-px w-full motion-safe:animate-fade-in ${dashed ? '' : colour}`}
            style={{
              top: `${l.pos * 100}%`,
              ...(dashed
                ? { backgroundImage: 'repeating-linear-gradient(to right, hsl(var(--studio-bright)/0.5) 0 4px, transparent 4px 8px)' }
                : {}),
            }}
          />
        );
      })}
    </div>
  );
}
