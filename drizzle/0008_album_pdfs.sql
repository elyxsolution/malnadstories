-- ============================================================
-- Malnad Stories — 0008: album preview PDF state (worker part 2)
-- Run this in: Supabase Dashboard → SQL Editor → New query
-- ============================================================
--
-- One row per album tracking the latest generated preview PDF, plus the short-lived
-- single-use token the worker's headless Chromium uses to reach the print route.
--
--   status        idle → generating → ready | failed
--   r2_key        private R2 key of the generated PDF ({user}/albums/{album}/preview.pdf)
--   token_hash    sha256 of the print-route token (raw token never stored)
--   token_used_at single-use marker (set on first valid print-route hit)

create table if not exists public.album_pdfs (
  album_id          uuid primary key references public.albums(id) on delete cascade,
  status            text not null default 'idle'
                      check (status in ('idle', 'generating', 'ready', 'failed')),
  r2_key            text,
  generated_at      timestamptz,
  error             text,
  token_hash        text,
  token_expires_at  timestamptz,
  token_used_at     timestamptz
);

alter table public.album_pdfs enable row level security;

-- SERVICE-ROLE ONLY: no policies, no grants. The app touches this table exclusively
-- through server code that first verifies album ownership (mint token / poll status);
-- the client never reads or writes it directly. service_role bypasses RLS and keeps
-- its privileges, so the worker + server actions work without any policy.
revoke all on table public.album_pdfs from anon, authenticated;
