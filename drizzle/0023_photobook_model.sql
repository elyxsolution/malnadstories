-- ============================================================
-- Malnad Stories — 0023: physical-photobook page model + cover templates
-- Run this in: Supabase Dashboard → SQL Editor → New query
-- ============================================================
--
-- Phase F. Moves the album to a real printed-photobook model:
--
--   Physical page 1 = Cover (admin-managed template; chosen, never edited)
--   Physical page 2 = Blank (inside front cover, left)   ┐ injected by the PDF
--   Physical page 3 = Blank (inside front cover, right)  ┘ generator only
--   Physical page 4… = user content
--
-- Content is built in PAIRS (every unit is two physical pages) so the printed book
-- always has an even content-page count and binds correctly:
--   single-pair    = two independent photos (left page photo + right page photo)
--   double-spread  = ONE image split exactly down the centre across both pages
--
-- `albums.size` (24/36/48) continues to mean CONTENT leaves only — the cover + 2
-- blanks are extra physical pages and do NOT affect pricing.
--
-- Backward compatibility: per product owner, all current rows are disposable test
-- data, so we transform in place (no legacy renderer, no paid-album exceptions).

-- ── 1. Cover templates (admin-managed catalogue) ─────────────────────────────
-- Artwork bytes live in the existing PRIVATE R2 bucket under cover-templates/…;
-- only the metadata + R2 keys live here. Served via presigned GET like photos.
create table if not exists public.cover_templates (
  id          uuid        primary key default gen_random_uuid(),
  name        text        not null,
  image_key   text        not null,            -- R2 key: full cover artwork (portrait)
  thumb_key   text,                            -- R2 key: optional small preview
  sort        integer     not null default 0,  -- catalogue ordering
  active      boolean     not null default true,
  created_by  uuid        references public.profiles(id),
  created_at  timestamptz not null default now()
);

alter table public.cover_templates enable row level security;

-- Signed-in users (and anon, for a future public catalogue) may READ active covers
-- to choose one. There is no write GRANT for anon/authenticated, so inserts/updates/
-- deletes are impossible for them regardless of policy — admin writes go through the
-- service role (which bypasses RLS), mirroring coupons. GRANT + RLS both required.
drop policy if exists cover_templates_read_active on public.cover_templates;
create policy cover_templates_read_active on public.cover_templates
  for select using (active = true);

grant select on table public.cover_templates to anon, authenticated;
grant all    on table public.cover_templates to service_role;

create index if not exists cover_templates_active_sort_idx
  on public.cover_templates (active, sort);

-- ── 2. Album → selected cover ────────────────────────────────────────────────
-- Nullable until the user picks one; submit + PDF generation require an active one.
-- ON DELETE SET NULL so retiring a cover template never orphans an album row.
alter table public.albums
  add column if not exists cover_template_id uuid references public.cover_templates(id) on delete set null;

-- ── 3. album_pages: new paired template set ──────────────────────────────────
-- A row is still one layout BLOCK = one content PAIR (two physical pages).
--   layout_template ∈ { single-pair, double-spread }
--   photo_ids       single-pair: [leftId, rightId]  (index 0 = left, 1 = right)
--                   double-spread: [imageId]
--   layout_config   { overlays:[ {photoId,x,y,w,h} ] } — 0..1 across the open PAIR
alter table public.album_pages drop constraint if exists album_pages_layout_template_check;
alter table public.album_pages drop constraint if exists album_pages_photo_ids_len_check;

-- Transform disposable test data in place:
--   spread-full (one wide image) → double-spread (same image, now centre-split)
--   single-full (one page)       → single-pair  (its photo becomes the LEFT page;
--                                                 the right page starts empty)
update public.album_pages set layout_template = 'double-spread' where layout_template = 'spread-full';
update public.album_pages set layout_template = 'single-pair'   where layout_template = 'single-full';

alter table public.album_pages
  add constraint album_pages_layout_template_check
  check (layout_template is null or layout_template in ('single-pair', 'double-spread'));

-- single-pair carries up to two base photos (left, right); double-spread one.
alter table public.album_pages
  add constraint album_pages_photo_ids_len_check
  check (array_length(photo_ids, 1) is null or array_length(photo_ids, 1) <= 2);

-- layout_config shape guard is unchanged from 0006 (null, or object w/ overlays array).

-- ============================================================
-- NOTE: existing albums whose content no longer fills exactly `size` content leaves
-- (e.g. a draft that mixed the old 1-leaf singles) will simply re-validate on the
-- next Save/Submit in the new builder. No data is lost; only re-arrangement may be
-- needed. This is acceptable: all current data is pre-launch test data.
-- ============================================================
