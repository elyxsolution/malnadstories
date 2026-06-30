/**
 * Album builder — font catalog (PURE, shared, no I/O).
 *
 * The single source of truth for the selectable typefaces on BOTH the cover and album pages.
 * Each entry maps a stable `key` (persisted on text/cover) → a display label + a CSS font stack
 * that references the `var(--font-*)` emitted by next/font in lib/fonts.ts. The legacy brand keys
 * (`serif`/`sans`/`script`) are kept first for backward compatibility with existing albums.
 *
 * `key` is what's stored in album_pages.layout_config / albums.cover_config, so keys are STABLE —
 * never rename one. To add a font: register it in lib/fonts.ts (a `--font-*` variable) and add a
 * row here. The renderer + font picker pick it up automatically.
 */

export type FontKey =
  // Brand / legacy (kept for backward compatibility — do not remove)
  | 'serif'
  | 'sans'
  | 'script'
  // Expanded library
  | 'poppins'
  | 'inter'
  | 'montserrat'
  | 'playfair'
  | 'lora'
  | 'merriweather'
  | 'raleway'
  | 'nunito'
  | 'open-sans'
  | 'roboto'
  | 'bebas'
  | 'pacifico'
  | 'dancing'
  | 'caveat'
  | 'cinzel'
  | 'josefin'
  | 'abril'
  | 'quicksand'
  | 'dm-sans'
  | 'manrope';

export type FontEntry = { key: FontKey; label: string; stack: string; category: 'Brand' | 'Sans' | 'Serif' | 'Display' | 'Handwritten' };

export const FONT_CATALOG: FontEntry[] = [
  { key: 'serif', label: 'Editorial', stack: "var(--font-display), 'Cormorant Garamond', Georgia, serif", category: 'Brand' },
  { key: 'sans', label: 'Modern', stack: "var(--font-ui), 'Work Sans', system-ui, sans-serif", category: 'Brand' },
  { key: 'script', label: 'Hand', stack: "var(--font-accent-handwritten), 'Segoe Script', cursive", category: 'Brand' },
  { key: 'poppins', label: 'Poppins', stack: "var(--font-poppins), sans-serif", category: 'Sans' },
  { key: 'inter', label: 'Inter', stack: "var(--font-inter), sans-serif", category: 'Sans' },
  { key: 'montserrat', label: 'Montserrat', stack: "var(--font-montserrat), sans-serif", category: 'Sans' },
  { key: 'raleway', label: 'Raleway', stack: "var(--font-raleway), sans-serif", category: 'Sans' },
  { key: 'nunito', label: 'Nunito', stack: "var(--font-nunito), sans-serif", category: 'Sans' },
  { key: 'open-sans', label: 'Open Sans', stack: "var(--font-open-sans), sans-serif", category: 'Sans' },
  { key: 'roboto', label: 'Roboto', stack: "var(--font-roboto), sans-serif", category: 'Sans' },
  { key: 'josefin', label: 'Josefin Sans', stack: "var(--font-josefin), sans-serif", category: 'Sans' },
  { key: 'quicksand', label: 'Quicksand', stack: "var(--font-quicksand), sans-serif", category: 'Sans' },
  { key: 'dm-sans', label: 'DM Sans', stack: "var(--font-dm-sans), sans-serif", category: 'Sans' },
  { key: 'manrope', label: 'Manrope', stack: "var(--font-manrope), sans-serif", category: 'Sans' },
  { key: 'playfair', label: 'Playfair Display', stack: "var(--font-playfair), Georgia, serif", category: 'Serif' },
  { key: 'lora', label: 'Lora', stack: "var(--font-lora), Georgia, serif", category: 'Serif' },
  { key: 'merriweather', label: 'Merriweather', stack: "var(--font-merriweather), Georgia, serif", category: 'Serif' },
  { key: 'cinzel', label: 'Cinzel', stack: "var(--font-cinzel), Georgia, serif", category: 'Serif' },
  { key: 'bebas', label: 'Bebas Neue', stack: "var(--font-bebas), Impact, sans-serif", category: 'Display' },
  { key: 'abril', label: 'Abril Fatface', stack: "var(--font-abril), Georgia, serif", category: 'Display' },
  { key: 'pacifico', label: 'Pacifico', stack: "var(--font-pacifico), cursive", category: 'Handwritten' },
  { key: 'dancing', label: 'Dancing Script', stack: "var(--font-dancing), cursive", category: 'Handwritten' },
  { key: 'caveat', label: 'Caveat', stack: "var(--font-caveat), cursive", category: 'Handwritten' },
];

export const FONT_KEYS = FONT_CATALOG.map((f) => f.key) as [FontKey, ...FontKey[]];

const FONT_MAP = new Map(FONT_CATALOG.map((f) => [f.key, f]));

/** Resolve a font key → CSS font stack. Unknown/legacy keys fall back to the first entry. */
export function fontStack(key: string): string {
  return (FONT_MAP.get(key as FontKey) ?? FONT_CATALOG[0]).stack;
}

/** Label for a font key (for the picker trigger). */
export function fontLabel(key: string): string {
  return (FONT_MAP.get(key as FontKey) ?? FONT_CATALOG[0]).label;
}
