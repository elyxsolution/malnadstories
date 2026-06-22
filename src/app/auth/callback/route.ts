import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { validateName } from '@/lib/auth/policy';

// Only allow same-site, single-slash relative paths as the post-auth redirect target
// (prevents open redirects via ?next=//evil.com, ?next=https://evil.com, backslashes…).
function safeNext(raw: string | null): string {
  return raw && /^\/[^/\\]/.test(raw) ? raw : '/dashboard';
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = safeNext(searchParams.get('next'));

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

  return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`);
}
