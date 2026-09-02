import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { validateName } from '@/lib/auth/policy';
import { resolveNextPath } from '@/lib/auth/next';

/*
 * THE POST-AUTH DESTINATION.
 *
 * The open-redirect rule that used to live here as a local `safeNext` now lives in
 * `lib/auth/next.ts`. Phase 2 gave four more callers the same question (the login form, the
 * signup form, the Google entry, the app layout's guard), and five near-identical regexes is
 * how an open redirect eventually gets shipped. The BEHAVIOUR is unchanged: a single-slash
 * relative path is honoured, everything else becomes /dashboard.
 *
 * THIS IS ALSO THE BLUEPRINT CONTINUATION POINT. A visitor who pressed "Use this design" while
 * signed out arrives here with `next=/albums/new?design=<id>` after verifying their email or
 * returning from Google, and lands on the design they chose — the id having travelled in the
 * URL and never in any store. The id itself means nothing until `/albums/new` re-resolves it
 * against the active catalog server-side.
 */

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = resolveNextPath(searchParams.get('next'));

  if (code) {
    const cookieStore = cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          },
        },
      },
    );

    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // Belt-and-suspenders: ensure a profiles row exists even if the
      // on_auth_user_created trigger misfired (e.g. signup before migration).
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        // Close the server gap: user_metadata.name is client-supplied at signup, so
        // normalise + validate it here against the shared identity policy before it is
        // ever persisted. A name that fails validation falls back to the email local
        // part (also normalised) so the upsert always has a sane value.
        const rawName = (user.user_metadata?.name as string | undefined) ?? '';
        const checked = validateName(rawName);
        const fallback = validateName(user.email?.split('@')[0] ?? 'User');
        const name = checked.ok
          ? checked.value
          : fallback.ok
            ? fallback.value
            : 'User';

        await supabase.from('profiles').upsert(
          { id: user.id, name },
          { onConflict: 'id', ignoreDuplicates: true },
        );
      }

      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  /*
   * CALLBACK FAILURE — a missing/expired/replayed code, or a failed exchange.
   *
   * The customer is returned to sign-in with the existing `error=auth_callback_failed` marker
   * AND their intended destination intact, so retrying the sign-in still lands them on the
   * design they picked rather than dropping them on the dashboard. `next` is already validated
   * above, so re-emitting it cannot smuggle an off-site redirect through the error path.
   */
  const failed = new URL('/login', origin);
  failed.searchParams.set('error', 'auth_callback_failed');
  if (next !== '/dashboard') failed.searchParams.set('next', next);
  return NextResponse.redirect(failed);
}
