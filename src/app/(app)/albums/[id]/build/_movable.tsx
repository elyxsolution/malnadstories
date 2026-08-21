'use client';

import { useRef, useState, type ReactNode, type PointerEvent as ReactPointerEvent } from 'react';
import { useLongPress } from './_use-long-press';
import { createPortal } from 'react-dom';
import type { Rect } from '@/lib/builder/model';
import { clampRect, isFullyOffPage, type Bounds } from '@/lib/builder/edit-bounds';

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

/**
 * SNAP THRESHOLD, IN PIXELS — not in fractions of the page.
 *
 * It used to be `0.012` of the box on BOTH axes, which quietly made snapping behave differently
 * in every direction and at every zoom: on a 1200 × 500 spread that is 14px horizontally and 6px
 * vertically, and both grow as the user zooms in — exactly when they are trying to place
 * something precisely. Corners were the worst case, because two over-eager axes agree to pin the
 * element to one intersection and fine positioning near an edge becomes impossible.
 *
 * A fixed pixel radius is what every desktop editor uses: the pull feels the same everywhere on
 * the page, the same at 50% zoom and at 200%, and small enough that ordinary dragging is free.
 */
const SNAP_PX = 6;
/**
 * Structural targets, per surface. On an open PAIR the meaningful vertical lines are the two page
 * centres (0.25 / 0.75) and the fold between them (0.5). A single page — the cover — has exactly
 * one centre, and offering it 0.25/0.75 as "page centres" drawn in the strongest guide style was
 * simply untrue: they are quarter marks on that surface, and a guide that misnames itself is
 * worse than no guide.
 */
const CENTER_X: Record<1 | 2, number[]> = { 1: [0.5], 2: [0.25, 0.5, 0.75] };
const CENTER_Y = [0.5];
const EDGE_X = [0.05, 0.95];
const EDGE_Y = [0.06, 0.94];

type Candidate = { pos: number; kind: 'center' | 'edge' | 'spacing' };

/**
 * Snap `centre` to the nearest candidate within `threshold` (a fraction of the box on this axis,
 * derived per gesture from `SNAP_PX` and the live container size).
 *
 * Candidates are tried in the order given, so structural guides (page centres) win ties against
 * peer edges — being centred on the page is almost always the intent when both are within a
 * pixel of each other.
 */
function snapAxis(
  centre: number,
  half: number,
  candidates: Candidate[],
  threshold: number,
): { value: number; line: Candidate | null } {
  let best: Candidate | null = null;
  let bestDist = threshold;
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
 * `structural` is false once the element's centre has left the page on this axis. Page centres
 * and safe margins describe the PRINTED page, so an element being deliberately pushed onto the
 * pasteboard has no business being tugged back onto a margin it is no longer near — that pull is
 * the second half of "the page reclaims the object". Peer alignment survives, because lining two
 * off-page elements up with each other is still meaningful.
 */
/**
 * The structural candidates are CONSTANT — four fixed lists (two axes × two page spans) — so they
 * are built once at module load rather than allocated twice per `pointermove`. A drag fires this
 * path ~60 times a second; rebuilding half a dozen literals each time is the cheapest kind of
 * waste to remove, and it leaves the per-move allocation proportional to peers alone.
 */
const STRUCTURAL: Record<'x' | 'y', Record<1 | 2, Candidate[]>> = {
  x: {
    1: [...CENTER_X[1].map((pos) => ({ pos, kind: 'center' as const })), ...EDGE_X.map((pos) => ({ pos, kind: 'edge' as const }))],
    2: [...CENTER_X[2].map((pos) => ({ pos, kind: 'center' as const })), ...EDGE_X.map((pos) => ({ pos, kind: 'edge' as const }))],
  },
  y: {
    1: [...CENTER_Y.map((pos) => ({ pos, kind: 'center' as const })), ...EDGE_Y.map((pos) => ({ pos, kind: 'edge' as const }))],
    2: [...CENTER_Y.map((pos) => ({ pos, kind: 'center' as const })), ...EDGE_Y.map((pos) => ({ pos, kind: 'edge' as const }))],
  },
};

const NO_CANDIDATES: Candidate[] = [];

function candidatesFor(axis: 'x' | 'y', peers: PeerRect[], structural: boolean, span: 1 | 2): Candidate[] {
  const base = structural ? STRUCTURAL[axis][span] : NO_CANDIDATES;
  if (peers.length === 0) return base;

  const peerCentres: Candidate[] = peers.map((p) =>
    axis === 'x' ? { pos: p.x + p.w / 2, kind: 'edge' as const } : { pos: p.y + p.h / 2, kind: 'edge' as const },
  );
  // Equal spacing: the midpoint between each adjacent pair of peer centres.
  const sorted = peerCentres.map((c) => c.pos).sort((a, b) => a - b);
  const spacing: Candidate[] = [];
  for (let i = 0; i < sorted.length - 1; i += 1) {
    spacing.push({ pos: (sorted[i] + sorted[i + 1]) / 2, kind: 'spacing' });
  }
  return [...base, ...peerCentres, ...spacing];
}

/**
 * THE EIGHT RESIZE HANDLES.
 *
 * Pass 2 replaces the single south-east dot with the full set every desktop editor has, because
 * one corner handle silently forces a workflow: to change an element's top edge you had to move
 * it, resize it, and move it back. Each handle records which edges it owns, and the resize maths
 * derives everything from that — so there is one implementation, not eight.
 *
 * `cursor` is part of the definition rather than a lookup, because the cursor IS the affordance:
 * it is the only thing that tells you a 12px dot resizes diagonally before you commit to a drag.
 */
type HandleDef = {
  id: string;
  /** Which edges this handle moves. */
  x: -1 | 0 | 1;
  y: -1 | 0 | 1;
  cursor: string;
  /** Position on the box, as CSS. */
  pos: string;
  label: string;
};

const HANDLES: HandleDef[] = [
  { id: 'nw', x: -1, y: -1, cursor: 'nwse-resize', pos: '-left-1.5 -top-1.5', label: 'Resize from top left' },
  { id: 'n', x: 0, y: -1, cursor: 'ns-resize', pos: 'left-1/2 -top-1.5 -translate-x-1/2', label: 'Resize from top' },
  { id: 'ne', x: 1, y: -1, cursor: 'nesw-resize', pos: '-right-1.5 -top-1.5', label: 'Resize from top right' },
  { id: 'e', x: 1, y: 0, cursor: 'ew-resize', pos: '-right-1.5 top-1/2 -translate-y-1/2', label: 'Resize from right' },
  { id: 'se', x: 1, y: 1, cursor: 'nwse-resize', pos: '-bottom-1.5 -right-1.5', label: 'Resize from bottom right' },
  { id: 's', x: 0, y: 1, cursor: 'ns-resize', pos: 'left-1/2 -bottom-1.5 -translate-x-1/2', label: 'Resize from bottom' },
  { id: 'sw', x: -1, y: 1, cursor: 'nesw-resize', pos: '-bottom-1.5 -left-1.5', label: 'Resize from bottom left' },
  { id: 'w', x: -1, y: 0, cursor: 'ew-resize', pos: '-left-1.5 top-1/2 -translate-y-1/2', label: 'Resize from left' },
];

/**
 * THE EDITING LAYER'S TRAVEL RULES.
 *
 * `edit` is how far a gesture may go — out onto the pasteboard, past the trim edge. `commit` is
 * where the element may LAND. Hosts pass `PASTEBOARD_ESCAPE`, in which the two are the SAME box:
 * a gesture can only reach places the element may stay, so releasing never moves anything.
 * `commit` is still applied on release as a defensive backstop (a host could legitimately pass a
 * wider `edit`), it simply has nothing left to correct.
 *
 * Omit `escape` entirely and the component keeps its original behaviour — the element stays
 * fully inside the page — which is what a host that has not opted in gets.
 */
export type EscapeBounds = { edit: Bounds; commit: Bounds };

/**
 * Modifier state at the moment of selection. `meta` toggles set membership, `shift` extends a
 * range, and `alt` asks for the object BENEATH the one that was hit — the standard escape hatch
 * for reaching something covered, without disturbing the stack.
 */
export type SelectMods = { meta: boolean; shift: boolean; alt: boolean };

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
  escape,
  chromeContainer,
  containerRef,
  onSelect,
  onContextMenu,
  onChange,
  onCommit,
  onRotate,
  onSnap,
  peers = [],
  pageSpan = 2,
  onDoubleClick,
  onLongPress,
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
  /** Opt in to editing outside the page. Absent = the element stays fully inside it. */
  escape?: EscapeBounds;
  /**
   * WHERE THE SELECTION CHROME IS DRAWN — the other half of "separate editing from rendering".
   *
   * The host clips its element layer to the trim box, so an element that hangs off the page is
   * cut exactly where the paper ends (what prints is what you see). That clip would take the
   * outline and the resize handles with it, leaving an off-page element impossible to grab. So
   * the chrome is portalled OUT of the clipped layer into this unclipped one, which the host
   * overlays on the same page box. Same geometry, same percentages — only the clipping differs.
   *
   * Absent → chrome renders inline, exactly as before (used by hosts with no clip layer).
   */
  chromeContainer?: HTMLElement | null;
  containerRef: React.RefObject<HTMLElement>;
  /**
   * Receives modifier state so the selection store — not this component — decides semantics.
   * `alt` is carried alongside meta/shift so the host can implement "select the object beneath
   * this one" without Movable knowing anything about stacks.
   */
  onSelect: (mods?: SelectMods) => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  onChange: (rect: Rect) => void;
  onCommit?: () => void;
  onRotate?: (deg: number) => void;
  onSnap?: (lines: SnapLine[]) => void;
  /** Sibling boxes on the same page — enables edge + equal-spacing guides. Empty is fine. */
  peers?: PeerRect[];
  /**
   * How many printed pages the container spans: 2 for an open spread (default), 1 for a single
   * page such as a cover side. It only selects which structural guides are true for the surface.
   */
  pageSpan?: 1 | 2;
  onDoubleClick?: () => void;
  /**
   * PRESS AND HOLD — a second door into whatever the host considers this element's primary
   * adjustment. On a photo overlay that is image-adjustment mode, the same state the Crop button
   * opens; this component does not know or care which, it only recognises the gesture.
   *
   * It lives here rather than in the host because a move gesture and a long press are the SAME
   * pointer-down, and only the thing that owns the drag can tell them apart: the press has to be
   * abandoned the moment the pointer travels far enough to be a drag, and the drag has to be
   * abandoned the moment the press wins. Two components watching one pointer would fight.
   *
   * Absent → no timer is ever started and behaviour is byte-for-byte what it was.
   */
  onLongPress?: () => void;
  className?: string;
  zIndex?: number;
  ariaLabel?: string;
  children: ReactNode;
  controls?: ReactNode;
}) {
  const drag = useRef<{
    mode: 'move' | 'resize' | 'rotate';
    sx: number;
    sy: number;
    start: Rect;
    cx: number;
    cy: number;
    /** Which edges a resize is moving. Unused for move/rotate. */
    ex: -1 | 0 | 1;
    ey: -1 | 0 | 1;
  } | null>(null);
  /** True while a gesture is in flight — suppresses hover chrome so the drag reads cleanly. */
  const [dragging, setDragging] = useState(false);

  /**
   * PRESS AND HOLD. The recognition lives in `useLongPress` so a photo behaves identically
   * whichever kind of frame holds it; what stays here is the part only this component can do —
   * deciding, on one pointer, whether the gesture became a drag or a hold.
   */
  const press = useLongPress(onLongPress);

  /**
   * The pointer is asking for a position the element is not allowed to occupy, and the drag is
   * being held against that limit. Nothing jumps — the element simply stops — but a wall you
   * cannot see reads as a stuck interface, so the outline says "this is the boundary" for as long
   * as you push on it. It replaces the old `willSettle` warning, which existed to pre-announce a
   * snap-back that can no longer happen.
   */
  const [atLimit, setAtLimit] = useState(false);

  /**
   * No part of this element is over the page, so the clipped element layer draws nothing for it.
   * Its chrome becomes its only handle — see `chromeContainer`.
   */
  const fullyOffPage = !!escape && isFullyOffPage(rect);

  const begin = (mode: 'move' | 'resize' | 'rotate', edges: { x: -1 | 0 | 1; y: -1 | 0 | 1 } = { x: 1, y: 1 }) => (
    e: ReactPointerEvent,
  ) => {
    if (locked) return;
    e.stopPropagation();
    /**
     * SELECTION HAPPENS EXACTLY ONCE PER GESTURE, HERE.
     *
     * It used to fire on pointer-down AND again on the click that followed. That was harmless when
     * selecting was idempotent, but it is not once a repeated click CYCLES through overlapping
     * elements — two fires per click would skip every other object in the stack. Pointer-down is
     * also the moment the user expects the selection to change: it is already when the drag starts.
     */
    onSelect({ meta: e.metaKey || e.ctrlKey, shift: e.shiftKey, alt: e.altKey });
    const box = containerRef.current?.getBoundingClientRect();
    drag.current = {
      mode,
      sx: e.clientX,
      sy: e.clientY,
      start: rect,
      cx: box ? box.left + (rect.x + rect.w / 2) * box.width : 0,
      cy: box ? box.top + (rect.y + rect.h / 2) * box.height : 0,
      ex: edges.x,
      ey: edges.y,
    };
    setDragging(true);
    const target = e.target as HTMLElement;
    target.setPointerCapture(e.pointerId);

    /**
     * ARM THE PRESS — moves only, and only when the host wants one. A resize or rotate handle is
     * already an unambiguous intent, so holding one must not turn into something else.
     */
    if (mode === 'move') {
      const pointerId = e.pointerId;
      press.arm(e, () => {
        /**
         * THE DRAG IS ABANDONED, NOT COMPLETED. The pointer is still down when the press wins, so
         * without this the next twitch would move the element behind the surface that just
         * opened. Capture is released for the same reason: whatever the host mounts needs it.
         */
        drag.current = null;
        setDragging(false);
        flagLimit(false);
        onSnap?.([]);
        try {
          target.releasePointerCapture(pointerId);
        } catch {
          /* the pointer is already gone — nothing to release */
        }
      });
    }
  };

  /**
   * The travel box for the CURRENT gesture. Without `escape` this reproduces the original rule
   * exactly — the element's far edge may not pass the page's — so opting out changes nothing.
   */
  const travel = (r: Rect) => ({
    minX: escape ? escape.edit.minX : 0,
    maxX: escape ? escape.edit.maxX : 1 - r.w,
    minY: escape ? escape.edit.minY : 0,
    maxY: escape ? escape.edit.maxY : 1 - r.h,
  });

  const flagLimit = (v: boolean) => setAtLimit((prev) => (prev === v ? prev : v));

  const onMove = (e: ReactPointerEvent) => {
    // TRAVEL, NOT TIME: past a few pixels this is a drag, so the pending press is abandoned.
    // Checked before the drag guard below, so it also applies to a gesture that has already ended.
    press.track(e);

    const d = drag.current;
    const box = containerRef.current?.getBoundingClientRect();
    if (!d || !box || box.width === 0 || box.height === 0) return;
    const dx = (e.clientX - d.sx) / box.width;
    const dy = (e.clientY - d.sy) / box.height;
    const t = travel(d.start);

    if (d.mode === 'move') {
      const wantX = d.start.x + dx;
      const wantY = d.start.y + dy;
      let nx = clamp(wantX, t.minX, t.maxX);
      let ny = clamp(wantY, t.minY, t.maxY);
      // Held against a boundary — say so, don't just stop dead. Tolerance is a hair over a
      // device pixel so ordinary rounding never lights the warning up.
      const eps = 1 / Math.max(box.width, box.height);
      flagLimit(Math.abs(wantX - nx) > eps || Math.abs(wantY - ny) > eps);

      const lines: SnapLine[] = [];
      /**
       * ALT SUSPENDS SNAPPING for as long as it is held — the escape hatch every layout tool
       * has, and the honest answer to "I want it EXACTLY here". Read live from the event rather
       * than captured at pointer-down, so it can be pressed and released mid-drag.
       */
      if (!e.altKey) {
        const cx = nx + d.start.w / 2;
        const cy = ny + d.start.h / 2;
        // Pixel radius → fraction, per axis, from the live box: identical pull in both
        // directions and at every zoom level.
        const thX = SNAP_PX / box.width;
        const thY = SNAP_PX / box.height;
        const sx = snapAxis(cx, d.start.w / 2, candidatesFor('x', peers, cx >= 0 && cx <= 1, pageSpan), thX);
        const sy = snapAxis(cy, d.start.h / 2, candidatesFor('y', peers, cy >= 0 && cy <= 1, pageSpan), thY);
        if (sx.line !== null) {
          nx = clamp(sx.value, t.minX, t.maxX);
          lines.push({ axis: 'x', pos: sx.line.pos, kind: sx.line.kind });
        }
        if (sy.line !== null) {
          ny = clamp(sy.value, t.minY, t.maxY);
          lines.push({ axis: 'y', pos: sy.line.pos, kind: sy.line.kind });
        }
      }
      onSnap?.(lines);
      onChange({ ...d.start, x: nx, y: ny });
    } else if (d.mode === 'resize') {
      /**
       * ONE resize implementation for all eight handles. A handle contributes to an axis only
       * when it owns an edge on it (`ex`/`ey` ≠ 0), and a NEGATIVE edge moves the origin as well
       * as the size — which is what makes dragging the top-left corner grow the box upward
       * instead of downward. `minW`/`minH` are enforced against the far edge so a box can never
       * invert through itself.
       */
      let { x, y, w, h } = d.start;
      // Growing outward is capped by the far edge of the page when the element is confined, and
      // by the stored maximum (w/h ≤ 1) once it is allowed to bleed off it.
      const maxW = escape ? 1 : 1 - d.start.x;
      const maxH = escape ? 1 : 1 - d.start.y;

      if (d.ex === 1) {
        w = clamp(d.start.w + dx, minW, maxW);
      } else if (d.ex === -1) {
        const right = d.start.x + d.start.w;
        x = clamp(d.start.x + dx, t.minX, right - minW);
        w = Math.min(right - x, 1);
      }

      if (keepSquare) {
        // Square elements (QR) derive height from width, so the vertical edges are ignored.
        h = clamp(w * squareRatio, minH, 1);
        if (d.ey === -1) y = clamp(d.start.y + d.start.h - h, t.minY, escape ? t.maxY : 1 - h);
        else y = clamp(y, t.minY, escape ? t.maxY : 1 - h);
      } else if (d.ey === 1) {
        h = clamp(d.start.h + dy, minH, maxH);
      } else if (d.ey === -1) {
        const bottom = d.start.y + d.start.h;
        y = clamp(d.start.y + dy, t.minY, bottom - minH);
        h = Math.min(bottom - y, 1);
      }

      onChange({ x, y, w, h });
    } else if (d.mode === 'rotate' && onRotate) {
      const angle = (Math.atan2(e.clientY - d.cy, e.clientX - d.cx) * 180) / Math.PI + 90;
      const snapped = Math.abs(((angle % 90) + 90) % 90) < 4 || Math.abs((((angle % 90) + 90) % 90) - 90) < 4
        ? Math.round(angle / 90) * 90
        : Math.round(angle);
      onRotate(clamp(snapped, -180, 180));
    }
  };

  const end = (e: ReactPointerEvent) => {
    press.cancel();
    if (!drag.current) return;
    drag.current = null;
    setDragging(false);
    flagLimit(false);
    onSnap?.([]);
    // A cancelled pointer (browser gesture, tab switch, the node re-keyed mid-drag) can already
    // have lost capture; releasing it then throws and would strand `onCommit`.
    try {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* the pointer is gone — nothing to release */
    }
    /**
     * BACKSTOP, NOT A SETTLE. The gesture travelled inside the commit box (see `edit-bounds`), so
     * this clamp finds nothing to correct and the element does not move on release — which is the
     * whole point: an object stays exactly where it was put. It is kept because a host is free to
     * pass a wider `edit` box, and because a rect that arrived from somewhere other than a drag
     * should still be brought inside the persisted contract before it is saved.
     */
    if (escape) {
      const settled = clampRect(rect, escape.commit);
      if (settled !== rect) onChange(settled);
    }
    onCommit?.();
    maybeDoubleTap(e);
  };

  /**
   * R5 — reach `onDoubleClick` from a finger.
   *
   * The native `dblclick` this component already listens for only survives when both clicks land
   * on the SAME node: the first click selects the element, React re-renders the Movable, and the
   * pairing is lost if the second click arrives after that. Measured: an atomic `clickCount: 2`
   * opens the editor, two clicks 220ms apart do not — on DESKTOP as well as on touch. A mouse
   * double-click is fast enough to win that race in practice; two taps with a thumb never are, so
   * text editing was unreachable on touch.
   *
   * This pairs two touch taps on the same element and calls the SAME `onDoubleClick` callback —
   * no new action, no new workflow, nothing added to the UI. It is gated on
   * `pointerType === 'touch'`, so a mouse never enters this path and desktop behaviour, including
   * the existing native `dblclick`, is untouched.
   */
  const lastTap = useRef(0);
  const maybeDoubleTap = (e: ReactPointerEvent) => {
    if (!onDoubleClick || e.pointerType !== 'touch') return;
    const now = e.timeStamp || Date.now();
    // 450ms is deliberately more generous than the mouse interval: a thumb is slower than a
    // finger on a button, and the first tap has a re-render to pay for.
    if (now - lastTap.current < 450) {
      lastTap.current = 0;
      onDoubleClick();
      return;
    }
    lastTap.current = now;
  };

  /** The element's box geometry — shared verbatim by the element and its selection chrome. */
  const geometry: React.CSSProperties = {
    left: `${rect.x * 100}%`,
    top: `${rect.y * 100}%`,
    width: `${rect.w * 100}%`,
    height: `${rect.h * 100}%`,
    transform: rotation ? `rotate(${rotation}deg)` : undefined,
  };

  /*
    THE SELECTION CHROME — a sibling overlay, not a child.

    It mirrors the element's box exactly but lives at the top of the page's stack, which is the
    piece that makes editing a COVERED element possible: the outline stays visible and the
    handles stay grabbable even when the element itself is buried under three others, and none
    of that requires moving the element forward. It is inert except for the handles, so the
    element underneath keeps its own double-click, context menu and drop-target behaviour.

    When the host supplies a `chromeContainer` it is also what makes an OFF-PAGE element usable:
    the element itself is clipped at the trim, but its outline and handles are drawn on the
    pasteboard, unclipped, so it can always be seen and dragged back.
  */
  const chrome =
    !locked && (selected || fullyOffPage) ? (
      <div
        /**
         * R5 — `bj-chrome` makes this a size container so the handle hit-area rule in globals.css
         * can ask how big the element actually is. R4 grew every handle's touch target to 36px,
         * which is right for a photo (measured 97×158) and wrong for a text block (measured
         * 151×30): the bottom handle's 36px box then covered the element's centre and swallowed
         * the taps meant for the text. The rule now only expands when the element can spare the
         * room. Nothing about the painted chrome changes.
         */
        className="bj-chrome pointer-events-none absolute z-[40]"
        style={{
          ...geometry,
          ...(selected
            ? {
                outline: atLimit ? '2px dashed hsl(var(--warning))' : '2px solid hsl(var(--studio-bright))',
                outlineOffset: '1px',
                // The selected halo softens while dragging so the element itself stays the subject.
                boxShadow: `0 0 0 ${dragging ? 2 : 4}px hsl(var(--studio-bright) / ${dragging ? 0.1 : 0.18})`,
              }
            : null),
          borderRadius: '2px',
        }}
      >
        {/*
          THE OFF-PAGE GHOST. Once nothing of the element overlaps the paper it draws nothing at
          all, so this stands in for it: a quiet dashed box on the pasteboard that carries the
          SAME `begin('move')` gesture as the element itself — one movement implementation, two
          surfaces. Without it, pushing something fully off the page would lose it for good.
        */}
        {fullyOffPage && (
          <span
            role="presentation"
            aria-label={`${ariaLabel ?? 'Element'}, outside the page`}
            title="Outside the page — this will not print"
            onPointerDown={begin('move')}
            onPointerMove={onMove}
            onPointerUp={end}
            onPointerCancel={end}
            className={`pointer-events-auto absolute inset-0 rounded-[2px] border border-dashed bg-studio/[0.07] ${
              dragging ? 'cursor-grabbing' : 'cursor-grab'
            } ${selected ? 'border-transparent' : 'border-studio-bright/70'}`}
          />
        )}

        {selected && (
          <>
            {/* Legacy inline control bar. The page canvas now uses the floating context bar and
                passes no `controls`; the cover canvas still supplies its own, unchanged. */}
            {controls && (
              <div
                onPointerDown={(e) => e.stopPropagation()}
                className="motion-safe:animate-scale-in pointer-events-auto absolute -top-9 left-1/2 flex -translate-x-1/2 items-center gap-0.5 rounded-lg border border-border bg-card/95 p-0.5 shadow-elevated backdrop-blur-sm"
              >
                {controls}
              </div>
            )}

            {/* EIGHT HANDLES. Corners are dots, edges are short bars — the shape tells you which
                axes it will move before the cursor does. Squares (QR) expose corners only, since
                their height is derived and an edge handle would be a lie. */}
            {HANDLES.filter((hd) => !keepSquare || (hd.x !== 0 && hd.y !== 0)).map((hd) => {
              const isCorner = hd.x !== 0 && hd.y !== 0;
              return (
                <span
                  key={hd.id}
                  role="presentation"
                  aria-label={hd.label}
                  /**
                   * R4 — touch. These are 12×12 dots and 20×8 bars: correct for a cursor,
                   * unhittable with a thumb. `data-mv-handle` opts them into the coarse-pointer
                   * hit-area rule in globals.css, which grows the TOUCHABLE region only and
                   * leaves the painted dot exactly as it is. `touch-none` is the other half:
                   * `touch-action` does not inherit, so although the movable wrapper already
                   * sets it, a drag starting ON a handle was still being claimed by the
                   * browser's scroll gesture.
                   */
                  data-mv-handle=""
                  onPointerDown={begin('resize', { x: hd.x, y: hd.y })}
                  onPointerMove={onMove}
                  onPointerUp={end}
                  onPointerCancel={end}
                  style={{ cursor: hd.cursor }}
                  className={`pointer-events-auto absolute touch-none border-2 border-card bg-studio shadow-sm motion-safe:transition-transform motion-safe:duration-100 motion-safe:hover:scale-125 ${hd.pos} ${
                    isCorner
                      ? 'h-3 w-3 rounded-full'
                      : hd.x === 0
                        ? 'h-2 w-5 rounded-full'
                        : 'h-5 w-2 rounded-full'
                  }`}
                />
              );
            })}

            {/* Rotate handle, on a visible stem so it doesn't read as a ninth resize dot. */}
            {rotatable && onRotate && (
              <>
                <span aria-hidden className="absolute -top-4 left-1/2 h-4 w-px -translate-x-1/2 bg-studio/50" />
                <span
                  role="presentation"
                  aria-label="Rotate"
                  /* Same treatment as the resize handles: 14×14 painted, thumb-sized to touch. */
                  data-mv-handle=""
                  onPointerDown={begin('rotate')}
                  onPointerMove={onMove}
                  onPointerUp={end}
                  onPointerCancel={end}
                  className="pointer-events-auto absolute -top-1.5 left-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-4 cursor-grab touch-none rounded-full border-2 border-card bg-studio shadow-sm motion-safe:transition-transform motion-safe:duration-100 motion-safe:hover:scale-125 active:cursor-grabbing"
                />
              </>
            )}
          </>
        )}
      </div>
    ) : null;

  return (
    <>
      <div
        role="button"
        tabIndex={-1}
        aria-label={ariaLabel}
        aria-pressed={selected}
        onPointerDown={begin('move')}
        onPointerMove={onMove}
        onPointerUp={end}
        onPointerCancel={end}
        onContextMenu={(ev) => {
          // A long press has already acted. Some browsers synthesise `contextmenu` from the same
          // hold, which would open the menu on top of the adjustment surface it just opened.
          if (press.consumeFired()) {
            ev.preventDefault();
            return;
          }
          onContextMenu?.(ev);
        }}
        onDoubleClick={onDoubleClick}
        /* Selection already happened on pointer-down; this only stops the canvas from treating
           the same gesture as a click on empty space and deselecting. */
        onClick={(e) => e.stopPropagation()}
        /**
         * CURSORS ARE THE AFFORDANCE. `grab` when it can be picked up, `grabbing` while it is being
         * dragged, `default` when locked — so the pointer answers "can I move this?" before any
         * commitment. `touch-none` keeps a drag from being stolen by page scrolling on a trackpad
         * or touchscreen.
         */
        className={`group/movable absolute touch-none ${
          locked ? 'cursor-default' : dragging ? 'cursor-grabbing' : 'cursor-grab'
        } ${className}`}
        style={{
          ...geometry,
          /**
           * SELECTION NEVER TOUCHES STACKING ORDER.
           *
           * This used to be `selected ? 50 : zIndex`, which meant clicking an element silently
           * promoted it above everything it was behind — an invisible edit to the layer order that
           * the user never asked for and could not undo. Layer order now changes ONLY through the
           * Layers menu (`commands.moveLayer`). The element keeps its natural position in the
           * stack whether or not it is selected; its chrome is what rises, below.
           */
          zIndex,
          borderRadius: '2px',
        }}
      >
        {/* HOVER AFFORDANCE. An unselected element gets a hairline outline on hover — enough to say
            "this is a thing you can grab", quiet enough to disappear against the page. */}
        {!selected && !locked && (
          <span
            aria-hidden
            className="pointer-events-none absolute -inset-px rounded-[2px] opacity-0 ring-1 ring-inset ring-studio-bright/60 transition-opacity duration-150 group-hover/movable:opacity-100"
          />
        )}

        {children}
      </div>

      {/* Chrome goes to the host's unclipped layer when it has one, otherwise stays inline. */}
      {chromeContainer ? createPortal(chrome, chromeContainer) : chrome}
    </>
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
