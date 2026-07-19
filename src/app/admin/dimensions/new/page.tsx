import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { requireProductCapability } from '@/lib/products/access';
import ProductEditor from '../_editor';

export const dynamic = 'force-dynamic';

export default async function NewProductPage() {
  await requireProductCapability();
  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:py-10">
      <Link href="/admin/dimensions" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Album Products
      </Link>
      <h1 className="mt-3 font-display text-2xl font-semibold tracking-tight text-foreground">New album product</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Set the dimensions and pricing. You can add cover and gallery images after saving.
      </p>
      <div className="mt-6">
        <ProductEditor product={null} />
      </div>
    </div>
  );
}
