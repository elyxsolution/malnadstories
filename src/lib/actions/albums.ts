'use server';

import { createClient } from '@/lib/supabase/server';
import { db } from '@/db';
import { albums, products } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { CreateAlbumSchema } from '@/lib/validations';

export type AlbumActionState = { error: string } | null;

export async function createAlbum(
  _prevState: AlbumActionState,
  formData: FormData,
): Promise<AlbumActionState> {
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

  // Verify the product exists and is active — size comes from the DB, never from user input
  const [product] = await db
    .select({ pages: products.pages })
    .from(products)
    .where(eq(products.id, parsed.data.productId))
    .limit(1);

  if (!product) {
    return { error: 'Invalid size selected. Please try again.' };
  }

  // userId is always taken from the verified session, not from the form
  const [album] = await db
    .insert(albums)
    .values({
      userId: user.id,
      title: parsed.data.title,
      size: product.pages,
      status: 'draft',
    })
    .returning({ id: albums.id });

  redirect(`/albums/${album.id}/build`);
}
