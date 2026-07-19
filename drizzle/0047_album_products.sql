-- ============================================================
-- Malnad Stories — 0047: Album Product catalog (physical products + dimensions + prices)
-- Run this in: Supabase Dashboard → SQL Editor → New query
-- ============================================================
--
-- REPLACES the "products = a page-count/price lookup" model with a true catalog of
-- PHYSICAL album products (Standard / Premium / Signature). Each product owns its
-- physical dimensions + builder aspect + print size, a cover preview, a gallery of
-- preview images, and a price PER supported page count.
--
-- Additive + backward-compatible:
--   • The legacy `products` table is LEFT INTACT (still read as a page-count fallback
--     by pricing/creation), so nothing breaks the moment this runs.
--   • `albums.size` (the page count) is UNCHANGED and stays the source of truth for the
--     page count; we only ADD `albums.product_id`.
--   • Every existing album is backfilled to the Standard product; every existing order
--     gets a Standard product snapshot for historical accuracy.
--
-- Security: mirrors the stickers (0039) / cover-templates (0023) catalog pattern —
--   public SELECT of ACTIVE rows only, ALL writes via the service role (no anon/
--   authenticated write GRANT → inserts/updates/deletes are impossible regardless).

-- ── 1. AlbumProduct — the catalog ────────────────────────────────────────────────
create table if not exists public.album_products (
  id                  uuid          primary key default gen_random_uuid(),
  name                text          not null,
  slug                text          not null,
  description         text,
  -- Physical + rendering dimensions. Stored in the DB so the builder/print/worker
  -- NEVER hardcode them. builder_aspect_ratio = width_cm / height_cm (persisted so a
  -- product can override it independently of the raw cm if ever needed).
  width_cm            numeric(6,2)  not null check (width_cm > 0),
  height_cm           numeric(6,2)  not null check (height_cm > 0),
  builder_aspect_ratio numeric(8,5) not null check (builder_aspect_ratio > 0),
  print_width_cm      numeric(6,2)  not null check (print_width_cm > 0),
  print_height_cm     numeric(6,2)  not null check (print_height_cm > 0),
  cover_preview_key   text,                                   -- R2 key: single cover preview image
  display_order       integer       not null default 0,
  is_default          boolean       not null default false,
  is_active           boolean       not null default true,
  created_at          timestamptz   not null default now(),
  updated_at          timestamptz   not null default now(),
  created_by          uuid          references public.profiles(id) on delete set null,
  updated_by          uuid          references public.profiles(id) on delete set null
);

-- No duplicate names / slugs (validation is also enforced in the admin action).
create unique index if not exists album_products_name_key on public.album_products (lower(name));
create unique index if not exists album_products_slug_key on public.album_products (slug);
-- EXACTLY ONE default product (partial unique index — the DB is the backstop for the
-- admin "set default" action which clears the previous default first).
create unique index if not exists album_products_one_default_idx
  on public.album_products ((is_default)) where is_default;
create index if not exists album_products_active_order_idx
  on public.album_products (is_active, display_order);

alter table public.album_products enable row level security;

drop policy if exists album_products_read_active on public.album_products;
create policy album_products_read_active on public.album_products
  for select using (is_active = true);

grant select on table public.album_products to anon, authenticated;
grant all    on table public.album_products to service_role;

-- ── 2. AlbumProductPreview — gallery images (ordered) ────────────────────────────
create table if not exists public.album_product_previews (
  id          uuid        primary key default gen_random_uuid(),
  product_id  uuid        not null references public.album_products(id) on delete cascade,
  image_key   text        not null,                  -- R2 key (private bucket; presigned GET)
  sort_order  integer     not null default 0,
  created_at  timestamptz not null default now()
);

create index if not exists album_product_previews_product_sort_idx
  on public.album_product_previews (product_id, sort_order);

alter table public.album_product_previews enable row level security;

-- Readable only while the parent product is active (previews follow product visibility).
drop policy if exists album_product_previews_read on public.album_product_previews;
create policy album_product_previews_read on public.album_product_previews
  for select using (
    exists (select 1 from public.album_products p where p.id = product_id and p.is_active)
  );

grant select on table public.album_product_previews to anon, authenticated;
grant all    on table public.album_product_previews to service_role;

-- ── 3. AlbumProductPrice — price per (product, page_count) ────────────────────────
create table if not exists public.album_product_prices (
  id          uuid          primary key default gen_random_uuid(),
  product_id  uuid          not null references public.album_products(id) on delete cascade,
  page_count  integer       not null check (page_count > 0),
  price       numeric(10,2) not null check (price >= 0),
  created_at  timestamptz   not null default now(),
  updated_at  timestamptz   not null default now(),
  unique (product_id, page_count)
);

create index if not exists album_product_prices_product_idx
  on public.album_product_prices (product_id, page_count);

alter table public.album_product_prices enable row level security;

drop policy if exists album_product_prices_read on public.album_product_prices;
create policy album_product_prices_read on public.album_product_prices
  for select using (
    exists (select 1 from public.album_products p where p.id = product_id and p.is_active)
  );

grant select on table public.album_product_prices to anon, authenticated;
grant all    on table public.album_product_prices to service_role;

-- ── 4. Albums: add product_id (page count stays in albums.size, unchanged) ─────────
alter table public.albums
  add column if not exists product_id uuid references public.album_products(id) on delete restrict;

create index if not exists albums_product_id_idx on public.albums (product_id);

-- Column-scoped GRANT so the authenticated creation path (createAlbum) may set product_id
-- at INSERT (mirrors 0021/0026/0038). product_id is NOT updatable by customers (changing
-- it changes dimensions + price) — server-role only.
grant insert (product_id) on table public.albums to authenticated;

-- ── 5. Orders: persist the product snapshot for historical accuracy ────────────────
alter table public.orders
  add column if not exists product_id         uuid references public.album_products(id) on delete set null,
  add column if not exists product_name       text,
  add column if not exists product_dimensions jsonb;

-- ── 6. Seed the three physical products (idempotent by slug) ──────────────────────
insert into public.album_products
  (name, slug, description, width_cm, height_cm, builder_aspect_ratio, print_width_cm, print_height_cm, display_order, is_default, is_active)
values
  ('Standard',  'standard',
   'Everyday A4 photo album — crisp, lightweight, beautifully bound.',
   21.0, 29.7, round(21.0/29.7, 5), 21.0, 29.7, 10, true,  true),
  ('Premium',   'premium',
   'Larger format on heavier stock for a gallery-grade finish.',
   25.0, 35.0, round(25.0/35.0, 5), 25.0, 35.0, 20, false, true),
  ('Signature', 'signature',
   'Our flagship A3 keepsake — the most immersive way to relive a journey.',
   29.7, 42.0, round(29.7/42.0, 5), 29.7, 42.0, 30, false, true)
on conflict (slug) do nothing;

-- ── 7. Seed prices per (product, page_count). Standard = the existing prices; Premium
--       + Signature are editable placeholders (admin tunes them). Idempotent. ────────
insert into public.album_product_prices (product_id, page_count, price)
select p.id, v.page_count, v.price
from (values
  ('standard', 24,  899.00), ('standard', 36, 1599.00), ('standard', 48, 2799.00),
  ('premium',  24, 1299.00), ('premium',  36, 2199.00), ('premium',  48, 3699.00),
  ('signature',24, 1899.00), ('signature',36, 3199.00), ('signature',48, 4999.00)
) as v(slug, page_count, price)
join public.album_products p on p.slug = v.slug
on conflict (product_id, page_count) do nothing;

-- ── 8. Backfill: every existing album → Standard (page count unchanged) ────────────
update public.albums
   set product_id = (select id from public.album_products where slug = 'standard')
 where product_id is null;

-- ── 9. Backfill: every existing order → Standard snapshot (historical accuracy) ────
update public.orders o
   set product_id = s.id,
       product_name = s.name,
       product_dimensions = jsonb_build_object(
         'width_cm', s.width_cm, 'height_cm', s.height_cm,
         'print_width_cm', s.print_width_cm, 'print_height_cm', s.print_height_cm,
         'builder_aspect_ratio', s.builder_aspect_ratio)
  from public.album_products s
 where s.slug = 'standard'
   and o.product_id is null;
