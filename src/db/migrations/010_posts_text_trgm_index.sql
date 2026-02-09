-- 010_posts_text_trgm_index.sql
-- Adds trigram support for regex/keyword scans used by scoring SQL prefilter.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_posts_text_trgm
ON posts
USING gin (text gin_trgm_ops)
WHERE deleted = FALSE;
