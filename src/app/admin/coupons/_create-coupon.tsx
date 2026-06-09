'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { createCoupon } from '@/lib/actions/admin/coupons';

export default function CreateCoupon() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [type, setType] = useState<'flat' | 'percentage'>('flat');
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    const num = (k: string) => {
      const v = fd.get(k);
      return v && String(v).trim() !== '' ? Number(v) : undefined;
    };
    const str = (k: string) => {
      const v = fd.get(k);
      return v && String(v).trim() !== '' ? String(v) : undefined;
    };
    const dt = (k: string) => {
      const v = str(k);
      return v ? new Date(v).toISOString() : undefined;
    };

    setBusy(true);
    setMsg(null);
    const res = await createCoupon({
      description: str('description'),
      createdReason: str('createdReason'),
      discountType: type,
      discountValue: num('discountValue'),
      minimumOrderAmount: num('minimumOrderAmount'),
      maxUses: num('maxUses'),
      startsAt: dt('startsAt'),
      expiresAt: dt('expiresAt'),
      active: fd.get('active') === 'on',
    });
    setBusy(false);
    if (res.ok) {
      setMsg({ kind: 'ok', text: `Created coupon ${res.code}` });
      form.reset();
      router.refresh();
    } else {
      setMsg({ kind: 'err', text: res.error });
    }
  };

  if (!open) {
    return (
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus /> New coupon
      </Button>
    );
  }

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold">New coupon</h2>
        <Button variant="ghost" size="icon-sm" onClick={() => setOpen(false)} aria-label="Close">
          <X />
        </Button>
      </div>
      <p className="mb-3 text-xs text-muted-foreground">
        The code is generated automatically (e.g. MS-AB12CD34). You cannot set it manually.
      </p>
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
        <Field label="Discount type">
          <select
            value={type}
            onChange={(e) => setType(e.target.value as 'flat' | 'percentage')}
            className="h-8 w-full rounded-lg border bg-background px-2 text-sm"
          >
            <option value="flat">Flat (₹)</option>
            <option value="percentage">Percentage (%)</option>
          </select>
        </Field>
        <Field label={type === 'flat' ? 'Value (₹)' : 'Value (%)'}>
          <Input name="discountValue" type="number" step="0.01" min="0" required />
        </Field>
        <Field label="Minimum order (₹, optional)">
          <Input name="minimumOrderAmount" type="number" step="0.01" min="0" />
        </Field>
        <Field label="Max uses (optional, blank = unlimited)">
          <Input name="maxUses" type="number" min="1" />
        </Field>
        <Field label="Starts at (optional)">
          <Input name="startsAt" type="datetime-local" />
        </Field>
        <Field label="Expires at (optional)">
          <Input name="expiresAt" type="datetime-local" />
        </Field>
        <Field label="Description (customer-facing, optional)">
          <Input name="description" maxLength={200} />
        </Field>
        <Field label="Created reason (internal, optional)">
          <Input name="createdReason" maxLength={300} />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="active" defaultChecked /> Active immediately
        </label>
        <div className="flex items-center gap-3 sm:col-span-2">
          <Button type="submit" disabled={busy}>
            {busy ? <Loader2 className="animate-spin" /> : <Plus />} Create coupon
          </Button>
          {msg && (
            <span className={`text-sm ${msg.kind === 'ok' ? 'text-primary' : 'text-destructive'}`}>
              {msg.text}
            </span>
          )}
        </div>
      </form>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}
