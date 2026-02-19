-- Migration 011: Research Consent
-- Adds research consent tracking to subscribers table.
-- NULL = not yet asked, TRUE = consented, FALSE = declined.

ALTER TABLE subscribers
  ADD COLUMN IF NOT EXISTS research_consent BOOLEAN DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS research_consent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS research_consent_version TEXT;
