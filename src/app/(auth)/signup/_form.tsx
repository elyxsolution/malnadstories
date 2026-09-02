'use client';

import { useState } from 'react';
import Link from 'next/link';
import { MailCheck } from 'lucide-react';
import { InlineLoader } from '@/components/loading';
import { createClient } from '@/lib/supabase/client';
import { SignupSchema } from '@/lib/validations';
import { NAME_MAX, PASSWORD_MAX, PASSWORD_MIN } from '@/lib/auth/policy';
import { authCallbackUrl, loginHref } from '@/lib/auth/next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';
import { Label } from '@/components/ui/label';
import { LUX_PRIMARY } from '@/components/brand';
import AuthShell from '../_auth-shell';
import GoogleAuth from '../_google-auth';

/**
 * CREATE AN ACCOUNT. Split out of `page.tsx` so the page can be a Server Component that reads
 * and validates `?next=` (see the login page for why). The signup mechanism is untouched: the
 * browser client still calls `supabase.auth.signUp` directly, so Supabase's own rate limiting
 * remains the gate, and the verification link still returns to `/auth/callback`.
 *
 * The ONE addition is that the callback URL now carries the destination, so a customer who chose
 * a design, created an account and clicked the verification link in their email lands on that
 * design — across a completely fresh page load, in a possibly different tab, with no client
 * state surviving. That is exactly why the continuation is a URL and not a store.
 */
export default function SignupForm({ next }: { next: string | null }) {
  const [fields, setFields] = useState({ name: '', email: '', password: '', confirm: '' });
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  function update(field: keyof typeof fields) {
    return (e: React.ChangeEvent<HTMLInputElement>) =>
      setFields((prev) => ({ ...prev, [field]: e.target.value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    // Confirm-password is a client-side guard (no schema change); the server still validates name/email/password.
    if (fields.password !== fields.confirm) {
      setError('Passwords do not match.');
      return;
    }

    const result = SignupSchema.safeParse({ name: fields.name, email: fields.email, password: fields.password });
    if (!result.success) {
      setError(result.error.issues[0].message);
      return;
    }

    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signUp({
      email: fields.email,
      password: fields.password,
      options: {
        data: { name: fields.name },
        emailRedirectTo: authCallbackUrl(window.location.origin, next),
      },
    });
    setLoading(false);

    if (error) {
      setError(error.message);
      return;
    }
    setSuccess(true);
  }

  if (success) {
    return (
      <AuthShell title="Check your email" subtitle="One last step to activate your account.">
        <div className="flex flex-col items-center gap-4 text-center">
          <span className="grid h-12 w-12 place-items-center rounded-full bg-primary/[0.07] text-primary ring-1 ring-primary/15">
            <MailCheck className="h-6 w-6" />
          </span>
          <p className="text-sm text-muted-foreground">
            We sent a verification link to <strong className="text-foreground">{fields.email}</strong>. Click it to
            activate your account and start building.
          </p>
          <Link href={loginHref(next)} className="text-sm font-medium text-foreground underline-offset-2 hover:underline">
            Back to log in
          </Link>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Create Your Memory Workspace"
      subtitle="Start preserving your travels, bound beautifully."
    >
      <GoogleAuth next={next} />

      <form onSubmit={handleSubmit} className="mt-4 space-y-4">
        <div className="space-y-2">
          <Label htmlFor="name">Full name</Label>
          <Input
            id="name"
            type="text"
            autoComplete="name"
            maxLength={NAME_MAX}
            value={fields.name}
            onChange={update('name')}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" autoComplete="email" value={fields.email} onChange={update('email')} required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <PasswordInput
            id="password"
            name="password"
            autoComplete="new-password"
            minLength={PASSWORD_MIN}
            maxLength={PASSWORD_MAX}
            value={fields.password}
            onChange={update('password')}
            required
          />
          <p className="text-xs text-muted-foreground">
            Between {PASSWORD_MIN} and {PASSWORD_MAX} characters
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="confirm">Confirm password</Label>
          <PasswordInput
            id="confirm"
            name="confirm"
            autoComplete="new-password"
            maxLength={PASSWORD_MAX}
            value={fields.confirm}
            onChange={update('confirm')}
            required
          />
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <Button type="submit" size="lg" className={`w-full ${LUX_PRIMARY}`} disabled={loading}>
          {loading && <InlineLoader />}
          {loading ? 'Creating account…' : 'Create Account'}
        </Button>
      </form>

      <p className="mt-6 text-sm text-muted-foreground">
        Already have an account?{' '}
        <Link href={loginHref(next)} className="font-medium text-foreground underline-offset-2 hover:underline">
          Sign In
        </Link>
      </p>
    </AuthShell>
  );
}
