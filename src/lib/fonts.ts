import { Cormorant_Garamond, Work_Sans } from 'next/font/google';

/**
 * Malnad Stories editorial typography — the Claude Design "Foundations" typefaces.
 * Cormorant Garamond = the display/emotional voice (titles, album names, prices,
 * counters); Work Sans = the UI voice. Exposed as the SAME CSS variables the app
 * already consumes (`--font-display` / `--font-ui` → tailwind `font-display`/`font-ui`),
 * so swapping the families here re-skins every surface globally without touching call
 * sites. Created once to avoid duplicate next/font instances.
 */
export const fraunces = Cormorant_Garamond({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  style: ['normal', 'italic'],
  display: 'swap',
  variable: '--font-display',
});

export const jakarta = Work_Sans({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600'],
  display: 'swap',
  variable: '--font-ui',
});

/** Convenience: the class set that turns on the editorial typography on a wrapper. */
export const brandFontVars = `${fraunces.variable} ${jakarta.variable}`;
