'use client';

import { useState } from 'react';
import { InlineLoader } from '@/components/loading';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight } from 'lucide-react';
import { updateOrderStatus } from '@/lib/actions/admin/orders';
import { adminStatusLabel } from '@/lib/orders/status';
import { fmtDate, shortId } from '@/lib/admin/format';

/**
 * ONE PURCHASE UNIT — one `order_items` row: one album, printed `copies` times.
 * `albumTitle` is the SNAPSHOT title (as purchased); `spec` and `pdfStatus` are operational.
 */
export type BoardItem = {
  id: string;
  albumId: string;
  albumTitle: string;
  spec: string;
  copies: number;
  pdfStatus: string;
};
/** One order = one parcel = one fulfilment lifecycle, containing N albums to print. */
export type BoardCard = {
  id: string;
  customerName: string;
  placedAt: string;
  items: BoardItem[];
  totalCopies: number;
};
type Column = { status: string; label: string; cards: BoardCard[] };

const PDF_CHIP: Record<string, string> = {
  ready: 'bg-success/10 text-success',
  generating: 'bg-warning/12 text-warning',
  failed: 'bg-destructive/10 text-destructive',
  idle: 'bg-muted text-muted-foreground',
};

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

                      {/*
                        EVERY album in the order, each with its OWN copy count — a combined order is
                        several books to print, not one. Each row links to that album's admin page,
                        which is where the album-level PDF/regenerate action lives, so an operator
                        acting on a specific book can never be sent to the order's first album.
                      */}
                      <ul className="mt-1.5 flex flex-col gap-1.5">
                        {c.items.map((it) => (
                          <li key={it.id} className="rounded-md bg-muted/40 px-2 py-1.5">
                            <div className="flex items-start justify-between gap-2">
                              <Link
                                href={`/admin/albums/${it.albumId}`}
                                className="min-w-0 truncate text-sm font-medium text-primary hover:underline"
                              >
                                {it.albumTitle}
                              </Link>
                              <span className="flex-none text-xs font-semibold tabular-nums">× {it.copies}</span>
                            </div>
                            <div className="mt-0.5 flex items-center gap-1.5">
                              <span className="text-[11px] text-muted-foreground">{it.spec}</span>
                              <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${PDF_CHIP[it.pdfStatus] ?? PDF_CHIP.idle}`}>
                                PDF {it.pdfStatus}
                              </span>
                            </div>
                          </li>
                        ))}
                      </ul>

                      <p className="mt-1.5 text-[11px] text-muted-foreground">
                        {c.customerName}
                        {c.items.length > 1 ? ` · ${c.items.length} albums · ${c.totalCopies} copies total` : ''}
                      </p>
                      {next && (
                        <button
                          type="button"
                          onClick={() => advance(c.id, col.status)}
                          disabled={busy === c.id}
                          className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-md border border-primary/40 px-2 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/[0.06] disabled:opacity-50"
                        >
                          {busy === c.id ? <InlineLoader /> : <ArrowRight className="h-3 w-3" />}
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
