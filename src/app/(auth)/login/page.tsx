'use client';

import { useFormState, useFormStatus } from 'react-dom';
import Link from 'next/link';
import { signIn, type SignInState } from '@/lib/actions/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? 'Signing in…' : 'Log in'}
    </Button>
  );
}

export default function LoginPage() {
  const [state, formAction] = useFormState<SignInState, FormData>(signIn, null);

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Welcome back</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={formAction} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" type="email" autoComplete="email" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
              />
            </div>

            <label htmlFor="remember" className="flex items-center gap-2 text-sm">
              <input
                id="remember"
                name="remember"
                type="checkbox"
                defaultChecked
                className="h-4 w-4"
              />
              Stay logged in
            </label>

            {state?.error && <p className="text-sm text-red-600">{state.error}</p>}

            <SubmitButton />

            <p className="text-sm text-center text-muted-foreground">
              Don&apos;t have an account?{' '}
              <Link href="/signup" className="underline text-foreground">
                Sign up
              </Link>
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
