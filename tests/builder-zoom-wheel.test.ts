/**
 * CTRL + WHEEL ZOOMS THE BOOK — and only over the book.
 *
 * The hook under test is a DOM binding, and this suite runs in `node` with no DOM. So the listener
 * is driven directly: a minimal element stub records what was attached and with which options, and
 * synthetic wheel events are dispatched through it. That exercises the real decisions — is the
 * modifier held, is the default prevented, which direction, is the listener non-passive — without
 * pretending to be a browser.
 *
 * What it cannot do is prove the browser honours `preventDefault` on a non-passive wheel listener.
 * That is specified behaviour, and the assertion here is that the code asks for it correctly:
 * `{ passive: false }` at registration, `preventDefault()` only when the modifier is held.
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ── a listener target that records what a hook binds to it ─────────────────────────────────
type Listener = (e: WheelEvent) => void;

function makeElement() {
  const bound: { type: string; fn: Listener; opts: AddEventListenerOptions | undefined }[] = [];
  const el = {
    addEventListener: (type: string, fn: Listener, opts?: AddEventListenerOptions) => {
      bound.push({ type, fn, opts });
    },
    removeEventListener: (type: string, fn: Listener) => {
      const i = bound.findIndex((b) => b.type === type && b.fn === fn);
      if (i >= 0) bound.splice(i, 1);
    },
  };
  return { el: el as unknown as HTMLElement, bound };
}

function wheelEvent(over: Partial<WheelEvent> = {}) {
  return {
    ctrlKey: false,
    metaKey: false,
    deltaY: 0,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    ...over,
  } as unknown as WheelEvent & { preventDefault: ReturnType<typeof vi.fn>; stopPropagation: ReturnType<typeof vi.fn> };
}

/**
 * The hook's effect body, extracted so it can run without React. It is the SAME logic — the file
 * is read below and asserted to contain each decision, so this stub cannot drift silently.
 */
function bindZoomWheel(el: HTMLElement, onZoom: (direction: 1 | -1) => void) {
  const onWheel = (e: WheelEvent) => {
    if (!e.ctrlKey && !e.metaKey) return;
    if (e.deltaY === 0) return;
    e.preventDefault();
    onZoom(e.deltaY < 0 ? 1 : -1);
  };
  el.addEventListener('wheel', onWheel as EventListener, { passive: false });
  return () => el.removeEventListener('wheel', onWheel as EventListener);
}

const fire = (bound: ReturnType<typeof makeElement>['bound'], e: WheelEvent) => {
  for (const b of bound) if (b.type === 'wheel') b.fn(e);
};

describe('ctrl + wheel over the book', () => {
  it('zooms IN on a scroll up and prevents the browser default', () => {
    const { el, bound } = makeElement();
    const onZoom = vi.fn();
    bindZoomWheel(el, onZoom);
    const e = wheelEvent({ ctrlKey: true, deltaY: -120 });
    fire(bound, e);
    expect(onZoom).toHaveBeenCalledWith(1);
    expect(e.preventDefault).toHaveBeenCalledOnce();
  });

  it('zooms OUT on a scroll down', () => {
    const { el, bound } = makeElement();
    const onZoom = vi.fn();
    bindZoomWheel(el, onZoom);
    const e = wheelEvent({ ctrlKey: true, deltaY: 120 });
    fire(bound, e);
    expect(onZoom).toHaveBeenCalledWith(-1);
    expect(e.preventDefault).toHaveBeenCalledOnce();
  });

  it('treats the Mac meta key the same way', () => {
    const { el, bound } = makeElement();
    const onZoom = vi.fn();
    bindZoomWheel(el, onZoom);
    fire(bound, wheelEvent({ metaKey: true, deltaY: -1 }));
    expect(onZoom).toHaveBeenCalledWith(1);
  });

  it('registers NON-PASSIVELY, or preventDefault would be ignored', () => {
    // React registers wheel passively at its root — the entire reason this is a native listener.
    const { el, bound } = makeElement();
    bindZoomWheel(el, () => {});
    expect(bound[0].opts).toEqual({ passive: false });
  });

  it('detaches on cleanup, so a remount cannot double-zoom', () => {
    const { el, bound } = makeElement();
    const stop = bindZoomWheel(el, () => {});
    expect(bound).toHaveLength(1);
    stop();
    expect(bound).toHaveLength(0);
  });
});

describe('ordinary scrolling is untouched', () => {
  it('a wheel with no modifier is not prevented and does not zoom', () => {
    const { el, bound } = makeElement();
    const onZoom = vi.fn();
    bindZoomWheel(el, onZoom);
    const e = wheelEvent({ deltaY: 240 });
    fire(bound, e);
    expect(onZoom).not.toHaveBeenCalled();
    expect(e.preventDefault).not.toHaveBeenCalled();
  });

  it('a horizontal-only gesture expresses no zoom direction, so it is left alone', () => {
    const { el, bound } = makeElement();
    const onZoom = vi.fn();
    bindZoomWheel(el, onZoom);
    const e = wheelEvent({ ctrlKey: true, deltaY: 0 });
    fire(bound, e);
    expect(onZoom).not.toHaveBeenCalled();
    expect(e.preventDefault).not.toHaveBeenCalled();
  });

  it('never stops propagation, so the deeper crop-wheel listener keeps priority', () => {
    const { el, bound } = makeElement();
    bindZoomWheel(el, () => {});
    const e = wheelEvent({ ctrlKey: true, deltaY: -1 });
    fire(bound, e);
    expect(e.stopPropagation).not.toHaveBeenCalled();
  });
});

// ===============================================================================================
// Scoping and bounds — asserted against the real source
// ===============================================================================================

const hook = readFileSync(resolve(__dirname, '../src/app/(app)/albums/[id]/build/_use-zoom-wheel.ts'), 'utf8');
const builder = readFileSync(resolve(__dirname, '../src/app/(app)/albums/[id]/build/_builder.tsx'), 'utf8');
const coverCanvas = readFileSync(resolve(__dirname, '../src/app/(app)/albums/[id]/build/_cover-canvas.tsx'), 'utf8');

describe('the interception is scoped to the canvas, not global', () => {
  it('binds to the element it is given — never to window or document', () => {
    expect(hook).toContain("node.addEventListener('wheel', onWheel, { passive: false })");
    expect(hook).not.toContain('window.addEventListener');
    expect(hook).not.toContain('document.addEventListener');
  });

  it('the hook body matches the logic exercised above', () => {
    expect(hook).toContain('if (!e.ctrlKey && !e.metaKey) return;');
    expect(hook).toContain('if (e.deltaY === 0) return;');
    expect(hook).toContain('e.preventDefault();');
    expect(hook).toContain('latest.current(e.deltaY < 0 ? 1 : -1);');
  });

  it('is attached to BOTH book surfaces — the spread canvas and the cover canvas', () => {
    expect(builder).toContain('zoomAreaRef(el)');
    expect(builder).toContain('onCanvasEl={zoomAreaRef}');
    expect(coverCanvas).toContain('onCanvasEl?.(el)');
  });

  it('is attached NOWHERE else — no other file binds it', () => {
    // Sidebars, toolbars, the page strip and every dialog keep the browser's own zoom.
    const uses = [builder, coverCanvas].filter((s) => s.includes('useCtrlWheelZoom')).length;
    expect(uses).toBe(1); // the builder constructs it; the cover canvas only receives the ref
    expect(coverCanvas).not.toContain('useCtrlWheelZoom');
  });
});

describe('it drives the EXISTING zoom, not a second one', () => {
  it('there is one zoom state and one stepping function', () => {
    expect(builder).toContain('const [zoomPct, setZoomPct] = useState(100)');
    expect(builder).toContain('const zoomBy = useCallback');
    expect(builder).toContain('useCtrlWheelZoom(zoomBy)');
  });

  it('the buttons and the wheel are inputs to the SAME function', () => {
    expect(builder).toContain('const zoomIn = useCallback(() => zoomBy(1)');
    expect(builder).toContain('const zoomOut = useCallback(() => zoomBy(-1)');
  });

  it('the bounds live in one place and the wheel inherits them', () => {
    expect(builder).toContain('const ZOOM_MIN_PCT = 50;');
    expect(builder).toContain('const ZOOM_MAX_PCT = 200;');
    expect(builder).toContain('const ZOOM_STEP_PCT = 15;');
    expect(builder).toContain('Math.max(ZOOM_MIN_PCT, Math.min(ZOOM_MAX_PCT, z + direction * ZOOM_STEP_PCT))');
  });

  it('the clamp holds at both ends, however many times it is stepped', () => {
    // The exact expression `zoomBy` applies.
    const step = (z: number, d: 1 | -1) => Math.max(50, Math.min(200, z + d * 15));
    let z = 100;
    for (let i = 0; i < 50; i++) z = step(z, 1);
    expect(z).toBe(200);
    for (let i = 0; i < 50; i++) z = step(z, -1);
    expect(z).toBe(50);
  });

  it('does not touch scroll position — the canvas cannot jump', () => {
    expect(hook).not.toContain('scrollLeft');
    expect(hook).not.toContain('scrollTop');
    expect(hook).not.toContain('scrollTo');
  });
});
