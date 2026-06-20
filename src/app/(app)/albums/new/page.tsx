import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { db } from '@/db';
import { products } from '@/db/schema';
import { eq } from 'drizzle-orm';
import CreateAlbumForm from './_form';
import { listActiveCoverOptions } from '@/lib/covers';
import { brandFontVars } from '@/lib/fonts';
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
    <div className={`${brandFontVars} brand-surface font-ui min-h-[calc(100vh-3.5rem)]`}>
      {/* Pre-warm the worker: this user is about to build an album (upload/PDF soon). */}
      <WorkerPrewarm />
      <div className="animate-rise mx-auto max-w-xl px-4 py-10 sm:px-6">
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Your stories
        </Link>
        <p className="mt-5 text-[11px] font-semibold uppercase tracking-[0.18em] text-primary/70">Begin</p>
        <h1 className="mt-2 font-display text-[2.2rem] font-semibold leading-none tracking-tight">Begin a new story.</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          Give your album a name, choose its form, and pick a cover. You can change any of this while you build.
        </p>

        <div className="mt-8">
          <CreateAlbumForm products={activeProducts} covers={covers} />
        </div>
      </div>
    </div>
  );
}
