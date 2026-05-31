'use server';

import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { CreateAlbumSchema } from '@/lib/validations';

export type AlbumActionState = { error: string } | null;

export async function createAlbum(
  _prevState: AlbumActionState,
  formData: FormData,
): Promise<AlbumActionState> {
  // Supabase server client carries the user's JWT → auth.uid() resolves in Postgres.
  // RLS enforces: albums INSERT check (user_id = auth.uid()), products SELECT (is_active = true).
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  const parsed = CreateAlbumSchema.safeParse({
    title: formData.get('title'),
    productId: formData.get('productId'),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  // RLS policy "public_read_active_products" already filters inactive products.
  // If productId is tampered or the product is inactive, this returns null.
  const { data: product } = await supabase
    .from('products')
    .select('pages')
    .eq('id', parsed.data.productId)
    .maybeSingle();

  if (!product) {
    return { error: 'Invalid size selected. Please try again.' };
  }

  // user_id is always taken from the verified JWT session, never from form input.
  // The RLS INSERT check (user_id = auth.uid()) enforces this at the DB level too.
  const { data: album, error: insertError } = await supabase
    .from('albums')
    .insert({
      user_id: user.id,
      title: parsed.data.title,
      size: (product as { pages: number }).pages,
      status: 'draft',
    })
    .select('id')
    .single();

  if (insertError || !album) {
    console.error('Album insert error:', insertError);
    return { error: 'Could not create album. Please try again.' };
  }

  redirect(`/albums/${album.id}/build`);
}
