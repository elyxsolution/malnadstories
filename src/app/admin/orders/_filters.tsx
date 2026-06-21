'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

const STATUSES = [
  'pending',
  'paid',
  'processing',
  'printing',
  'packed',
  'shipped',
  'delivered',
  'cancelled',
  'failed',
];

export default function OrdersFilters({ q, status, counts }: { q: string; status: string; counts?: Record<string, number> }) {
  const router = useRouter();
  const params = useSearchParams();

  const apply = (next: Record<string, string>) => {
    const sp = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v) sp.set(k, v);
      else sp.delete(k);
    }
    sp.delete('page'); // reset to first page on any filter change
    router.push(`/admin/orders?${sp.toString()}`);
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        apply({ q: String(fd.get('q') || '') });
      }}
      className="flex flex-wrap items-center gap-2"
    >
      <Input
        name="q"
        defaultValue={q}
        placeholder="Search order id, customer, album…"
        className="w-72"
      />
      <select
        name="status"
        defaultValue={status}
        onChange={(e) => apply({ status: e.target.value })}
        className="h-8 rounded-lg border bg-background px-2 text-sm"
      >
        <option value="">All statuses{counts ? ` (${Object.values(counts).reduce((a, b) => a + b, 0)})` : ''}</option>
        {STATUSES.map((s) => (
          <option key={s} value={s}>
            {s}
            {counts ? ` (${counts[s] ?? 0})` : ''}
          </option>
        ))}
      </select>
      <Button type="submit" variant="outline" size="sm">
        Search
      </Button>
    </form>
  );
}
