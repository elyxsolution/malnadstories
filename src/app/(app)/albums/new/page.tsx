import Link from 'next/link';
import { db } from '@/db';
import { products } from '@/db/schema';
import { eq } from 'drizzle-orm';
import CreateAlbumForm from './_form';
import { listActiveCoverOptions } from '@/lib/covers';
import WorkerPrewarm from '@/components/worker/worker-prewarm';

export default async function NewAlbumPage() {
  const [activeProducts, covers] = await Promise.all([
    db
      .select({
        id: products.id,
        name: products.name,
        pages: products.pages,
        basePrice: products.basePrice,
      })
      .from(products)
      .where(eq(products.isActive, true))
      .orderBy(products.pages),
    listActiveCoverOptions(),
  ]);

  return (
    <div className="p-8 max-w-xl mx-auto">
      {/* Pre-warm the worker: this user is about to build an album (upload/PDF soon). */}
      <WorkerPrewarm />
      <p className="text-sm text-muted-foreground">
        <Link href="/dashboard" className="hover:underline">
          Dashboard
        </Link>
        {' / '}New album
      </p>
      <h1 className="mt-2 text-2xl font-bold">New album</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Give your album a name, choose a size, and pick a cover design.
      </p>

      <div className="mt-8">
        <CreateAlbumForm products={activeProducts} covers={covers} />
      </div>
    </div>
  );
}
