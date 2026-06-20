'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

export type UpdateProfileResult = { ok: true } | { ok: false; error: string };

// Only the two fields the column-scoped grant (0019) lets `authenticated` write —
// role/id/created_at remain server-only. Empty phone clears it.
const UpdateProfileSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(80, 'Name is too long'),
  phone: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null),
    z
      .string()
      .regex(/^[+0-9 ()-]{6,20}$/, 'Enter a valid phone number')
      .nullable(),
  ),
});

/**
 * Update the signed-in user's profile name/phone (Account view).
 *
 * Authenticated client + RLS (`users_own_profile`, id = auth.uid()) is the gate; the
 * column-scoped UPDATE grant from 0019 permits ONLY (name, phone) — a request touching
 * role/id is rejected at the DB. Additive; no schema, ownership, or auth change.
 */
export async function updateProfile(input: unknown): Promise<UpdateProfileResult> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Not signed in' };

  const parsed = UpdateProfileSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  // RLS scopes the row to the owner; we also pin id for belt-and-suspenders.
  const { error } = await supabase
    .from('profiles')
    .update({ name: parsed.data.name, phone: parsed.data.phone })
    .eq('id', user.id);

  if (error) {
    console.error('updateProfile error:', error);
    return { ok: false, error: 'Could not save your details. Please try again.' };
  }

  revalidatePath('/account');
  return { ok: true };
}
