-- ============================================================
-- Malnad Stories — 0006: generic unlimited overlays; retire pip
-- Run this in: Supabase Dashboard → SQL Editor → New query
-- ============================================================
--
-- layout_config becomes { "overlays": [ { photoId, x, y, w, h } ] } (0..1 fractions),
-- valid on single-full AND spread-full. The overlay's photo moves OUT of photo_ids
-- (which now holds only the base slot) and INTO each overlay object. 'pip' is folded
-- into 'single-full' + one overlay.

-- 1. Drop the old guards that assumed pip / a 2-slot photo_ids.
alter table public.album_pages drop constraint if exists album_pages_layout_template_check;
alter table public.album_pages drop constraint if exists album_pages_photo_ids_len_check;
alter table public.album_pages drop constraint if exists album_pages_layout_config_shape_check;

-- 2. Migrate existing pip blocks → single-full + (optional) one overlay.
--    photo_ids[1] = base, photo_ids[2] = overlay photo (may be absent).
--    Old geometry lived in layout_config->'overlay'; default it if missing.
update public.album_pages
set
  layout_config = case
    when array_length(photo_ids, 1) >= 2 then
      jsonb_build_object('overlays', jsonb_build_array(jsonb_build_object(
        'photoId', photo_ids[2]::text,
        'x', coalesce((layout_config -> 'overlay' ->> 'x')::numeric, 0.6),
        'y', coalesce((layout_config -> 'overlay' ->> 'y')::numeric, 0.06),
        'w', coalesce((layout_config -> 'overlay' ->> 'w')::numeric, 0.34),
        'h', coalesce((layout_config -> 'overlay' ->> 'h')::numeric, 0.34)
      )))
    else jsonb_build_object('overlays', '[]'::jsonb)
  end,
  photo_ids = case
    when array_length(photo_ids, 1) >= 1 then (array[photo_ids[1]])::uuid[]
    else '{}'::uuid[]
  end,
  layout_template = 'single-full'
where layout_template = 'pip';

-- 3. New layout_template guard: pip retired.
alter table public.album_pages
  add constraint album_pages_layout_template_check
  check (layout_template is null or layout_template in ('single-full', 'spread-full'));

-- 4. photo_ids now holds only the base slot; overlays live in layout_config.
alter table public.album_pages
  add constraint album_pages_photo_ids_len_check
  check (array_length(photo_ids, 1) is null or array_length(photo_ids, 1) <= 1);

-- 5. Light shape guard: layout_config is null, or an object with an 'overlays' array.
alter table public.album_pages
  add constraint album_pages_layout_config_shape_check
  check (layout_config is null or jsonb_typeof(layout_config -> 'overlays') = 'array');

-- No GRANT changes: authenticated already has full CRUD on album_pages (0003);
-- RLS "users_own_album_pages" scopes every row via the parent album's owner.
