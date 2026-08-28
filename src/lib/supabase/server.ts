import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { boundedFetch } from './timeout';

export function createClient() {
  const cookieStore = cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      // Supabase ships no request timeout of its own, so an unresponsive Supabase service
      // holds the request open until the platform kills it. This bounds each call AND the
      // total this request may spend in Supabase, both an order of magnitude above healthy
      // latency — it never fires on a healthy call, and only converts "hangs forever" into an
      // ordinary error the existing code paths already handle. See ./timeout.ts.
      global: { fetch: boundedFetch() },
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          // "Stay logged in" support: when the user opted out (remember_me="0"),
          // drop maxAge/expires so the Supabase auth cookies become SESSION cookies
          // that clear on browser close. Applied here means it also holds on token
          // refresh, not just at login. Default (cookie absent or "1") = persistent.
          const sessionOnly = cookieStore.get('remember_me')?.value === '0';

          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              const opts = sessionOnly
                ? { ...options, maxAge: undefined, expires: undefined }
                : options;
              cookieStore.set(name, value, opts);
            });
          } catch {
            // Called from a Server Component — cookies are read-only here
          }
        },
      },
    },
  );
}
