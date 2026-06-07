'use server';

import { createClient } from '@/lib/supabase/server';
import { AddressSchema } from '@/lib/validations';

export type AddAddressResult = { ok: true; id: string } | { ok: false; error: string };

/**
 * Add a delivery address for the signed-in user.
 *
 * Authenticated client + RLS: the insert's user_id is taken from the verified JWT
 * (never from input), and the addresses policy (user_id = auth.uid()) is the
 * DB-level gate. If isDefault, clear any previous default first.
 */
export async function addAddress(input: unknown): Promise<AddAddressResult> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Not signed in' };

  const parsed = AddressSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const a = parsed.data;

  if (a.isDefault) {
    // RLS scopes this to the user's own rows.
    await supabase.from('addresses').update({ is_default: false }).eq('user_id', user.id);
  }

  const { data, error } = await supabase
    .from('addresses')
    .insert({
      user_id: user.id,
      full_name: a.fullName,
      line1: a.line1,
      city: a.city,
      state: a.state,
      pincode: a.pincode,
      is_default: a.isDefault,
    })
    .select('id')
    .single();

  if (error || !data) {
    console.error('addAddress error:', error);
    return { ok: false, error: 'Could not save address. Please try again.' };
  }

  return { ok: true, id: (data as { id: string }).id };
}
