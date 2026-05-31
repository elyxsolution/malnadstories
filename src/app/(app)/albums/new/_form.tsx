'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { createAlbum, type AlbumActionState } from '@/lib/actions/albums';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';

type Product = {
  id: string;
  name: string;
  pages: number;
  basePrice: string;
};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="w-full">
      {pending ? 'Creating…' : 'Create album'}
    </Button>
  );
}

export default function CreateAlbumForm({ products }: { products: Product[] }) {
  const [state, formAction] = useFormState<AlbumActionState, FormData>(createAlbum, null);

  return (
    <form action={formAction} className="space-y-6">
      <div className="space-y-2">
        <Label htmlFor="title">Album title</Label>
        <Input
          id="title"
          name="title"
          type="text"
          placeholder="E.g. Coorg trip 2024"
          autoComplete="off"
          required
        />
      </div>

      <div className="space-y-2">
        <Label>Size</Label>
        <div className="space-y-2">
          {products.map((product, i) => (
            <label
              key={product.id}
              className="flex items-center justify-between rounded-lg border px-4 py-3 cursor-pointer has-[:checked]:border-foreground has-[:checked]:bg-muted/50"
            >
              <div className="flex items-center gap-3">
                <input
                  type="radio"
                  name="productId"
                  value={product.id}
                  defaultChecked={i === 0}
                  required
                />
                <div>
                  <p className="text-sm font-medium">{product.pages} pages</p>
                  <p className="text-xs text-muted-foreground">{product.name}</p>
                </div>
              </div>
              <span className="text-sm font-medium">
                ₹{Number(product.basePrice).toLocaleString('en-IN')}
              </span>
            </label>
          ))}
        </div>
      </div>

      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}

      <SubmitButton />
    </form>
  );
}
