import Link from 'next/link';
import { and, count, gte, inArray, sum } from 'drizzle-orm';
import { db } from '@/db';
import { orders } from '@/db/schema';
import { requireAdmin } from '@/lib/auth/require-admin';
import { inr } from '@/lib/admin/format';

const PAID_FAMILY = ['paid', 'processing', 'printing', 'packed', 'shipped', 'delivered'];
const RANGES: { key: string; label: string; days: number }[] = [
  { key: 'day', label: 'Day', days: 1 },
  { key: 'week', label: 'Week', days: 7 },
  { key: 'month', label: 'Month', days: 30 },
  { key: 'year', label: 'Year', days: 365 },
];

/**
 * Analytics (read-only). Revenue / orders / AOV over a chosen window, computed from
 * existing paid-family orders via Drizzle aggregates. No funnel/event capture exists,
 * so conversion is intentionally omitted. No PII, no writes.
 */
export default async function AdminAnalyticsPage({ searchParams }: { searchParams: { range?: string } }) {
  await requireAdmin();

  const range = RANGES.find((r) => r.key === searchParams.range) ?? RANGES[2];
  const start = new Date(Date.now() - range.days * 24 * 60 * 60 * 1000);

  const [agg] = await db
    .select({ revenue: sum(orders.totalAmount), count: count() })
    .from(orders)
    .where(and(inArray(orders.status, PAID_FAMILY), gte(orders.placedAt, start)));

  const revenue = Number(agg?.revenue ?? 0);
  const orderCount = agg?.count ?? 0;
  const aov = orderCount > 0 ? revenue / orderCount : 0;

  const kpis = [
    { label: 'Revenue', value: inr(revenue) },
    { label: 'Orders', value: String(orderCount) },
    { label: 'Avg order value', value: inr(Math.round(aov)) },
  ];

  return (
    <div className="mx-auto max-w-5xl p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold">Analytics</h1>
        <div className="inline-flex rounded-lg border bg-card p-0.5">
          {RANGES.map((r) => (
            <Link
              key={r.key}
              href={`/admin/analytics?range=${r.key}`}
              className={`rounded-md px-3 py-1 text-sm transition-colors ${
                r.key === range.key ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {r.label}
            </Link>
          ))}
        </div>
      </div>

      <p className="mb-4 text-sm text-muted-foreground">
        Paid orders in the last {range.days === 1 ? 'day' : `${range.days} days`}.
      </p>

      <div className="grid gap-4 sm:grid-cols-3">
        {kpis.map((k) => (
          <div key={k.label} className="rounded-lg border bg-card p-5">
            <p className="text-xs text-muted-foreground">{k.label}</p>
            <p className="mt-1 font-display text-3xl font-semibold tabular-nums">{k.value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
