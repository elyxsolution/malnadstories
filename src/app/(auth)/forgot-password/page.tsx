'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useFormStatus } from 'react-dom';
import { requestPasswordReset } from '@/lib/actions/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" disabled={pending}>
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
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Reset your password</CardTitle>
        </CardHeader>
        <CardContent>
          {sent ? (
            <div className="space-y-4 text-sm">
              <p>
                If an account exists for that email, we&apos;ve sent a link to reset your
                password. Please check your inbox (and spam folder).
              </p>
              <Link href="/login" className="underline text-foreground">
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
              <p className="text-center text-sm">
                <Link href="/login" className="text-muted-foreground underline">
                  Back to log in
                </Link>
              </p>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
