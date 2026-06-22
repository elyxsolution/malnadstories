import Link from 'next/link';
import { ArrowRight, ClipboardCheck } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import CustomerShell from '@/components/customer-shell';
import EmptyState from '@/components/ui/empty-state';
import StatusBadge from '@/components/ui/status-badge';
import { reviewStatusLabel, reviewStatusChip } from '@/lib/reviews/model';

type ReviewRow = { id: string; album_id: string; status: string; updated_at: string };

const fmt = (iso: string) =>
  new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

/**
 * Customer Review Center. RLS (customer_id = auth.uid()) scopes the list to the owner;
 * the column-scoped SELECT grant keeps reviewed_by out of the response. Album titles are
 * resolved with a second RLS-scoped read (the user owns these albums too).
 */
export default async function ReviewCenterPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data } = await supabase
    .from('album_reviews')
    .select('id, album_id, status, updated_at')
    .order('updated_at', { ascending: false });
  const reviews = (data ?? []) as ReviewRow[];

  const titles = new Map<string, string>();
  if (reviews.length > 0) {
    const { data: albumData } = await supabase
      .from('albums')
      .select('id, title')
      .in('id', reviews.map((r) => r.album_id));
    for (const a of (albumData ?? []) as { id: string; title: string }[]) titles.set(a.id, a.title);
  }

  return (
    <CustomerShell email={user?.email ?? ''}>
      <div className="px-5 py-9 sm:px-8 lg:py-12">
        <div className="mx-auto max-w-3xl">
          <h1 className="font-display text-[2.6rem] font-normal leading-none tracking-tight text-primary">
            Album reviews
          </h1>
          <p className="mt-3 text-base font-light text-muted-foreground">
            When you submit an album, our team checks it for print-readiness. Track the status
            here and resubmit if we ask for any changes.
          </p>

          {reviews.length === 0 ? (
            <EmptyState
              className="mt-10"
              icon={ClipboardCheck}
              title="No albums in review yet"
              description="When you submit an album, our team checks it for print-readiness. Submit one from your dashboard to get started."
              action={{ label: 'Go to your stories', href: '/dashboard' }}
            />
          ) : (
            <ul className="mt-8 divide-y divide-border border-y border-border">
              {reviews.map((r) => (
                <li key={r.id}>
                  <Link
                    href={`/reviews/${r.id}`}
                    className="group flex items-center gap-4 py-4 transition-colors hover:bg-card/60"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusBadge className={reviewStatusChip(r.status)} label={reviewStatusLabel(r.status)} />
                      </div>
                      <p className="mt-1.5 truncate font-display text-lg leading-tight text-primary">
                        {titles.get(r.album_id) ?? 'Your album'}
                      </p>
                      <p className="mt-0.5 text-[12px] text-muted-foreground">
                        #{r.id.slice(0, 8)} · Updated {fmt(r.updated_at)}
                      </p>
                    </div>
                    <ArrowRight className="h-4 w-4 flex-none text-muted-foreground/50 transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </CustomerShell>
  );
}
