'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, MapPin, Plus, Check, CreditCard, Bell, ShieldCheck, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { LUX_PRIMARY } from '@/components/brand';
import { updateProfile } from '@/lib/actions/profile';
import { addAddress } from '@/lib/actions/addresses';

export type AccountAddress = {
  id: string;
  full_name: string;
  line1: string;
  city: string;
  state: string;
  pincode: string;
  is_default: boolean;
};

export default function AccountView({
  email,
  name,
  phone,
  memberSince,
  addresses,
}: {
  email: string;
  name: string;
  phone: string;
  memberSince: string | null;
  addresses: AccountAddress[];
}) {
  const router = useRouter();
  const initial = (name || email || 'U').trim().charAt(0).toUpperCase();

  return (
    <div className="mt-6 space-y-5">
      {/* Identity banner */}
      <div className="flex flex-wrap items-center gap-4 rounded-2xl bg-primary px-6 py-5 text-primary-foreground">
        <span className="grid h-14 w-14 place-items-center rounded-full bg-white/10 font-display text-2xl">{initial}</span>
        <div className="min-w-0 flex-1">
          <p className="font-display text-xl font-semibold leading-tight">{name || 'Your account'}</p>
          <p className="truncate text-sm text-primary-foreground/70">
            {email}
            {memberSince ? ` · member since ${memberSince}` : ''}
          </p>
        </div>
      </div>

      <ProfileCard initialName={name} initialPhone={phone} email={email} onSaved={() => router.refresh()} />

      <AddressesCard addresses={addresses} onChanged={() => router.refresh()} />

      {/* Honest placeholders — no fake data, no new entities. */}
      <div className="grid gap-4 sm:grid-cols-2">
        <PlaceholderCard
          icon={<CreditCard className="h-4 w-4" />}
          title="Payment"
          body="Payments are handled securely by Razorpay at checkout — we never store your card or UPI details."
        />
        <PlaceholderCard
          icon={<Bell className="h-4 w-4" />}
          title="Notifications"
          body="Order updates are emailed to you automatically. Granular preferences are coming soon."
        />
        <PlaceholderCard
          icon={<ShieldCheck className="h-4 w-4" />}
          title="Security"
          body="Change your password any time from the sign-in screen via “Forgot password”."
        />
      </div>
    </div>
  );
}

function ProfileCard({
  initialName,
  initialPhone,
  email,
  onSaved,
}: {
  initialName: string;
  initialPhone: string;
  email: string;
  onSaved: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [phone, setPhone] = useState(initialPhone);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const dirty = name !== initialName || phone !== initialPhone;

  const save = async () => {
    setBusy(true);
    setMsg(null);
    const res = await updateProfile({ name, phone });
    setBusy(false);
    if (res.ok) {
      setMsg({ ok: true, text: 'Saved' });
      onSaved();
    } else {
      setMsg({ ok: false, text: res.error });
    }
  };

  return (
    <section className="rounded-2xl border bg-card p-5 shadow-panel">
      <h2 className="font-display text-[15px] font-semibold tracking-tight">Profile</h2>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="acc-name">Full name</Label>
          <Input id="acc-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="acc-phone">Phone</Label>
          <Input id="acc-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91" maxLength={20} />
        </div>
        <div className="space-y-2">
          <Label>Email</Label>
          <Input value={email} disabled readOnly />
        </div>
      </div>
      <div className="mt-4 flex items-center gap-3">
        <Button size="sm" onClick={save} disabled={busy || !dirty} className={LUX_PRIMARY}>
          {busy ? <Loader2 className="animate-spin" /> : null} Save changes
        </Button>
        {msg && <span className={`text-xs ${msg.ok ? 'text-primary' : 'text-destructive'}`}>{msg.text}</span>}
      </div>
    </section>
  );
}

function AddressesCard({ addresses, onChanged }: { addresses: AccountAddress[]; onChanged: () => void }) {
  const [adding, setAdding] = useState(false);
  return (
    <section className="rounded-2xl border bg-card p-5 shadow-panel">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 font-display text-[15px] font-semibold tracking-tight">
          <MapPin className="h-4 w-4 text-primary" /> Addresses
        </h2>
        {!adding && (
          <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
            <Plus /> Add address
          </Button>
        )}
      </div>

      {addresses.length === 0 && !adding && (
        <p className="mt-3 text-sm text-muted-foreground">No saved addresses yet.</p>
      )}

      {addresses.length > 0 && (
        <ul className="mt-3 space-y-2">
          {addresses.map((a) => (
            <li key={a.id} className="rounded-xl border bg-background px-4 py-3 text-sm">
              <div className="flex items-center gap-2">
                <span className="font-medium">{a.full_name}</span>
                {a.is_default && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                    <Check className="h-3 w-3" /> Default
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-muted-foreground">
                {a.line1}, {a.city}, {a.state} — {a.pincode}
              </p>
            </li>
          ))}
        </ul>
      )}

      {adding && <AddAddressForm onDone={() => setAdding(false)} onSaved={onChanged} />}
    </section>
  );
}

function AddAddressForm({ onDone, onSaved }: { onDone: () => void; onSaved: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    const res = await addAddress({
      fullName: String(fd.get('fullName') ?? ''),
      line1: String(fd.get('line1') ?? ''),
      city: String(fd.get('city') ?? ''),
      state: String(fd.get('state') ?? ''),
      pincode: String(fd.get('pincode') ?? ''),
      isDefault: fd.get('isDefault') === 'on',
    });
    setBusy(false);
    if (res.ok) {
      onSaved();
      onDone();
    } else {
      setError(res.error);
    }
  };

  return (
    <form onSubmit={submit} className="mt-4 space-y-3 rounded-xl border bg-background p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">New address</p>
        <Button type="button" variant="ghost" size="icon-sm" onClick={onDone} aria-label="Cancel">
          <X />
        </Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Input name="fullName" placeholder="Full name" required maxLength={100} />
        <Input name="line1" placeholder="Street, building, area" required maxLength={200} className="sm:col-span-2" />
        <Input name="city" placeholder="City" required maxLength={100} />
        <Input name="state" placeholder="State" required maxLength={100} />
        <Input name="pincode" placeholder="6-digit PIN" required inputMode="numeric" pattern="\d{6}" />
      </div>
      <label className="flex items-center gap-2 text-sm text-muted-foreground">
        <input type="checkbox" name="isDefault" className="h-4 w-4" /> Make this my default address
      </label>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <Button type="submit" size="sm" disabled={busy} className={LUX_PRIMARY}>
        {busy ? <Loader2 className="animate-spin" /> : null} Save address
      </Button>
    </form>
  );
}

function PlaceholderCard({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="rounded-2xl border bg-card p-5">
      <div className="flex items-center gap-2">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-secondary text-primary">{icon}</span>
        <h3 className="text-sm font-semibold">{title}</h3>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{body}</p>
    </div>
  );
}
