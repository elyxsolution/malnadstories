-- ============================================================
-- Malnad Stories — Initial Migration
-- Run this in: Supabase Dashboard → SQL Editor → New query
-- ============================================================

-- ── Tables ──────────────────────────────────────────────────

create table public.profiles (
  id         uuid        primary key references auth.users(id) on delete cascade,
  name       text,
  phone      text,
  role       text        not null default 'user'
                         check (role in ('user', 'admin')),
  created_at timestamptz not null default now()
);

create table public.addresses (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null references public.profiles(id) on delete cascade,
  full_name  text        not null,
  line1      text        not null,
  city       text        not null,
  state      text        not null,
  pincode    text        not null,
  is_default boolean     not null default false,
  created_at timestamptz not null default now()
);

create table public.products (
  id          uuid        primary key default gen_random_uuid(),
  name        text        not null,
  pages       integer     not null,
  base_price  numeric(10,2) not null,
  cover_types text[]      not null default '{}',
  is_active   boolean     not null default true,
  created_at  timestamptz not null default now()
);

create table public.albums (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null references public.profiles(id) on delete cascade,
  title      text        not null,
  size       integer     not null check (size in (50, 100, 200)),
  status     text        not null default 'draft'
                         check (status in ('draft', 'submitted', 'printing', 'complete')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.album_pages (
  id               uuid        primary key default gen_random_uuid(),
  album_id         uuid        not null references public.albums(id) on delete cascade,
  page_number      integer     not null,
  layout_template  text,
  caption          text,
  photo_ids        uuid[]      not null default '{}',
  created_at       timestamptz not null default now()
);

create table public.photos (
  id                uuid        primary key default gen_random_uuid(),
  user_id           uuid        not null references public.profiles(id) on delete cascade,
  album_id          uuid        references public.albums(id) on delete set null,
  r2_key            text,
  original_filename text        not null,
  edit_config       jsonb,
  uploaded_at       timestamptz not null default now()
);

create table public.orders (
  id                 uuid        primary key default gen_random_uuid(),
  user_id            uuid        not null references public.profiles(id) on delete cascade,
  album_id           uuid        not null references public.albums(id),
  address_id         uuid        not null references public.addresses(id),
  status             text        not null default 'pending'
                                 check (status in ('pending','paid','processing','shipped','delivered','cancelled')),
  total_amount       numeric(10,2) not null,
  razorpay_order_id  text,
  placed_at          timestamptz not null default now()
);

create table public.payments (
  id                   uuid        primary key default gen_random_uuid(),
  order_id             uuid        not null references public.orders(id) on delete cascade,
  razorpay_payment_id  text,
  method               text,
  amount               numeric(10,2) not null,
  status               text        not null default 'pending'
                                   check (status in ('pending','captured','failed','refunded')),
  captured_at          timestamptz
);

-- ── Row-Level Security ───────────────────────────────────────

alter table public.profiles    enable row level security;
alter table public.addresses   enable row level security;
alter table public.products    enable row level security;
alter table public.albums      enable row level security;
alter table public.album_pages enable row level security;
alter table public.photos      enable row level security;
alter table public.orders      enable row level security;
alter table public.payments    enable row level security;

-- Helper: is the current user an admin?
create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
as $$
  select coalesce(
    (select role = 'admin' from public.profiles where id = auth.uid()),
    false
  );
$$;

-- profiles
create policy "users_own_profile"
  on public.profiles for all
  using (id = auth.uid());

create policy "admins_read_all_profiles"
  on public.profiles for select
  using (public.is_admin());

-- addresses
create policy "users_own_addresses"
  on public.addresses for all
  using (user_id = auth.uid());

create policy "admins_read_all_addresses"
  on public.addresses for select
  using (public.is_admin());

-- products: anyone can read active products; only admins manage
create policy "public_read_active_products"
  on public.products for select
  using (is_active = true);

create policy "admins_manage_products"
  on public.products for all
  using (public.is_admin());

-- albums
create policy "users_own_albums"
  on public.albums for all
  using (user_id = auth.uid());

create policy "admins_read_all_albums"
  on public.albums for select
  using (public.is_admin());

-- album_pages (access via parent album ownership)
create policy "users_own_album_pages"
  on public.album_pages for all
  using (
    exists (
      select 1 from public.albums
      where id = album_id and user_id = auth.uid()
    )
  );

create policy "admins_read_all_album_pages"
  on public.album_pages for select
  using (public.is_admin());

-- photos
create policy "users_own_photos"
  on public.photos for all
  using (user_id = auth.uid());

create policy "admins_read_all_photos"
  on public.photos for select
  using (public.is_admin());

-- orders
create policy "users_own_orders"
  on public.orders for all
  using (user_id = auth.uid());

create policy "admins_read_all_orders"
  on public.orders for select
  using (public.is_admin());

-- payments (access via parent order ownership)
create policy "users_view_own_payments"
  on public.payments for select
  using (
    exists (
      select 1 from public.orders
      where id = order_id and user_id = auth.uid()
    )
  );

create policy "admins_manage_payments"
  on public.payments for all
  using (public.is_admin());

-- ── Trigger: auto-create profile on signup ───────────────────

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1))
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── Seed: products ───────────────────────────────────────────

insert into public.products (name, pages, base_price, cover_types, is_active) values
  ('Memories 50',  50,   899.00, array['softcover', 'hardcover'],           true),
  ('Memories 100', 100, 1599.00, array['softcover', 'hardcover', 'leather'], true),
  ('Memories 200', 200, 2799.00, array['hardcover', 'leather'],              true);
