import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, PenLine, Eye, ShoppingCart, ReceiptText, MapPin, Calendar } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { listActiveCoverOptions } from '@/lib/covers';
import { getPaidOrder } from '@/lib/orders/album-lock';
import { orderStatusView } from '@/lib/orders/status';
import { Button } from '@/components/ui/button';
import { LUX_PRIMARY } from '@/components/brand';
import Book from '@/components/book';
import CustomerShell from '@/components/customer-shell';

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

const ALBUM_STATE: Record<string, string> = { draft: 'Draft', submitted: 'Ready to order' };

/**
 * Album Details (Design Completion Phase 1). A read view of one album — cover, the
 * numbers, its metadata, order history, and the next actions — sitting between the
 * library and the builder. All data is the existing album/photos/orders, RLS-scoped to
 * the owner; nothing is mutated here.
 */
export default async function AlbumDetailPage({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: albumRow } = await supabase
    .from('albums')
    .select('id, title, size, status, cover_template_id, destination, travel_dates, description')
    .eq('id', params.id)
    .maybeSingle();
  const album = albumRow as {
    id: string;
    title: string;
    size: number;
    status: string;
    cover_template_id: string | null;
    destination: string | null;
    travel_dates: string | null;
    description: string | null;
  } | null;
  if (!album) notFound();

  const [{ count: photoCount }, { data: orderRows }, paidOrder, covers] = await Promise.all([
    supabase.from('photos').select('id', { count: 'exact', head: true }).eq('album_id', album.id),
    supabase
      .from('orders')
      .select('id, status, total_amount, placed_at')
      .eq('album_id', album.id)
      .order('placed_at', { ascending: false }),
    getPaidOrder(supabase, album.id),
    listActiveCoverOptions(),
  ]);

  const orders = (orderRows ?? []) as { id: string; status: string; total_amount: string; placed_at: string }[];
  const cover = covers.find((c) => c.id === album.cover_template_id) ?? null;
  const isEditable = !paidOrder; // paid → read-only album

  return (
    <CustomerShell email={user?.email ?? ''}>
      <div className="mx-auto max-w-4xl px-5 py-9 sm:px-8">
        <div className="animate-rise">
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Your stories
          </Link>

          <div className="mt-5 grid gap-8 sm:grid-cols-[260px_1fr]">
            {/* Book + actions */}
            <div>
              <div className="flex justify-center">
                <Book title={album.title} coverImage={cover?.thumbUrl ?? null} size="lg" thickness={album.size >= 100 ? 16 : 12} />
              </div>

              <div className="mt-7 flex flex-col gap-2">
                {isEditable ? (
                  <>
                    <Button render={<Link href={`/albums/${album.id}/build`} />} className={LUX_PRIMARY}>
                      <PenLine /> Continue building
                    </Button>
                    {album.status === 'submitted' && (
                      <Button variant="outline" render={<Link href={`/checkout/${album.id}`} />}>
                        <ShoppingCart /> Proceed to checkout
                      </Button>
                    )}
                  </>
                ) : (
                  <>
                    <Button render={<Link href={`/orders/${paidOrder!.id}`} />} className={LUX_PRIMARY}>
                      <ReceiptText /> View order
                    </Button>
                    <Button variant="outline" render={<Link href={`/albums/${album.id}/build`} />}>
                      <Eye /> View album
                    </Button>
                  </>
                )}
              </div>
            </div>

            {/* Details */}
            <div>
              <h1 className="font-display text-[2.1rem] font-semibold leading-none tracking-tight">{album.title}</h1>
              {(album.destination || album.travel_dates) && (
                <div className="mt-3 flex flex-wrap gap-4 text-sm text-muted-foreground">
                  {album.destination && (
                    <span className="inline-flex items-center gap-1.5">
                      <MapPin className="h-4 w-4 text-primary/70" /> {album.destination}
                    </span>
                  )}
                  {album.travel_dates && (
                    <span className="inline-flex items-center gap-1.5">
                      <Calendar className="h-4 w-4 text-primary/70" /> {album.travel_dates}
                    </span>
                  )}
                </div>
              )}
              {album.description && (
                <p className="mt-3 max-w-prose font-display text-lg italic leading-relaxed text-muted-foreground">
                  “{album.description}”
                </p>
              )}

              <div className="mt-6 grid grid-cols-3 overflow-hidden rounded-xl border bg-card">
                {[
                  { value: album.size, label: 'Pages' },
                  { value: photoCount ?? 0, label: 'Photos' },
                  { value: ALBUM_STATE[album.status] ?? album.status, label: 'Status' },
                ].map((s, i) => (
                  <div key={s.label} className={`p-4 ${i < 2 ? 'border-r' : ''}`}>
                    <div className="font-display text-2xl font-semibold tabular-nums">{s.value}</div>
                    <div className="mt-0.5 text-[11px] uppercase tracking-wide text-muted-foreground">{s.label}</div>
                  </div>
                ))}
              </div>

              <h2 className="mt-8 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Order history
              </h2>
              {orders.length === 0 ? (
                <p className="mt-3 rounded-xl border border-dashed bg-card/50 p-5 text-sm text-muted-foreground">
                  Not ordered yet — when you’re ready, this album can be printed and bound.
                </p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {orders.map((o) => {
                    const view = orderStatusView(o.status);
                    return (
                      <li
                        key={o.id}
                        className="flex items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3 text-sm"
                      >
                        <div>
                          <span className="font-mono text-xs text-muted-foreground">#{o.id.slice(0, 8)}</span>
                          <span className="ml-2 font-medium">
                            {['paid', 'processing', 'printing', 'packed', 'shipped', 'delivered'].includes(o.status)
                              ? view.label
                              : o.status}
                          </span>
                          <span className="ml-2 text-muted-foreground">· {fmtDate(o.placed_at)}</span>
                        </div>
                        <Link
                          href={`/orders/${o.id}`}
                          className="text-xs font-medium text-primary underline-offset-2 hover:underline"
                        >
                          View
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </div>
      </div>
    </CustomerShell>
  );
}
