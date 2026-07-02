-- ============================================================
-- Malnad Stories — 0046: blueprint-editing draft albums
-- Run this in: Supabase Dashboard → SQL Editor → New query
-- ============================================================
--
-- PURELY ADDITIVE. Enables "Edit Blueprint in the builder" by reusing the EXISTING album builder:
-- opening a blueprint for editing creates a short-lived admin-owned DRAFT album (this column links
-- it back to the blueprint). Saving distills the album back into the SAME blueprint row and deletes
-- the draft. `on delete cascade` cleans up drafts if the blueprint is deleted. These albums are
-- hidden from the customer dashboard (a resilient filter that falls back gracefully pre-migration)
-- and are never orderable (they carry no photos). No album-model redesign; RLS unchanged.

alter table public.albums
  add column if not exists blueprint_draft_of uuid references public.layout_templates(id) on delete cascade;

create index if not exists albums_blueprint_draft_of_idx on public.albums (blueprint_draft_of) where blueprint_draft_of is not null;
