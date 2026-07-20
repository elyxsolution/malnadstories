-- 0051_album_pdf_stages.sql
-- Observability + diagnosability for PDF generation (audit Sections 6 & 8). PURELY ADDITIVE — two
-- nullable columns on the service-only `album_pdfs` table; no RLS/grant change (the table has no
-- client grants — it is read via the service role by the poll routes). Safe to run any time; code
-- treats both as optional, so behaviour is unchanged until the worker starts writing them.
--
--   stage         — coarse progress of an in-flight generation, written by the worker as it advances:
--                   queued → preparing → rendering → uploading → finalizing → completed.
--                   Replaces the opaque single "generating" with a real, honest progress signal.
--   failure_code  — a TYPED reason a generation failed (render_timeout, upload_failed,
--                   missing_cover_asset, db_update_failed, …) so admins see WHY, not just "failed".
ALTER TABLE album_pdfs ADD COLUMN IF NOT EXISTS stage text;
ALTER TABLE album_pdfs ADD COLUMN IF NOT EXISTS failure_code text;
