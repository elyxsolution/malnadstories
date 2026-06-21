-- ============================================================
-- Malnad Stories — 0031: CMS & Content Management (Phase 9D)
-- Run this in: Supabase Dashboard → SQL Editor → New query  (run BEFORE deploying the
-- matching app code — the new public pages + admin UI read this table).
-- ============================================================
--
-- Additive, ADMIN-OWNED content subsystem (FAQs, testimonials, legacy stories, homepage
-- sections, blog, announcements). One polymorphic table; per-type extras live in
-- `metadata` jsonb. Touches NOTHING in payments / uploads / PDF / builder / orders /
-- review-refund-reprint.
--
-- Security model is the PUBLIC-READ one (like `products`), NOT the customer-owned tables:
--   • Public (anon + authenticated) may SELECT only PUBLISHED rows. Admins see all
--     (via is_admin(), and the admin UI reads via Drizzle superuser regardless).
--   • All writes are service-role only (no client write grant + restrictive deny). Admin
--     actions are requireAdmin-gated and write the audit row via log_audit() (0016),
--     exactly like cover_templates — no bespoke RPCs.
--
-- Enum values are LOWERCASE to match the rest of the schema.

create table if not exists public.content_pages (
  id            uuid primary key default gen_random_uuid(),
  type          text not null
                  check (type in ('blog','faq','testimonial','legacy_story','homepage_section','announcement')),
  status        text not null default 'draft'
                  check (status in ('draft','published','archived')),
  title         text not null,                       -- question / name / section-name per type
  slug          text not null unique,                -- url / section key (slugified server-side)
  excerpt       text,
  content       text,                                -- markdown/plain: answer / review / story / body
  cover_image   text,                                -- URL only (no upload pipeline)
  metadata      jsonb not null default '{}'::jsonb,  -- per-type: category, rating, location, subtitle, featured, heading, subheading, cta_label, cta_link
  published_at  timestamptz,                         -- set on first publish
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid references public.profiles(id) on delete set null,
  updated_by    uuid references public.profiles(id) on delete set null
);

create index if not exists content_pages_type_status_idx on public.content_pages (type, status, updated_at desc);
create index if not exists content_pages_status_pub_idx   on public.content_pages (status, published_at desc);

-- ── RLS + grants (public-read model) ─────────────────────────────────────────
alter table public.content_pages enable row level security;

-- SELECT: public sees only PUBLISHED; admins see everything. is_admin() is false for anon.
drop policy if exists "content_pages_select" on public.content_pages;
create policy "content_pages_select" on public.content_pages for select to anon, authenticated
  using (status = 'published' or public.is_admin());

-- No client writes — admins mutate via service-role actions. Deny INSERT/UPDATE/DELETE.
drop policy if exists "content_pages_deny_insert" on public.content_pages;
create policy "content_pages_deny_insert" on public.content_pages as restrictive for insert to authenticated, anon with check (false);
drop policy if exists "content_pages_deny_update" on public.content_pages;
create policy "content_pages_deny_update" on public.content_pages as restrictive for update to authenticated, anon using (false);
drop policy if exists "content_pages_deny_delete" on public.content_pages;
create policy "content_pages_deny_delete" on public.content_pages as restrictive for delete to authenticated, anon using (false);

-- Privileges: SELECT to anon + authenticated (RLS filters to published/admin); service_role full.
grant select on table public.content_pages to anon, authenticated;
grant all    on table public.content_pages to service_role;
