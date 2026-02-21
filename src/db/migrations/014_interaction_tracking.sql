-- Migration 014: Feed Interaction Tracking
--
-- Adds tables to track feed requests, engagement attribution,
-- and aggregated stats for measuring governance impact.
-- Retention: 30 days for raw data, indefinite for aggregated stats.

-- ============================================================
-- 1. Feed request log (who loaded the feed, when, how deep)
-- ============================================================
CREATE TABLE IF NOT EXISTS feed_requests (
    id               BIGSERIAL PRIMARY KEY,
    viewer_did       TEXT,                           -- NULL if anonymous (no JWT)
    epoch_id         INTEGER NOT NULL,               -- Which epoch was active
    snapshot_id      TEXT NOT NULL,                   -- Links pages of same session
    page_offset      INTEGER NOT NULL DEFAULT 0,     -- Scroll depth indicator
    posts_served     INTEGER NOT NULL,               -- How many posts returned this page
    response_time_ms INTEGER,                        -- Measured response latency
    requested_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- "How many feed loads today?"
CREATE INDEX IF NOT EXISTS idx_feed_requests_time
  ON feed_requests(requested_at DESC);

-- "Scroll depth and frequency per user"
CREATE INDEX IF NOT EXISTS idx_feed_requests_viewer
  ON feed_requests(viewer_did, requested_at DESC)
  WHERE viewer_did IS NOT NULL;

-- "Feed loads per epoch for comparison"
CREATE INDEX IF NOT EXISTS idx_feed_requests_epoch
  ON feed_requests(epoch_id, requested_at DESC);

-- "Group pages by session"
CREATE INDEX IF NOT EXISTS idx_feed_requests_snapshot
  ON feed_requests(snapshot_id);


-- ============================================================
-- 2. Pre-aggregated daily stats (one row per day per epoch)
-- ============================================================
CREATE TABLE IF NOT EXISTS feed_request_daily_stats (
    id                    SERIAL PRIMARY KEY,
    date                  DATE NOT NULL,
    epoch_id              INTEGER NOT NULL,
    unique_viewers        INTEGER NOT NULL DEFAULT 0,
    anonymous_requests    INTEGER NOT NULL DEFAULT 0,
    total_requests        INTEGER NOT NULL DEFAULT 0,
    total_pages           INTEGER NOT NULL DEFAULT 0,
    avg_pages_per_session FLOAT,
    max_scroll_depth      INTEGER,
    returning_viewers     INTEGER NOT NULL DEFAULT 0,
    UNIQUE(date, epoch_id)
);


-- ============================================================
-- 3. Engagement attribution (served-then-engaged tracking)
-- ============================================================
CREATE TABLE IF NOT EXISTS engagement_attributions (
    id               BIGSERIAL PRIMARY KEY,
    post_uri         TEXT NOT NULL,
    viewer_did       TEXT NOT NULL,            -- Who was served the post
    epoch_id         INTEGER NOT NULL,         -- Which epoch's ranking served it
    served_at        TIMESTAMPTZ NOT NULL,     -- When we served it
    engaged_at       TIMESTAMPTZ,             -- When they liked/reposted (NULL = no engagement)
    engagement_type  TEXT,                     -- 'like', 'repost', or NULL
    position_in_feed INTEGER,                  -- Rank position when served
    UNIQUE(post_uri, viewer_did, epoch_id)
);

-- "Which served posts got engagement?"
CREATE INDEX IF NOT EXISTS idx_attributions_post
  ON engagement_attributions(post_uri, epoch_id);

-- "Engagement rate by feed position"
CREATE INDEX IF NOT EXISTS idx_attributions_position
  ON engagement_attributions(position_in_feed, epoch_id)
  WHERE engaged_at IS NOT NULL;

-- "Attribution stats per epoch"
CREATE INDEX IF NOT EXISTS idx_attributions_epoch
  ON engagement_attributions(epoch_id, engaged_at);

-- "User engagement history"
CREATE INDEX IF NOT EXISTS idx_attributions_viewer
  ON engagement_attributions(viewer_did, served_at DESC);

-- "Fast lookup for write-time attribution in like/repost handlers"
CREATE INDEX IF NOT EXISTS idx_attributions_pending
  ON engagement_attributions(post_uri, viewer_did)
  WHERE engaged_at IS NULL;


-- ============================================================
-- 4. Epoch engagement stats (one row per epoch, computed)
-- ============================================================
CREATE TABLE IF NOT EXISTS epoch_engagement_stats (
    id                      SERIAL PRIMARY KEY,
    epoch_id                INTEGER NOT NULL REFERENCES governance_epochs(id),
    computed_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    total_feed_loads        INTEGER NOT NULL DEFAULT 0,
    unique_viewers          INTEGER NOT NULL DEFAULT 0,
    avg_scroll_depth        FLOAT,
    returning_viewer_pct    FLOAT,
    posts_served            INTEGER NOT NULL DEFAULT 0,
    posts_with_engagement   INTEGER,
    engagement_rate         FLOAT,
    avg_engagement_position FLOAT,
    keyword_stats           JSONB,    -- { "keyword": { served: N, engaged: N, rate: F } }
    UNIQUE(epoch_id)
);
