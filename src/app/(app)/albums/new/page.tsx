import { db } from '@/db';
import { products } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { listActiveCoverOptions } from '@/lib/covers';
import { brandFontVars } from '@/lib/fonts';
import WorkerPrewarm from '@/components/worker/worker-prewarm';
import CreateWizard from './_wizard';

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
    <div className={`${brandFontVars} font-ui`}>
      {/* Pre-warm the worker: this user is about to upload photos in the wizard. */}
      <WorkerPrewarm />
      <CreateWizard products={activeProducts} covers={covers} />
    </div>
  );
}
