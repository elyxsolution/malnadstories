'use client';

import { useState } from 'react';
import { InlineLoader } from '@/components/loading';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { createTicket } from '@/lib/actions/support';
import {
  SUPPORT_CATEGORIES,
  CUSTOMER_PRIORITIES,
  categoryLabel,
  priorityLabel,
} from '@/lib/support/model';

export type LinkOption = { id: string; label: string };

const fieldClass =
  'w-full border border-input bg-card px-3 py-2.5 text-sm outline-none transition-colors focus:border-primary';

export default function NewTicketForm({
  albums,
  orders,
  presetAlbumId,
  presetOrderId,
}: {
  albums: LinkOption[];
  orders: LinkOption[];
  presetAlbumId: string | null;
  presetOrderId: string | null;
}) {
  const router = useRouter();
  const [category, setCategory] = useState<string>(presetOrderId ? 'order' : 'other');
  const [priority, setPriority] = useState<string>('medium');
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [albumId, setAlbumId] = useState(presetAlbumId ?? '');
  const [orderId, setOrderId] = useState(presetOrderId ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await createTicket({
      subject,
      description,
      category,
      priority,
      albumId: albumId || undefined,
      orderId: orderId || undefined,
    });
    if (res.ok) {
      router.push(`/support/${res.id}`);
    } else {
      setError(res.error);
      setBusy(false);
    }
  };

  return (
    <div className="px-5 py-9 sm:px-8 lg:py-12">
      <div className="mx-auto max-w-2xl">
        <Link
          href="/support"
          className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Support
        </Link>

        <h1 className="mt-4 font-display text-[2.4rem] font-normal leading-none tracking-tight text-primary">
          Open a request
        </h1>
        <p className="mt-3 text-sm font-light text-muted-foreground">
          Tell us what’s going on and we’ll reply by email and here in your support history.
        </p>

        <form onSubmit={submit} className="mt-9 space-y-6">
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="What is this about?">
              <select value={category} onChange={(e) => setCategory(e.target.value)} className={fieldClass}>
                {SUPPORT_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {categoryLabel(c)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Priority">
              <select value={priority} onChange={(e) => setPriority(e.target.value)} className={fieldClass}>
                {CUSTOMER_PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {priorityLabel(p)}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <Field label="Subject">
            <Input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="A one-line summary"
              maxLength={140}
              required
              className="border-input bg-card"
            />
          </Field>

          <Field label="Details">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Share as much as helps — dates, what you expected, what happened."
              rows={6}
              maxLength={4000}
              required
              className={`${fieldClass} resize-y leading-relaxed`}
            />
          </Field>

          {(albums.length > 0 || orders.length > 0) && (
            <div className="grid gap-5 sm:grid-cols-2">
              {albums.length > 0 && (
                <Field label="Related album (optional)">
                  <select value={albumId} onChange={(e) => setAlbumId(e.target.value)} className={fieldClass}>
                    <option value="">None</option>
                    {albums.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.label}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
              {orders.length > 0 && (
                <Field label="Related order (optional)">
                  <select value={orderId} onChange={(e) => setOrderId(e.target.value)} className={fieldClass}>
                    <option value="">None</option>
                    {orders.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
            </div>
          )}

          {error && (
            <p className="border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
          )}

          <div className="flex items-center justify-end gap-3 border-t border-border pt-5">
            <Button variant="ghost" render={<Link href="/support" />} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? <InlineLoader /> : <Send />} Send request
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[12px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}
