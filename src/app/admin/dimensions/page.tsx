import Link from 'next/link';
import { Plus } from 'lucide-react';
import { requireProductCapability } from '@/lib/products/access';
import { listAllProductsForAdmin } from '@/lib/admin/products';
import { buttonVariants } from '@/components/ui/button';
import ProductList from './_list';

export const dynamic = 'force-dynamic';

/**
 * Admin → Album Products (physical products + dimensions + prices). Gated by `product:manage`.
 * Read via the service-role admin reader; every mutation is a gated server action (Phase A).
 */
export default async function AdminDimensionsPage() {
  await requireProductCapability();
  const products = await listAllProductsForAdmin();

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:py-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">Album Products</h1>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">
            The physical products customers choose — dimensions, page-count pricing, and preview imagery. These drive
            the builder canvas, print size, and checkout price.
          </p>
        </div>
        <Link href="/admin/dimensions/new" className={buttonVariants({ size: 'lg' })}>
          <Plus className="h-4 w-4" /> New product
        </Link>
      </header>

      <div className="mt-8">
        <ProductList products={products} />
      </div>
    </div>
  );
}
