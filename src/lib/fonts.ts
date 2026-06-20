import { Fraunces, Plus_Jakarta_Sans } from 'next/font/google';

/**
 * Malnad Stories editorial typography, shared across the premium customer
 * surfaces (Builder + the purchase journey). Fraunces = display/emotional voice
 * (titles, album names, prices, counters); Plus Jakarta Sans = the UI voice.
 *
 * Exposed as CSS variables applied on each surface's wrapper, so the rest of the
 * app (Inter, set on <body>) is untouched. Created once here to avoid duplicate
 * next/font instances.
 */
export const fraunces = Fraunces({ subsets: ['latin'], display: 'swap', variable: '--font-display' });
export const jakarta = Plus_Jakarta_Sans({ subsets: ['latin'], display: 'swap', variable: '--font-ui' });

/** Convenience: the class set that turns on builder/brand typography on a wrapper. */
export const brandFontVars = `${fraunces.variable} ${jakarta.variable}`;
