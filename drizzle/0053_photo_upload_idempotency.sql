-- ============================================================
-- Malnad Stories — 0053: immutable upload identity (photos.upload_key)
-- Run this in: Supabase Dashboard → SQL Editor → New query
-- DEPLOY ORDER: run this SQL FIRST, then ship the app build. The new confirm route
--   inserts `upload_key` and relies on the unique index below; until this runs, that
--   insert would fail on an unknown column. Running the SQL early is harmless — the
--   OLD confirm route simply never writes the column (it stays null).
-- ============================================================
--
-- WHY: /api/photos/confirm must be idempotent per R2 object key, so a retried confirm
--   returns the SAME photo id instead of creating a second row.
--
--   `r2_key` cannot carry that identity because it is TRANSIENT by design: the worker
--   hardens the image, deletes the raw object, and then NULLs `r2_key`
--   (worker .../processors/image/photo-repository.ts → clearRawKey). A unique index on
--   `r2_key` would therefore only dedupe while the upload is still 'pending'; a late
--   retry (after hardening) would insert a second row whose raw object no longer exists,
--   and the worker would mark that ghost row 'rejected'.
--
-- WHAT: `upload_key` records the ORIGINAL raw upload key and is never nulled by anyone.
--   `r2_key` keeps its exact current meaning and lifecycle — this migration does not
--   change it, and the worker is untouched.
--
--     confirm            upload_key = <key>   r2_key = <key>
--     after hardening    upload_key = <key>   r2_key = NULL      ← unchanged behaviour
--
-- SECURITY: extends the 0020 column-scoped INSERT grant with `upload_key` only.
--   `authenticated` deliberately gets NO UPDATE on it, so the upload identity is
--   IMMUTABLE from the client — a customer can create it once and can never rewrite it
--   to point at (or collide with) another row. RLS `users_own_photos`
--   (user_id = auth.uid()) is unchanged; no policy is added, altered, or dropped.
--   `service_role` keeps table-level ALL from 0009, which covers new columns automatically.
--
-- NO DATA LOSS: one additive nullable column, one backfill that only copies an existing
--   value, one additive index, one additive column grant. No row is created or deleted.

-- ── 1. The column ────────────────────────────────────────────────────────────────
-- Nullable ON PURPOSE. Legacy rows that finished hardening before this migration have
-- already had `r2_key` nulled, so their original upload key is GONE and unrecoverable.
-- Those rows keep upload_key = NULL forever; see §2.
alter table public.photos add column if not exists upload_key text;

-- ── 2. Backfill — ONLY from a trustworthy source ─────────────────────────────────
-- A non-null `r2_key` still IS the row's original raw upload key (the worker has not yet
-- cleared it), so copying it is exact, not a guess.
--
-- Rows with `r2_key IS NULL` are deliberately LEFT NULL. Their upload key is not derivable
-- from sanitized_key / thumb_key / id / filename / timestamps — those are worker-generated
-- or unrelated — and fabricating one would risk a false collision that silently returns the
-- WRONG photo id from a future confirm. A null upload_key simply means "legacy row, not
-- deduplicable", which is the safe, honest state: such a row can never be re-confirmed
-- anyway, because its raw R2 object was deleted long ago.
--
-- Idempotent: re-running only fills rows that are still null.
update public.photos
   set upload_key = r2_key
 where r2_key is not null
   and upload_key is null;

-- ── 3. The idempotency constraint ────────────────────────────────────────────────
-- PARTIAL so the legacy NULL rows from §2 coexist freely (SQL NULLs are distinct anyway;
-- the predicate also keeps the index small — it holds only in-flight/known uploads).
-- Non-null upload keys are GLOBALLY unique, which is what makes the confirm route's
-- ON CONFLICT DO NOTHING race-safe: concurrent duplicate confirms cannot both insert.
--
-- Safe against current production data: the 0053 preflight measured 0 duplicate non-null
-- r2_key values (189 photos, 1 non-null r2_key, 188 already-hardened NULLs), so the
-- backfill above produces 0 duplicate upload_key values and this index builds cleanly.
create unique index if not exists photos_upload_key_key
  on public.photos (upload_key)
  where upload_key is not null;

-- ── 4. Column grant (0020 pattern — column grants ACCUMULATE) ────────────────────
-- INSERT only. After this, `authenticated` may insert exactly:
--   (user_id, album_id, r2_key, original_filename, upload_key)   ← /api/photos/confirm
-- and may still UPDATE only (edit_config). No UPDATE(upload_key) is granted anywhere, so
-- the client cannot mutate an upload identity after creation. No revoke is issued, so the
-- 0020 grants stay exactly as they are.
grant insert (upload_key) on table public.photos to authenticated;
