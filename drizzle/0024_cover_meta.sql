-- ============================================================
-- Malnad Stories — 0024: cover template description + dimensions
-- Run this in: Supabase Dashboard → SQL Editor → New query
-- ============================================================
--
-- Phase F.1. Adds:
--   description  optional admin note shown on the catalogue card + pickers.
--   width/height pixel dimensions of the cover artwork, populated by the
--                cover-thumbnail worker job. Used for (a) a "low resolution" admin
--                warning and (b) the print-safety gate before PDF generation
--                (the cover is physical page 1, so it must be print-ready).
--
-- All nullable / additive — no backfill, instant, safe on existing rows.

alter table public.cover_templates
  add column if not exists description text;

alter table public.cover_templates
  add column if not exists width  integer;

alter table public.cover_templates
  add column if not exists height integer;
