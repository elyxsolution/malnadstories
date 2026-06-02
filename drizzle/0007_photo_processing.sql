-- ============================================================
-- Malnad Stories — 0007: image-hardening pipeline (worker)
-- Run this in: Supabase Dashboard → SQL Editor → New query
-- ============================================================
--
-- After each upload the background worker downloads the raw object, validates its
-- magic bytes, re-encodes it (auto-orient, strip metadata, HEIC→JPEG) into a
-- SANITIZED full-res master + a thumbnail, then DELETES the raw original. The app
-- serves only the sanitized derivatives via signed URLs — never the raw bytes.
--
--   status        pending → ready (processed) | rejected (invalid/undecodable)
--   sanitized_key served full-res master (original resolution, JPEG ~q90)
--   thumb_key     served ~400px thumbnail
--   width/height  dimensions of the sanitized master (post auto-orient)
--   taken_at      EXIF DateTimeOriginal, for auto-ordering (nullable)
--   r2_key        keeps meaning "raw original key"; the worker NULLs it after the
--                 raw is deleted (or retained if KEEP_RAW_ORIGINAL=true).

alter table public.photos
  add column if not exists status        text not null default 'pending',
  add column if not exists sanitized_key text,
  add column if not exists thumb_key     text,
  add column if not exists width         integer,
  add column if not exists height        integer,
  add column if not exists taken_at      timestamptz;

alter table public.photos drop constraint if exists photos_status_check;
alter table public.photos
  add constraint photos_status_check check (status in ('pending', 'ready', 'rejected'));

-- The worker sweep queries pending rows; the app lists by (album, status).
create index if not exists photos_album_status_idx on public.photos (album_id, status);

-- No GRANT changes: authenticated already has CRUD on photos (new columns inherit),
-- and RLS "users_own_photos" still scopes rows to the owner. status transitions are
-- worker-only by convention — the worker uses the service role (bypasses RLS).
--
-- pg-boss creates and owns its own `pgboss` schema automatically on first start via
-- the privileged DIRECT_URL connection — no queue tables are defined here.
