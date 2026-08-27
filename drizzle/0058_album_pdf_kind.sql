-- 0058_album_pdf_kind.sql
--
-- ALBUM PDF KIND — one album, several independent PDF artifacts.
--
-- `album_pdfs` was keyed by `album_id` alone, so an album could hold exactly ONE generated PDF:
-- the customer preview. The printer-ready exports (Admin → Print files) add two more, and each
-- needs its OWN status, stage, failure code, print token, attempt count and R2 key — a failed
-- `print_cover` must be retryable without touching `print_content`, and neither may ever disturb
-- the preview a customer can already download.
--
--   preview        the customer-facing preview book. Behaviour UNCHANGED in every respect.
--   print_cover    printer-ready flat cover spread, 483 x 327 mm, one page.  Admin-on-demand.
--   print_content  printer-ready interior, N x 206 x 291 mm pages.           Admin-on-demand.
--
-- BACKWARD COMPATIBILITY IS THE POINT. `kind` defaults to 'preview', so every existing row keeps
-- its exact meaning without a backfill statement, and every existing query that filters only on
-- `album_id` still resolves the preview row until it is updated to name a kind.
--
-- Idempotent + safely re-runnable (repo convention since 0055).
--
-- RUN ORDER: this is code-first-safe in one direction only — the SHIPPED CODE READS `kind`, so run
-- this SQL BEFORE (or with) the deploy. Running it early is harmless: the extra column is unused
-- until the code that names it arrives.

begin;

-- ── 1. The discriminator ──────────────────────────────────────────────────────────────────────
alter table public.album_pdfs
  add column if not exists kind text not null default 'preview';

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.album_pdfs'::regclass
       and conname  = 'album_pdfs_kind_check'
  ) then
    alter table public.album_pdfs
      add constraint album_pdfs_kind_check
      check (kind in ('preview', 'print_cover', 'print_content'));
  end if;
end $$;

-- ── 2. Primary key: (album_id) -> (album_id, kind) ────────────────────────────────────────────
-- Nothing references album_pdfs with a foreign key (the album_id column is itself the FK INTO
-- albums), so widening the primary key breaks no dependency. Guarded so a re-run is a no-op.
do $$
declare
  pk_cols text;
begin
  select string_agg(a.attname, ',' order by k.ord)
    into pk_cols
    from pg_constraint c
    join lateral unnest(c.conkey) with ordinality as k(attnum, ord) on true
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
   where c.conrelid = 'public.album_pdfs'::regclass
     and c.contype  = 'p';

  if pk_cols is distinct from 'album_id,kind' then
    alter table public.album_pdfs drop constraint if exists album_pdfs_pkey;
    alter table public.album_pdfs add constraint album_pdfs_pkey primary key (album_id, kind);
  end if;
end $$;

-- ── 3. Index for the worker's recovery sweep ──────────────────────────────────────────────────
-- `findStaleGenerating` scans for rows stuck in 'generating' past a cutoff, ordered by
-- requested_at. With three kinds per album the table grows threefold; this keeps the sweep cheap.
-- Partial: only 'generating' rows are ever candidates.
create index if not exists album_pdfs_stale_generating_idx
  on public.album_pdfs (requested_at asc)
  where status = 'generating';

-- ── 4. Privileges: state the intended FINAL state explicitly (repo convention) ─────────────────
-- album_pdfs is SERVICE-ONLY: RLS is enabled with no policies, and neither anon nor authenticated
-- has ever held a grant on it. A customer reaches their preview PDF only through the ownership-
-- checked API route, which reads with the service role. Restated here so the new column cannot be
-- assumed to have widened access, and so a fresh environment lands in the same place.
revoke all on table public.album_pdfs from anon;
revoke all on table public.album_pdfs from authenticated;
grant all on table public.album_pdfs to service_role;

commit;

-- ── Verification (run separately; object existence IS the evidence — there is no migrations table)
--
--   select column_name, data_type, column_default
--     from information_schema.columns
--    where table_schema = 'public' and table_name = 'album_pdfs' and column_name = 'kind';
--
--   select conname, pg_get_constraintdef(oid)
--     from pg_constraint where conrelid = 'public.album_pdfs'::regclass and contype in ('p','c');
--
--   select grantee, privilege_type from information_schema.role_table_grants
--    where table_schema = 'public' and table_name = 'album_pdfs' order by grantee;
--     -- expected: service_role only. anon and authenticated must return NO rows.
--
--   select relrowsecurity from pg_class where oid = 'public.album_pdfs'::regclass;  -- expected: t
