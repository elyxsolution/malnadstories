-- ============================================================
-- Malnad Stories — 0032: Template Management Platform (Phase 9E)
-- Run this in: Supabase Dashboard → SQL Editor → New query  (run BEFORE deploying the
-- matching app code — the admin UI + builder read this table).
-- ============================================================
--
-- Additive, ADMIN-OWNED catalog of curated LAYOUT PRESETS. A template's `geometry` is a
-- strictly-validated preset that maps onto the EXISTING two renderer primitives:
--   geometry = { "base": "single-pair" | "double-spread", "overlays": [{x,y,w,h}, …] }
-- Applying a template in the builder produces an ordinary Block[] (the same shape
-- saveLayout / the PDF route already handle), so NOTHING new reaches the renderer,
-- saveLayout, the album_pages CHECK, or the Zod BlockSchema. PDF parity holds by
-- construction. Touches nothing in payments/uploads/PDF/orders/review-refund-reprint.
--
-- Security model mirrors cover_templates / content_pages (admin-owned, app reads ACTIVE):
--   • RLS: authenticated may SELECT only ACTIVE rows; admins see all (is_admin()).
--     Builder + auto-layout read ACTIVE templates only (also enforced in app via service
--     role). Writes are service-role only (no client write grant + restrictive deny).
--   • Admin actions are requireTemplateCapability-gated and write audit via log_audit()
--     (0016) — no bespoke RPCs. New templates start INACTIVE (unselectable until validated
--     + activated).
--
-- Enum values are LOWERCASE to match the rest of the schema.

create table if not exists public.layout_templates (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  slug          text not null unique,                -- slugified server-side
  description   text,
  category      text not null
                  check (category in ('solo','pair','collage','panoramic','story')),
  status        text not null default 'inactive'
                  check (status in ('active','inactive','archived')),
  -- Renderer-safe preset. Validated by the app (validateGeometry) at the Zod boundary AND
  -- the activation gate; only { base: existing-primitive, overlays: numeric rects } is ever
  -- stored or consumed — no HTML/CSS/arbitrary keys reach the renderer.
  geometry      jsonb not null,
  preview_image text,                                -- optional URL (live preview is computed)
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid references public.profiles(id) on delete set null,
  updated_by    uuid references public.profiles(id) on delete set null
);

create index if not exists layout_templates_cat_status_idx on public.layout_templates (category, status, updated_at desc);
create index if not exists layout_templates_status_idx     on public.layout_templates (status, updated_at desc);

-- ── RLS + grants (active-read model) ─────────────────────────────────────────
alter table public.layout_templates enable row level security;

-- SELECT: authenticated sees only ACTIVE; admins see everything.
drop policy if exists "layout_templates_select" on public.layout_templates;
create policy "layout_templates_select" on public.layout_templates for select to authenticated
  using (status = 'active' or public.is_admin());

-- No client writes — admins mutate via service-role actions. Deny INSERT/UPDATE/DELETE.
drop policy if exists "layout_templates_deny_insert" on public.layout_templates;
create policy "layout_templates_deny_insert" on public.layout_templates as restrictive for insert to authenticated, anon with check (false);
drop policy if exists "layout_templates_deny_update" on public.layout_templates;
create policy "layout_templates_deny_update" on public.layout_templates as restrictive for update to authenticated, anon using (false);
drop policy if exists "layout_templates_deny_delete" on public.layout_templates;
create policy "layout_templates_deny_delete" on public.layout_templates as restrictive for delete to authenticated, anon using (false);

grant select on table public.layout_templates to authenticated;
grant all    on table public.layout_templates to service_role;
revoke all   on table public.layout_templates from anon;
