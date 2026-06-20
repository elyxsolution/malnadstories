'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { LUX_PRIMARY } from '@/components/brand';
import { brandFontVars } from '@/lib/fonts';
import AuthShell from '../_auth-shell';

type Phase = 'checking' | 'ready' | 'invalid' | 'saving' | 'done';

export default function ResetPasswordPage() {
  const [phase, setPhase] = useState<Phase>('checking');
  const [error, setError] = useState<string | null>(null);

  // The /auth/callback exchanged the reset code for a recovery session before
  // redirecting here. If there is no session, the link was invalid/expired/used.
  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      setPhase(data.user ? 'ready' : 'invalid');
    });
  }, []);

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const password = String(new FormData(e.currentTarget).get('password') ?? '');
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    setPhase('saving');
    setError(null);
    const supabase = createClient();
    const { error: updErr } = await supabase.auth.updateUser({ password });
    if (updErr) {
      setError('Could not update your password. The link may have expired — request a new one.');
      setPhase('ready');
      return;
    }
    setPhase('done');
  };

  return (
    <div className={`${brandFontVars} font-ui`}>
      <AuthShell eyebrow="Account recovery" title="Choose a new password.">
        {phase === 'checking' && <p className="text-sm text-muted-foreground">Verifying your link…</p>}

        {phase === 'invalid' && (
          <div className="space-y-4 text-sm">
            <p className="text-muted-foreground">This password reset link is invalid or has expired.</p>
            <Link href="/forgot-password" className="font-medium text-foreground underline-offset-2 hover:underline">
              Request a new link
            </Link>
          </div>
        )}

        {phase === 'done' && (
          <div className="flex flex-col items-center gap-4 text-center text-sm">
            <span className="grid h-12 w-12 place-items-center rounded-full bg-primary/[0.07] text-primary ring-1 ring-primary/15">
              <CheckCircle2 className="h-6 w-6" />
            </span>
            <p className="font-medium text-foreground">Your password has been updated.</p>
            <Button render={<Link href="/dashboard" />} className={`w-full ${LUX_PRIMARY}`} size="lg">
              Continue to your dashboard
            </Button>
          </div>
        )}

        {(phase === 'ready' || phase === 'saving') && (
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="password">New password</Label>
              <Input id="password" name="password" type="password" autoComplete="new-password" minLength={8} required />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" size="lg" className={`w-full ${LUX_PRIMARY}`} disabled={phase === 'saving'}>
              {phase === 'saving' ? 'Saving…' : 'Update password'}
            </Button>
          </form>
        )}
      </AuthShell>
    </div>
  );
}
