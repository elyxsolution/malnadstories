-- ============================================================
-- Malnad Stories — 0049: album-level product snapshot (historical consistency)
-- Run this in: Supabase Dashboard → SQL Editor → New query
-- ============================================================
--
-- Additive + behaviour-preserving. Snapshots the SELECTED PRODUCT'S metadata onto the album
-- AT CREATION time, so an album keeps its original product name + dimensions even if the
-- catalog later changes (future catalog evolution / historical accuracy). RENDERING IS
-- UNCHANGED — the builder/print still resolve LIVE dimensions from the product (0047); these
-- columns are a record only. All nullable (old albums stay null; nothing breaks).

alter table public.albums
  add column if not exists product_name            text,
  add column if not exists product_width_cm        numeric(6,2),
  add column if not exists product_height_cm       numeric(6,2),
  add column if not exists product_aspect_ratio    numeric(8,5),
  add column if not exists product_print_width_cm  numeric(6,2),
  add column if not exists product_print_height_cm numeric(6,2);

-- The creation path writes these through the AUTHENTICATED client (server-computed from the
-- resolved product, never client input), so grant column-scoped INSERT (mirrors 0021/0026/0038).
-- Not updatable by customers — snapshot is frozen at creation.
grant insert (product_name, product_width_cm, product_height_cm, product_aspect_ratio, product_print_width_cm, product_print_height_cm)
  on table public.albums to authenticated;
