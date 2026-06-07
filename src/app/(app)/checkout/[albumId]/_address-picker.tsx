'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Plus } from 'lucide-react';
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
        <div className="space-y-2">
          {addresses.map((a) => (
            <label
              key={a.id}
              className="flex cursor-pointer items-start gap-3 rounded-lg border px-4 py-3 has-[:checked]:border-foreground has-[:checked]:bg-muted/50"
            >
              <input
                type="radio"
                name="addressId"
                value={a.id}
                checked={selectedId === a.id}
                onChange={() => onSelect(a.id)}
                className="mt-1"
              />
              <div className="text-sm">
                <p className="font-medium">{a.full_name}</p>
                <p className="text-muted-foreground">
                  {a.line1}, {a.city}, {a.state} — {a.pincode}
                </p>
              </div>
            </label>
          ))}
        </div>
      )}

      {adding ? (
        <form onSubmit={onSubmit} className="space-y-3 rounded-lg border p-4">
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
              {saving ? <Loader2 className="animate-spin" /> : null} Save address
            </Button>
            {addresses.length > 0 && (
              <Button type="button" variant="ghost" size="sm" onClick={() => setAdding(false)} disabled={saving}>
                Cancel
              </Button>
            )}
          </div>
        </form>
      ) : (
        <Button type="button" variant="outline" size="sm" onClick={() => setAdding(true)}>
          <Plus /> Add a new address
        </Button>
      )}
    </div>
  );
}
