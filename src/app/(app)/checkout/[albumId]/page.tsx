import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { computeOrderAmount } from '@/lib/pricing';
import { priceFor, getAlbumProductSnapshot } from '@/lib/products/catalog';
import { DEFAULT_SHIPPING_METHOD, isShippingMethod, type ShippingMethod } from '@/lib/shipping';
import { isPaidStatus } from '@/lib/orders/status';
import { presignGet } from '@/lib/r2';
import { listActiveCoverOptions } from '@/lib/covers';
import { PAGE_COST, type LayoutTemplate } from '@/lib/builder/model';
import { hasFrontCover } from '@/lib/albums/cover';
import { loadAlbumValidation } from '@/lib/albums/validation';
import { loadRenderReadiness } from '@/lib/albums/render-readiness';
import { normalizeCoverConfig } from '@/lib/builder/cover';
import Checkout from './_checkout';
import { type ReadinessItem } from './_readiness';
import { type Address } from './_address-picker';

// Longest-edge px below which a placed photo may print soft (advisory only).
const LOWRES_MIN_EDGE = 1000;

export default async function CheckoutPage({ params }: { params: { albumId: string } }) {
  const supabase = createClient();

  // Album must exist + belong to the user (RLS). Must be submitted to check out.
  const { data: albumRow } = await supabase
    .from('albums')
    .select('id, title, size, status, cover_template_id, cover_config, destination, travel_dates, product_id')
    .eq('id', params.albumId)
    .maybeSingle();
  const album = albumRow as {
    id: string;
    title: string;
    size: number;
    status: string;
    cover_template_id: string | null;
    cover_config: unknown;
    destination: string | null;
    travel_dates: string | null;
    product_id: string | null;
  } | null;
  if (!album) notFound();

  // Orders already on this album: a paid+ one → straight to its confirmation; a pending
  // one → resume with its EXACT figures (copies/coupon) so the UI matches what will be
  // charged on resume.
  const { data: orderRows } = await supabase
    .from('orders')
    .select('id, status, copies, coupon_id, subtotal_amount, shipping_amount, shipping_method, discount_amount, total_amount')
    .eq('album_id', album.id)
    .order('placed_at', { ascending: false });
  const orders = (orderRows ?? []) as {
    id: string;
    status: string;
    copies: number;
    coupon_id: string | null;
    subtotal_amount: string;
    shipping_amount: string;
    shipping_method: string;
    discount_amount: string;
    total_amount: string;
  }[];

  const paid = orders.find((o) => isPaidStatus(o.status));
  if (paid) redirect(`/orders/${paid.id}`);

  if (album.status !== 'submitted') redirect(`/albums/${album.id}/build`);

  const pending = orders.find((o) => o.status === 'pending') ?? null;

  // Server-side price by ALBUM PRODUCT + page count (0047) — never page count alone. priceFor
  // falls back to the legacy products lookup only for a pre-migration null-product album, so the
  // first server-rendered total always matches the selected Album Product.
  const basePrice = await priceFor(album.product_id, album.size);
  if (basePrice == null) {
    return (
      <div className="mx-auto max-w-md p-8 text-sm text-destructive">
        Pricing for this album is currently unavailable. Please contact support.
      </div>
    );
  }
  // Product name + dimensions from the Album Product (matches what the customer chose).
  const snapshot = await getAlbumProductSnapshot(album.product_id);
  const formatName = snapshot.productName ?? `${album.size}-page album`;
  const formatDimensions = `${snapshot.dimensions.widthCm} × ${snapshot.dimensions.heightCm} cm`;

  // Initial breakdown/copies/coupon: resume a pending order's stored figures, else the
  // default single-copy, no-coupon price. All server-computed.
  let initialCopies = 1;
  let initialCouponCode: string | null = null;
  let initialShippingMethod: ShippingMethod = DEFAULT_SHIPPING_METHOD;
  let amount: { subtotalInr: number; shippingInr: number; discountInr: number; totalInr: number };

  if (pending) {
    initialCopies = pending.copies;
    if (isShippingMethod(pending.shipping_method)) initialShippingMethod = pending.shipping_method;
    amount = {
      subtotalInr: Number(pending.subtotal_amount),
      shippingInr: Number(pending.shipping_amount),
      discountInr: Number(pending.discount_amount),
      totalInr: Number(pending.total_amount),
    };
    if (pending.coupon_id) {
      // coupons are service-only; read just the code for display (ownership already
      // proven by the RLS-scoped orders read above).
      const admin = createServiceClient();
      const { data: c } = await admin
        .from('coupons')
        .select('code')
        .eq('id', pending.coupon_id)
        .maybeSingle();
      initialCouponCode = (c as { code: string } | null)?.code ?? null;
    }
  } else {
    // FRESH CHECKOUT — carry the copy count the customer already chose in their cart (Phase 7).
    //
    // Read SERVER-SIDE from their own `cart_items` row through the RLS-scoped client, never from
    // the URL or the client: there is no `?copies=` to tamper with, and the figure is only a
    // starting value for the stepper anyway — `createOrder` recomputes the amount from the
    // product price and its own Zod-bounded `copies` at pay time.
    //
    // This branch is the ELSE of the pending-order case above, deliberately. A pending order's
    // stored copies stay authoritative because its Razorpay amount is already fixed; seeding from
    // the cart there would display a number that is not what will be charged.
    const { data: cartRow } = await supabase
      .from('cart_items')
      .select('quantity')
      .eq('album_id', album.id)
      .maybeSingle();
    const cartQuantity = (cartRow as { quantity: number } | null)?.quantity;
    if (typeof cartQuantity === 'number' && Number.isFinite(cartQuantity)) {
      initialCopies = Math.min(10, Math.max(1, Math.round(cartQuantity)));
    }
    const a = computeOrderAmount(basePrice, initialCopies);
    amount = {
      subtotalInr: a.subtotalInr,
      shippingInr: a.shippingInr,
      discountInr: a.discountInr,
      totalInr: a.totalInr,
    };
  }

  // OWN ADDRESSES ONLY — filtered explicitly, not just by RLS: `addresses` carries an
  // `admins_read_all_addresses` policy, so for an admin the RLS-scoped read returns every
  // customer's address and the picker could pre-select a foreign one. `createOrder` refuses such
  // an id, so this only aligns the list with what the action will accept. No change for a
  // normal customer, whose RLS view is already just their own rows.
  const {
    data: { user: currentUser },
  } = await supabase.auth.getUser();
  const { data: addressRows } = await supabase
    .from('addresses')
    .select('id, full_name, line1, city, state, pincode, is_default')
    .eq('user_id', currentUser?.id ?? '')
    .order('is_default', { ascending: false })
    .order('created_at', { ascending: false });
  const addresses = (addressRows ?? []) as Address[];

  // ── Advisory readiness check (Design Completion Phase 1) ──────────────────────
  // Reuses existing data only (album_pages + photos.width/height + cover/title). It is
  // ADVISORY: it never gates payment — submitAlbum already enforces completeness, so for
  // a properly submitted album these mostly read green; the low-res note adds substance.
  const [{ data: pageRows }, { data: photoRows }] = await Promise.all([
    supabase.from('album_pages').select('layout_template, photo_ids, layout_config').eq('album_id', album.id),
    supabase.from('photos').select('id, width, height, status').eq('album_id', album.id),
  ]);
  const pages = (pageRows ?? []) as {
    layout_template: LayoutTemplate | null;
    photo_ids: string[] | null;
    layout_config: { overlays?: { photoId: string | null }[] } | null;
  }[];
  const photos = (photoRows ?? []) as { id: string; width: number | null; height: number | null; status: string }[];

  let consumed = 0;
  let emptyFrames = 0;
  const placedIds = new Set<string>();
  for (const p of pages) {
    if (!p.layout_template) continue;
    consumed += PAGE_COST[p.layout_template];
    const filled = (p.photo_ids ?? []).filter(Boolean);
    filled.forEach((id) => placedIds.add(id));
    const overlays = p.layout_config?.overlays ?? [];
    overlays.forEach((o) => o.photoId && placedIds.add(o.photoId));
    // An EMPTY FRAME is an overlay container with no photo in it — the only unfinished thing a
    // page can carry now that pages are backgrounds rather than photo containers. Counting unfilled
    // base halves (the old rule) would report every ordinary one-photo spread as short two photos.
    emptyFrames += overlays.filter((o) => !o.photoId).length;
  }
  const lowResCount = photos.filter(
    (ph) =>
      ph.status === 'ready' &&
      placedIds.has(ph.id) &&
      ph.width != null &&
      ph.height != null &&
      Math.max(ph.width, ph.height) < LOWRES_MIN_EDGE,
  ).length;

  // Canonical cover check (single source of truth) — recognises every cover type, not just a
  // legacy template id. Advisory: `activeTemplate` = a selected template id (no extra round-trip).
  const coverOk = hasFrontCover({
    activeTemplate: !!album.cover_template_id,
    config: normalizeCoverConfig(album.cover_config as Parameters<typeof normalizeCoverConfig>[0]),
    title: album.title,
  });

  // Print-readiness (CHANGE 2) — the SAME central report the builder + PDF use. Surfaced before
  // payment so a customer never pays for an album that can't yet be printed. Blank back cover is
  // INFO, so it never blocks checkout.
  const [printReport, renderReport] = await Promise.all([
    loadAlbumValidation(supabase, album.id),
    loadRenderReadiness(supabase, album.id),
  ]);
  const printReady = printReport?.printReady ?? true;
  const blockingIssues = printReport ? [...printReport.critical, ...printReport.warnings].map((i) => i.title) : [];

  const readiness: ReadinessItem[] = [
    {
      ok: consumed === album.size,
      title: 'Album structure complete',
      detail:
        consumed === album.size
          ? `All ${album.size} pages are laid out.`
          : `${consumed} of ${album.size} pages laid out.`,
    },
    {
      ok: emptyFrames === 0,
      title: emptyFrames === 0 ? 'No empty frames' : `${emptyFrames} empty frame${emptyFrames === 1 ? '' : 's'}`,
      detail:
        emptyFrames === 0
          ? 'Every frame has a photo.'
          : 'Empty frames print as blank paper — add photos in the builder.',
    },
    {
      ok: coverOk,
      title: coverOk ? 'Cover design chosen' : 'No cover design',
      detail: coverOk
        ? 'Your selected cover will be printed on page one.'
        : 'Choose a cover design in the builder.',
    },
    {
      ok: !!album.title.trim(),
      title: album.title.trim() ? 'Cover title set' : 'Cover title missing',
      detail: album.title.trim()
        ? `“${album.title}” will be printed on the cover.`
        : 'Give your album a title in the builder.',
    },
    {
      ok: lowResCount === 0,
      title:
        lowResCount === 0
          ? 'Image resolution looks good'
          : `${lowResCount} low-resolution photo${lowResCount === 1 ? '' : 's'}`,
      detail:
        lowResCount === 0
          ? 'Placed photos are large enough to print crisply.'
          : 'These sit below our recommended print resolution and may look soft. You can still print them as-is.',
      advisory: true,
    },
  ];

  // Cover thumbnail for the album-summary preview (what the customer is buying).
  // Mirrors the builder page: resolve from the active covers, with a service-role
  // fallback for a now-inactive cover. Display only — never gates anything.
  let coverUrl: string | null = null;
  let coverName: string | null = null;
  if (album.cover_template_id) {
    const covers = await listActiveCoverOptions();
    const active = covers.find((c) => c.id === album.cover_template_id);
    if (active) {
      coverUrl = active.thumbUrl;
      coverName = active.name;
    } else {
      const svc = createServiceClient();
      const { data: c } = await svc
        .from('cover_templates')
        .select('name, image_key')
        .eq('id', album.cover_template_id)
        .maybeSingle();
      const row = c as { name: string; image_key: string } | null;
      if (row) {
        coverUrl = await presignGet(row.image_key, 3600);
        coverName = row.name;
      }
    }
  }

  const albumSub = [album.destination, album.travel_dates].filter(Boolean).join(' · ') || null;

  // The album's OWN cover, for the book shown beside the order summary. `cover_config` was already
  // selected for the readiness check above, so this costs no extra query. NULL stays NULL: an album
  // with no design keeps the existing template-thumbnail / bound-book fallback rather than being
  // handed an invented default config.
  const ownCover = album.cover_config
    ? normalizeCoverConfig(album.cover_config as Parameters<typeof normalizeCoverConfig>[0])
    : null;

  return (
    <div className="brand-surface">
      <Checkout
        albumId={album.id}
        albumTitle={album.title}
        albumSub={albumSub}
        albumSize={album.size}
        photoCount={placedIds.size}
        formatName={formatName}
        formatDimensions={formatDimensions}
        coverUrl={coverUrl}
        coverName={coverName}
        coverConfig={ownCover}
        amount={amount}
        addresses={addresses}
        pendingOrderId={pending?.id ?? null}
        initialCopies={initialCopies}
        initialCouponCode={initialCouponCode}
        initialShippingMethod={initialShippingMethod}
        readiness={readiness}
        printReady={printReady}
        blockingIssues={blockingIssues}
        validationReport={printReport}
        renderReport={renderReport}
      />
    </div>
  );
}
