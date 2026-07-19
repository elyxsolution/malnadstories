'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { InlineLoader } from '@/components/loading';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { addAddress } from '@/lib/actions/addresses';

export type Address = {
  id: string;
  full_name: string;
  line1: string;
  city: string;
  state: string;
  pincode: string;
  is_default: boolean;
};

/**
 * Delivery-address selector + inline "add new" form. The list is supplied by the
 * server component (RLS-scoped); adding calls the addAddress server action then
 * refreshes the route so the new row appears, and selects it.
 */
export default function AddressPicker({
  addresses,
  selectedId,
  onSelect,
}: {
  addresses: Address[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(addresses.length === 0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    const res = await addAddress({
      fullName: fd.get('fullName'),
      line1: fd.get('line1'),
      city: fd.get('city'),
      state: fd.get('state'),
      pincode: fd.get('pincode'),
      isDefault: addresses.length === 0, // first address becomes the default
    });
    setSaving(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    onSelect(res.id);
    setAdding(false);
    router.refresh();
  };

  return (
    <div className="space-y-3">
      {addresses.length > 0 && (
        <div className="space-y-2.5">
          {addresses.map((a) => (
            <label
              key={a.id}
              className="flex cursor-pointer items-start gap-3 rounded-xl border bg-card px-4 py-3 shadow-xs transition-all duration-200 ease-glide hover:border-primary/30 hover:shadow-card has-[:checked]:border-primary has-[:checked]:bg-primary/[0.04] has-[:checked]:shadow-card"
            >
              <input
                type="radio"
                name="addressId"
                value={a.id}
                checked={selectedId === a.id}
                onChange={() => onSelect(a.id)}
                className="mt-0.5 h-4 w-4"
              />
              <div className="min-w-0 text-sm">
                <p className="flex items-center gap-2 font-medium">
                  {a.full_name}
                  {a.is_default && (
                    <span className="rounded-full bg-secondary px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      Default
                    </span>
                  )}
                </p>
                <p className="mt-0.5 text-muted-foreground">
                  {a.line1}, {a.city}, {a.state} — {a.pincode}
                </p>
              </div>
            </label>
          ))}
        </div>
      )}

      {adding ? (
        <form onSubmit={onSubmit} className="space-y-3 rounded-xl border bg-card p-4 shadow-xs">
          <div className="space-y-1.5">
            <Label htmlFor="fullName">Full name</Label>
            <Input id="fullName" name="fullName" required autoComplete="name" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="line1">Address</Label>
            <Input id="line1" name="line1" required placeholder="House no., street, area" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="city">City</Label>
              <Input id="city" name="city" required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="state">State</Label>
              <Input id="state" name="state" required />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pincode">Pincode</Label>
            <Input id="pincode" name="pincode" required inputMode="numeric" placeholder="6 digits" />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={saving}>
              {saving ? <InlineLoader /> : null} Save address
            </Button>
            {addresses.length > 0 && (
              <Button type="button" variant="ghost" size="sm" onClick={() => setAdding(false)} disabled={saving}>
                Cancel
              </Button>
            )}
          </div>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border/80 bg-secondary/30 px-4 py-3 text-sm font-medium text-muted-foreground transition-all duration-200 ease-glide hover:border-primary/40 hover:bg-accent/50 hover:text-foreground"
        >
          <Plus className="h-4 w-4" /> Add a new address
        </button>
      )}
    </div>
  );
}
