-- 009_governance_phases.sql
-- Governance cycle phases: running -> voting -> results

-- ---------------------------------------------------------------------------
-- governance_epochs phase and lifecycle metadata
-- ---------------------------------------------------------------------------

ALTER TABLE governance_epochs
ADD COLUMN IF NOT EXISTS phase TEXT NOT NULL DEFAULT 'running',
ADD COLUMN IF NOT EXISTS voting_started_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS voting_closed_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS results_approved_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS results_approved_by TEXT,
ADD COLUMN IF NOT EXISTS proposed_weights JSONB,
ADD COLUMN IF NOT EXISTS proposed_content_rules JSONB;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'governance_epochs_phase_check'
  ) THEN
    ALTER TABLE governance_epochs
    ADD CONSTRAINT governance_epochs_phase_check
    CHECK (phase IN ('running', 'voting', 'results'));
  END IF;
END $$;

-- Backfill: if an epoch was previously marked as status='voting',
-- map it to phase='voting'; active/closed defaults remain running.
UPDATE governance_epochs
SET phase = 'voting'
WHERE status = 'voting';

CREATE INDEX IF NOT EXISTS idx_epochs_active_phase
ON governance_epochs (phase)
WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_epochs_voting_deadline
ON governance_epochs (voting_ends_at)
WHERE status = 'active' AND phase = 'voting' AND voting_ends_at IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Future vote scheduling
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS scheduled_votes (
  id SERIAL PRIMARY KEY,
  starts_at TIMESTAMPTZ NOT NULL,
  duration_hours INTEGER NOT NULL DEFAULT 72 CHECK (duration_hours >= 1 AND duration_hours <= 168),
  announced BOOLEAN NOT NULL DEFAULT FALSE,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scheduled_votes_starts_at
ON scheduled_votes (starts_at);

-- ---------------------------------------------------------------------------
-- Governance announcement settings
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS announcement_settings (
  key TEXT PRIMARY KEY,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO announcement_settings (key, enabled) VALUES
  ('voting_opened', TRUE),
  ('voting_reminder_24h', TRUE),
  ('voting_closed', TRUE),
  ('results_approved', TRUE),
  ('vote_scheduled', TRUE)
ON CONFLICT (key) DO NOTHING;
