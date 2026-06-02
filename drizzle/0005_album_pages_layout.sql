-- ============================================================
-- Malnad Stories — 0005: album_pages.layout_config + layout guards
-- Run this in: Supabase Dashboard → SQL Editor → New query
-- ============================================================
--
-- The builder writes one album_pages row per layout BLOCK, in order.
--   page_number     = the block's sequence position (0-based), NOT a physical
--                     leaf number. Physical leaves are derived from the template
--                     costs (single=1, pip=1, spread=2) when rendering.
--   layout_template = 'single-full' | 'spread-full' | 'pip'
--   photo_ids       = ordered slots. single/spread: [photoId]. pip: [baseId, overlayId].
--                     Partially-filled blocks store only the slots filled so far.
--   layout_config   = jsonb, pip only: { "overlay": { x, y, w, h } } as 0..1 fractions
--                     of the page box. Null for single/spread.

-- 1. New column for the pip overlay geometry (and any future per-page layout state).
alter table public.album_pages
  add column if not exists layout_config jsonb;

-- 2. Constrain layout_template to the three templates this slice supports.
--    NULL stays allowed so the column's prior rows / placeholder pages don't break.
alter table public.album_pages
  drop constraint if exists album_pages_layout_template_check;
alter table public.album_pages
  add constraint album_pages_layout_template_check
  check (layout_template is null
         or layout_template in ('single-full', 'spread-full', 'pip'));

-- 3. A block has at most 2 photo slots (pip). single/spread use 1.
alter table public.album_pages
  drop constraint if exists album_pages_photo_ids_len_check;
alter table public.album_pages
  add constraint album_pages_photo_ids_len_check
  check (array_length(photo_ids, 1) is null or array_length(photo_ids, 1) <= 2);

-- 4. Ordering: blocks of one album are addressed by (album_id, page_number).
--    Unique so a save can't accidentally write two blocks at the same position.
create unique index if not exists album_pages_album_position_idx
  on public.album_pages (album_id, page_number);

-- No new GRANTs needed: authenticated already has full CRUD on album_pages (0003),
-- and RLS "users_own_album_pages" scopes every row to the parent album's owner.
