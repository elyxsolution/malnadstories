'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Search, Plus, LifeBuoy, SearchX, ArrowRight, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  categoryLabel,
  statusLabel,
  statusChip,
  priorityChip,
  priorityLabel,
  SUPPORT_STATUSES,
  type SupportStatus,
} from '@/lib/support/model';

export type CustomerTicket = {
  id: string;
  subject: string;
  category: string;
  priority: string;
  status: string;
  created_at: string;
  updated_at: string;
};

const FILTERS: { key: 'all' | 'active' | SupportStatus; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  ...SUPPORT_STATUSES.map((s) => ({ key: s, label: statusLabel(s) })),
];

const ACTIVE = new Set<string>(['open', 'in_progress', 'waiting_for_customer']);

const fmt = (iso: string) =>
  new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

export default function Tickets({ tickets }: { tickets: CustomerTicket[] }) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'active' | SupportStatus>('all');

  const filtered = useMemo(
    () =>
      tickets.filter((t) => {
        if (filter === 'active' && !ACTIVE.has(t.status)) return false;
        if (filter !== 'all' && filter !== 'active' && t.status !== filter) return false;
        const q = search.trim().toLowerCase();
        if (q && !t.subject.toLowerCase().includes(q) && !categoryLabel(t.category).toLowerCase().includes(q))
          return false;
        return true;
      }),
    [tickets, filter, search],
  );

  return (
    <div className="px-5 py-9 sm:px-8 lg:py-12">
      <div className="mx-auto max-w-3xl">
        {/* Masthead */}
        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-gold">Support</p>
        <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-display text-[2.6rem] font-normal leading-none tracking-tight text-primary">
              How can we help?
            </h1>
            <p className="mt-3 text-base font-light text-muted-foreground">
              {tickets.length === 0
                ? 'Questions about an order, a print, or your album — we’re here.'
                : `${tickets.length} ${tickets.length === 1 ? 'request' : 'requests'} in your history.`}
            </p>
          </div>
          <Button render={<Link href="/support/new" />}>
            <Plus /> New request
          </Button>
        </div>

        {/* Refunds & reprints entry */}
        <Link
          href="/support/requests"
          className="group mt-6 flex items-center gap-3 border border-border bg-card/60 px-4 py-3 transition-colors hover:border-primary"
        >
          <span className="grid h-9 w-9 flex-none place-items-center rounded-full bg-primary/10 text-primary">
            <RotateCcw className="h-4 w-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium text-foreground">Refunds &amp; reprints</span>
            <span className="block text-[13px] text-muted-foreground">
              Request a refund on a paid order or a reprint of a delivered album.
            </span>
          </span>
          <ArrowRight className="h-4 w-4 flex-none text-muted-foreground/50 transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
        </Link>

        {tickets.length === 0 ? (
          <EmptyFirstRun />
        ) : (
          <>
            {/* Search + filters */}
            <div className="mt-10 flex flex-wrap items-center justify-between gap-3">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gold" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search requests…"
                  className="w-[220px] border border-input bg-card py-2 pl-8 pr-3 text-[13px] outline-none transition-colors focus:border-primary"
                />
              </div>
              <div className="flex flex-wrap gap-2">
                {FILTERS.map((f) => {
                  const active = filter === f.key;
                  return (
                    <button
                      key={f.key}
                      type="button"
                      onClick={() => setFilter(f.key)}
                      className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
                        active
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-input bg-card text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      {f.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* List */}
            {filtered.length === 0 ? (
              <div className="mt-8 flex flex-col items-center border border-dashed bg-card/40 px-6 py-16 text-center">
                <SearchX className="h-7 w-7 text-muted-foreground/50" />
                <p className="mt-3 font-display text-xl text-primary">No requests match that.</p>
                <Button
                  variant="outline"
                  className="mt-4"
                  onClick={() => {
                    setSearch('');
                    setFilter('all');
                  }}
                >
                  Clear filters
                </Button>
              </div>
            ) : (
              <ul className="mt-7 divide-y divide-border border-y border-border">
                {filtered.map((t) => (
                  <li key={t.id}>
                    <Link
                      href={`/support/${t.id}`}
                      className="group flex items-center gap-4 py-4 transition-colors hover:bg-card/60"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${statusChip(t.status)}`}>
                            {statusLabel(t.status)}
                          </span>
                          <span className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                            {categoryLabel(t.category)}
                          </span>
                          {t.priority === 'high' && (
                            <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${priorityChip(t.priority)}`}>
                              {priorityLabel(t.priority)}
                            </span>
                          )}
                        </div>
                        <p className="mt-1.5 truncate font-display text-lg leading-tight text-primary">{t.subject}</p>
                        <p className="mt-0.5 text-[12px] text-muted-foreground">
                          #{t.id.slice(0, 8)} · updated {fmt(t.updated_at)}
                        </p>
                      </div>
                      <ArrowRight className="h-4 w-4 flex-none text-muted-foreground/50 transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function EmptyFirstRun() {
  return (
    <div className="mt-10 flex flex-col items-center border border-dashed bg-card/40 px-6 py-20 text-center">
      <span className="grid h-12 w-12 place-items-center rounded-full bg-primary/10 text-primary">
        <LifeBuoy className="h-6 w-6" />
      </span>
      <p className="mt-4 font-display text-2xl text-primary">No requests yet</p>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">
        If something needs a hand — an order, a delivery, a print question — open a request and we’ll get back to you.
      </p>
      <Button render={<Link href="/support/new" />} className="mt-6">
        <Plus /> New request
      </Button>
    </div>
  );
}
