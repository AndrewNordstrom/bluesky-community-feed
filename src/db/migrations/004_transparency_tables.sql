-- Migration 004: Transparency Tables
-- Pre-computed transparency metrics per epoch
-- Note: feed_snapshots NOT included - Phase 3 uses Redis-based cursor pagination

-- ─── Epoch Metrics ─────────────────────────────────────────
-- Pre-computed transparency stats updated each scoring run
CREATE TABLE IF NOT EXISTS epoch_metrics (
    id              SERIAL PRIMARY KEY,
    epoch_id        INTEGER NOT NULL REFERENCES governance_epochs(id),

    -- Distribution metrics
    author_gini     FLOAT,                          -- Gini coefficient of author representation (0=equal, 1=dominated)
    avg_bridging    FLOAT,                          -- Average bridging score across all scored posts
    median_bridging FLOAT,                          -- Median bridging score

    -- Comparison to baselines (Jaccard similarity 0-1)
    vs_chronological_overlap FLOAT,                 -- Overlap with chronological top-N
    vs_engagement_overlap    FLOAT,                 -- Overlap with pure-engagement top-N

    -- Volume metrics
    posts_scored    INTEGER,                        -- Total posts scored this run
    unique_authors  INTEGER,                        -- Distinct authors in scored posts

    computed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for looking up metrics by epoch
CREATE INDEX IF NOT EXISTS idx_epoch_metrics_epoch ON epoch_metrics(epoch_id);

-- Index for time-based queries
CREATE INDEX IF NOT EXISTS idx_epoch_metrics_computed ON epoch_metrics(computed_at DESC);
