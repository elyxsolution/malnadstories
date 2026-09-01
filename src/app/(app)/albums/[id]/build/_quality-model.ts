'use client';

import { cmToIn } from '@/lib/products/model';
import { isBlockComplete, resolveFrameEdit, type Block, type EditConfig } from '@/lib/builder/model';
import type { Photo } from '@/lib/builder/photo';
import type { CoverConfig } from '@/lib/builder/cover';
import { orientedSize, type PhotoUiState } from './_photo-state';
import { orientationOf, type OrientationFilter } from './_tray-filters';
import type { SelectionTarget } from './_selection-model';
import type { BaseSlot } from './_use-builder';

/**
 * THE ALBUM QUALITY ENGINE — pure derivation of "is this album good enough to print".
 *
 * WHY IT IS SEPARATE FROM `lib/albums/validation`. That service answers a BUSINESS question —
 * may this album be submitted, may a PDF be generated — and it is shared with the server, the
 * worker and the admin console, so it can only see what the database stores: templates and
 * photo ids. This engine answers a CRAFT question the browser alone can answer: is that photo
 * big enough for the frame it sits in, has it been cropped past the point of usefulness, is the
 * same picture printed twice, is anything still uploading. Those need pixel dimensions, edit
 * configs and live upload state — none of which the server-side validator has or wants.
 *
 * So the two do not compete: `validation.ts` still owns the submit gate and the readiness score,
 * and nothing here blocks anything. Quality is ADVISORY, always — the panel that renders it can
 * be ignored indefinitely and the album still submits exactly as it did before.
 *
 * PURE BY CONSTRUCTION. No hooks, no I/O, no React. Everything derives from state that already
 * exists (`blocks`, `photos`, the cover config, the upload state machine in `_photo-state`), so
 * there is no third copy of the truth to keep in sync and the whole report can be recomputed in
 * a `useMemo` on every edit without measuring anything in the DOM.
 *
 * THE ONE PIECE OF REAL MATH is `effectiveDpi`: how many photo pixels actually survive crop,
 * cover-fit and zoom, divided by the physical inches that frame occupies on the printed page.
 * The physical size comes from the product (0047) rather than a constant, so an A4 album and a
 * 6×8 album get different — and correct — answers from the same photo.
 */

// ── thresholds (ONE place; the panel and the badges both read these) ──────────────

/** Below this many dots per inch a photo will visibly soften in print. */
export const DPI_ATTENTION = 150;
/** Between this and DPI_ATTENTION it prints acceptably but is worth a glance. */
export const DPI_NOTICE = 200;
/**
 * Fraction of the original image that still reaches the page.
 *
 * Calibrated against real shapes rather than picked round: a portrait cover-fit into a landscape
 * frame keeps ~50% and is completely ordinary, so the notice threshold sits below that. A 3:1
 * panorama forced into a portrait page keeps ~25% and IS worth a second look, so it sits above
 * that. Below 10% the photo is essentially a detail crop, which is either deliberate or a
 * mistake — and worth saying so either way.
 */
export const RETAINED_ATTENTION = 0.1;
export const RETAINED_NOTICE = 0.3;

// ── frames ────────────────────────────────────────────────────────────────────────

/**
 * A photo-holding position on a spread — filled or not. Base slots are enumerated from the
 * template (so a MISSING photo still produces a frame, which is what makes "empty frame"
 * detectable), overlays from the block's own list.
 */
export type FrameRef =
  | { kind: 'base'; blockKey: string; blockIndex: number; slot: BaseSlot }
  | { kind: 'overlay'; blockKey: string; blockIndex: number; id: string };

/** The selection target for a frame — so an issue can hand the user straight to it. */
export function frameTarget(f: FrameRef): SelectionTarget {
  return f.kind === 'base'
    ? { kind: 'base', blockKey: f.blockKey, slot: f.slot }
    : { kind: 'overlay', blockKey: f.blockKey, id: f.id };
}

export function frameKey(f: FrameRef): string {
  return f.kind === 'base' ? `base:${f.blockKey}:${f.slot}` : `overlay:${f.blockKey}:${f.id}`;
}

/**
 * The base image slots this unit ACTUALLY exposes, in reading order.
 *
 * A template no longer decides this on its own. A page created by the customer is a background —
 * photos arrive as overlays — so it exposes no base slots at all, and enumerating two for it would
 * invent two empty frames on every ordinary page and report the album as permanently unfinished.
 * A non-empty base row means the unit genuinely works that way (a legacy album, a panorama, or a
 * page a layout preset just filled), and there both halves are real frames again — including an
 * empty companion, which is exactly the "you have a slot left to fill" the canvas still shows.
 *
 * This is the same predicate `_block` renders from, so what the quality engine counts and what the
 * customer can see and click cannot drift apart.
 */
export function activeBaseSlots(block: Pick<Block, 'template' | 'photoIds'>): BaseSlot[] {
  if (block.photoIds.length === 0) return [];
  return block.template === 'double-spread' ? ['image'] : ['left', 'right'];
}

/** Which photo (if any) occupies a frame. */
export function framePhotoId(block: Block, f: FrameRef): string | null {
  if (f.kind === 'base') {
    if (f.slot === 'image' || f.slot === 'left') return block.photoIds[0] ?? null;
    return block.photoIds[1] ?? null;
  }
  return block.overlays.find((o) => o.id === f.id)?.photoId ?? null;
}

/**
 * THE EDIT THIS FRAME IS ACTUALLY SHOWING — its own if it has forked, otherwise the source
 * photo's (see PLACEMENT EDITS in `lib/builder/model`).
 *
 * The quality engine's one piece of real maths is effective DPI, and `zoom` and `crop` are its
 * two biggest inputs. With per-placement edits, reading them off the `photos` row would report
 * the SOURCE's numbers for every frame — so a heavily zoomed placement of a photo would be
 * scored as if it were untouched, and the "only 30 % of this photo reaches the page" warning
 * would appear on the wrong frame. It resolves exactly as every renderer does.
 */
export function frameEditOf(block: Block, f: FrameRef, photo: Photo): EditConfig | null {
  const own =
    f.kind === 'base'
      ? (block.baseEdits ?? [])[f.slot === 'right' ? 1 : 0]
      : block.overlays.find((o) => o.id === f.id)?.edit;
  return resolveFrameEdit(own, photo.edit);
}

/** Every frame in the album, in page order. */
export function enumerateFrames(blocks: Block[]): FrameRef[] {
  const out: FrameRef[] = [];
  blocks.forEach((b, blockIndex) => {
    for (const slot of activeBaseSlots(b)) out.push({ kind: 'base', blockKey: b.key, blockIndex, slot });
    for (const o of b.overlays) if (o.id) out.push({ kind: 'overlay', blockKey: b.key, blockIndex, id: o.id });
  });
  return out;
}

/**
 * A frame's geometry on the OPEN PAIR: how wide it is as a fraction of the pair, and its
 * printed aspect (width / height). Overlay rects are normalized against the pair, so an
 * overlay's pixel aspect is `(w / h) × pairAspect` — the same conversion the photo editor uses
 * to pick its crop frame, kept identical here on purpose.
 */
export function frameGeometry(block: Block, f: FrameRef, pairAspect: number): { widthFrac: number; aspect: number } {
  if (f.kind === 'base') {
    return block.template === 'double-spread'
      ? { widthFrac: 1, aspect: pairAspect }
      : { widthFrac: 0.5, aspect: pairAspect / 2 };
  }
  const o = block.overlays.find((ov) => ov.id === f.id);
  if (!o || o.h <= 0 || o.w <= 0) return { widthFrac: 0.3, aspect: 1 };
  return { widthFrac: o.w, aspect: (o.w * pairAspect) / o.h };
}

// ── the resolution / crop math ────────────────────────────────────────────────────

export type FrameMetrics = {
  /** Dots per inch this photo actually prints at in this frame. Null when size is unknown. */
  dpi: number | null;
  /** Fraction of the ORIGINAL image that survives crop + cover-fit + zoom (0..1). */
  retained: number | null;
  /** Whether the numbers came from the worker (authoritative) or the browser (advisory). */
  source: 'server' | 'client' | null;
};

/**
 * How much of a photo reaches the page, and at what density.
 *
 * The pipeline mirrors the renderer exactly (`computeFrameLayout` in `model.ts`): take the
 * `crop` region of the ORIENTED image, cover-fit it into the frame's aspect — which discards
 * whatever doesn't match — then apply `zoom`, which crops further. Rotation by 90°/270° swaps
 * the axes before any of that. Getting this wrong in either direction would be worse than not
 * showing it at all, so it follows the same order of operations the pixels do.
 */
export function frameMetrics(
  photo: Photo,
  geom: { widthFrac: number; aspect: number },
  pairWidthIn: number,
  /**
   * The edit THIS FRAME renders. Omitted ⇒ the source photo's, which is what every caller meant
   * while a photo could be placed once and is still the right answer for a lone placement.
   */
  frameEdit?: EditConfig | null,
): FrameMetrics {
  const size = orientedSize(photo);
  if (!size || pairWidthIn <= 0 || geom.aspect <= 0) return { dpi: null, retained: null, source: null };

  const edit: EditConfig = frameEdit ?? photo.edit ?? {};
  const quarter = edit.rotate === 90 || edit.rotate === 270;
  const imgW = quarter ? size.height : size.width;
  const imgH = quarter ? size.width : size.height;

  const crop = edit.crop;
  const cw = imgW * (crop?.w ?? 1);
  const ch = imgH * (crop?.h ?? 1);
  if (cw <= 0 || ch <= 0) return { dpi: null, retained: null, source: size.source };

  // Cover-fit the cropped region into the frame: the axis that is proportionally larger is
  // the one trimmed away.
  const cropAspect = cw / ch;
  const usedW = cropAspect > geom.aspect ? ch * geom.aspect : cw;
  const usedH = cropAspect > geom.aspect ? ch : cw / geom.aspect;

  const zoom = Math.max(1, edit.zoom ?? 1);
  const printedW = usedW / zoom;
  const printedH = usedH / zoom;

  const frameWidthIn = pairWidthIn * geom.widthFrac;
  return {
    dpi: frameWidthIn > 0 ? printedW / frameWidthIn : null,
    retained: (printedW * printedH) / (imgW * imgH),
    source: size.source,
  };
}

// ── print readiness (the badge vocabulary, shared with the canvas) ────────────────

export type ReadinessLevel = 'good' | 'notice' | 'attention' | 'empty' | 'processing' | 'failed';

export type Readiness = {
  level: ReadinessLevel;
  /** Two or three words — this is what a badge shows. */
  label: string;
  /** One sentence — the tooltip / panel line. */
  detail: string;
};

const GOOD: Readiness = { level: 'good', label: 'Good', detail: 'Sharp enough for print at this size.' };

/**
 * The state of ONE frame, in the vocabulary the badges use. Deliberately returns `good` rather
 * than null so callers make the "is it worth drawing?" decision in one place (the badge itself
 * renders nothing for `good`, which is why a finished album is completely quiet).
 */
export function frameReadiness(
  photo: Photo | undefined,
  state: PhotoUiState | undefined,
  metrics: FrameMetrics | null,
): Readiness {
  if (!photo) return { level: 'empty', label: 'Empty', detail: 'This frame has no photo yet.' };
  if (state === 'failed') {
    return { level: 'failed', label: 'Failed', detail: 'This photo could not be uploaded or processed.' };
  }
  if (state && state !== 'ready') {
    return { level: 'processing', label: 'Processing', detail: 'Still preparing — quality can be checked once it finishes.' };
  }
  if (!metrics || metrics.dpi === null || metrics.retained === null) return GOOD;

  if (metrics.dpi < DPI_ATTENTION) {
    return {
      level: 'attention',
      label: 'Low resolution',
      detail: `Prints at about ${Math.round(metrics.dpi)} dpi here — noticeably soft. Use a smaller frame or a larger photo.`,
    };
  }
  if (metrics.retained < RETAINED_ATTENTION) {
    return {
      level: 'attention',
      label: 'Crop aggressive',
      detail: `Only ${Math.round(metrics.retained * 100)}% of this photo reaches the page. Loosen the crop or zoom out.`,
    };
  }
  if (metrics.dpi < DPI_NOTICE) {
    return {
      level: 'notice',
      label: 'Soft',
      detail: `Prints at about ${Math.round(metrics.dpi)} dpi — acceptable, but not crisp.`,
    };
  }
  if (metrics.retained < RETAINED_NOTICE) {
    return {
      level: 'notice',
      label: 'Tight crop',
      detail: `About ${Math.round(metrics.retained * 100)}% of this photo reaches the page.`,
    };
  }
  return GOOD;
}

// ── issues ────────────────────────────────────────────────────────────────────────

export type IssueKind =
  | 'empty-frame'
  | 'empty-spread'
  | 'low-resolution'
  | 'extreme-crop'
  | 'duplicate-photo'
  | 'cover-photo'
  | 'processing'
  | 'upload-failed';

/** `attention` is worth acting on before printing; `notice` is a judgement call. */
export type IssueSeverity = 'attention' | 'notice';

/** Where an issue lives — everything the builder needs to navigate to it in one click. */
export type IssueLocation =
  | { kind: 'cover' }
  | { kind: 'tray' }
  | { kind: 'spread'; blockKey: string; blockIndex: number }
  | { kind: 'frame'; blockKey: string; blockIndex: number; target: SelectionTarget }
  | { kind: 'photo'; photoId: string };

export type QualityIssue = {
  /** Stable within a report, so React keys and "dismissed" bookkeeping survive recomputation. */
  id: string;
  kind: IssueKind;
  severity: IssueSeverity;
  title: string;
  detail: string;
  location: IssueLocation;
  /** How many things this row stands for (an aggregated spread or photo count). */
  count?: number;
};

export type QualityInput = {
  blocks: Block[];
  photos: Photo[];
  photoState: (photoId: string) => PhotoUiState | undefined;
  cover: { config: CoverConfig; templateId: string | null };
  /** Open-pair aspect (2 × page) and its printed width in inches — both from the product. */
  pairAspect: number;
  pairWidthIn: number;
};

export type QualityReport = {
  issues: QualityIssue[];
  attention: QualityIssue[];
  notices: QualityIssue[];
  /** Per-frame readiness, keyed by `frameKey` — the badges read this, never recompute it. */
  readiness: Map<string, Readiness>;
  /** Spread index → the worst level found on it, for the page strip's quiet dot. */
  spreadLevels: Map<number, ReadinessLevel>;
  /** True when nothing at all needs attention — used for the calm "all clear" state. */
  clean: boolean;
};

const SEVERITY_RANK: Record<IssueSeverity, number> = { attention: 0, notice: 1 };
const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many);

/** Physical inches across an open pair, from the product's print width. */
export function pairWidthInches(printWidthCm: number): number {
  return cmToIn(printWidthCm) * 2;
}

/**
 * THE inspection pass. One walk over the frames collects readiness, empties, duplicates and
 * spread-level rollups together, because they all need the same per-frame resolution and doing
 * them in separate passes would mean recomputing `frameMetrics` four times.
 */
export function inspectAlbum(input: QualityInput): QualityReport {
  const { blocks, photos, photoState, cover, pairAspect, pairWidthIn } = input;
  const photoById = new Map(photos.map((p) => [p.id, p]));
  const issues: QualityIssue[] = [];
  const readiness = new Map<string, Readiness>();
  const spreadLevels = new Map<number, ReadinessLevel>();

  /** Frames each photo occupies — the duplicate detector's raw material. */
  const usage = new Map<string, FrameRef[]>();

  // Per-spread accumulators, so aggregated rows can be emitted once per page rather than once
  // per frame (twelve "empty frame" rows for one blank spread is noise, not information).
  const emptyBySpread = new Map<number, FrameRef[]>();
  const emptySlotsBySpread = new Map<number, FrameRef[]>();
  const lowRes: { frame: FrameRef; photo: Photo; dpi: number }[] = [];
  const tightCrop: { frame: FrameRef; photo: Photo; retained: number }[] = [];
  const stuckProcessing: { frame: FrameRef; photo: Photo }[] = [];

  const worsen = (index: number, level: ReadinessLevel) => {
    const rank: Record<ReadinessLevel, number> = { failed: 0, attention: 1, empty: 2, processing: 3, notice: 4, good: 5 };
    const cur = spreadLevels.get(index);
    if (cur === undefined || rank[level] < rank[cur]) spreadLevels.set(index, level);
  };

  for (const frame of enumerateFrames(blocks)) {
    const block = blocks[frame.blockIndex];
    const photoId = framePhotoId(block, frame);
    const photo = photoId ? photoById.get(photoId) : undefined;
    const state = photoId ? photoState(photoId) : undefined;
    const geom = frameGeometry(block, frame, pairAspect);
    // The FRAME's edit, not the photo's: two placements of one image zoomed differently really do
    // print at different densities, and each frame's badge has to describe its own frame.
    const metrics = photo ? frameMetrics(photo, geom, pairWidthIn, frameEditOf(block, frame, photo)) : null;
    const r = frameReadiness(photo, state, metrics);

    readiness.set(frameKey(frame), r);
    worsen(frame.blockIndex, r.level);

    if (photoId) {
      const list = usage.get(photoId);
      if (list) list.push(frame);
      else usage.set(photoId, [frame]);
    }

    // Every enumerated BASE slot is required by its template (`requiredBaseCount`), so an empty
    // one always prints as blank paper. An empty OVERLAY prints as nothing at all — it is a
    // waiting slot, not a defect — so the two are collected separately and reported differently.
    if (!photo) {
      if (frame.kind === 'base') push(emptyBySpread, frame.blockIndex, frame);
      else push(emptySlotsBySpread, frame.blockIndex, frame);
    }

    if (photo && state === 'ready' && metrics) {
      if (metrics.dpi !== null && metrics.dpi < DPI_ATTENTION) lowRes.push({ frame, photo, dpi: metrics.dpi });
      else if (metrics.retained !== null && metrics.retained < RETAINED_ATTENTION) {
        tightCrop.push({ frame, photo, retained: metrics.retained });
      }
    }
    if (photo && state && state !== 'ready' && state !== 'failed') stuckProcessing.push({ frame, photo });
  }

  // ── empty frames, aggregated per spread ────────────────────────────────────────
  emptyBySpread.forEach((frames, blockIndex) => {
    const block = blocks[blockIndex];
    const hasAnyPhoto = block.photoIds.some(Boolean) || block.overlays.some((o) => o.photoId);
    if (!hasAnyPhoto) return; // reported once, below, as an empty spread
    issues.push({
      id: `empty-frame:${block.key}`,
      kind: 'empty-frame',
      severity: 'attention',
      title: `Spread ${blockIndex + 1} has ${frames.length} empty ${plural(frames.length, 'frame')}`,
      detail: 'An empty frame prints as blank paper. Drop a photo in, or apply a layout with fewer slots.',
      location: { kind: 'frame', blockKey: block.key, blockIndex, target: frameTarget(frames[0]) },
      count: frames.length,
    });
  });

  // ── unfilled overlay slots — waiting, not broken ───────────────────────────────
  emptySlotsBySpread.forEach((frames, blockIndex) => {
    const block = blocks[blockIndex];
    issues.push({
      id: `empty-slot:${block.key}`,
      kind: 'empty-frame',
      severity: 'notice',
      title: `Spread ${blockIndex + 1} has ${frames.length} unfilled ${plural(frames.length, 'slot')}`,
      detail: 'These overlay slots print as nothing at all. Fill them from your tray, or remove them for a cleaner page.',
      location: { kind: 'frame', blockKey: block.key, blockIndex, target: frameTarget(frames[0]) },
      count: frames.length,
    });
  });

  // ── spreads with nothing on them ───────────────────────────────────────────────
  blocks.forEach((b, i) => {
    const hasPhoto = b.photoIds.some(Boolean) || b.overlays.some((o) => o.photoId);
    if (hasPhoto) return;
    const decorated = b.texts.length > 0 || b.stickers.length > 0 || b.qrs.length > 0 || !!b.background;
    issues.push({
      id: `empty-spread:${b.key}`,
      kind: 'empty-spread',
      severity: decorated ? 'notice' : 'attention',
      title: `Spread ${i + 1} has no photos`,
      detail: decorated
        ? 'This spread has design elements but no photographs — intentional, or still to fill?'
        : 'This spread will print as blank pages. Add photos, or remove the spread to free its pages.',
      location: { kind: 'spread', blockKey: b.key, blockIndex: i },
    });
    worsen(i, decorated ? 'notice' : 'attention');
  });

  // ── resolution + crop ──────────────────────────────────────────────────────────
  for (const { frame, photo, dpi } of lowRes) {
    issues.push({
      id: `low-res:${frameKey(frame)}`,
      kind: 'low-resolution',
      severity: 'attention',
      title: `${photo.filename} prints at ${Math.round(dpi)} dpi`,
      detail: `Below ${DPI_ATTENTION} dpi this frame will look soft in print. Move it to a smaller frame, or use a higher-resolution file.`,
      location: { kind: 'frame', blockKey: frame.blockKey, blockIndex: frame.blockIndex, target: frameTarget(frame) },
    });
  }
  for (const { frame, photo, retained } of tightCrop) {
    issues.push({
      id: `crop:${frameKey(frame)}`,
      kind: 'extreme-crop',
      severity: 'attention',
      title: `${photo.filename} is cropped to ${Math.round(retained * 100)}%`,
      detail: 'Most of this photo never reaches the page. Loosen the crop, zoom out, or choose a frame closer to its shape.',
      location: { kind: 'frame', blockKey: frame.blockKey, blockIndex: frame.blockIndex, target: frameTarget(frame) },
    });
  }

  // ── the same picture printed more than once ────────────────────────────────────
  usage.forEach((frames, photoId) => {
    if (frames.length < 2) return;
    const photo = photoById.get(photoId);
    const seen: number[] = [];
    for (const f of frames) if (!seen.includes(f.blockIndex + 1)) seen.push(f.blockIndex + 1);
    const pages = seen.sort((a, b) => a - b);
    issues.push({
      id: `duplicate:${photoId}`,
      kind: 'duplicate-photo',
      severity: 'notice',
      title: `${photo?.filename ?? 'A photo'} appears ${frames.length} times`,
      detail: `Used on ${pages.length === 1 ? 'spread' : 'spreads'} ${pages.join(', ')}. Repeating a photo can be deliberate — worth a look if it wasn't.`,
      location: { kind: 'frame', blockKey: frames[0].blockKey, blockIndex: frames[0].blockIndex, target: frameTarget(frames[0]) },
      count: frames.length,
    });
  });

  // ── cover ──────────────────────────────────────────────────────────────────────
  const coverHasArt = !!cover.config.photoId || !!cover.config.background || !!cover.templateId;
  if (!coverHasArt) {
    issues.push({
      id: 'cover-photo',
      kind: 'cover-photo',
      severity: 'notice',
      title: 'The front cover has no photo',
      detail: 'Your album will print with the plain house cover. Choose a cover photo or a cover design to make it yours.',
      location: { kind: 'cover' },
    });
  }

  // ── still in flight ────────────────────────────────────────────────────────────
  const failed = photos.filter((p) => photoState(p.id) === 'failed');
  if (failed.length > 0) {
    issues.push({
      id: 'upload-failed',
      kind: 'upload-failed',
      severity: 'attention',
      title: `${failed.length} ${plural(failed.length, 'photo')} couldn’t be added`,
      detail: 'These uploads stopped or the file couldn’t be read. Retry them from the tray, or replace the files.',
      location: failed.length === 1 ? { kind: 'photo', photoId: failed[0].id } : { kind: 'tray' },
      count: failed.length,
    });
  }
  const processing = photos.filter((p) => {
    const s = photoState(p.id);
    return s !== undefined && s !== 'ready' && s !== 'failed';
  });
  if (processing.length > 0) {
    const placed = stuckProcessing.length;
    issues.push({
      id: 'processing',
      kind: 'processing',
      severity: placed > 0 ? 'attention' : 'notice',
      title: `${processing.length} ${plural(processing.length, 'photo')} still processing`,
      detail:
        placed > 0
          ? `${placed} of them ${plural(placed, 'is', 'are')} already on a page. Give them a moment before you submit — quality can’t be judged until they finish.`
          : 'Nothing to do — they’ll be ready shortly, and quality checks will run on them then.',
      location: placed > 0
        ? {
            kind: 'frame',
            blockKey: stuckProcessing[0].frame.blockKey,
            blockIndex: stuckProcessing[0].frame.blockIndex,
            target: frameTarget(stuckProcessing[0].frame),
          }
        : { kind: 'tray' },
      count: processing.length,
    });
  }

  issues.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
  const attention = issues.filter((i) => i.severity === 'attention');
  return {
    issues,
    attention,
    notices: issues.filter((i) => i.severity === 'notice'),
    readiness,
    spreadLevels,
    clean: attention.length === 0,
  };
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V) {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

// ── statistics ────────────────────────────────────────────────────────────────────

export type AlbumStatistics = {
  totalPhotos: number;
  usedPhotos: number;
  unusedPhotos: number;
  duplicatedPhotos: number;
  spreads: number;
  spreadsComplete: number;
  spreadsIncomplete: number;
  framesTotal: number;
  framesFilled: number;
  /** Photos per spread, one decimal — the density of the book. */
  photosPerSpread: number;
  orientation: Record<OrientationFilter | 'unknown', number>;
  upload: { ready: number; processing: number; failed: number; percent: number };
};

/**
 * Live project statistics. Shares `enumerateFrames` with the inspector so "frames" means
 * exactly the same thing in both — a statistic that disagrees with the issue list beside it is
 * worse than no statistic.
 */
export function albumStatistics(input: {
  blocks: Block[];
  photos: Photo[];
  photoState: (photoId: string) => PhotoUiState | undefined;
}): AlbumStatistics {
  const { blocks, photos, photoState } = input;
  const frames = enumerateFrames(blocks);

  const usage = new Map<string, number>();
  let framesFilled = 0;
  for (const f of frames) {
    const id = framePhotoId(blocks[f.blockIndex], f);
    if (!id) continue;
    framesFilled += 1;
    usage.set(id, (usage.get(id) ?? 0) + 1);
  }

  // "Complete" uses the SAME predicate the submit gate uses (`isBlockComplete`): every required
  // base slot filled, overlays optional. A statistic that disagreed with the gate beside it
  // would be worse than no statistic.
  const spreadsComplete = blocks.filter(isBlockComplete).length;

  const orientation: AlbumStatistics['orientation'] = { portrait: 0, landscape: 0, square: 0, unknown: 0 };
  for (const p of photos) {
    if (!usage.has(p.id)) continue;
    const o = orientationOf(p);
    orientation[o ?? 'unknown'] += 1;
  }

  let ready = 0;
  let processing = 0;
  let failed = 0;
  for (const p of photos) {
    const s = photoState(p.id);
    if (s === 'failed') failed += 1;
    else if (s === undefined || s === 'ready') ready += 1;
    else processing += 1;
  }

  return {
    totalPhotos: photos.length,
    usedPhotos: usage.size,
    unusedPhotos: Math.max(0, photos.length - usage.size),
    duplicatedPhotos: Array.from(usage.values()).filter((n) => n > 1).length,
    spreads: blocks.length,
    spreadsComplete,
    spreadsIncomplete: Math.max(0, blocks.length - spreadsComplete),
    framesTotal: frames.length,
    framesFilled,
    photosPerSpread: blocks.length > 0 ? Math.round((framesFilled / blocks.length) * 10) / 10 : 0,
    orientation,
    upload: {
      ready,
      processing,
      failed,
      percent: photos.length > 0 ? Math.round((ready / photos.length) * 100) : 100,
    },
  };
}
