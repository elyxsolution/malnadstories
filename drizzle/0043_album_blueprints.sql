-- ============================================================
-- Malnad Stories — 0043: Album Blueprints (whole-album layout templates)
-- Run this in: Supabase Dashboard → SQL Editor → New query
-- ============================================================
--
-- Extends the EXISTING layout_templates (0032) into whole-album blueprints — additively, with
-- ZERO risk to existing rows. A layout_templates row is now one of two things:
--   • blueprint IS NULL  → a legacy SINGLE-SPREAD preset (geometry {base,overlays}) — unchanged.
--   • blueprint IS NOT NULL → a whole-ALBUM blueprint: { version, blocks: BlueprintBlock[] } where
--     each block is a page unit (single-pair | double-spread) + empty overlay slots + decorative
--     elements (texts / QR / stickers / background). Applying a blueprint PRODUCES ordinary album
--     Block[] (photos assigned to slots), so the builder / preview / flipbook / PDF / worker render
--     it through the existing pipeline with NO new rendering.
--
-- Derived fields (page_count / slot_count / recommended_photos) are computed from the blueprint on
-- every write — never hand-entered. Merchandising (featured/popular/pinned/sort) mirrors the cover
-- templates. thumb_key is an optional cached preview (Phase D); the picker falls back to live render.
--
-- Backward compatibility: every existing preset has blueprint=null and flags default false, so the
-- single-spread preset catalog (listActiveTemplates) and the builder behave exactly as before.

alter table public.layout_templates add column if not exists blueprint          jsonb;
alter table public.layout_templates add column if not exists page_count         integer;
alter table public.layout_templates add column if not exists slot_count          integer;
alter table public.layout_templates add column if not exists recommended_photos  integer;
alter table public.layout_templates add column if not exists featured            boolean not null default false;
alter table public.layout_templates add column if not exists popular             boolean not null default false;
alter table public.layout_templates add column if not exists pinned              boolean not null default false;
alter table public.layout_templates add column if not exists sort                integer not null default 0;
alter table public.layout_templates add column if not exists thumb_key           text;

-- Hot read path for the active BLUEPRINT catalog (partial index — presets excluded).
create index if not exists layout_templates_blueprint_active_idx
  on public.layout_templates (status, pinned, featured, sort)
  where blueprint is not null;

-- RLS + GRANTs are unchanged (0032): authenticated/anon SELECT active rows; admins write via the
-- service role. Blueprints inherit the exact same active-read policy — only active blueprints are
-- ever user-visible, and inactive/archived ones stay admin-only.
