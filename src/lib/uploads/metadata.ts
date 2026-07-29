/**
 * CLIENT-SIDE IMAGE METADATA — dimensions and EXIF orientation read in the browser, from the
 * user's own bytes, before a single byte has been uploaded.
 *
 * WHY. Auto-layout groups photos by shape (`classify` in auto-layout.ts: pano / landscape /
 * portrait / square). Until now that shape came only from the worker's sanitized master, so
 * "Build it for me" sat unavailable for as long as processing took. The browser already knows
 * the shape the instant a file is picked — we were simply not asking.
 *
 * THE ORIENTATION PROBLEM, AND WHY THIS IS SAFE.
 * A JPEG straight off a phone is often stored rotated, with an EXIF Orientation tag saying
 * "display this turned 90°". Naive decoding reports the STORED dimensions, so a portrait photo
 * measures as landscape — which would put it in the wrong layout bucket. The worker resolves
 * this by baking the rotation in (`sharp.rotate()`), so its `width`/`height` are ORIENTED.
 *
 * To match, we decode with `imageOrientation: 'from-image'`, which makes `createImageBitmap`
 * apply the EXIF rotation and report oriented dimensions — the same convention the worker uses
 * and the same one `<img>` renders with. When that path is unavailable we fall back to an
 * `<img>` measurement and correct it ourselves using the parsed EXIF tag. Anything we cannot
 * establish confidently is returned as `reliable: false` and simply never used for layout.
 *
 * THE BACKEND REMAINS THE SOURCE OF TRUTH. These numbers drive client UX only. When the real
 * metadata arrives it is compared, and the layout is reconciled (see `_use-optimistic-layout`).
 */

/** Formats a browser can decode from a blob. HEIC is absent — no browser decodes it. */
const DECODABLE = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'];

export type ClientImageMetadata = {
  /** Oriented width — the width the image is DISPLAYED at, matching the worker's convention. */
  width: number;
  /** Oriented height. */
  height: number;
  /** width / height, oriented. */
  aspectRatio: number;
  /** EXIF orientation tag 1–8. 1 when absent, unknown, or not a JPEG. */
  orientation: number;
  /** True when the EXIF rotation has been applied to `width`/`height`. */
  orientationApplied: boolean;
  /** Only `true` metadata may influence layout decisions. */
  reliable: boolean;
  source: 'bitmap' | 'image';
};

/** Can this content type be measured in-browser? */
export function canExtractMetadata(contentType: string): boolean {
  return DECODABLE.includes(contentType);
}

/** EXIF orientations 5–8 swap the axes; 2/3/4 only mirror or flip 180°. */
export function orientationSwapsAxes(orientation: number): boolean {
  return orientation >= 5 && orientation <= 8;
}

/**
 * Read the EXIF Orientation tag from a JPEG.
 *
 * A deliberately minimal parser rather than a dependency: it walks the JPEG marker chain to the
 * APP1/Exif segment, reads the TIFF header's endianness, and scans IFD0 for tag 0x0112. Only
 * the first 128 KB is inspected — EXIF lives at the very start of the file, so this never reads
 * a whole 20 MB photo. Any malformed structure returns 1 (the "no rotation" default) rather than
 * throwing; an unreadable tag must degrade to "assume upright", never break an upload.
 */
export async function readExifOrientation(file: File): Promise<number> {
  try {
    const head = await file.slice(0, 128 * 1024).arrayBuffer();
    const view = new DataView(head);
    if (view.byteLength < 4 || view.getUint16(0, false) !== 0xffd8) return 1; // not a JPEG

    let offset = 2;
    while (offset + 4 <= view.byteLength) {
      const marker = view.getUint16(offset, false);
      if ((marker & 0xff00) !== 0xff00) break; // desynchronised — give up safely
      const size = view.getUint16(offset + 2, false);
      if (size < 2) break;

      // APP1 — the Exif segment.
      if (marker === 0xffe1) {
        const exifStart = offset + 4;
        if (exifStart + 10 > view.byteLength) return 1;
        if (view.getUint32(exifStart, false) !== 0x45786966) return 1; // not "Exif"
        const tiff = exifStart + 6;
        const little = view.getUint16(tiff, false) === 0x4949;
        if (tiff + 8 > view.byteLength) return 1;
        const ifd0 = tiff + view.getUint32(tiff + 4, little);
        if (ifd0 + 2 > view.byteLength) return 1;
        const entries = view.getUint16(ifd0, little);
        for (let i = 0; i < entries; i += 1) {
          const entry = ifd0 + 2 + i * 12;
          if (entry + 12 > view.byteLength) return 1;
          if (view.getUint16(entry, little) === 0x0112) {
            const value = view.getUint16(entry + 8, little);
            return value >= 1 && value <= 8 ? value : 1;
          }
        }
        return 1;
      }

      if (marker === 0xffda) break; // start of scan — no EXIF before the image data
      offset += 2 + size;
    }
  } catch {
    /* unreadable header — assume upright */
  }
  return 1;
}

/** Measure via `createImageBitmap`, letting the browser apply EXIF. Null when unsupported. */
async function measureViaBitmap(file: File): Promise<{ width: number; height: number } | null> {
  if (typeof createImageBitmap !== 'function') return null;
  try {
    // `imageOrientation: 'from-image'` is what makes these dimensions ORIENTED. Some engines
    // ignore the option rather than rejecting, which is why the EXIF tag is cross-checked below.
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close?.();
    return size.width > 0 && size.height > 0 ? size : null;
  } catch {
    return null;
  }
}

/** Measure via an `<img>` — reports whatever the engine's default orientation handling gives. */
function measureViaImage(file: File): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    let url: string;
    try {
      url = URL.createObjectURL(file);
    } catch {
      resolve(null);
      return;
    }
    const img = new Image();
    const done = (result: { width: number; height: number } | null) => {
      URL.revokeObjectURL(url);
      resolve(result);
    };
    img.onload = () =>
      done(img.naturalWidth > 0 && img.naturalHeight > 0 ? { width: img.naturalWidth, height: img.naturalHeight } : null);
    img.onerror = () => done(null);
    img.src = url;
  });
}

/**
 * Extract oriented dimensions + EXIF orientation for a picked file.
 *
 * Never throws and never blocks: a failure returns `null`, and the photo simply behaves as it
 * did before this phase (waiting for the worker). Typical cost is a few milliseconds — the
 * decode is off the critical path, fired after the optimistic photo already exists.
 */
export async function extractImageMetadata(file: File, contentType: string): Promise<ClientImageMetadata | null> {
  if (typeof window === 'undefined' || !canExtractMetadata(contentType)) return null;

  const orientation = contentType === 'image/jpeg' ? await readExifOrientation(file) : 1;

  const bitmap = await measureViaBitmap(file);
  if (bitmap) {
    // The bitmap path already applied the rotation, so its dimensions are oriented as-is.
    return finalize(bitmap.width, bitmap.height, orientation, true, 'bitmap');
  }

  const measured = await measureViaImage(file);
  if (!measured) return null;

  // Fallback path: correct the axes ourselves when the tag says the image is turned. Browsers
  // that already honour EXIF here would make this a double-correction, so it is applied only
  // when the measured shape still disagrees with the tag — i.e. when nothing corrected it.
  const swap = orientationSwapsAxes(orientation);
  const looksUncorrected = swap && measured.width >= measured.height;
  const width = looksUncorrected ? measured.height : measured.width;
  const height = looksUncorrected ? measured.width : measured.height;
  return finalize(width, height, orientation, !swap || looksUncorrected, 'image');
}

function finalize(
  width: number,
  height: number,
  orientation: number,
  orientationApplied: boolean,
  source: ClientImageMetadata['source'],
): ClientImageMetadata | null {
  if (!(width > 0) || !(height > 0)) return null;
  return {
    width,
    height,
    aspectRatio: width / height,
    orientation,
    orientationApplied,
    // Only fully-resolved orientation is trusted for layout. An ambiguous rotated image is
    // better left to the worker than placed in the wrong bucket.
    reliable: orientationApplied,
    source,
  };
}
