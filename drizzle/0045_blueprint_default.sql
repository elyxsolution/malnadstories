-- ============================================================
-- Malnad Stories — 0045: Default Blueprint per album size
-- Run this in: Supabase Dashboard → SQL Editor → New query
-- ============================================================
--
-- PURELY ADDITIVE. Gives every album size (page_count) ONE admin-chosen default blueprint that
-- Auto Create uses — deterministic, never random. `is_default` marks it; a partial unique index
-- enforces AT MOST ONE default per page_count (only among blueprint rows). "Exactly one" is a UI
-- guarantee (the admin sets it); if a size has no default, Auto Create falls back gracefully
-- (closest-capacity, then the deterministic auto-layout) so it never fails. No schema redesign;
-- RLS/GRANTs unchanged (service-role writes only). Existing rows default to false → unchanged.

alter table public.layout_templates add column if not exists is_default boolean not null default false;

create unique index if not exists layout_templates_default_per_pagecount_idx
  on public.layout_templates (page_count)
  where is_default = true and blueprint is not null;
