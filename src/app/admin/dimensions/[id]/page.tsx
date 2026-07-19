import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { requireProductCapability } from '@/lib/products/access';
import { getProductForAdmin } from '@/lib/admin/products';
import ProductEditor from '../_editor';

export const dynamic = 'force-dynamic';

export default async function EditProductPage({ params }: { params: { id: string } }) {
  await requireProductCapability();
  const product = await getProductForAdmin(params.id);
  if (!product) notFound();

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:py-10">
      <Link href="/admin/dimensions" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Album Products
      </Link>
      <h1 className="mt-3 font-display text-2xl font-semibold tracking-tight text-foreground">Edit {product.name}</h1>
      <div className="mt-6">
        <ProductEditor product={product} />
      </div>
    </div>
  );
}
