-- 0039_stickers.sql — Sticker catalog (admin-managed decorative artwork for the cover + pages).
--
-- Mirrors cover_templates (0023): artwork bytes live in the existing PRIVATE R2 bucket under
-- stickers/…; only metadata + R2 keys live here, served via presigned GET like covers/photos.
-- Customers SELECT active rows to place stickers; there is NO write GRANT for anon/authenticated,
-- so all admin writes go through the service role (which bypasses RLS). GRANT + RLS both required.

-- ── 1. Categories ──────────────────────────────────────────────────────────────
create table if not exists public.sticker_categories (
  id          uuid        primary key default gen_random_uuid(),
  name        text        not null,
  slug        text        not null unique,
  sort        integer     not null default 0,
  created_at  timestamptz not null default now()
);

alter table public.sticker_categories enable row level security;

drop policy if exists sticker_categories_read on public.sticker_categories;
create policy sticker_categories_read on public.sticker_categories
  for select using (true);

grant select on table public.sticker_categories to anon, authenticated;
grant all    on table public.sticker_categories to service_role;

-- ── 2. Stickers ────────────────────────────────────────────────────────────────
create table if not exists public.stickers (
  id           uuid        primary key default gen_random_uuid(),
  name         text        not null,
  category_id  uuid        references public.sticker_categories(id) on delete set null,
  image_key    text        not null,            -- R2 key: full sticker artwork (PNG w/ transparency)
  thumb_key    text,                            -- R2 key: optional small preview
  width        integer,
  height       integer,
  sort         integer     not null default 0,
  active       boolean     not null default true,
  created_by   uuid        references public.profiles(id),
  created_at   timestamptz not null default now()
);

alter table public.stickers enable row level security;

-- Signed-in users (and anon) READ active stickers to place them. No anon/authenticated write
-- GRANT → inserts/updates/deletes are impossible regardless of policy (admin writes go through
-- the service role). The print route / admin preview resolve referenced stickers by id via the
-- service role, so a deactivated-but-already-placed sticker still renders.
drop policy if exists stickers_read_active on public.stickers;
create policy stickers_read_active on public.stickers
  for select using (active = true);

grant select on table public.stickers to anon, authenticated;
grant all    on table public.stickers to service_role;

create index if not exists stickers_active_category_sort_idx
  on public.stickers (active, category_id, sort);

-- ── 3. Seed the default categories (idempotent) ──────────────────────────────────
insert into public.sticker_categories (name, slug, sort) values
  ('Travel',     'travel',     10),
  ('Mountains',  'mountains',  20),
  ('Beaches',    'beaches',    30),
  ('Nature',     'nature',     40),
  ('Adventure',  'adventure',  50),
  ('Wedding',    'wedding',    60),
  ('Food',       'food',       70),
  ('Frames',     'frames',     80),
  ('Decorative', 'decorative', 90)
on conflict (slug) do nothing;
