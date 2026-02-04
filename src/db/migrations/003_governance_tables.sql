-- 003_governance_tables.sql
-- Governance Epochs, Votes, and Audit Log

-- ─── Governance Epochs ──────────────────────────────────
-- Every time weights change, a new epoch is created.
-- This is the backbone of the governance audit trail.
CREATE TABLE governance_epochs (
    id              SERIAL PRIMARY KEY,
    status          TEXT NOT NULL DEFAULT 'active',     -- 'active', 'voting', 'closed'

    -- The weight vector for this epoch (must sum to 1.0)
    recency_weight          FLOAT NOT NULL,
    engagement_weight       FLOAT NOT NULL,
    bridging_weight         FLOAT NOT NULL,
    source_diversity_weight FLOAT NOT NULL,
    relevance_weight        FLOAT NOT NULL,

    -- Metadata
    vote_count      INTEGER DEFAULT 0,                  -- How many votes determined these weights
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    closed_at       TIMESTAMPTZ,                        -- When this epoch ended
    description     TEXT,                               -- Human-readable description of changes

    -- CRITICAL: Weights must sum to 1.0 (within tolerance)
    CONSTRAINT weights_sum_check CHECK (
        ABS(recency_weight + engagement_weight + bridging_weight +
            source_diversity_weight + relevance_weight - 1.0) < 0.01
    )
);

-- ─── Votes ──────────────────────────────────────────────
-- Individual votes on weight parameters
CREATE TABLE governance_votes (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    voter_did       TEXT NOT NULL,                      -- Bluesky DID of the voter
    epoch_id        INTEGER NOT NULL REFERENCES governance_epochs(id),

    -- What the voter wants the weights to be
    recency_weight          FLOAT NOT NULL,
    engagement_weight       FLOAT NOT NULL,
    bridging_weight         FLOAT NOT NULL,
    source_diversity_weight FLOAT NOT NULL,
    relevance_weight        FLOAT NOT NULL,

    -- Validation: weights must sum to 1.0 (within tolerance)
    CONSTRAINT vote_weights_sum_to_one CHECK (
        ABS(recency_weight + engagement_weight + bridging_weight +
            source_diversity_weight + relevance_weight - 1.0) < 0.01
    ),

    -- Voter must be a subscriber
    CONSTRAINT voter_is_subscriber FOREIGN KEY (voter_did) REFERENCES subscribers(did),

    -- One vote per voter per epoch
    CONSTRAINT one_vote_per_epoch UNIQUE(voter_did, epoch_id),

    voted_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_votes_epoch ON governance_votes(epoch_id);
CREATE INDEX idx_votes_voter ON governance_votes(voter_did);

-- ─── Governance Audit Log ───────────────────────────────
-- Append-only log of all governance actions
-- NEVER update or delete entries. This is the trust anchor.
CREATE TABLE governance_audit_log (
    id              SERIAL PRIMARY KEY,
    action          TEXT NOT NULL,                      -- 'epoch_created', 'vote_cast', 'epoch_closed', 'weights_changed'
    actor_did       TEXT,                               -- Who performed the action (null for system)
    epoch_id        INTEGER REFERENCES governance_epochs(id),
    details         JSONB,                              -- Action-specific details
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_epoch ON governance_audit_log(epoch_id);
CREATE INDEX idx_audit_created ON governance_audit_log(created_at DESC);
CREATE INDEX idx_audit_action ON governance_audit_log(action);
