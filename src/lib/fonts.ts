import {
  Cormorant_Garamond,
  Work_Sans,
  La_Belle_Aurore,
  Poppins,
  Inter,
  Montserrat,
  Playfair_Display,
  Lora,
  Merriweather,
  Raleway,
  Nunito,
  Open_Sans,
  Roboto,
  Bebas_Neue,
  Pacifico,
  Dancing_Script,
  Caveat,
  Cinzel,
  Josefin_Sans,
  Abril_Fatface,
  Quicksand,
  DM_Sans,
  Manrope,
} from 'next/font/google';
import localFont from 'next/font/local';

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

/**
 * THE HEADING FACE — Scriptorama Markdown JF, self-hosted through `next/font/local`.
 *
 * This is the ONE definition of the family in the project. It is exposed as `--font-heading`
 * (tailwind `font-heading`), and `globals.css` applies it to every heading element from a
 * single central rule, so a new screen inherits the brand heading typography without opting in.
 *
 * The file lives in `src/lib/font-files/` rather than beside a component because two very
 * different surfaces need it: this global heading system, and the Book Journey engine, which
 * needs the RESOLVED family name for its canvas textures (`ctx.font` is a string, and
 * `next/font` generates a hashed family). `book-journey/fonts.ts` imports this same object,
 * so there is exactly one `@font-face` for it and exactly one copy of the file in the repo.
 */
export const scriptorama = localFont({
  src: './font-files/ScriptoramaMarkdownJF-Regular.ttf',
  weight: '400',
  style: 'normal',
  display: 'swap',
  variable: '--font-heading',
  // The face has a single cut. Naming a real fallback stack keeps a heading from being measured
  // against Times for the swap frame, which is what makes a font change read as a layout jump.
  fallback: ['Cormorant Garamond', 'Georgia', 'serif'],
});

export const handwritten = La_Belle_Aurore({
  subsets: ['latin'],
  weight: ['400'],
  display: 'swap',
  variable: '--font-accent-handwritten',
});

/** Convenience: the class set that turns on the editorial typography on a wrapper. */
export const brandFontVars = `${fraunces.variable} ${jakarta.variable} ${handwritten.variable} ${scriptorama.variable}`;

/**
 * Expanded album-builder font library (≈20 high-quality free Google fonts) — selectable for
 * BOTH cover and page text. next/font self-hosts each family and emits a CSS variable; the
 * actual font files are fetched only when a rendered element uses that family (font-display:
 * swap), so declaring all of them is cheap. The catalog (lib/builder/fonts-catalog.ts) maps a
 * font key → the matching `var(--font-*)`. Apply `builderFontVars` on any surface that renders
 * builder text (the builder, flipbook, PDF print route, admin/purchased previews).
 */
const poppins = Poppins({ subsets: ['latin'], weight: ['400', '500', '600', '700'], display: 'swap', variable: '--font-poppins' });
const inter = Inter({ subsets: ['latin'], weight: ['400', '500', '600', '700'], display: 'swap', variable: '--font-inter' });
const montserrat = Montserrat({ subsets: ['latin'], weight: ['400', '500', '600', '700'], display: 'swap', variable: '--font-montserrat' });
const playfair = Playfair_Display({ subsets: ['latin'], weight: ['400', '500', '600', '700'], display: 'swap', variable: '--font-playfair' });
const lora = Lora({ subsets: ['latin'], weight: ['400', '500', '600', '700'], display: 'swap', variable: '--font-lora' });
const merriweather = Merriweather({ subsets: ['latin'], weight: ['400', '700'], display: 'swap', variable: '--font-merriweather' });
const raleway = Raleway({ subsets: ['latin'], weight: ['400', '500', '600', '700'], display: 'swap', variable: '--font-raleway' });
const nunito = Nunito({ subsets: ['latin'], weight: ['400', '600', '700'], display: 'swap', variable: '--font-nunito' });
const openSans = Open_Sans({ subsets: ['latin'], weight: ['400', '600', '700'], display: 'swap', variable: '--font-open-sans' });
const roboto = Roboto({ subsets: ['latin'], weight: ['400', '500', '700'], display: 'swap', variable: '--font-roboto' });
const bebas = Bebas_Neue({ subsets: ['latin'], weight: ['400'], display: 'swap', variable: '--font-bebas' });
const pacifico = Pacifico({ subsets: ['latin'], weight: ['400'], display: 'swap', variable: '--font-pacifico' });
const dancing = Dancing_Script({ subsets: ['latin'], weight: ['400', '700'], display: 'swap', variable: '--font-dancing' });
const caveat = Caveat({ subsets: ['latin'], weight: ['400', '700'], display: 'swap', variable: '--font-caveat' });
const cinzel = Cinzel({ subsets: ['latin'], weight: ['400', '600', '700'], display: 'swap', variable: '--font-cinzel' });
const josefin = Josefin_Sans({ subsets: ['latin'], weight: ['400', '600', '700'], display: 'swap', variable: '--font-josefin' });
const abril = Abril_Fatface({ subsets: ['latin'], weight: ['400'], display: 'swap', variable: '--font-abril' });
const quicksand = Quicksand({ subsets: ['latin'], weight: ['400', '500', '600', '700'], display: 'swap', variable: '--font-quicksand' });
const dmSans = DM_Sans({ subsets: ['latin'], weight: ['400', '500', '700'], display: 'swap', variable: '--font-dm-sans' });
const manrope = Manrope({ subsets: ['latin'], weight: ['400', '500', '600', '700'], display: 'swap', variable: '--font-manrope' });

/** All builder-library font CSS variables (brand + expanded), for surfaces that render text. */
export const builderFontVars = [
  fraunces.variable,
  jakarta.variable,
  handwritten.variable,
  poppins.variable,
  inter.variable,
  montserrat.variable,
  playfair.variable,
  lora.variable,
  merriweather.variable,
  raleway.variable,
  nunito.variable,
  openSans.variable,
  roboto.variable,
  bebas.variable,
  pacifico.variable,
  dancing.variable,
  caveat.variable,
  cinzel.variable,
  josefin.variable,
  abril.variable,
  quicksand.variable,
  dmSans.variable,
  manrope.variable,
].join(' ');

