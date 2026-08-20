/**
 * THE ALBUM TITLE, DERIVED — because the customer is no longer asked for one (Phase 5).
 *
 * Naming a book before you have seen a single page of it is a decision made with no
 * information, so the creation flow stopped asking. `albums.title` did not go away: it is still
 * NOT NULL, still the name on the dashboard, the checkout summary, the order, the invoice and
 * the printed cover, and still fully editable later (on the cover canvas, or in Album Settings).
 * It simply gets its FIRST value from what the customer already told us about the trip.
 *
 * PURE, AND DELIBERATELY SO. No I/O, no clock, no `server-only`, no imports at all — the whole
 * rule is one function over two strings, which is what makes the edge cases (empty, whitespace,
 * control characters, Kannada, emoji, 200 characters) testable without a database or a browser.
 *
 * THE CHAIN — first candidate that normalises to something non-empty wins:
 *
 *     destination  →  travelDates  →  'Untitled Album'
 *
 * WHAT IS NOT IN THE CHAIN, and why:
 *
 *   • THE PRODUCT NAME. "Standard" is a SKU, not a name. It would print badly on a physical
 *     cover, and — because every album a customer owns is likely the same product — it would
 *     make every title in their library identical, which is worse than a plain fallback: the
 *     dashboard searches on this field. The product is already shown in its own right.
 *   • THE CREATION DATE. A derived title must be deterministic, and nothing in this codebase
 *     pins a timezone (every date is formatted `en-IN` against whatever zone the runtime
 *     happens to be in). A server in UTC would date a 1 a.m. IST album to the previous day.
 *     `travelDates` already carries the trip's dates, supplied by the customer, as text.
 */

/** What every album is called when the customer told us nothing usable about the trip. */
export const DEFAULT_ALBUM_TITLE = 'Untitled Album';

/**
 * The cap. Matches `UpdateAlbumDetailsSchema.title` and `CoverDesignSchema.title`, which is the
 * point: a derived title longer than those would load into Album Settings and then refuse to
 * save, stranding the customer in a form they never filled in.
 *
 * Counted in CODE POINTS, not UTF-16 units — `.slice(100)` on a string of emoji or Indic text
 * can cut a surrogate pair in half and produce a broken character.
 */
const MAX_TITLE = 100;

/**
 * The Unicode-aware patterns are built with `new RegExp` rather than written as literals: this
 * project's tsconfig sets no `target`, so TypeScript type-checks against ES5 and rejects the `u`
 * flag on a literal. Flags passed as a string are not checked, and the emitted code is Next/SWC's
 * (modern browsers + Node), where `u` and `\p{…}` are fully supported. Behaviour is identical;
 * only the way the pattern is spelled changes.
 */

/**
 * Invisible characters that are never content.
 *
 * `\p{Cc}` (C0/C1 controls) are replaced with a SPACE rather than deleted, so a pasted
 * "Coorg\nKarnataka" becomes two words instead of one; the collapse below tidies the result.
 */
const CONTROL = new RegExp('\\p{Cc}', 'gu');

/**
 * Direction and joining overrides, deleted outright.
 *
 * NOT `\p{Cf}` wholesale, which is the tempting shorthand and the wrong one: that class also
 * contains ZWJ (U+200D) and ZWNJ (U+200C), which are LOAD-BEARING in Devanagari and Kannada
 * conjuncts and in emoji sequences. Stripping them would silently mangle "ಕೊಡಗು" and split
 * family emoji into their parts. Only the bidi controls — which can reorder a display string
 * into something it does not say — and lone surrogates are removed.
 */
const OVERRIDES = new RegExp('[\\u200E\\u200F\\u202A-\\u202E\\u2066-\\u2069\\p{Cs}]', 'gu');

/** A trailing joiner (ZWJ / ZWNJ) has nothing left to join once the string has been cut. */
const DANGLING_JOINER = new RegExp('[\\u200C\\u200D]+$', 'u');

/**
 * A candidate reduced to plain, printable, single-spaced text — or '' if nothing survives.
 *
 * PLAIN TEXT, NOT MARKUP. The result is rendered by React and drawn onto the cover as text; it
 * is never interpolated into HTML, so quotes, angle brackets and ampersands are kept exactly as
 * the customer typed them. Escaping here would corrupt a perfectly good destination like
 * "Coorg & Chikmagalur".
 */
function normalize(value: string | null | undefined): string {
  if (typeof value !== 'string') return '';
  const cleaned = value
    .replace(CONTROL, ' ')
    .replace(OVERRIDES, '')
    // `\s` already covers NBSP, the en-quad family, line separators and U+FEFF.
    .replace(/\s+/g, ' ')
    .trim();
  if (cleaned.length <= MAX_TITLE) return cleaned;
  // Spread splits by code point, so a truncation can never leave half a character behind.
  return Array.from(cleaned).slice(0, MAX_TITLE).join('').replace(DANGLING_JOINER, '').trim();
}

/**
 * The album's starting name, from what the customer already told us.
 *
 * ALWAYS returns a non-empty string of at most 100 code points — `albums.title` is NOT NULL and
 * a blank name would render as an empty heading on the dashboard and an empty line on the cover.
 */
export function deriveAlbumTitle(input: {
  /** `albums.destination` — free text, already trimmed and length-bounded by Zod. */
  destination?: string | null;
  /**
   * `albums.travel_dates` — ALREADY a human-readable string ("3 Aug 2026 – 9 Aug 2026"),
   * composed in the wizard from the two date inputs and stored verbatim. Nothing is parsed or
   * re-formatted here: it is used as the customer's own words, which keeps this function free
   * of dates, locales and timezones entirely.
   */
  travelDates?: string | null;
}): string {
  return normalize(input.destination) || normalize(input.travelDates) || DEFAULT_ALBUM_TITLE;
}
