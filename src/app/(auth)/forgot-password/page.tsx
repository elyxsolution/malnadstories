'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useFormStatus } from 'react-dom';
import { requestPasswordReset } from '@/lib/actions/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { LUX_PRIMARY } from '@/components/brand';
import { brandFontVars } from '@/lib/fonts';
import AuthShell from '../_auth-shell';

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" className={`w-full ${LUX_PRIMARY}`} disabled={pending}>
      {pending ? 'Sending…' : 'Send reset link'}
    </Button>
  );
}

export default function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);

  // The action always reports success (no user enumeration); we show the same neutral
  // confirmation regardless of whether the address has an account.
  const action = async (formData: FormData) => {
    await requestPasswordReset(formData);
    setSent(true);
  };

  return (
    <div className={`${brandFontVars} font-ui`}>
      <AuthShell
        eyebrow="Account recovery"
        title="Reset your password."
        subtitle="Enter your email and we’ll send a secure link to set a new one."
      >
        {sent ? (
          <div className="space-y-4 text-sm">
            <p className="text-muted-foreground">
              If an account exists for that email, we’ve sent a link to reset your password. Please check your inbox
              (and spam folder).
            </p>
            <Link href="/login" className="font-medium text-foreground underline-offset-2 hover:underline">
              Back to log in
            </Link>
          </div>
        ) : (
          <form action={action} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" type="email" autoComplete="email" required />
            </div>
            <SubmitButton />
            <p className="text-center text-sm text-muted-foreground">
              <Link href="/login" className="underline-offset-2 hover:text-foreground hover:underline">
                Back to log in
              </Link>
            </p>
          </form>
        )}
      </AuthShell>
    </div>
  );
}
