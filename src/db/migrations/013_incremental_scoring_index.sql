-- Speed up incremental scoring: find posts whose engagement changed since last score
-- The updated_at column is already maintained by like/repost/reply handlers.
CREATE INDEX IF NOT EXISTS idx_engagement_updated
  ON post_engagement(updated_at DESC);
