'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight, Loader2 } from 'lucide-react';
import { updateOrderStatus } from '@/lib/actions/admin/orders';
import { adminStatusLabel } from '@/lib/orders/status';
import { fmtDate, shortId } from '@/lib/admin/format';

export type BoardCard = { id: string; albumTitle: string; customerName: string; spec: string; placedAt: string };
type Column = { status: string; label: string; cards: BoardCard[] };

// Forward-only next state (mirrors admin_update_order_status adjacency). 'shipped' →
// 'delivered' leaves the board. We never write directly — we call the audited RPC.
const NEXT: Record<string, 'processing' | 'printing' | 'packed' | 'shipped' | 'delivered'> = {
  paid: 'processing',
  processing: 'printing',
  printing: 'packed',
  packed: 'shipped',
  shipped: 'delivered',
};

export default function ProductionBoard({ columns }: { columns: Column[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const advance = async (id: string, current: string) => {
    const next = NEXT[current];
    if (!next) return;
    setBusy(id);
    setError(null);
    const res = await updateOrderStatus({ orderId: id, status: next });
    setBusy(null);
    if (res.ok) router.refresh();
    else setError(res.error);
  };

  return (
    <>
      {error && <p className="mb-3 text-sm text-destructive">{error}</p>}
      <div className="flex gap-3 overflow-x-auto pb-3">
        {columns.map((col) => {
          const next = NEXT[col.status];
          return (
            <div key={col.status} className="flex w-[260px] flex-none flex-col rounded-lg border bg-card">
              <div className="flex items-center justify-between border-b px-3 py-2.5">
                <span className="text-sm font-semibold">{col.label}</span>
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{col.cards.length}</span>
              </div>
              <div className="flex flex-col gap-2 p-2.5">
                {col.cards.length === 0 ? (
                  <p className="px-1 py-4 text-center text-xs text-muted-foreground">Empty</p>
                ) : (
                  col.cards.map((c) => (
                    <div key={c.id} className="rounded-lg border bg-background p-3">
                      <div className="flex items-center justify-between">
                        <Link href={`/admin/orders/${c.id}`} className="font-mono text-xs font-semibold text-primary hover:underline">
                          #{shortId(c.id)}
                        </Link>
                        <span className="text-[10px] text-muted-foreground">{fmtDate(c.placedAt)}</span>
                      </div>
                      <p className="mt-1 truncate text-sm font-medium">{c.albumTitle}</p>
                      <p className="text-xs text-muted-foreground">{c.spec}</p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">{c.customerName}</p>
                      {next && (
                        <button
                          type="button"
                          onClick={() => advance(c.id, col.status)}
                          disabled={busy === c.id}
                          className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-md border border-primary/40 px-2 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/[0.06] disabled:opacity-50"
                        >
                          {busy === c.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <ArrowRight className="h-3 w-3" />}
                          Move to {adminStatusLabel(next)}
                        </button>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
