-- ============================================================
-- Malnad Stories — 0038: editable custom front cover (albums.cover_config)
-- Run this in: Supabase Dashboard → SQL Editor → New query
-- DEPLOY ORDER: safe either way — ship the app build, then run this. The cover designer's
--   `saveCoverDesign` writes `albums.cover_config`; until this runs that one write fails
--   gracefully (the rest of the builder/cover-selection flow is unaffected).
-- ============================================================
--
-- WHAT: adds a single nullable jsonb column holding the customer's custom cover DESIGN —
--   subtitle/tagline, typography (font/colour/alignment), a premium layout preset, the
--   text vertical position, an optional CSS background, and an optional uploaded-photo
--   image source. The existing `cover_template_id` (the chosen base cover artwork) is
--   UNCHANGED and still the image fallback. `albums.title` remains the cover title.
--
-- The cover composition is rendered identically in the builder, the flipbook preview, and
-- the PDF print route from this jsonb — no other schema/render contract changes.
--
-- SECURITY: extends the column-scoped UPDATE grant from 0021 with `cover_config` so the
--   authenticated client can persist the design under RLS (`user_id = auth.uid()`).
--   `status` stays server-only. No new RLS policy is needed (rows already scoped by 0001).
--
-- NO DATA LOSS: one additive nullable column + one additive column grant.

alter table public.albums add column if not exists cover_config jsonb;

-- Additive column privilege (Postgres column grants accumulate). Mirrors 0021's UPDATE
-- grant which already covers (title, cover_template_id, updated_at).
grant update (cover_config) on table public.albums to authenticated;
