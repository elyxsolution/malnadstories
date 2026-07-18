'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';

/**
 * "Continue with Google" — the OAuth entry shared by the login + signup pages.
 *
 * Deliberately reuses the EXISTING flow end-to-end: signInWithOAuth runs the same PKCE
 * handshake email signup already uses (the @supabase/ssr browser client stores the code
 * verifier in a cookie), redirects to Google, and returns to the SAME /auth/callback
 * route — which already exchanges the code for a session and upserts the profiles row
 * (belt-and-suspenders on top of the on_auth_user_created trigger). No new callback, no
 * new auth architecture, no schema/RLS/session change. Identity is the Supabase UUID, so
 * repeated Google logins reuse the one profile and never create a duplicate.
 */
export default function GoogleAuth() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function continueWithGoogle() {
    setError(null);
    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        // The very same callback the email flow lands on; its `next` defaults to /dashboard.
        redirectTo: `${window.location.origin}/auth/callback`,
        // Let returning users pick which Google account to use.
        queryParams: { prompt: 'select_account' },
      },
    });
    // On success the page is already navigating to Google — keep the spinner up. Only a
    // pre-redirect failure (misconfiguration / offline) falls through to here.
    if (error) {
      setError('Could not start Google sign-in. Please try again.');
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <Button
        type="button"
        size="lg"
        variant="outline"
        className="w-full"
        onClick={continueWithGoogle}
        disabled={loading}
      >
        {loading ? <Loader2 className="animate-spin" /> : <GoogleIcon />}
        Continue with Google
      </Button>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      {/* OR divider — the chip sits on the shell's bg-background surface. */}
      <div className="relative">
        <div aria-hidden className="absolute inset-0 flex items-center">
          <span className="w-full border-t border-border" />
        </div>
        <div className="relative flex justify-center">
          <span className="bg-background px-3 text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            or
          </span>
        </div>
      </div>
    </div>
  );
}

/** Official multi-colour Google "G". Brand asset — keeps its own colours by design. */
function GoogleIcon() {
  return (
    <svg viewBox="0 0 18 18" className="size-4" aria-hidden focusable="false">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"
      />
    </svg>
  );
}
