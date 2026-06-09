'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, ArrowRight, Truck, StickyNote } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CARRIERS } from '@/lib/validations';
import { updateOrderStatus, setTracking, addOrderNote } from '@/lib/actions/admin/orders';

// Forward-only adjacency (mirrors admin_update_order_status). Only the single valid
// next step is ever shown — invalid transitions are never rendered.
const NEXT: Record<string, string> = {
  paid: 'processing',
  processing: 'printing',
  printing: 'packed',
  packed: 'shipped',
  shipped: 'delivered',
};

const TERMINAL = new Set(['delivered', 'cancelled', 'failed', 'pending']);

export default function Fulfillment({
  orderId,
  status,
  trackingNumber,
  carrier,
}: {
  orderId: string;
  status: string;
  trackingNumber: string | null;
  carrier: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [track, setTrack] = useState(trackingNumber ?? '');
  const [carr, setCarr] = useState(carrier ?? '');
  const [note, setNote] = useState('');

  const next = NEXT[status];
  const editable = !TERMINAL.has(status);
  const needsTracking = next === 'shipped' && (!trackingNumber || !carrier);

  const run = async (key: string, fn: () => Promise<{ ok: boolean; error?: string }>, okText: string) => {
    setBusy(key);
    setMsg(null);
    const res = await fn();
    setBusy(null);
    if (res.ok) {
      setMsg({ kind: 'ok', text: okText });
      router.refresh();
    } else {
      setMsg({ kind: 'err', text: res.error ?? 'Something went wrong.' });
    }
  };

  return (
    <div className="space-y-4">
      {msg && (
        <p className={`text-sm ${msg.kind === 'ok' ? 'text-primary' : 'text-destructive'}`}>{msg.text}</p>
      )}

      {/* Advance status */}
      {next && editable ? (
        <div>
          <Button
            onClick={() =>
              run('status', () => updateOrderStatus({ orderId, status: next }), `Moved to ${next}.`)
            }
            disabled={busy !== null || needsTracking}
          >
            {busy === 'status' ? <Loader2 className="animate-spin" /> : <ArrowRight />} Move to {next}
          </Button>
          {needsTracking && (
            <p className="mt-1 text-xs text-muted-foreground">Add a tracking number and carrier first.</p>
          )}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          No further fulfilment action ({status}).
        </p>
      )}

      {/* Tracking */}
      {editable && (
        <div className="space-y-2 rounded-lg border p-3">
          <p className="flex items-center gap-1.5 text-sm font-medium">
            <Truck className="h-4 w-4" /> Shipping
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <Label htmlFor="track" className="text-xs">
                Tracking number
              </Label>
              <Input id="track" value={track} onChange={(e) => setTrack(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="carr" className="text-xs">
                Carrier
              </Label>
              <select
                id="carr"
                value={carr}
                onChange={(e) => setCarr(e.target.value)}
                className="h-8 w-full rounded-lg border bg-background px-2 text-sm"
              >
                <option value="">Select…</option>
                {CARRIERS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={busy !== null || !track.trim() || !carr}
            onClick={() =>
              run('track', () => setTracking({ orderId, trackingNumber: track.trim(), carrier: carr }), 'Tracking saved.')
            }
          >
            {busy === 'track' ? <Loader2 className="animate-spin" /> : <Truck />} Save tracking
          </Button>
        </div>
      )}

      {/* Add note */}
      <div className="space-y-2 rounded-lg border p-3">
        <p className="flex items-center gap-1.5 text-sm font-medium">
          <StickyNote className="h-4 w-4" /> Add internal note
        </p>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          placeholder="Visible to admins only…"
          className="w-full rounded-lg border bg-background p-2 text-sm"
        />
        <Button
          variant="outline"
          size="sm"
          disabled={busy !== null || !note.trim()}
          onClick={() =>
            run('note', async () => {
              const res = await addOrderNote({ orderId, body: note.trim() });
              if (res.ok) setNote('');
              return res;
            }, 'Note added.')
          }
        >
          {busy === 'note' ? <Loader2 className="animate-spin" /> : <StickyNote />} Add note
        </Button>
      </div>
    </div>
  );
}
