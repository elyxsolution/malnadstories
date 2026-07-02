-- ============================================================
-- Malnad Stories — 0044: blueprint preview render token (thumbnail worker)
-- Run this in: Supabase Dashboard → SQL Editor → New query
-- ============================================================
--
-- PURELY ADDITIVE. Phase D generates blueprint thumbnails by having the worker's headless Chromium
-- screenshot a token-gated render route (mirrors album_pdfs' print token). These two columns on
-- layout_templates hold the short-lived, single-purpose token for that route:
--   preview_token_hash        — sha256 of the raw token (raw token never stored/logged)
--   preview_token_expires_at  — absolute expiry (5 min); the route rejects expired tokens
-- The generated thumbnail key lands in the existing `thumb_key` (0043). No schema redesign; RLS +
-- GRANTs unchanged (these columns are written/read only by the service role — never client-exposed).

alter table public.layout_templates add column if not exists preview_token_hash       text;
alter table public.layout_templates add column if not exists preview_token_expires_at  timestamptz;
