import { createClient } from '@/lib/supabase/server';
import CustomerShell from '@/components/customer-shell';
import NewTicketForm, { type LinkOption } from './_form';

/**
 * Open-a-request page. Loads the customer's own albums + orders (RLS-scoped) so a ticket
 * can be linked to one. The link is optional; the create action + RLS re-verify ownership.
 */
export default async function NewSupportPage({ searchParams }: { searchParams: { album?: string; order?: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [albumsRes, ordersRes] = await Promise.all([
    supabase.from('albums').select('id, title').order('updated_at', { ascending: false }),
    supabase.from('orders').select('id, album_id, status, placed_at').order('placed_at', { ascending: false }),
  ]);

  const albums = (albumsRes.data ?? []) as { id: string; title: string }[];
  const albumTitle = new Map(albums.map((a) => [a.id, a.title]));
  const orders = (ordersRes.data ?? []) as { id: string; album_id: string; status: string; placed_at: string }[];

  const albumOptions: LinkOption[] = albums.map((a) => ({ id: a.id, label: a.title }));
  const orderOptions: LinkOption[] = orders.map((o) => ({
    id: o.id,
    label: `#${o.id.slice(0, 8)} · ${albumTitle.get(o.album_id) ?? 'album'} · ${o.status}`,
  }));

  return (
    <CustomerShell email={user?.email ?? ''}>
      <NewTicketForm
        albums={albumOptions}
        orders={orderOptions}
        presetAlbumId={searchParams.album ?? null}
        presetOrderId={searchParams.order ?? null}
      />
    </CustomerShell>
  );
}
