-- ============================================================
-- Malnad Stories — 0052: Default Cover Design Template
-- Run this in: Supabase Dashboard → SQL Editor → New query
-- ============================================================
--
-- PURELY ADDITIVE. Gives the cover-design catalog ONE admin-chosen default that every new album
-- receives automatically, so the creation flow no longer has to ask the customer to pick a cover.
-- `is_default` marks it; a partial unique index enforces AT MOST ONE default across the whole
-- table (covers are not size-scoped, unlike blueprints in 0045 — hence a global index, not a
-- per-page-count one).
--
-- "Exactly one" is a UI guarantee (the admin sets it). If NO default is set, album creation falls
-- back to exactly the behaviour it has today — a blank custom cover the customer designs in the
-- builder — so this can never fail closed.
--
-- No schema redesign. RLS/GRANTs unchanged (cover_design_templates is service-role-write only,
-- public-read for active rows). Existing rows default to false → nothing changes until an admin
-- picks a default. Safe to run before or after the paired code deploy: until it runs, the default
-- lookup simply finds no column and creation keeps using the blank-cover path.

alter table public.cover_design_templates
  add column if not exists is_default boolean not null default false;

-- At most one default row in the entire table.
create unique index if not exists cover_design_templates_single_default_idx
  on public.cover_design_templates (is_default)
  where is_default = true;
