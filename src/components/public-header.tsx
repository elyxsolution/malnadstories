import { headers } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { getUserWithDeadline } from '@/lib/supabase/timeout';
import { loginHref, safeNextPath } from '@/lib/auth/next';
import PublicHeaderNav from '@/components/public-header-nav';

/**
 * THE PUBLIC HEADER — now a two-file component: this SERVER shell resolves who is looking, and
 * `public-header-nav.tsx` (unchanged in every other respect) draws the bar.
 *
 * WHY A SHELL AND NOT A CLIENT SESSION READ. The bar has always been a Client Component, because
 * it owns a scroll listener and a mobile sheet. Reading the session from inside it would mean a
 * second auth path in the browser, a flash of the wrong control on every public page, and client
 * state standing in for something the server already knows. Instead the answer is computed once,
 * on the server, and handed down as two plain values — a boolean and a string. **No public page
 * became a Client Component, and none needed to change: the import path is the same.**
 *
 * WHICH AUTH MECHANISM. The existing one, unchanged: `createClient()` (anon key + the user's
 * cookie) and `getUserWithDeadline`, the SAME bounded `getUser()` the middleware and the `(app)`
 * layout use. No service role, no second client, no cookie parsing, no user data beyond "is there
 * a validated session". For an anonymous visitor — most public traffic — `getUser()` returns in
 * about a millisecond WITHOUT a network call, because there is no `sb-*` cookie to validate (the
 * property `src/middleware.ts` documents). A timeout is treated as signed out: the visitor sees
 * Login, which is the harmless answer, and `/dashboard` refuses them anyway if they were wrong.
 *
 * THIS IS PRESENTATION ONLY. It decides which of two controls is drawn. `/dashboard` is still
 * protected server-side by `(app)/layout.tsx`, and nothing here is an authorization decision.
 *
 * ⚠️ COST, stated plainly: reading the session makes the pages that render this header render
 * per-request rather than being prerendered. Their expensive reads are untouched and still cached
 * (`listActiveBlueprints` under `templatesActive`, `listPublished` under `cms-public`, both 300s),
 * and their `export const revalidate = 300` still governs those caches — what is no longer reused
 * is the finished HTML. That is the unavoidable price of per-visitor chrome; the alternative was
 * resolving it in the browser, which trades it for a visible flash on every page.
 */
export async function PublicHeader() {
  const { user } = await getUserWithDeadline(createClient());

  /*
   * A PENDING CONTINUATION, PRESERVED (Phase 2). If this page was reached with a `?next=` still
   * in flight, the Login link carries it, so pressing Login cannot be the thing that discards the
   * design a visitor chose. Read from the query the middleware already forwards as `x-search`,
   * and put through the SAME validator every other caller uses — so it is impossible for this
   * link to become an open redirect, and an absent or unusable value simply yields a bare
   * `/login`, which is the right answer for ordinary public navigation.
   */
  const search = headers().get('x-search') ?? '';
  const pendingNext = safeNextPath(new URLSearchParams(search).get('next'));

  return <PublicHeaderNav signedIn={!!user} loginHref={loginHref(pendingNext)} />;
}

export default PublicHeader;
