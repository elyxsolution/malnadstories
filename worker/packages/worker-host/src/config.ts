import type { PrintProfile } from '@workerv2/document';
import type { PdfExportConfig } from '@workerv2/pdf-export';

/**
 * HOST CONFIGURATION — the deterministic knobs the composition root wires the pipeline with. These
 * are wiring parameters (render target, print profile, export config, backend selection, the
 * deterministic clock seed) — NOT business logic. All are pure data; the run is a deterministic
 * function of the Blueprint + seeded Artifacts + this config.
 */

/** The pixel canvas each surface is composed at (a rendering parameter, not blueprint data). */
export interface RenderTarget {
  readonly width: number;
  readonly height: number;
}

export interface HostConfig {
  /** The page pixel size each surface composes at. */
  readonly renderTarget: RenderTarget;
  /** The print profile the assembled Document is built for. */
  readonly printProfile: PrintProfile;
  /** The PDF export configuration (part of PDF export identity). */
  readonly exportConfig: PdfExportConfig;
  /** Which registered ImageBackend to drive composition with (selection, not processor logic). */
  readonly backendId: string;
  /** The deterministic clock seed (ISO-8601). Keeps the driven run reproducible. */
  readonly clockStart: string;
}

/** The canonical deterministic reference backend id. */
export const REFERENCE_BACKEND_ID = 'reference';

export const DEFAULT_RENDER_TARGET: RenderTarget = { width: 16, height: 16 };

export const DEFAULT_HOST_PRINT_PROFILE: PrintProfile = {
  id: 'classic-16-72',
  name: 'Classic 16px 72dpi',
  settings: { pageWidth: 16, pageHeight: 16, dpi: 72, colorSpace: 'srgb', bleed: 0 },
};

export const DEFAULT_CLOCK_START = '2026-01-01T00:00:00.000Z';

/** Fill any omitted config with deterministic defaults. */
export function resolveHostConfig(config: Partial<HostConfig> = {}): HostConfig {
  return {
    renderTarget: config.renderTarget ?? DEFAULT_RENDER_TARGET,
    printProfile: config.printProfile ?? DEFAULT_HOST_PRINT_PROFILE,
    exportConfig: config.exportConfig ?? {},
    backendId: config.backendId ?? REFERENCE_BACKEND_ID,
    clockStart: config.clockStart ?? DEFAULT_CLOCK_START,
  };
}
