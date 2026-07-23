// The page CANVAS — an RGBA pixel buffer with the primitive compositing operations the engine
// drives: background fill (at construction), compositing a fitted RGBA layer (honouring clip,
// grayscale mask, opacity, and blend mode), and drawing a frame border. Pure and backend-free: the
// compositor does the backend pixel work (fit/rotate/mask-resize) and hands the canvas ready
// buffers, keeping this deterministic per-pixel math in one place.

import type { RasterImage } from '@workerv2/image-backend';
import type { BlendMode, FrameSpec, PixelRect, Rgba } from './model.js';
import { compositePixel, fillRgba } from './color.js';

export class Canvas {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;

  constructor(width: number, height: number, background: Rgba) {
    this.width = width;
    this.height = height;
    this.data = new Uint8Array(width * height * 4);
    fillRgba(this.data, background);
  }

  /**
   * Composite a fitted RGBA layer whose top-left maps to (`destX`,`destY`). `maskGray`, when given,
   * is a 1-channel buffer the SAME size as `fitted` used as per-pixel alpha; `opacity` scales every
   * source alpha; `clip` restricts writes to a rectangle. Out-of-canvas pixels are skipped.
   */
  compositeLayer(
    fitted: RasterImage,
    destX: number,
    destY: number,
    opacity: number,
    blend: BlendMode,
    maskGray: Uint8Array | undefined,
    clip: PixelRect | undefined,
  ): void {
    const fw = fitted.width;
    const fh = fitted.height;
    for (let y = 0; y < fh; y += 1) {
      const cy = destY + y;
      if (cy < 0 || cy >= this.height) continue;
      for (let x = 0; x < fw; x += 1) {
        const cx = destX + x;
        if (cx < 0 || cx >= this.width) continue;
        if (clip !== undefined && !inRect(cx, cy, clip)) continue;
        const si = (y * fw + x) * 4;
        const srcAByte = fitted.data[si + 3] as number;
        if (srcAByte === 0) continue;
        const maskV = maskGray === undefined ? 1 : (maskGray[y * fw + x] as number) / 255;
        const srcA01 = (srcAByte / 255) * maskV * opacity;
        const di = (cy * this.width + cx) * 4;
        compositePixel(
          blend,
          this.data,
          di,
          fitted.data[si] as number,
          fitted.data[si + 1] as number,
          fitted.data[si + 2] as number,
          srcA01,
        );
      }
    }
  }

  /** Draw a frame border of `frame.thickness` inward from the edges of `rect`. */
  drawFrame(rect: PixelRect, frame: FrameSpec): void {
    const t = Math.max(0, Math.floor(frame.thickness));
    if (t === 0) return;
    const x0 = rect.x;
    const y0 = rect.y;
    const x1 = rect.x + rect.width; // exclusive
    const y1 = rect.y + rect.height; // exclusive
    const a01 = frame.color.a / 255;
    for (let cy = y0; cy < y1; cy += 1) {
      if (cy < 0 || cy >= this.height) continue;
      const onHBand = cy < y0 + t || cy >= y1 - t;
      for (let cx = x0; cx < x1; cx += 1) {
        if (cx < 0 || cx >= this.width) continue;
        const onVBand = cx < x0 + t || cx >= x1 - t;
        if (!onHBand && !onVBand) continue; // interior — not part of the border
        const di = (cy * this.width + cx) * 4;
        compositePixel('normal', this.data, di, frame.color.r, frame.color.g, frame.color.b, a01);
      }
    }
  }

  /** Snapshot the canvas as an immutable RGBA sRGB raster. */
  toRaster(): RasterImage {
    return {
      width: this.width,
      height: this.height,
      channels: 4,
      colorSpace: 'srgb',
      bitDepth: 8,
      data: new Uint8Array(this.data),
    };
  }
}

function inRect(x: number, y: number, rect: PixelRect): boolean {
  return x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height;
}
