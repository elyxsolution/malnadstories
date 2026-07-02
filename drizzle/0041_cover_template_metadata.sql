-- ============================================================
-- Malnad Stories — 0041: cover-template merchandising metadata (popular · pinned)
-- Run this in: Supabase Dashboard → SQL Editor → New query
-- ============================================================
--
-- PURELY ADDITIVE (Task 4). Extends cover_design_templates (0040) with two boolean flags so
-- admins can merchandise the picker. `featured` (0040) and `sort` (display order) already exist,
-- and "New" is derived from `created_at` — so we only add `popular` + `pinned` here.
--   popular → surfaces a "Popular" shelf in the picker.
--   pinned  → sticky at the very top of the catalog + picker (above featured), for a hero design.
-- No rows/columns/types dropped; existing templates default to false and behave exactly as before.

alter table public.cover_design_templates
  add column if not exists popular boolean not null default false;
alter table public.cover_design_templates
  add column if not exists pinned  boolean not null default false;

-- Refine the hot read index to lead with the new ordering (pinned → featured → sort).
drop index if exists cover_design_templates_active_idx;
create index if not exists cover_design_templates_active_idx
  on public.cover_design_templates (status, pinned, featured, sort);
