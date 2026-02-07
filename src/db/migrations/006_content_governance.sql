-- 006_content_governance.sql
-- Add content theme governance to the voting system
-- Allows community to vote on include/exclude keywords alongside algorithm weights

-- Add keyword columns to governance_votes
-- Using TEXT[] (PostgreSQL array) for efficient storage and querying
-- Empty arrays are the default - allows voting on weights only
ALTER TABLE governance_votes
ADD COLUMN include_keywords TEXT[] DEFAULT '{}',
ADD COLUMN exclude_keywords TEXT[] DEFAULT '{}';

-- Add content_rules to governance_epochs
-- JSONB structure: { "include_keywords": string[], "exclude_keywords": string[] }
-- Stores the aggregated content rules derived from community votes
ALTER TABLE governance_epochs
ADD COLUMN content_rules JSONB DEFAULT '{"include_keywords": [], "exclude_keywords": []}';

-- GIN index for efficient keyword aggregation queries
-- Enables fast unnest operations during vote aggregation
CREATE INDEX idx_votes_include_keywords ON governance_votes USING GIN (include_keywords);
CREATE INDEX idx_votes_exclude_keywords ON governance_votes USING GIN (exclude_keywords);

-- Make weight columns nullable to allow keyword-only votes
ALTER TABLE governance_votes ALTER COLUMN recency_weight DROP NOT NULL;
ALTER TABLE governance_votes ALTER COLUMN engagement_weight DROP NOT NULL;
ALTER TABLE governance_votes ALTER COLUMN bridging_weight DROP NOT NULL;
ALTER TABLE governance_votes ALTER COLUMN source_diversity_weight DROP NOT NULL;
ALTER TABLE governance_votes ALTER COLUMN relevance_weight DROP NOT NULL;

-- Update check constraint: weights must sum to 1.0 ONLY when all are present
-- Allows keyword-only votes (all weights null) or weight votes (all weights set)
ALTER TABLE governance_votes DROP CONSTRAINT IF EXISTS vote_weights_sum_to_one;
ALTER TABLE governance_votes ADD CONSTRAINT vote_weights_sum_to_one
  CHECK (
    (recency_weight IS NULL AND engagement_weight IS NULL AND bridging_weight IS NULL AND source_diversity_weight IS NULL AND relevance_weight IS NULL)
    OR
    (recency_weight IS NOT NULL AND engagement_weight IS NOT NULL AND bridging_weight IS NOT NULL AND source_diversity_weight IS NOT NULL AND relevance_weight IS NOT NULL
     AND abs(recency_weight + engagement_weight + bridging_weight + source_diversity_weight + relevance_weight - 1.0) < 0.01)
  );

-- Comment for documentation
COMMENT ON COLUMN governance_votes.include_keywords IS 'Keywords voter wants to include in feed (OR logic)';
COMMENT ON COLUMN governance_votes.exclude_keywords IS 'Keywords voter wants to exclude from feed (OR logic, takes precedence)';
COMMENT ON COLUMN governance_epochs.content_rules IS 'Aggregated content rules: keywords with >= 30% voter support';
