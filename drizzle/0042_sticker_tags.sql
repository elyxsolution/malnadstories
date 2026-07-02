-- ============================================================
-- Malnad Stories — 0042: sticker tags (searchable keywords)
-- Run this in: Supabase Dashboard → SQL Editor → New query
-- ============================================================
--
-- PURELY ADDITIVE. Extends stickers (0039) with a `tags` text[] so admins can label stickers
-- with searchable keywords (e.g. {'summer','beach','palm'}) beyond name + category. Reuses the
-- existing schema/RLS/GRANTs — no new table, no policy change: `select` for anon/authenticated
-- (active rows) and service-role writes are unchanged. A GIN index keeps tag search cheap.
-- Existing rows default to '{}' and behave exactly as before.

alter table public.stickers
  add column if not exists tags text[] not null default '{}';

create index if not exists stickers_tags_gin_idx on public.stickers using gin (tags);
