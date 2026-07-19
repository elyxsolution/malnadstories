-- ============================================================
-- Malnad Stories — 0048: Album Product demo album + "best for" tags (preview experience)
-- Run this in: Supabase Dashboard → SQL Editor → New query
-- ============================================================
--
-- Additive + backward-compatible. Extends album_products (0047) with:
--   • demo_album_id — an EXISTING album designated as the product's interactive preview
--     (rendered through the real Flipbook). ON DELETE SET NULL so deleting the album just
--     falls back to the gallery images. Optional — null → gallery-image preview (unchanged).
--   • best_for      — marketing tags shown in the preview info panel (Travel / Wedding / …).
--
-- No data migration; existing products keep working with their gallery previews.

alter table public.album_products
  add column if not exists demo_album_id uuid references public.albums(id) on delete set null,
  add column if not exists best_for text[] not null default '{}'::text[];

-- The demo album id is read (with the product) by the public catalog SELECT policy already in
-- place; no new policy/grant needed (still SELECT-active for anon/authenticated, service-role writes).
