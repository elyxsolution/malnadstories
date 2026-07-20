-- 0050_catalog_perf_indexes.sql
-- Performance indexes for the admin/catalog read paths flagged in the architecture audit (M-3 /
-- Section 9). PURELY ADDITIVE — no schema, RLS, grant, or data change; code works with or without
-- them (queries just stop sequential-scanning the visibility predicate). Mirrors the additive
-- pattern of 0037_perf_indexes.sql. Every statement is IF NOT EXISTS → safe to run any time.
--
-- The base catalog tables index their primary key but never their hot FILTER columns (status /
-- active), which every public + builder read narrows on. These are small tables today, but they are
-- exactly the "slow catalog query" sources in the audit logs; partial indexes on the visible subset
-- keep them fast as content grows.

-- CMS public reads: listPublished(type) filters type + status='published'. Partial index on the
-- published subset (the only rows anon/authenticated ever read) keeps it index-only.
CREATE INDEX IF NOT EXISTS content_pages_type_published_idx
  ON content_pages (type, published_at DESC)
  WHERE status = 'published';
-- Admin CMS lists filter/sort by status.
CREATE INDEX IF NOT EXISTS content_pages_status_idx
  ON content_pages (status, updated_at DESC);

-- Builder + admin read ACTIVE layout templates (status = 'active').
CREATE INDEX IF NOT EXISTS layout_templates_active_idx
  ON layout_templates (status)
  WHERE status = 'active';

-- Cover-design templates (builder-JSON) — active reads.
CREATE INDEX IF NOT EXISTS cover_design_templates_active_idx
  ON cover_design_templates (status)
  WHERE status = 'active';

-- Cover artwork templates — public/builder read active rows.
CREATE INDEX IF NOT EXISTS cover_templates_active_idx
  ON cover_templates (active)
  WHERE active;

-- Stickers — builder reads active decorative artwork.
CREATE INDEX IF NOT EXISTS stickers_active_idx
  ON stickers (active)
  WHERE active;
