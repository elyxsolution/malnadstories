-- ============================================================
-- Malnad Stories — 0025: album-PDF reliability/recovery state
-- Run this in: Supabase Dashboard → SQL Editor → New query
-- ============================================================
--
-- Phase: PDF becomes an INTERNAL backend workflow (no customer-facing generate).
-- Adds the two fields the recovery layer needs so an album can NEVER get stuck on
-- "generating" forever:
--
--   requested_at   when the CURRENT generation attempt started. The worker's stuck-job
--                  sweep re-drives any row that has been 'generating' longer than the
--                  timeout, and gives up (→ 'failed') after `attempts` hits the cap.
--   attempts       how many times generation has been driven for the current request.
--                  Bounds the retry loop so a permanently-broken album lands in
--                  'failed' (admin-recoverable) instead of looping forever.
--
-- album_pdfs stays SERVICE-ROLE ONLY (no policies/grants) — see 0008.

alter table public.album_pdfs
  add column if not exists requested_at timestamptz,
  add column if not exists attempts integer not null default 0;

-- Backfill: treat any existing in-flight 'generating' row as freshly requested so the
-- new sweep can time it out rather than ignore it (null requested_at = unknown age).
update public.album_pdfs
  set requested_at = coalesce(requested_at, generated_at, now())
  where status = 'generating' and requested_at is null;
