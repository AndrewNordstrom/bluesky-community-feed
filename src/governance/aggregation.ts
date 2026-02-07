/**
 * Vote Aggregation Module
 *
 * Aggregates votes using trimmed mean to determine new epoch weights.
 * Removes top and bottom 10% of votes to prevent outlier manipulation.
 */

import { db } from '../db/client.js';
import { logger } from '../lib/logger.js';
import { GovernanceWeights, normalizeWeights, ContentRules, emptyContentRules } from './governance.types.js';

/**
 * Weight component names for iteration.
 */
const WEIGHT_COMPONENTS = [
  'recency_weight',
  'engagement_weight',
  'bridging_weight',
  'source_diversity_weight',
  'relevance_weight',
] as const;

type WeightComponent = (typeof WEIGHT_COMPONENTS)[number];

/**
 * Aggregate votes for an epoch using trimmed mean.
 *
 * Algorithm:
 * 1. Get all votes for the epoch
 * 2. For each weight component:
 *    - Sort values ascending
 *    - Remove top 10% and bottom 10%
 *    - Calculate mean of remaining
 * 3. Normalize result to sum to exactly 1.0
 *
 * @param epochId - The epoch to aggregate votes for
 * @returns Aggregated weights, or null if no votes
 */
export async function aggregateVotes(epochId: number): Promise<GovernanceWeights | null> {
  const votes = await db.query(
    `SELECT recency_weight, engagement_weight, bridging_weight,
            source_diversity_weight, relevance_weight
     FROM governance_votes
     WHERE epoch_id = $1
     ORDER BY voted_at`,
    [epochId]
  );

  const n = votes.rows.length;

  if (n === 0) {
    logger.warn({ epochId }, 'No votes to aggregate');
    return null;
  }

  logger.info({ epochId, voteCount: n }, 'Aggregating votes');

  // Calculate trim count (10% from each end)
  const trimPct = 0.1;
  const trimCount = Math.floor(n * trimPct);

  // For small vote counts, don't trim (need at least 10 votes to trim 1 from each end)
  const effectiveTrimCount = n >= 10 ? trimCount : 0;

  const aggregated: Record<WeightComponent, number> = {
    recency_weight: 0,
    engagement_weight: 0,
    bridging_weight: 0,
    source_diversity_weight: 0,
    relevance_weight: 0,
  };

  for (const component of WEIGHT_COMPONENTS) {
    const values = votes.rows
      .map((v: Record<string, number>) => v[component])
      .sort((a: number, b: number) => a - b);

    // Trim extremes
    const trimmed =
      effectiveTrimCount > 0
        ? values.slice(effectiveTrimCount, n - effectiveTrimCount)
        : values;

    // Calculate mean
    const mean = trimmed.reduce((sum: number, v: number) => sum + v, 0) / trimmed.length;
    aggregated[component] = mean;

    logger.debug(
      { component, original: values.length, trimmed: trimmed.length, mean },
      'Component aggregation'
    );
  }

  // Convert to GovernanceWeights
  const weights: GovernanceWeights = {
    recency: aggregated.recency_weight,
    engagement: aggregated.engagement_weight,
    bridging: aggregated.bridging_weight,
    sourceDiversity: aggregated.source_diversity_weight,
    relevance: aggregated.relevance_weight,
  };

  // Normalize to ensure exact sum of 1.0
  const normalized = normalizeWeights(weights);

  logger.info({ epochId, aggregated: normalized }, 'Vote aggregation complete');

  return normalized;
}

/**
 * Get vote statistics for an epoch without aggregating.
 * Useful for transparency reporting.
 */
export async function getVoteStatistics(epochId: number): Promise<{
  count: number;
  average: GovernanceWeights;
  median: GovernanceWeights;
  stdDev: GovernanceWeights;
} | null> {
  const result = await db.query(
    `SELECT
      COUNT(*) as count,
      AVG(recency_weight) as avg_recency,
      AVG(engagement_weight) as avg_engagement,
      AVG(bridging_weight) as avg_bridging,
      AVG(source_diversity_weight) as avg_source_diversity,
      AVG(relevance_weight) as avg_relevance,
      STDDEV(recency_weight) as std_recency,
      STDDEV(engagement_weight) as std_engagement,
      STDDEV(bridging_weight) as std_bridging,
      STDDEV(source_diversity_weight) as std_source_diversity,
      STDDEV(relevance_weight) as std_relevance
     FROM governance_votes
     WHERE epoch_id = $1`,
    [epochId]
  );

  const row = result.rows[0];
  const count = parseInt(row.count);

  if (count === 0) {
    return null;
  }

  // For median, we need to fetch all votes
  const votes = await db.query(
    `SELECT recency_weight, engagement_weight, bridging_weight,
            source_diversity_weight, relevance_weight
     FROM governance_votes
     WHERE epoch_id = $1`,
    [epochId]
  );

  const median: GovernanceWeights = {
    recency: calculateMedian(votes.rows.map((v: Record<string, number>) => v.recency_weight)),
    engagement: calculateMedian(votes.rows.map((v: Record<string, number>) => v.engagement_weight)),
    bridging: calculateMedian(votes.rows.map((v: Record<string, number>) => v.bridging_weight)),
    sourceDiversity: calculateMedian(
      votes.rows.map((v: Record<string, number>) => v.source_diversity_weight)
    ),
    relevance: calculateMedian(votes.rows.map((v: Record<string, number>) => v.relevance_weight)),
  };

  return {
    count,
    average: {
      recency: parseFloat(row.avg_recency) || 0,
      engagement: parseFloat(row.avg_engagement) || 0,
      bridging: parseFloat(row.avg_bridging) || 0,
      sourceDiversity: parseFloat(row.avg_source_diversity) || 0,
      relevance: parseFloat(row.avg_relevance) || 0,
    },
    median,
    stdDev: {
      recency: parseFloat(row.std_recency) || 0,
      engagement: parseFloat(row.std_engagement) || 0,
      bridging: parseFloat(row.std_bridging) || 0,
      sourceDiversity: parseFloat(row.std_source_diversity) || 0,
      relevance: parseFloat(row.std_relevance) || 0,
    },
  };
}

/**
 * Calculate the median of an array of numbers.
 */
function calculateMedian(values: number[]): number {
  if (values.length === 0) return 0;

  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }

  return sorted[mid];
}

// ============================================================================
// Content Vote Aggregation
// ============================================================================

/** Threshold for keyword inclusion (30% of voters must include it) */
const KEYWORD_THRESHOLD = 0.3;

/**
 * Aggregate content votes for an epoch.
 * Keywords appearing in >= 30% of votes are included in the content rules.
 *
 * @param epochId - The epoch to aggregate content votes for
 * @returns Aggregated content rules
 */
export async function aggregateContentVotes(epochId: number): Promise<ContentRules> {
  const votes = await db.query(
    `SELECT include_keywords, exclude_keywords
     FROM governance_votes
     WHERE epoch_id = $1
       AND (
         include_keywords IS NOT NULL AND array_length(include_keywords, 1) > 0
         OR exclude_keywords IS NOT NULL AND array_length(exclude_keywords, 1) > 0
       )`,
    [epochId]
  );

  const n = votes.rows.length;

  if (n === 0) {
    logger.info({ epochId }, 'No content votes to aggregate');
    return emptyContentRules();
  }

  // Calculate threshold - minimum votes needed for keyword to be included
  const threshold = Math.max(1, Math.ceil(n * KEYWORD_THRESHOLD));

  // Count keyword occurrences
  const includeCounts = new Map<string, number>();
  const excludeCounts = new Map<string, number>();

  for (const row of votes.rows) {
    for (const keyword of row.include_keywords ?? []) {
      includeCounts.set(keyword, (includeCounts.get(keyword) ?? 0) + 1);
    }
    for (const keyword of row.exclude_keywords ?? []) {
      excludeCounts.set(keyword, (excludeCounts.get(keyword) ?? 0) + 1);
    }
  }

  // Filter to keywords meeting threshold and sort alphabetically
  const includeKeywords = Array.from(includeCounts.entries())
    .filter(([, count]) => count >= threshold)
    .map(([keyword]) => keyword)
    .sort();

  const excludeKeywords = Array.from(excludeCounts.entries())
    .filter(([, count]) => count >= threshold)
    .map(([keyword]) => keyword)
    .sort();

  logger.info(
    {
      epochId,
      voterCount: n,
      threshold,
      includeKeywordsCount: includeKeywords.length,
      excludeKeywordsCount: excludeKeywords.length,
      totalIncludeCandidates: includeCounts.size,
      totalExcludeCandidates: excludeCounts.size,
    },
    'Content votes aggregated'
  );

  return { includeKeywords, excludeKeywords };
}

/**
 * Get content vote statistics for transparency reporting.
 */
export async function getContentVoteStatistics(epochId: number): Promise<{
  voterCount: number;
  includeKeywordVotes: Record<string, number>;
  excludeKeywordVotes: Record<string, number>;
  threshold: number;
}> {
  const votes = await db.query(
    `SELECT include_keywords, exclude_keywords
     FROM governance_votes
     WHERE epoch_id = $1
       AND (
         include_keywords IS NOT NULL AND array_length(include_keywords, 1) > 0
         OR exclude_keywords IS NOT NULL AND array_length(exclude_keywords, 1) > 0
       )`,
    [epochId]
  );

  const includeKeywordVotes: Record<string, number> = {};
  const excludeKeywordVotes: Record<string, number> = {};

  for (const row of votes.rows) {
    for (const keyword of row.include_keywords ?? []) {
      includeKeywordVotes[keyword] = (includeKeywordVotes[keyword] ?? 0) + 1;
    }
    for (const keyword of row.exclude_keywords ?? []) {
      excludeKeywordVotes[keyword] = (excludeKeywordVotes[keyword] ?? 0) + 1;
    }
  }

  const voterCount = votes.rows.length;
  const threshold = Math.max(1, Math.ceil(voterCount * KEYWORD_THRESHOLD));

  return {
    voterCount,
    includeKeywordVotes,
    excludeKeywordVotes,
    threshold,
  };
}
