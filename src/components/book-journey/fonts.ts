import { Cinzel, Jost, Lato } from 'next/font/google';
import localFont from 'next/font/local';

/**
 * BOOK JOURNEY TYPOGRAPHY — the artifact's faces, moved onto the project's font system.
 *
 * The artifact pulled Cinzel + Jost from `https://fonts.googleapis.com` with a `<link>` and
 * loaded Scriptorama from a relative `uploads/…ttf`. Neither survives here: the app's CSP is
 * `style-src 'self' 'unsafe-inline'` and `font-src 'self'`, so the stylesheet and the font files
 * would both be blocked. `next/font` self-hosts all four from our own origin, which is CSP-clean
 * and removes the render-blocking third-party request as well.
 *
 * The faces themselves are UNCHANGED — same families, same weights the artifact used.
 *
 * Two consumers need them, and they need them differently:
 *   · the stage markup, through the `--font-*` CSS variables (the ported inline styles were
 *     rewritten from `Cinzel,serif` to `var(--font-cinzel), serif` and so on); and
 *   · the engine's canvas textures, which build a `ctx.font` STRING and therefore need the real
 *     resolved family name — `next/font` generates a hashed one, so it is passed in explicitly
 *     via `BOOK_JOURNEY_FONT_FAMILIES` rather than hard-coded.
 */
const cinzel = Cinzel({ subsets: ['latin'], weight: ['400', '500', '600'], display: 'swap', variable: '--bj-cinzel' });
const jost = Jost({ subsets: ['latin'], weight: ['300', '400', '500'], display: 'swap', variable: '--bj-jost' });
const lato = Lato({ subsets: ['latin'], weight: ['300', '400', '700'], display: 'swap', variable: '--bj-lato' });

/** The artifact's display face for the wordmark and the book cover art. Shipped with the port. */
const scriptorama = localFont({
  src: './fonts/ScriptoramaMarkdownJF-Regular.ttf',
  weight: '400',
  style: 'normal',
  display: 'swap',
  variable: '--bj-scriptorama',
});

/** Apply on the journey section so the ported inline styles can resolve their variables. */
export const bookJourneyFontVars = [
  cinzel.variable,
  jost.variable,
  lato.variable,
  scriptorama.variable,
].join(' ');

/**
 * Resolved family names for `ctx.font` inside the engine's procedural canvas textures
 * (book cover art, page art, trail labels). Keys match the artifact's original family names.
 */
export const BOOK_JOURNEY_FONT_FAMILIES = {
  cinzel: cinzel.style.fontFamily,
  jost: jost.style.fontFamily,
  lato: lato.style.fontFamily,
  scriptorama: scriptorama.style.fontFamily,
} as const;

export type BookJourneyFontFamilies = typeof BOOK_JOURNEY_FONT_FAMILIES;
