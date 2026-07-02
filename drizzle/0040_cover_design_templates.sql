-- ============================================================
-- Malnad Stories — 0040: cover DESIGN templates (builder-JSON cover presets)
-- Run this in: Supabase Dashboard → SQL Editor → New query
-- ============================================================
--
-- Phase 3 (Cover Design Template System). Admins design a FULL cover composition in the
-- SAME cover editor customers use, and publish it as a selectable, fully-editable starting
-- point. Unlike cover_templates (0023 = an uploaded PNG used as a backdrop image), a row
-- here stores a CoverConfig SNAPSHOT (jsonb) — subtitle/author/typography/layout/background
-- + free text/sticker/QR elements + the back-cover composition. Applying a template
-- DEEP-COPIES its config into albums.cover_config (photoId slots nulled — a template can't
-- reference a customer's photos), after which the customer may edit EVERYTHING. Nothing is
-- locked; the template is only the starting point.
--
-- Mirrors layout_templates (0032) + cover_templates (0023): admin-owned catalog, ACTIVE-read
-- for anon/authenticated, ALL writes via the service role (no client write GRANT), audited via
-- log_audit. It NEVER reaches the renderer beyond the existing CoverConfig shape, so builder /
-- flipbook / PDF / worker render it with ZERO new rendering — backward compatible by construction.
-- The legacy PNG cover_templates catalog (0023) is UNTOUCHED and keeps working alongside this.

create table if not exists public.cover_design_templates (
  id           uuid        primary key default gen_random_uuid(),
  name         text        not null,
  slug         text        not null unique,
  description  text,
  category     text        not null default 'general',
  status       text        not null default 'inactive'
                           check (status in ('active', 'inactive', 'archived')),
  -- A CoverConfig snapshot (lib/builder/cover.ts). Validated by CoverConfigSchema at the Zod
  -- boundary AND re-checked at the activation gate, so a malformed config can never go active.
  config       jsonb       not null,
  preview_key  text,                            -- R2 key: optional rendered preview (front)
  thumb_key    text,                            -- R2 key: optional small preview
  featured     boolean     not null default false,
  sort         integer     not null default 0,
  created_by   uuid        references public.profiles(id) on delete set null,
  updated_by   uuid        references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table public.cover_design_templates enable row level security;

-- Signed-in users (and anon, for a future public gallery) READ active templates to choose one.
-- No anon/authenticated write GRANT → inserts/updates/deletes are impossible for them regardless
-- of policy; admin writes go through the service role (which bypasses RLS). GRANT + RLS both required.
drop policy if exists cover_design_templates_read_active on public.cover_design_templates;
create policy cover_design_templates_read_active on public.cover_design_templates
  for select using (status = 'active');

grant select on table public.cover_design_templates to anon, authenticated;
grant all    on table public.cover_design_templates to service_role;

-- Hot read path: active catalog ordered by featured, then sort.
create index if not exists cover_design_templates_active_idx
  on public.cover_design_templates (status, featured, sort);
