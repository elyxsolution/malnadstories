'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Loader2, ArrowRight, Download, Check } from 'lucide-react';
import { updateOrderStatus } from '@/lib/actions/admin/orders';
import { adminStatusLabel } from '@/lib/orders/status';
import { inr, shortId, fmtDate, statusChip } from '@/lib/admin/format';
import StatusBadge from '@/components/ui/status-badge';

export type OrderRow = {
  id: string;
  status: string;
  total: string;
  copies: number;
  placedAt: string;
  customerName: string | null;
  email: string;
  albumTitle: string | null;
  couponCode: string | null;
};

// Forward-only next state (mirrors admin_update_order_status). Terminal/pre-paid rows
// have no next and are skipped by bulk advance. We only ever call the audited RPC.
const NEXT: Record<string, 'processing' | 'printing' | 'packed' | 'shipped' | 'delivered'> = {
  paid: 'processing',
  processing: 'printing',
  printing: 'packed',
  packed: 'shipped',
  shipped: 'delivered',
};

const csvCell = (v: string) => `"${v.replace(/"/g, '""')}"`;

export default function OrdersTable({ rows }: { rows: OrderRow[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allChecked = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const toggleAll = () => setSelected(allChecked ? new Set() : new Set(rows.map((r) => r.id)));

  // Bulk advance: each selected order moves to ITS next status via the existing RPC
  // (one call per order). Adjacency + audit are enforced in the DB. Non-advanceable
  // rows are skipped — no direct status writes, ever.
  const advance = async () => {
    const targets = rows.filter((r) => selected.has(r.id) && NEXT[r.status]);
    if (targets.length === 0) {
      setMsg('No selected orders can be advanced.');
      return;
    }
    setBusy(true);
    setMsg(null);
    let ok = 0;
    for (const r of targets) {
      const res = await updateOrderStatus({ orderId: r.id, status: NEXT[r.status] });
      if (res.ok) ok += 1;
    }
    setBusy(false);
    setSelected(new Set());
    setMsg(`Advanced ${ok} of ${targets.length} order${targets.length === 1 ? '' : 's'}.`);
    router.refresh();
  };

  const exportCsv = () => {
    const chosen = selected.size > 0 ? rows.filter((r) => selected.has(r.id)) : rows;
    const header = ['Order', 'Customer', 'Email', 'Album', 'Amount', 'Copies', 'Coupon', 'Status', 'Placed'];
    const lines = chosen.map((r) =>
      [
        shortId(r.id),
        r.customerName ?? '',
        r.email,
        r.albumTitle ?? '',
        r.total,
        String(r.copies),
        r.couponCode ?? '',
        r.status,
        new Date(r.placedAt).toISOString(),
      ]
        .map(csvCell)
        .join(','),
    );
    const blob = new Blob([[header.map(csvCell).join(','), ...lines].join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `orders-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {selected.size > 0 ? (
          <>
            <span className="text-sm font-medium">{selected.size} selected</span>
            <button
              type="button"
              onClick={advance}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <ArrowRight className="h-3 w-3" />} Advance
            </button>
            <button type="button" onClick={() => setSelected(new Set())} className="text-xs text-muted-foreground hover:text-foreground">
              Clear
            </button>
          </>
        ) : (
          <span className="text-sm text-muted-foreground">{rows.length} on this page</span>
        )}
        <button
          type="button"
          onClick={exportCsv}
          className="ml-auto inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium hover:bg-muted"
        >
          <Download className="h-3 w-3" /> Export {selected.size > 0 ? 'selected' : 'page'} CSV
        </button>
      </div>

      {msg && <p className="mb-2 text-xs text-primary">{msg}</p>}

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2">
                <button type="button" onClick={toggleAll} aria-label="Select all" className="grid h-4 w-4 place-items-center rounded border">
                  {allChecked && <Check className="h-3 w-3" />}
                </button>
              </th>
              <th className="px-3 py-2">Order</th>
              <th className="px-3 py-2">Customer</th>
              <th className="px-3 py-2">Album</th>
              <th className="px-3 py-2 text-right">Amount</th>
              <th className="px-3 py-2 text-center">Copies</th>
              <th className="px-3 py-2">Coupon</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Created</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={`border-b last:border-0 hover:bg-muted/30 ${selected.has(r.id) ? 'bg-muted/40' : ''}`}>
                <td className="px-3 py-2">
                  <button type="button" onClick={() => toggle(r.id)} aria-label="Select order" className="grid h-4 w-4 place-items-center rounded border">
                    {selected.has(r.id) && <Check className="h-3 w-3" />}
                  </button>
                </td>
                <td className="px-3 py-2">
                  <Link href={`/admin/orders/${r.id}`} className="font-mono text-primary hover:underline">
                    #{shortId(r.id)}
                  </Link>
                </td>
                <td className="px-3 py-2">
                  <div>{r.customerName ?? '—'}</div>
                  <div className="text-xs text-muted-foreground">{r.email}</div>
                </td>
                <td className="px-3 py-2">{r.albumTitle ?? '—'}</td>
                <td className="px-3 py-2 text-right">{inr(r.total)}</td>
                <td className="px-3 py-2 text-center">{r.copies}</td>
                <td className="px-3 py-2 font-mono text-xs">{r.couponCode ?? '—'}</td>
                <td className="px-3 py-2">
                  <StatusBadge className={statusChip(r.status)} label={adminStatusLabel(r.status)} />
                </td>
                <td className="px-3 py-2 text-muted-foreground">{fmtDate(r.placedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
