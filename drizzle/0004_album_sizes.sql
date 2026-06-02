-- ============================================================
-- Malnad Stories — 0004: album page options 50/100/200 → 24/36/48
-- Run this in: Supabase Dashboard → SQL Editor → New query
-- ============================================================

-- 1. Drop the old CHECK so existing rows can be remapped.
alter table public.albums drop constraint if exists albums_size_check;

-- 2. Migrate existing test albums to the new sizes (50→24, 100→36, 200→48).
update public.albums set size = 24 where size = 50;
update public.albums set size = 36 where size = 100;
update public.albums set size = 48 where size = 200;

-- 3. Update product rows: pages + names. Prices unchanged.
update public.products set pages = 24, name = 'Memories 24' where pages = 50;
update public.products set pages = 36, name = 'Memories 36' where pages = 100;
update public.products set pages = 48, name = 'Memories 48' where pages = 200;

-- 4. Re-add the CHECK with the new allowed values.
alter table public.albums
  add constraint albums_size_check check (size in (24, 36, 48));
