/**
 * THE CROP EDITOR SHOWS THE CROP.
 *
 * ── THE DEFECT, AND WHY IT LOOKED SO STRANGE ───────────────────────────────────────────────
 *
 * Long-press or the Crop button entered adjustment mode, dragging changed the stored value, and
 * the preview and the PDF showed the result — but the canvas the customer was dragging on did not
 * move. So the state was correct everywhere except the one surface being used to author it.
 *
 * The cause was a single missed consumer. An adjustment is written to the PLACEMENT
 * (`overlay.edit` / `block.baseEdits[slot]`) and inherited from the source photo until it forks.
 * The shared read-only renderers and the cover canvas resolve that with `resolveFrameEdit`; the
 * page canvas (`_block.tsx`) did not, and went on rendering `photo.edit` — the `photos` row, which
 * a placement crop never writes. `OverlayContent`, `BaseSlotView` and the adjustment ghost
 * (`CropBleed`) were all reading it.
 *
 * ── WHAT IS ASSERTED HERE ──────────────────────────────────────────────────────────────────
 *
 * The canvas is a client component behind an authenticated route, so the GESTURE is not driven
 * here (see `tests/README.md`). What is executed is the thing that was actually broken: that a
 * change to the frame's own edit changes what the canvas renders, through the same resolution the
 * final renderers use. Plus the structural guarantees — one crop state, one entry point, one
 * write path — which is what keeps the two entry paths from drifting apart again.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import PairContent, { type PairPhoto } from '@/app/(app)/albums/[id]/build/_pair-frame';
import { BackCoverDesign } from '@/app/(app)/albums/[id]/build/_cover-render';
import { DEFAULT_BACK_COVER } from '@/lib/builder/cover';
import { resolveFrameEdit, type Block, type EditConfig, type Overlay } from '@/lib/builder/model';

const read = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');
const PHOTO = '11111111-1111-4111-8111-111111111111';

/** The source photo carries an edit of its own, so "inherited" and "forked" are distinguishable. */
const SOURCE: EditConfig = { brightness: 1.5 };
const photoFor = (id: string | null | undefined): PairPhoto | undefined =>
  id === PHOTO ? { url: 'https://r2.example/one.jpg', edit: SOURCE } : undefined;

const ov = (edit?: EditConfig | null): Overlay => ({
  id: 'o1',
  photoId: PHOTO,
  x: 0.1,
  y: 0.1,
  w: 0.3,
  h: 0.3,
  ...(edit === undefined ? {} : { edit }),
});

const block = (over: Partial<Block> = {}): Block => ({
  key: 'b1',
  template: 'single-pair',
  photoIds: [],
  caption: '',
  overlays: [],
  texts: [],
  qrs: [],
  stickers: [],
  background: null,
  ...over,
});

/** Every `filter:` declaration, in document order — the part of an edit a server render resolves. */
const filters = (html: string) => Array.from(html.matchAll(/filter:([^;"]+)/g)).map((m) => m[1].trim());

// ===============================================================================================
// 1 — a live change to the frame's edit changes what is drawn
// ===============================================================================================

describe('the canvas renders the FRAME state, so a live change is visible', () => {
  /**
   * This is the loop the gesture runs: `useCanvasCrop.onChange` → `patchFrameLocal` →
   * `api.amendFrameEdit`, which produces a new `Block` whose overlay carries a new `edit`. Each
   * render below is the frame at one instant of a drag.
   */
  it('successive frames of a drag each draw a different picture', () => {
    const frames = [0.2, 0.5, 0.9].map((v) =>
      renderToStaticMarkup(<PairContent block={block({ overlays: [ov({ brightness: v })] })} photoFor={photoFor} />),
    );
    expect(frames.map((h) => filters(h)[0])).toEqual(['brightness(0.2)', 'brightness(0.5)', 'brightness(0.9)']);
  });

  it('a base slot does the same, positionally', () => {
    const at = (edits: (EditConfig | null)[]) =>
      filters(
        renderToStaticMarkup(
          <PairContent block={block({ photoIds: [PHOTO, PHOTO], baseEdits: edits })} photoFor={photoFor} />,
        ),
      );
    expect(at([{ brightness: 0.3 }, null])).toEqual(['brightness(0.3)', 'brightness(1.5)']);
    expect(at([{ brightness: 0.3 }, { brightness: 0.7 }])).toEqual(['brightness(0.3)', 'brightness(0.7)']);
  });

  it('a cover overlay does the same', () => {
    const at = (edit: EditConfig) =>
      filters(
        renderToStaticMarkup(
          <BackCoverDesign
            back={{ ...DEFAULT_BACK_COVER, overlays: [ov(edit)] }}
            imageUrl={null}
            photoFor={photoFor}
          />,
        ),
      );
    expect(at({ brightness: 0.4 })).toEqual(['brightness(0.4)']);
    expect(at({ brightness: 0.8 })).toEqual(['brightness(0.8)']);
  });

  it('an UNFORKED frame still shows the source — nothing about inheritance changed', () => {
    const html = renderToStaticMarkup(<PairContent block={block({ overlays: [ov()] })} photoFor={photoFor} />);
    expect(filters(html)).toEqual(['brightness(1.5)']);
  });

  it('the resolution rule the canvas must use is the one the final renderers use', () => {
    // Stated directly, because the whole defect was one surface using a different rule.
    expect(resolveFrameEdit({ brightness: 2 }, SOURCE)).toEqual({ brightness: 2 });
    expect(resolveFrameEdit(undefined, SOURCE)).toEqual(SOURCE);
  });
});

// ===============================================================================================
// 2 — the page canvas now consumes it (the regression that caused the defect)
// ===============================================================================================

describe('the page canvas reads the FRAME, not the shared photo row', () => {
  const canvas = read('src/app/(app)/albums/[id]/build/_block.tsx');

  it('the overlay frame renders the placement edit', () => {
    expect(canvas).toContain('edit={resolveFrameEdit(o.edit, photo?.edit)}');
    expect(canvas).toContain('edit={edit ?? photo.edit}');
  });

  it('both page halves and the spread image render their positional edits', () => {
    expect(canvas).toContain('edit={resolveFrameEdit((block.baseEdits ?? [])[0], leftPhoto?.edit)}');
    expect(canvas).toContain('edit={resolveFrameEdit((block.baseEdits ?? [])[1], rightPhoto?.edit)}');
  });

  it('THE GHOST does too — it is the half that shows what you are choosing from', () => {
    expect(canvas).toContain('const cropEdit =');
    expect(canvas).toContain('edit={cropEdit}');
    expect(canvas).not.toContain('edit={cropPhoto?.edit}');
  });

  it('no frame on the editing canvas still reads `photo.edit` unconditionally', () => {
    // The picker's thumbnails are the one legitimate `photo.edit` reader left: they show the
    // SOURCE asset, which is exactly what a picker is for.
    const unconditional = canvas.match(/edit=\{(photo|p)\.edit\}/g) ?? [];
    expect(unconditional).toEqual(['edit={p.edit}']);
  });
});

// ===============================================================================================
// 3 — one crop implementation, two doors
// ===============================================================================================

describe('long-press and the Crop button are the same editor', () => {
  const builder = read('src/app/(app)/albums/[id]/build/_builder.tsx');
  const canvas = read('src/app/(app)/albums/[id]/build/_block.tsx');
  const cover = read('src/app/(app)/albums/[id]/build/_cover-canvas.tsx');

  it('both page doors call the SAME `beginCropOn`', () => {
    // Long press …
    expect(canvas).toContain('onLongPress={');
    expect(canvas).toContain("onBeginCrop({ overlayId: oid, photoId: photo.id })");
    // … the centre adjust handle …
    expect(canvas).toContain('<AdjustHandle onAdjust={() => onBeginCrop(');
    // … and the toolbar button, through the selection.
    expect(builder).toContain('const startCrop = useCallback(');
    expect(builder).toMatch(/startCrop[\s\S]{0,400}beginCropOn\(/);
    expect(builder).toContain('onBeginCrop={beginCropOn}');
  });

  it('both cover doors call the SAME handler, into the SAME crop state', () => {
    expect(cover).toContain('onLongPress={');
    expect(cover).toContain('<AdjustHandle');
    expect(builder).toContain('crop.begin({ blockKey: `cover:${cover.side}`, overlayId, photoId })');
  });

  it('there is exactly ONE `useCanvasCrop` in the builder', () => {
    expect((builder.match(/useCanvasCrop\(/g) ?? []).length).toBe(1);
  });

  it('and exactly one gesture surface + one ghost, shared by both canvases', () => {
    const chrome = read('src/app/(app)/albums/[id]/build/_crop-chrome.tsx');
    for (const fn of ['CropLayer', 'CropBleed', 'AdjustHandle', 'useCropWheel']) {
      expect(chrome).toContain(`export function ${fn}`);
      expect(canvas).not.toContain(`function ${fn}(`);
      expect(cover).not.toContain(`function ${fn}(`);
    }
  });

  it('the live half writes LOCALLY and the gesture persists once — not once per pointer move', () => {
    expect(builder).toContain('writeFrameEditLocal(ref, edit)');
    expect(builder).toMatch(/patchFrameLocal[\s\S]{0,400}writeFrameEditLocal/);
    expect(builder).toContain('onChange: useCallback((t, edit) => patchFrameLocal(cropFrameRef(t), edit)');
  });
});

// ===============================================================================================
// 4 — the crop still belongs to ONE placement
// ===============================================================================================

describe('cropping one placement leaves the others alone', () => {
  it('the same photo in three frames keeps three independent pictures', () => {
    const html = renderToStaticMarkup(
      <PairContent
        block={block({
          overlays: [
            { ...ov({ brightness: 0.3 }), id: 'a' },
            { ...ov({ brightness: 0.6 }), id: 'b' },
            { ...ov(), id: 'c' },
          ],
        })}
        photoFor={photoFor}
      />,
    );
    expect(filters(html)).toEqual(['brightness(0.3)', 'brightness(0.6)', 'brightness(1.5)']);
  });

  it('the gesture is addressed by FRAME, so it cannot reach another placement', () => {
    const crop = read('src/app/(app)/albums/[id]/build/_use-canvas-crop.ts');
    // Every read and every write in the gesture goes through the target, never through a photo id.
    expect(crop).toContain('editFor: (target: CropTarget) => EditConfig');
    expect(crop).toContain('onChange: (target: CropTarget, edit: EditConfig) => void');
    expect(crop).toContain('export function cropFrameRef(t: CropTarget): FrameRef');
    expect(crop).not.toContain('photoFor(target.photoId)?.edit');
  });
});
