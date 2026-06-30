/**
 * Builder-scoped UI constants (Pixory white + green reskin). Kept OUT of the shared
 * `@/components/brand` (cream journey) so the builder's interaction-green never leaks.
 */

/**
 * Primary CTA surface for the Album Builder — a flat, premium green fill on white
 * (Pixory's filled-accent role), soft layered shadow, gentle darken on hover. Mirrors
 * `LUX_PRIMARY`'s role but in the builder's interaction-green. Pass to `Button`'s
 * className like `className={STUDIO_PRIMARY}`.
 */
export const STUDIO_PRIMARY =
  'border-transparent bg-studio text-studio-foreground ' +
  'shadow-[0_1px_2px_rgb(16_24_20/0.12),0_6px_16px_-8px_hsl(150_46%_26%/0.5)] ' +
  'transition-all duration-150 ease-glide ' +
  'hover:bg-[hsl(150_48%_29%)] ' +
  'hover:shadow-[0_2px_6px_rgb(16_24_20/0.16),0_10px_24px_-10px_hsl(150_46%_24%/0.55)] ' +
  'active:scale-[0.98] ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-studio-bright focus-visible:ring-offset-2';
