'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { LoginSchema } from '@/lib/validations';

const REMEMBER_MAX_AGE = 400 * 24 * 60 * 60; // ~400 days (browser cap)
const cookieDefaults = {
  path: '/' as const,
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
};

export type SignInState = { error: string } | null;

export async function signIn(
  _prevState: SignInState,
  formData: FormData,
): Promise<SignInState> {
  const parsed = LoginSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  // Checkbox is checked by default; absent value means the user unchecked it.
  const remember = formData.get('remember') !== null;
  const cookieStore = cookies();

  // Set the choice BEFORE signing in so the server client's setAll (which reads
  // remember_me) writes the auth cookies with the right persistence in this same
  // request. remember="1" → persistent; "0" → session cookie + login timestamp
  // for the absolute-age backstop in middleware.
  if (remember) {
    cookieStore.set('remember_me', '1', { ...cookieDefaults, maxAge: REMEMBER_MAX_AGE });
    cookieStore.delete('rm_login_at');
  } else {
    cookieStore.set('remember_me', '0', cookieDefaults); // session cookie
    cookieStore.set('rm_login_at', String(Date.now()), cookieDefaults); // session cookie
  }

  const supabase = createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error) {
    return { error: 'Invalid email or password' };
  }

  redirect('/dashboard');
}

export async function signOut() {
  const supabase = createClient();
  await supabase.auth.signOut();

  const cookieStore = cookies();
  cookieStore.delete('remember_me');
  cookieStore.delete('rm_login_at');

  redirect('/');
}
