-- 002_scoring_tables.sql
-- Score Decomposition Tables
-- GOLDEN RULE: Store every component, every weight, every epoch.
-- Disk is cheap. Insight is expensive. This is what makes the project unique.

-- ─── Score Decomposition ────────────────────────────────
CREATE TABLE post_scores (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    post_uri            TEXT NOT NULL REFERENCES posts(uri) ON DELETE CASCADE,
    epoch_id            INTEGER NOT NULL,               -- Which governance epoch produced this score

    -- Individual component scores (0.0 to 1.0)
    recency_score       FLOAT NOT NULL,
    engagement_score    FLOAT NOT NULL,
    bridging_score      FLOAT NOT NULL,
    source_diversity_score FLOAT NOT NULL,
    relevance_score     FLOAT NOT NULL,

    -- Weights applied (from governance epoch)
    recency_weight      FLOAT NOT NULL,
    engagement_weight   FLOAT NOT NULL,
    bridging_weight     FLOAT NOT NULL,
    source_diversity_weight FLOAT NOT NULL,
    relevance_weight    FLOAT NOT NULL,

    -- Weighted components (score * weight)
    recency_weighted    FLOAT NOT NULL,
    engagement_weighted FLOAT NOT NULL,
    bridging_weighted   FLOAT NOT NULL,
    source_diversity_weighted FLOAT NOT NULL,
    relevance_weighted  FLOAT NOT NULL,

    -- Final combined score
    total_score         FLOAT NOT NULL,

    -- Metadata for explainability
    component_details   JSONB,                          -- Arbitrary detail per component
    -- Example: {"bridging": {"engager_count": 15, "avg_jaccard_distance": 0.72}}

    scored_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT unique_post_epoch UNIQUE(post_uri, epoch_id)
);

-- Index for fast feed retrieval (get top posts for an epoch)
CREATE INDEX idx_scores_epoch_total ON post_scores(epoch_id, total_score DESC);

-- Index for looking up scores by post
CREATE INDEX idx_scores_post ON post_scores(post_uri);

-- Index for time-based cleanup queries
CREATE INDEX idx_scores_scored_at ON post_scores(scored_at DESC);
