'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

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
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Choose a new password</CardTitle>
        </CardHeader>
        <CardContent>
          {phase === 'checking' && <p className="text-sm text-muted-foreground">Verifying your link…</p>}

          {phase === 'invalid' && (
            <div className="space-y-4 text-sm">
              <p>This password reset link is invalid or has expired.</p>
              <Link href="/forgot-password" className="underline text-foreground">
                Request a new link
              </Link>
            </div>
          )}

          {phase === 'done' && (
            <div className="space-y-4 text-sm">
              <p className="font-medium text-primary">Your password has been updated.</p>
              <Link href="/dashboard" className="underline text-foreground">
                Continue to your dashboard
              </Link>
            </div>
          )}

          {(phase === 'ready' || phase === 'saving') && (
            <form onSubmit={onSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="password">New password</Label>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  required
                />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button type="submit" className="w-full" disabled={phase === 'saving'}>
                {phase === 'saving' ? 'Saving…' : 'Update password'}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
