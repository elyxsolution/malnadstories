/**
 * THE POST-AUTHENTICATION CONTINUATION — one validator, one encoder, one default.
 *
 * PHASE 2. A visitor browsing the public design gallery may press "Use this design" without
 * being signed in. The design they chose must survive the login/signup round trip, and the
 * mechanism for that is DELIBERATELY the one this repository already had: a validated,
 * same-origin RELATIVE PATH carried as `?next=`. `/auth/callback` has validated one since the
 * password-reset work; this file is that rule extracted so the login page, the signup page, the
 * Google OAuth entry, the server action, the middleware and the app layout all apply it
 * IDENTICALLY instead of four near-copies drifting apart.
 *
 * WHY A PATH AND NOT A STORE. The selected design is already expressible as a destination —
 * `/albums/new?design=<id>` — so the continuation needs no session record, no cookie, no
 * localStorage entry and no React state. It survives a full page load, an email-link round trip
 * and an OAuth redirect for free, because a URL is the one piece of state a browser always
 * carries. It also means nothing about a design is *stored* anywhere: the id travels in the
 * address bar, and the server re-resolves it against the catalog before it means anything.
 *
 * WHY THE VALIDATION IS SHAPED THIS WAY. `next` is attacker-controllable, so it is an open
 * redirect unless it is provably same-origin. Anything that is not a single-slash-prefixed
 * relative path is rejected outright — no parsing, no normalising, no "fix it up" — because the
 * only safe way to handle `//evil.com`, `https://evil.com`, `/\evil.com` and their percent- and
 * backslash-encoded relatives is to refuse them. A rejected value is not an error the customer
 * ever sees; it silently becomes the default destination.
 *
 * PURE. No `server-only`, no I/O, no Next import — a Client Component (the login form) and the
 * middleware (edge runtime) both need it, and the tests import it directly.
 */

/** Where a customer lands when nothing else was requested. */
export const DEFAULT_AFTER_AUTH = '/dashboard';

/**
 * THE TWO PAGES A DESTINATION MAY NEVER BE.
 *
 * Middleware bounces an ALREADY-AUTHENTICATED visitor off /login and /signup to their pending
 * destination — so a destination of /login would bounce straight back to /login, for ever.
 *
 * /reset-password and /forgot-password are deliberately NOT here: the password-reset flow is
 * built on /auth/callback?next=/reset-password, and neither page is one an authenticated
 * visitor is redirected away from.
 */
const NOT_A_DESTINATION = ['/login', '/signup'];

/**
 * The ONE rule. Returns the path unchanged when it is a safe same-origin destination, else null.
 *
 * Accepted: `/dashboard`, `/albums/new?design=<uuid>`, `/support/requests#open`.
 * Rejected: absolute URLs, protocol-relative `//host`, backslash tricks, `/\`, anything with a
 *   control character (a header/URL smuggling vector), and anything unreasonably long.
 */
export function safeNextPath(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  if (raw.length === 0 || raw.length > 512) return null;
  // A single leading slash, and the SECOND character may not be another slash or a backslash —
  // that pair is what turns a "relative" path into a protocol-relative absolute one.
  if (!/^\/[^/\\]/.test(raw)) return null;
  // Control characters (incl. \n, \r, \t and NUL) never belong in a redirect target.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(raw)) return null;
  // A destination that is itself an auth page is a redirect loop, not a destination.
  const path = raw.split(/[?#]/, 1)[0];
  if (NOT_A_DESTINATION.includes(path)) return null;
  return raw;
}

/** The same rule, with the default applied — what a redirect actually uses. */
export function resolveNextPath(raw: string | null | undefined): string {
  return safeNextPath(raw) ?? DEFAULT_AFTER_AUTH;
}

/**
 * Append a validated `?next=` to an auth destination. An unsafe or absent value simply produces
 * the bare path, so a caller can pass whatever it has without branching.
 */
export function withNext(path: string, next: string | null | undefined): string {
  const safe = safeNextPath(next);
  return safe ? `${path}?next=${encodeURIComponent(safe)}` : path;
}

/** `/login`, carrying the destination to return to. */
export function loginHref(next?: string | null): string {
  return withNext('/login', next);
}

/** `/signup`, carrying the destination to return to. */
export function signupHref(next?: string | null): string {
  return withNext('/signup', next);
}

/**
 * The Supabase callback URL for an email-verification or OAuth round trip.
 *
 * Both flows re-enter the app at `/auth/callback`, which exchanges the code and then honours
 * `next` through this same validator — so a design chosen before signing up is still the
 * destination after the verification email is clicked.
 */
export function authCallbackUrl(origin: string, next?: string | null): string {
  return `${origin}${withNext('/auth/callback', next)}`;
}
