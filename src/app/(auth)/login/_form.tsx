'use client';

import { useState } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import Link from 'next/link';
import { InlineLoader } from '@/components/loading';
import { signIn, type SignInState } from '@/lib/actions/auth';
import { signupHref } from '@/lib/auth/next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';
import { Label } from '@/components/ui/label';
import { LUX_PRIMARY } from '@/components/brand';
import GoogleAuth from '../_google-auth';

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" className={`w-full ${LUX_PRIMARY}`} disabled={pending}>
      {pending && <InlineLoader />}
      {pending ? 'Signing in…' : 'Sign In'}
    </Button>
  );
}

/**
 * The sign-in form. Split out of `page.tsx` so the PAGE can be a Server Component that reads
 * `searchParams` — the destination a customer was heading for arrives as a prop rather than
 * through `useSearchParams`, which would have forced a Suspense boundary and made this screen's
 * rendering mode a side effect of a query parameter.
 *
 * `next` is ALREADY VALIDATED by the page. It is re-validated on the server inside `signIn`
 * anyway, because a hidden input is client-editable and a redirect target is exactly the kind of
 * value that must never be trusted from a form.
 */
export default function LoginForm({ next, notice }: { next: string | null; notice: string | null }) {
  const [state, formAction] = useFormState<SignInState, FormData>(signIn, null);
  // Controlled so the typed email survives a failed sign-in (the server action re-renders).
  const [email, setEmail] = useState('');

  return (
    <>
      {/* A failed callback (expired or replayed verification link, cancelled OAuth) lands here.
          It is stated plainly and non-alarmingly — the remedy is simply to sign in again, and
          the destination they were heading for is still attached to this form. */}
      {notice && (
        <p role="alert" className="mb-4 rounded-sm border border-border bg-secondary/60 px-3 py-2 text-sm text-muted-foreground">
          {notice}
        </p>
      )}

      <GoogleAuth next={next} />

      <form action={formAction} className="mt-4 space-y-4">
        {/* The continuation, carried through the POST. Re-validated server-side. */}
        {next && <input type="hidden" name="next" value={next} />}

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
        {/* The destination travels with them — creating an account must not cost them the
            design they were about to use. */}
        <Link href={signupHref(next)} className="font-medium text-foreground underline-offset-2 hover:underline">
          Create an account
        </Link>
      </p>
    </>
  );
}
