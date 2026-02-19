-- 012_legal_update_announcement.sql
-- Add legal_update type to bot announcements and announcement settings.

-- Update CHECK constraint on bot_announcements to allow 'legal_update' type
ALTER TABLE bot_announcements
  DROP CONSTRAINT IF EXISTS valid_announcement_type;

ALTER TABLE bot_announcements
  ADD CONSTRAINT valid_announcement_type
  CHECK (type IN ('voting_opened', 'epoch_transition', 'manual', 'legal_update'));

-- Add legal_update to announcement settings
INSERT INTO announcement_settings (key, enabled) VALUES
  ('legal_update', TRUE)
ON CONFLICT (key) DO NOTHING;
