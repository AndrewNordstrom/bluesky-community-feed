-- 005_bot_tables.sql
-- Bot Announcements Table
--
-- Stores all announcements posted by the bot for audit trail.
-- Follows soft-delete pattern per CLAUDE.md rule 10.

CREATE TABLE IF NOT EXISTS bot_announcements (
    id              SERIAL PRIMARY KEY,
    uri             TEXT NOT NULL UNIQUE,           -- at:// URI of the post
    cid             TEXT NOT NULL,                  -- Content hash
    type            TEXT NOT NULL,                  -- 'voting_opened', 'epoch_transition', 'manual'
    epoch_id        INTEGER REFERENCES governance_epochs(id),
    content         TEXT NOT NULL,                  -- Post text
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted         BOOLEAN NOT NULL DEFAULT FALSE, -- Soft delete (CLAUDE.md rule 10)

    CONSTRAINT valid_announcement_type CHECK (type IN ('voting_opened', 'epoch_transition', 'manual'))
);

-- Index for listing recent announcements
CREATE INDEX IF NOT EXISTS idx_announcements_created ON bot_announcements(created_at DESC);

-- Index for filtering by type
CREATE INDEX IF NOT EXISTS idx_announcements_type ON bot_announcements(type);

-- Index for epoch-related queries
CREATE INDEX IF NOT EXISTS idx_announcements_epoch ON bot_announcements(epoch_id);

-- Index for active (non-deleted) announcements
CREATE INDEX IF NOT EXISTS idx_announcements_active ON bot_announcements(deleted) WHERE deleted = FALSE;

COMMENT ON TABLE bot_announcements IS 'Stores all announcements posted by the governance bot';
COMMENT ON COLUMN bot_announcements.uri IS 'AT Protocol URI of the Bluesky post';
COMMENT ON COLUMN bot_announcements.cid IS 'Content identifier hash from Bluesky';
COMMENT ON COLUMN bot_announcements.type IS 'Type of announcement: voting_opened, epoch_transition, or manual';
COMMENT ON COLUMN bot_announcements.epoch_id IS 'Related governance epoch (if applicable)';
COMMENT ON COLUMN bot_announcements.deleted IS 'Soft delete flag - never hard delete (rule 10)';
