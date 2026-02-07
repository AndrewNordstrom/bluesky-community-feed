-- 007_epoch_scheduling.sql
-- Admin Dashboard Phase 1: Scheduling, announcements, and system status tracking

-- Add scheduling columns to governance_epochs
ALTER TABLE governance_epochs
ADD COLUMN IF NOT EXISTS voting_ends_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS auto_transition BOOLEAN DEFAULT false;

-- Index for scheduler queries (find epochs with upcoming voting deadlines)
CREATE INDEX IF NOT EXISTS idx_epochs_voting_ends
ON governance_epochs (voting_ends_at)
WHERE voting_ends_at IS NOT NULL AND status = 'active';

-- Track announcement history
CREATE TABLE IF NOT EXISTS announcements (
  id SERIAL PRIMARY KEY,
  epoch_id INTEGER REFERENCES governance_epochs(id),
  post_uri TEXT NOT NULL,
  post_cid TEXT NOT NULL,
  content TEXT NOT NULL,
  announcement_type TEXT DEFAULT 'custom', -- 'custom', 'epoch_start', 'epoch_end', 'voting_reminder'
  posted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  posted_by TEXT NOT NULL -- admin DID who triggered it, or 'system' for auto
);

CREATE INDEX IF NOT EXISTS idx_announcements_epoch ON announcements(epoch_id);
CREATE INDEX IF NOT EXISTS idx_announcements_posted ON announcements(posted_at DESC);

-- System status tracking (for scoring run stats, etc.)
CREATE TABLE IF NOT EXISTS system_status (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Initialize scoring status
INSERT INTO system_status (key, value)
VALUES ('last_scoring_run', '{"timestamp": null, "duration_ms": null, "posts_scored": 0, "posts_filtered": 0}')
ON CONFLICT (key) DO NOTHING;
