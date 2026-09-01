/**
 * ONE STACKING ORDER FOR EVERY OBJECT TYPE.
 *
 * ── WHAT WAS WRONG ─────────────────────────────────────────────────────────────────────────
 *
 * A surface keeps its objects in four arrays and every renderer painted them by mapping those
 * arrays IN A FIXED SEQUENCE — overlays, then texts, then QR codes, then stickers. Paint order was
 * therefore a property of an object's TYPE, so a sticker was always above a text which was always
 * above a photo. The Layers menu was real but could only reorder within one array: "Bring to
 * front" on a photo overlay brought it to the front of the overlays and left it under everything
 * else. Putting a sticker behind a photo was not a missing button — it was unrepresentable.
 *
 * ── WHAT THESE TESTS PIN ───────────────────────────────────────────────────────────────────
 *
 *   A. the legacy default, and that it still MATCHES THE RENDERERS (the compatibility guarantee
 *      is only worth anything if it is the truth);
 *   B. all four operations, across types, on a mixed stack;
 *   C. reconciliation — deleted objects drop out, new ones land on top, nothing is ever lost;
 *   D. persistence through serialize → Zod → hydrate, including "an untouched album stores
 *      nothing";
 *   E. the RENDERED result, on a content spread AND on a cover face — because a builder-only
 *      order that vanishes in the PDF is the failure mode this whole feature has to avoid.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  LEGACY_LAYER_ORDER,
  applyLayerAction,
  layerIndexOf,
  layerStack,
  layerZIndexes,
  trimLayerOrder,
  LAYER_CHROME_Z,
  type LayerSurface,
} from '@/lib/builder/layers';
import { SaveLayoutSchema, CoverConfigSchema } from '@/lib/validations';
import { DEFAULT_BACK_COVER, normalizeCoverConfig, DEFAULT_COVER_CONFIG } from '@/lib/builder/cover';
import { coverSideElements, withCoverSideElements } from '@/lib/builder/cover-objects';
import PairContent, { PrintGutter, type PairPhoto } from '@/app/(app)/albums/[id]/build/_pair-frame';
import { BackCoverDesign } from '@/app/(app)/albums/[id]/build/_cover-render';
import type { Block, QrElement, StickerElement, TextElement } from '@/lib/builder/model';

const ALBUM = '44444444-4444-4444-8444-444444444444';
const PHOTO = '11111111-1111-4111-8111-111111111111';

const ov = (id: string) => ({ id, photoId: PHOTO, x: 0.1, y: 0.1, w: 0.3, h: 0.3 });
const tx = (id: string): TextElement => ({
  id,
  text: 'Hello',
  x: 0.2,
  y: 0.2,
  w: 0.3,
  h: 0.1,
  variant: 'heading',
  font: 'serif',
  size: 40,
  weight: 600,
  italic: false,
  underline: false,
  align: 'center',
  color: '#ffffff',
  letterSpacing: 0,
  lineHeight: 1.1,
  opacity: 1,
  rotation: 0,
  shadow: false,
});
const qr = (id: string): QrElement => ({ id, data: 'x', x: 0.3, y: 0.3, w: 0.1, h: 0.1, fg: '#000000', bg: '#ffffff', padding: 0.1, radius: 0.1 });
const st = (id: string): StickerElement => ({
  id,
  stickerId: '99999999-9999-4999-8999-999999999999',
  x: 0.4,
  y: 0.4,
  w: 0.1,
  h: 0.1,
  rotation: 0,
  opacity: 1,
});

/** A surface with one of each — the mixture the requirement asks about. */
const mixed = (layerOrder?: string[]): LayerSurface => ({
  overlays: [ov('o1')],
  texts: [tx('t1')],
  qrs: [qr('q1')],
  stickers: [st('s1')],
  layerOrder,
});

const ids = (s: LayerSurface) => layerStack(s).map((o) => o.id);

// ===============================================================================================
// A. the legacy default IS the renderers' order
// ===============================================================================================

describe('A — the backwards-compatible default', () => {
  it('an absent order is the legacy family sequence, back to front', () => {
    expect(LEGACY_LAYER_ORDER).toEqual(['overlay', 'text', 'qr', 'sticker']);
    expect(ids(mixed())).toEqual(['o1', 't1', 'q1', 's1']);
  });

  /**
   * The compatibility promise is "an album with no stored order looks exactly as it did". That is
   * only true while `LEGACY_LAYER_ORDER` is what the renderers actually did, so it is checked
   * against the renderers themselves rather than restated.
   */
  it('and that sequence is still the order the two shared renderers declare', () => {
    const read = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');
    for (const file of [
      'src/app/(app)/albums/[id]/build/_pair-frame.tsx',
      'src/app/(app)/albums/[id]/build/_cover-render.tsx',
    ]) {
      const src = read(file);
      const at = (needle: string) => src.indexOf(needle);
      expect(at('<OverlayBox')).toBeLessThan(at('<TextBox'));
      expect(at('<TextBox')).toBeLessThan(at('<QrBox'));
      expect(at('<QrBox')).toBeLessThan(at('<StickerBox'));
    }
  });

  it('an empty stored order is treated as absent, not as "nothing on this page"', () => {
    expect(ids(mixed([]))).toEqual(['o1', 't1', 'q1', 's1']);
  });

  it('z-indexes start at 1, so the page background and base photos stay underneath', () => {
    const z = layerZIndexes(mixed());
    expect(Array.from(z.values()).sort((a, b) => a - b)).toEqual([1, 2, 3, 4]);
    expect(z.get('o1')).toBe(1);
    expect(z.get('s1')).toBe(4);
  });
});

// ===============================================================================================
// B. every operation, across types
// ===============================================================================================

describe('B — the four operations move an object past objects of OTHER types', () => {
  it('bring to front lifts a photo overlay above the text, QR and sticker', () => {
    const next = applyLayerAction(mixed(), 'o1', 'front');
    expect(next).toEqual(['t1', 'q1', 's1', 'o1']);
  });

  it('send to back drops a sticker beneath the photo', () => {
    expect(applyLayerAction(mixed(), 's1', 'back')).toEqual(['s1', 'o1', 't1', 'q1']);
  });

  it('bring forward moves ONE step, crossing a type boundary', () => {
    // o1 (overlay) steps over t1 (text) — impossible before, because they lived in different arrays.
    expect(applyLayerAction(mixed(), 'o1', 'forward')).toEqual(['t1', 'o1', 'q1', 's1']);
  });

  it('send backward moves ONE step, crossing a type boundary', () => {
    expect(applyLayerAction(mixed(), 's1', 'backward')).toEqual(['o1', 't1', 's1', 'q1']);
  });

  it('"move above" and "move below" target a named object of any type', () => {
    expect(applyLayerAction(mixed(), 's1', { below: 'o1' })).toEqual(['s1', 'o1', 't1', 'q1']);
    expect(applyLayerAction(mixed(), 'o1', { above: 'q1' })).toEqual(['t1', 'q1', 'o1', 's1']);
  });

  it('a no-op returns null rather than a pointless write', () => {
    expect(applyLayerAction(mixed(), 's1', 'front')).toBeNull();
    expect(applyLayerAction(mixed(), 'o1', 'back')).toBeNull();
    expect(applyLayerAction(mixed(), 'missing', 'front')).toBeNull();
  });

  it('operations compose — text below sticker below image, built one move at a time', () => {
    let order = applyLayerAction(mixed(), 'o1', 'front')!; // t1 q1 s1 o1
    order = applyLayerAction(mixed(order), 's1', 'back')!; // s1 t1 q1 o1
    order = applyLayerAction(mixed(order), 't1', 'back')!; // t1 s1 q1 o1
    expect(order).toEqual(['t1', 's1', 'q1', 'o1']);
    // Which reads, front to back: image · QR · sticker · text.
    expect(layerIndexOf(layerStack(mixed(order)), 'o1')).toBe(3);
  });
});

// ===============================================================================================
// C. reconciliation — the stack is derived from the arrays, so nothing can be lost
// ===============================================================================================

describe('C — a stored order is reconciled against the objects that exist', () => {
  it('ids naming a deleted object drop out', () => {
    const afterDelete: LayerSurface = { ...mixed(['s1', 'o1', 't1', 'q1']), texts: [] };
    expect(ids(afterDelete)).toEqual(['s1', 'o1', 'q1']);
  });

  it('an object the order does not name lands ON TOP — "add" puts it in front', () => {
    const withNewSticker: LayerSurface = {
      ...mixed(['s1', 'o1', 't1', 'q1']),
      stickers: [st('s1'), st('s2')],
    };
    expect(ids(withNewSticker)).toEqual(['s1', 'o1', 't1', 'q1', 's2']);
  });

  it('a duplicated id in the stored order cannot duplicate an object', () => {
    expect(ids(mixed(['o1', 'o1', 't1', 'q1', 's1']))).toEqual(['o1', 't1', 'q1', 's1']);
  });

  it('an id naming nothing at all is inert', () => {
    expect(ids(mixed(['ghost', 'o1', 't1', 'q1', 's1']))).toEqual(['o1', 't1', 'q1', 's1']);
  });

  it('EVERY object always appears, exactly once, whatever the order says', () => {
    for (const order of [undefined, [], ['ghost'], ['s1'], ['q1', 'o1'], ['s1', 'q1', 't1', 'o1']]) {
      expect(Array.from(ids(mixed(order))).sort()).toEqual(['o1', 'q1', 's1', 't1']);
    }
  });
});

// ===============================================================================================
// D. persistence
// ===============================================================================================

describe('D — the order survives save and reload, and costs nothing when unused', () => {
  it('an untouched surface stores NOTHING — existing albums are byte-identical', () => {
    expect(trimLayerOrder(mixed())).toBeUndefined();
    // Even when the stored order happens to equal the legacy one.
    expect(trimLayerOrder(mixed(['o1', 't1', 'q1', 's1']))).toBeUndefined();
  });

  it('a genuinely reordered surface stores the full stack', () => {
    expect(trimLayerOrder(mixed(['s1', 'o1', 't1', 'q1']))).toEqual(['s1', 'o1', 't1', 'q1']);
  });

  it('a stored order round-trips through the SAVE schema', () => {
    const parsed = SaveLayoutSchema.safeParse({
      albumId: ALBUM,
      blocks: [
        {
          template: 'single-pair',
          photoIds: [],
          overlays: [{ photoId: PHOTO, x: 0.1, y: 0.1, w: 0.3, h: 0.3 }],
          texts: [tx('t1')],
          stickers: [st('s1')],
          qrs: [qr('q1')],
          layerOrder: ['s1', 't1', 'q1', 'o1'],
        },
      ],
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.blocks[0].layerOrder).toEqual(['s1', 't1', 'q1', 'o1']);
  });

  it('a payload with no order still parses — every pre-existing album does', () => {
    const parsed = SaveLayoutSchema.safeParse({
      albumId: ALBUM,
      blocks: [{ template: 'single-pair', photoIds: [], overlays: [] }],
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.blocks[0].layerOrder).toBeUndefined();
  });

  it('an absurd order is refused, like every other unbounded payload', () => {
    const parsed = SaveLayoutSchema.safeParse({
      albumId: ALBUM,
      blocks: [
        { template: 'single-pair', photoIds: [], overlays: [], layerOrder: Array.from({ length: 500 }, (_, i) => `x${i}`) },
      ],
    });
    expect(parsed.success).toBe(false);
  });

  it('the COVER stores one order per face, and round-trips it', () => {
    const parsed = CoverConfigSchema.safeParse({
      layerOrder: ['t1'],
      texts: [tx('t1')],
      back: { overlays: [ov('o1')], stickers: [st('s1')], layerOrder: ['s1', 'o1'] },
      spine: { texts: [tx('sp1')], layerOrder: ['sp1'] },
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.layerOrder).toEqual(['t1']);
    expect(parsed.data.back.layerOrder).toEqual(['s1', 'o1']);
    expect(parsed.data.spine.layerOrder).toEqual(['sp1']);
  });

  it('normalizing a legacy cover leaves every face order absent, not broken', () => {
    const legacy = normalizeCoverConfig({ back: { stickers: [st('s1')] } } as Parameters<typeof normalizeCoverConfig>[0]);
    expect(legacy.layerOrder).toBeUndefined();
    expect(legacy.back.layerOrder).toBeUndefined();
    expect(legacy.spine.layerOrder).toBeUndefined();
    // And a garbage value is read as none rather than trusted.
    const junk = normalizeCoverConfig({ layerOrder: 'nope' } as unknown as Parameters<typeof normalizeCoverConfig>[0]);
    expect(junk.layerOrder).toBeUndefined();
  });

  it('the cover face accessor carries the order in both directions', () => {
    const c = { ...DEFAULT_COVER_CONFIG, back: { ...DEFAULT_BACK_COVER, stickers: [st('s1')], overlays: [ov('o1')] } };
    const written = withCoverSideElements(c, 'back', { layerOrder: ['s1', 'o1'] });
    expect(coverSideElements(written, 'back').layerOrder).toEqual(['s1', 'o1']);
    // Writing the order does not disturb the face's other properties.
    expect(written.back.stickers).toHaveLength(1);
    expect(written.back.overlays).toHaveLength(1);
    expect(written.back.showLogo).toBe(false);
  });
});

// ===============================================================================================
// E. what actually paints — the half that reaches a customer and a printer
// ===============================================================================================

describe('E — the rendered stack, on a page and on a cover', () => {
  const photoFor = (id: string | null | undefined): PairPhoto | undefined =>
    id === PHOTO ? { url: 'https://r2.example/one.jpg', edit: null } : undefined;

  const block = (layerOrder?: string[]): Block => ({
    key: 'b1',
    template: 'single-pair',
    photoIds: [],
    caption: '',
    overlays: [ov('o1')],
    texts: [tx('t1')],
    qrs: [],
    stickers: [st('s1')],
    background: null,
    layerOrder,
  });

  /** Each object's z-index, in the order the ids are given. */
  const zOf = (html: string) => Array.from(html.matchAll(/z-index:(\d+)/g)).map((m) => Number(m[1]));

  it('a page with no stored order paints overlay → text → sticker, as it always did', () => {
    const html = renderToStaticMarkup(
      <PairContent block={block()} photoFor={photoFor} stickerUrlFor={() => 'https://r2.example/s.png'} />,
    );
    expect(zOf(html)).toEqual([1, 2, 3]);
  });

  it('a page with a stored order paints IT — sticker beneath the photo, text on top', () => {
    const html = renderToStaticMarkup(
      <PairContent block={block(['s1', 'o1', 't1'])} photoFor={photoFor} stickerUrlFor={() => 'https://r2.example/s.png'} />,
    );
    // Document order is still overlay, text, sticker — only the z-indexes moved.
    expect(zOf(html)).toEqual([2, 3, 1]);
  });

  it('the object band is CONTAINED, so it cannot fight the surrounding chrome', () => {
    const html = renderToStaticMarkup(<PairContent block={block()} photoFor={photoFor} />);
    expect(html).toContain('isolation:isolate');
  });

  /**
   * Chrome drawn INSIDE an isolated layer has to clear the band. Page numbers, the guides, the
   * fold and the cover's face label used to sit at 2 / 6 / 7 / 8 and win by default, because
   * objects carried no z-index at all — a page with more than a handful of objects would now bury
   * them. Chrome drawn OUTSIDE the layer (handles, ghost, trim ring) needs nothing.
   */
  it('chrome inside the band clears its ceiling', () => {
    const read = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');
    // The ceiling is the sum of the element caps, and the constant must be clear of it.
    expect(LAYER_CHROME_Z).toBeGreaterThan(50 + 30 + 10 + 30);
    for (const file of [
      'src/app/(app)/albums/[id]/build/_block.tsx',
      'src/app/(app)/albums/[id]/build/_cover-canvas.tsx',
      'src/app/(app)/albums/[id]/build/_pair-frame.tsx',
      'src/app/(app)/albums/[id]/build/_print-guides.tsx',
    ]) {
      expect(read(file)).toContain('LAYER_CHROME_Z');
    }
    // And the fold really carries it, not a small literal.
    expect(renderToStaticMarkup(<PrintGutter />)).toContain(String(LAYER_CHROME_Z));
  });

  it('a COVER FACE paints its own stored order the same way', () => {
    const back = {
      ...DEFAULT_BACK_COVER,
      overlays: [ov('o1')],
      texts: [tx('t1')],
      stickers: [st('s1')],
      layerOrder: ['t1', 's1', 'o1'],
    };
    const html = renderToStaticMarkup(
      <BackCoverDesign back={back} imageUrl={null} photoFor={photoFor} stickerUrlFor={() => 'https://r2.example/s.png'} />,
    );
    // Document order overlay, text, sticker → z 3, 1, 2.
    expect(zOf(html)).toEqual([3, 1, 2]);
    expect(html).toContain('isolation:isolate');
  });

  it('and a cover face with no stored order is unchanged', () => {
    const back = { ...DEFAULT_BACK_COVER, overlays: [ov('o1')], texts: [tx('t1')], stickers: [st('s1')] };
    const html = renderToStaticMarkup(
      <BackCoverDesign back={back} imageUrl={null} photoFor={photoFor} stickerUrlFor={() => 'https://r2.example/s.png'} />,
    );
    expect(zOf(html)).toEqual([1, 2, 3]);
  });
});
