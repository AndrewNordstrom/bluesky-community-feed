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

-- Comment for documentation
COMMENT ON COLUMN governance_votes.include_keywords IS 'Keywords voter wants to include in feed (OR logic)';
COMMENT ON COLUMN governance_votes.exclude_keywords IS 'Keywords voter wants to exclude from feed (OR logic, takes precedence)';
COMMENT ON COLUMN governance_epochs.content_rules IS 'Aggregated content rules: keywords with >= 30% voter support';
