-- Query Analysis Script
-- Run with: psql -f scripts/analyze-queries.sql
--
-- This script runs EXPLAIN ANALYZE on all critical queries to verify
-- they use indexes properly and don't do sequential scans on large tables.

\echo '============================================================'
\echo 'Query Analysis for Community Feed Generator'
\echo '============================================================'
\echo ''

-- Get table sizes for context
\echo '--- Table Sizes ---'
SELECT
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname || '.' || tablename)) AS total_size,
  pg_size_pretty(pg_relation_size(schemaname || '.' || tablename)) AS table_size
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname || '.' || tablename) DESC;

\echo ''
\echo '============================================================'
\echo 'Query 1: Feed Skeleton (Redis is populated from this)'
\echo 'Expected: Index scan on post_scores(epoch_id, total_score DESC)'
\echo '============================================================'
\echo ''

EXPLAIN ANALYZE
SELECT post_uri, total_score
FROM post_scores
WHERE epoch_id = (SELECT MAX(id) FROM governance_epochs WHERE status = 'active')
ORDER BY total_score DESC
LIMIT 50;

\echo ''
\echo '============================================================'
\echo 'Query 2: Post Explanation (single post lookup)'
\echo 'Expected: Index scan on post_scores(post_uri)'
\echo '============================================================'
\echo ''

-- Use a sample post_uri from the database
EXPLAIN ANALYZE
SELECT ps.*, ge.description
FROM post_scores ps
JOIN governance_epochs ge ON ps.epoch_id = ge.id
WHERE ps.post_uri = (SELECT post_uri FROM post_scores LIMIT 1)
ORDER BY ps.scored_at DESC
LIMIT 1;

\echo ''
\echo '============================================================'
\echo 'Query 3: Counterfactual Analysis (top 100 posts with all scores)'
\echo 'Expected: Index scan on post_scores(epoch_id, total_score DESC)'
\echo '============================================================'
\echo ''

EXPLAIN ANALYZE
SELECT post_uri, recency_score, engagement_score, bridging_score,
       source_diversity_score, relevance_score, total_score
FROM post_scores
WHERE epoch_id = (SELECT MAX(id) FROM governance_epochs WHERE status = 'active')
ORDER BY total_score DESC
LIMIT 100;

\echo ''
\echo '============================================================'
\echo 'Query 4: Feed Statistics (author concentration)'
\echo 'Expected: Seq scan on post_scores may be acceptable for aggregation'
\echo '============================================================'
\echo ''

EXPLAIN ANALYZE
SELECT
  COUNT(DISTINCT ps.post_uri) AS posts_scored,
  COUNT(DISTINCT p.author_did) AS unique_authors
FROM post_scores ps
JOIN posts p ON ps.post_uri = p.uri
WHERE ps.epoch_id = (SELECT MAX(id) FROM governance_epochs WHERE status = 'active');

\echo ''
\echo '============================================================'
\echo 'Query 5: Posts for Scoring (main scoring pipeline query)'
\echo 'Expected: Index scan on posts(created_at) or posts(deleted, created_at)'
\echo '============================================================'
\echo ''

EXPLAIN ANALYZE
SELECT p.uri, p.cid, p.author_did, p.text, p.reply_root, p.reply_parent,
       p.langs, p.has_media, p.created_at,
       COALESCE(pe.like_count, 0) as like_count,
       COALESCE(pe.repost_count, 0) as repost_count,
       COALESCE(pe.reply_count, 0) as reply_count
FROM posts p
LEFT JOIN post_engagement pe ON p.uri = pe.post_uri
WHERE p.deleted = FALSE
  AND p.created_at > NOW() - INTERVAL '72 hours'
ORDER BY p.created_at DESC
LIMIT 1000;

\echo ''
\echo '============================================================'
\echo 'Query 6: Governance Votes (for epoch aggregation)'
\echo 'Expected: Index scan on governance_votes(epoch_id)'
\echo '============================================================'
\echo ''

EXPLAIN ANALYZE
SELECT recency, engagement, bridging, source_diversity, relevance
FROM governance_votes
WHERE epoch_id = (SELECT MAX(id) FROM governance_epochs WHERE status = 'active');

\echo ''
\echo '============================================================'
\echo 'Query 7: Audit Log (paginated)'
\echo 'Expected: Index scan on governance_audit_log(created_at DESC)'
\echo '============================================================'
\echo ''

EXPLAIN ANALYZE
SELECT * FROM governance_audit_log
ORDER BY created_at DESC
LIMIT 20;

\echo ''
\echo '============================================================'
\echo 'Index Usage Statistics'
\echo '============================================================'
\echo ''

SELECT
  schemaname,
  tablename,
  indexname,
  idx_scan AS index_scans,
  idx_tup_read AS tuples_read,
  idx_tup_fetch AS tuples_fetched
FROM pg_stat_user_indexes
WHERE schemaname = 'public'
ORDER BY idx_scan DESC;

\echo ''
\echo '============================================================'
\echo 'Tables with Sequential Scan Usage (potential optimization targets)'
\echo '============================================================'
\echo ''

SELECT
  schemaname,
  relname AS tablename,
  seq_scan AS sequential_scans,
  seq_tup_read AS rows_seq_read,
  idx_scan AS index_scans,
  idx_tup_fetch AS rows_idx_fetched,
  CASE
    WHEN seq_scan > 0 THEN
      ROUND(100.0 * idx_scan / (seq_scan + idx_scan), 2)
    ELSE 100.0
  END AS index_usage_percent
FROM pg_stat_user_tables
WHERE schemaname = 'public'
ORDER BY seq_scan DESC;

\echo ''
\echo '============================================================'
\echo 'Analysis Complete'
\echo '============================================================'
