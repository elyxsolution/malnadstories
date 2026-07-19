/**
 * LoadingConfig + LOADING_MESSAGES — the SINGLE source of loading timing AND copy for the whole
 * app. Every loading surface derives timing + messages from here, so the experience is identical
 * and future localization means editing only this file. Pure module (no 'use client').
 *
 * Timing ↔ CSS: `overlayFadeDuration` is the single source of truth for the fade duration. The CSS
 * animations in src/app/loader.css read it via the `--mal-fade-duration` custom property, which
 * LoadingProvider sets from this value on mount (with a 220ms fallback for first paint / SSR).
 *
 * Thresholds (STEP 6): < loadingDelay → no loader · ≥ loadingDelay → loader (≥ minimumVisible) ·
 * long ops → overlay + a rotating contextual message.
 */
export const LoadingConfig = {
  loadingDelay: 300, // ms before ANY loader is shown (fast ops never flash)
  minimumVisibleDuration: 600, // ms a shown loader stays before dismissing
  overlayFadeDuration: 220, // ms fade+scale in/out — SINGLE source; mirrored into CSS var
  messageRotationInterval: 2800, // ms per rotating message (~2.5–3s)
  defaultMessage: 'Loading…',
} as const;

/**
 * Operation-specific message groups. Rotated (never fake %) for long ops; the first item is the
 * static message used where rotation isn't available (route loading.tsx / buttons). Add copy or
 * translate HERE only — nothing elsewhere hardcodes loading text.
 */
export const LOADING_MESSAGES = {
  generic: ['Loading…', 'Please wait…', 'Almost ready…'],
  albumCreation: ['Creating your album…', 'Preparing your pages…', 'Organizing your memories…', 'Building your layouts…', 'Almost ready…'],
  photoUpload: ['Uploading your memories…', 'Optimizing image quality…', 'Preparing your photos…', 'Almost done…'],
  samplePreview: ['Preparing your sample album…', 'Loading beautiful layouts…', 'Getting everything ready…', 'Almost ready…'],
  pdfGeneration: ['Preparing your print-ready album…', 'Rendering high-quality pages…', 'Finalizing your PDF…', 'Almost ready…'],
  checkout: ['Preparing your order…', 'Verifying your purchase…', 'Finalizing checkout…', 'Almost ready…'],
  login: ['Signing you in…', 'Preparing your workspace…'],
  dashboard: ['Loading your dashboard…', 'Gathering your latest albums…'],
  imageProcessing: ['Processing your image…', 'Optimizing quality…', 'Almost done…'],
  saving: ['Saving your changes…', 'Almost done…'],
} as const;

export type MessageGroup = keyof typeof LOADING_MESSAGES;

/** Backward-compat alias for the former ALBUM_MESSAGES export. */
export const ALBUM_MESSAGES: readonly string[] = LOADING_MESSAGES.albumCreation;

export type MessageInput = {
  /** A named operation group (rotates through its messages). */
  messageGroup?: MessageGroup;
  /** An explicit message list (rotates). Wins over messageGroup. */
  messages?: readonly string[];
  /** A single static message. */
  message?: string;
};

/**
 * Resolve any message input to the list a surface should rotate through. Precedence:
 * explicit `messages` → `messageGroup` → single `message` → generic. Always returns ≥1 item.
 */
export function resolveLoadingMessages(input?: MessageInput): readonly string[] {
  if (input?.messages && input.messages.length) return input.messages;
  if (input?.messageGroup) return LOADING_MESSAGES[input.messageGroup];
  if (input?.message) return [input.message];
  return LOADING_MESSAGES.generic;
}

/** The single static message for surfaces that can't rotate (route loaders, buttons). */
export function resolveStaticMessage(input?: MessageInput): string {
  return resolveLoadingMessages(input)[0] ?? LoadingConfig.defaultMessage;
}
