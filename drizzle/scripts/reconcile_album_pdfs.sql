-- ============================================================
-- Malnad Stories — ONE-TIME PDF reconciliation / diagnostics
-- Run in: Supabase Dashboard → SQL Editor. READ sections are safe to run anytime.
-- The WRITE section is idempotent and NEVER touches a ready PDF.
-- ============================================================
--
-- CONTEXT / ROOT CAUSE
-- The backend PDF generator (src/lib/pdf/generate.ts) and the worker recovery sweep
-- (worker/src/jobs/pdf-recovery.ts) both UPSERT album_pdfs.requested_at + .attempts.
-- Those columns are added by migration 0025_album_pdf_recovery.sql. If 0025 is NOT
-- applied, EVERY generation upsert fails → the app returns "Could not start PDF
-- generation." and no row is ever written → customers see "Generating your PDF…"
-- forever and admins see "No preview PDF available". So the FIRST fix is to apply 0025.
--
-- ── STEP 0: confirm 0025 is applied (must return BOTH rows before anything else) ──
select column_name
from information_schema.columns
where table_schema = 'public' and table_name = 'album_pdfs'
  and column_name in ('requested_at', 'attempts')
order by column_name;
-- Expect: attempts, requested_at. If empty/partial → STOP and run drizzle/0025 first.


-- ── STEP 1 (READ): single-album diagnostic — paste the album id ──────────────────
-- Answers: row exists? status? r2_key (pdf_url)? requested_at? attempts? generated_at?
select
  ap.album_id,
  ap.status,
  ap.r2_key                          as pdf_key,           -- null ⇒ no file (pdf_url null)
  ap.generated_at,
  ap.requested_at,
  ap.attempts,
  ap.error,
  (ap.album_id is null)              as pdf_row_missing,
  a.status                           as album_status,
  o.status                           as order_status
from public.albums a
left join public.album_pdfs ap on ap.album_id = a.id
left join lateral (
  select status from public.orders
  where album_id = a.id
  order by placed_at desc limit 1
) o on true
where a.id = '<ALBUM_ID_HERE>';


-- ── STEP 2 (READ): migration audit — counts of albums needing a PDF ──────────────
-- "paid/delivered" come from orders.status; "submitted" from albums.status.
with paid_albums as (
  select distinct album_id
  from public.orders
  where status in ('paid','processing','printing','packed','shipped','delivered')
),
targets as (
  select a.id as album_id,
         a.status as album_status,
         (a.id in (select album_id from paid_albums)) as is_paid,
         ap.status as pdf_status,
         ap.r2_key,
         ap.requested_at
  from public.albums a
  left join public.album_pdfs ap on ap.album_id = a.id
  where a.id in (select album_id from paid_albums)
     or a.status = 'submitted'
)
select
  count(*) filter (where pdf_status is null)                                          as missing_pdf,
  count(*) filter (where pdf_status = 'failed')                                       as failed_pdf,
  count(*) filter (where pdf_status = 'generating'
                     and (requested_at is null
                          or requested_at < now() - interval '10 minutes'))           as stuck_generating_gt_10m,
  count(*) filter (where pdf_status = 'ready' and r2_key is null)                     as ready_but_null_url,
  count(*) filter (where is_paid and (pdf_status is null
                                      or pdf_status = 'failed'
                                      or (pdf_status = 'generating'
                                          and (requested_at is null
                                               or requested_at < now() - interval '10 minutes')))) as paid_needing_repair,
  count(*) filter (where pdf_status = 'ready' and r2_key is not null)                 as already_ready
from targets;


-- ── STEP 3 (WRITE, idempotent): reconcile — hand stuck/failed PAID albums back to
-- the worker's automatic recovery. We do NOT enqueue here (pg-boss jobs are created by
-- the app/worker, not SQL); we only normalize DB state so the worker's healPaid +
-- stuck sweeps (worker/src/jobs/pdf-recovery.ts) requeue them on its next pass.
--
-- Rules honoured:
--   • never touch a READY pdf (status='ready' is excluded everywhere below)
--   • no duplicate PDFs (we reset state; the worker mints exactly one fresh token/job)
--   • only PAID albums are reconciled here
--
-- 3a. FAILED-at-cap paid albums: clear so healPaid retries (it skips attempts>=5).
update public.album_pdfs ap
set status = 'idle', attempts = 0, error = null
from public.orders o
where o.album_id = ap.album_id
  and o.status in ('paid','processing','printing','packed','shipped','delivered')
  and ap.status = 'failed';

-- 3b. STUCK 'generating' > 10 min: backdate requested_at so the worker's stuck-sweep
--     re-drives immediately (it re-drives generating rows older than its 3-min stale
--     window). Leaves attempts intact so the cap still applies.
update public.album_pdfs ap
set requested_at = now() - interval '1 hour'
from public.orders o
where o.album_id = ap.album_id
  and o.status in ('paid','processing','printing','packed','shipped','delivered')
  and ap.status = 'generating'
  and (ap.requested_at is null or ap.requested_at < now() - interval '10 minutes');

-- 3c. MISSING rows for paid albums need no SQL: healPaid creates + enqueues them
--     automatically once the worker is awake. (The customer poll + payment nudge wake it.)

-- After 3a/3b, ensure the worker is awake so its sweep runs (it heals on boot + each
-- WORKER_SWEEP_INTERVAL_MS). Hitting WORKER_URL/health, opening any purchased album, or
-- an admin "Generate" all wake it.
