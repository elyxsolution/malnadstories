'use client';

import { useState } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import { signIn, type SignInState } from '@/lib/actions/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';
import { Label } from '@/components/ui/label';
import { LUX_PRIMARY } from '@/components/brand';
import { brandFontVars } from '@/lib/fonts';
import AuthShell from '../_auth-shell';
import GoogleAuth from '../_google-auth';

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" className={`w-full ${LUX_PRIMARY}`} disabled={pending}>
      {pending && <Loader2 className="animate-spin" />}
      {pending ? 'Signing in…' : 'Sign In'}
    </Button>
  );
}

export default function LoginPage() {
  const [state, formAction] = useFormState<SignInState, FormData>(signIn, null);
  // Controlled so the typed email survives a failed sign-in (the server action re-renders).
  const [email, setEmail] = useState('');

  return (
    <div className={`${brandFontVars} font-ui`}>
      <AuthShell title="Welcome Back" subtitle="Enter your credentials to access your memory workspace.">
        <GoogleAuth />

        <form action={formAction} className="mt-4 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="password">Password</Label>
              <Link
                href="/forgot-password"
                className="text-xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              >
                Forgot?
              </Link>
            </div>
            <PasswordInput id="password" name="password" autoComplete="current-password" required />
          </div>

          <label htmlFor="remember" className="flex items-center gap-2 text-sm text-muted-foreground">
            <input id="remember" name="remember" type="checkbox" defaultChecked className="h-4 w-4" />
            Stay logged in
          </label>

          {state?.error && (
            <p role="alert" className="text-sm text-destructive">
              {state.error}
            </p>
          )}

          <SubmitButton />
        </form>

        <p className="mt-6 text-sm text-muted-foreground">
          New traveler?{' '}
          <Link href="/signup" className="font-medium text-foreground underline-offset-2 hover:underline">
            Create an account
          </Link>
        </p>
      </AuthShell>
    </div>
  );
}
