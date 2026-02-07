/**
 * Governance Types
 *
 * Type definitions for the governance system including:
 * - Weight vectors
 * - Vote payloads
 * - Epoch information
 * - Audit log entries
 */

/**
 * Governance weights for the scoring algorithm.
 * All values must be 0.0-1.0 and sum to 1.0.
 */
export interface GovernanceWeights {
  recency: number;
  engagement: number;
  bridging: number;
  sourceDiversity: number;
  relevance: number;
}

/**
 * Vote payload as submitted by the API (snake_case to match DB schema).
 */
export interface VotePayload {
  recency_weight: number;
  engagement_weight: number;
  bridging_weight: number;
  source_diversity_weight: number;
  relevance_weight: number;
}

/**
 * Governance epoch information.
 */
export interface EpochInfo {
  id: number;
  status: 'active' | 'voting' | 'closed';
  weights: GovernanceWeights;
  voteCount: number;
  createdAt: Date;
  closedAt: Date | null;
  description: string | null;
}

/**
 * Audit log entry for governance actions.
 */
export interface AuditLogEntry {
  id: number;
  action: string;
  actorDid: string | null;
  epochId: number | null;
  details: Record<string, unknown>;
  createdAt: Date;
}

/**
 * Session info for authenticated users.
 */
export interface SessionInfo {
  did: string;
  handle: string;
  accessJwt: string;
  expiresAt: Date;
}

/**
 * Convert database row to EpochInfo.
 */
export function toEpochInfo(row: Record<string, unknown>): EpochInfo {
  return {
    id: row.id as number,
    status: row.status as 'active' | 'voting' | 'closed',
    weights: {
      recency: row.recency_weight as number,
      engagement: row.engagement_weight as number,
      bridging: row.bridging_weight as number,
      sourceDiversity: row.source_diversity_weight as number,
      relevance: row.relevance_weight as number,
    },
    voteCount: row.vote_count as number,
    createdAt: new Date(row.created_at as string),
    closedAt: row.closed_at ? new Date(row.closed_at as string) : null,
    description: row.description as string | null,
  };
}

/**
 * Convert database row to AuditLogEntry.
 */
export function toAuditLogEntry(row: Record<string, unknown>): AuditLogEntry {
  return {
    id: row.id as number,
    action: row.action as string,
    actorDid: row.actor_did as string | null,
    epochId: row.epoch_id as number | null,
    details: (row.details as Record<string, unknown>) ?? {},
    createdAt: new Date(row.created_at as string),
  };
}

/**
 * Convert VotePayload to GovernanceWeights.
 */
export function votePayloadToWeights(payload: VotePayload): GovernanceWeights {
  return {
    recency: payload.recency_weight,
    engagement: payload.engagement_weight,
    bridging: payload.bridging_weight,
    sourceDiversity: payload.source_diversity_weight,
    relevance: payload.relevance_weight,
  };
}

/**
 * Convert GovernanceWeights to VotePayload format.
 */
export function weightsToVotePayload(weights: GovernanceWeights): VotePayload {
  return {
    recency_weight: weights.recency,
    engagement_weight: weights.engagement,
    bridging_weight: weights.bridging,
    source_diversity_weight: weights.sourceDiversity,
    relevance_weight: weights.relevance,
  };
}

/**
 * Normalize weights to sum to exactly 1.0.
 * Handles floating point precision issues.
 */
export function normalizeWeights(weights: GovernanceWeights): GovernanceWeights {
  const total =
    weights.recency +
    weights.engagement +
    weights.bridging +
    weights.sourceDiversity +
    weights.relevance;

  if (total === 0) {
    // Default to equal weights if all zero
    return {
      recency: 0.2,
      engagement: 0.2,
      bridging: 0.2,
      sourceDiversity: 0.2,
      relevance: 0.2,
    };
  }

  const normalized: GovernanceWeights = {
    recency: Math.round((weights.recency / total) * 1000) / 1000,
    engagement: Math.round((weights.engagement / total) * 1000) / 1000,
    bridging: Math.round((weights.bridging / total) * 1000) / 1000,
    sourceDiversity: Math.round((weights.sourceDiversity / total) * 1000) / 1000,
    relevance: Math.round((weights.relevance / total) * 1000) / 1000,
  };

  // Fix rounding to ensure exact sum of 1.0
  const currentSum =
    normalized.recency +
    normalized.engagement +
    normalized.bridging +
    normalized.sourceDiversity +
    normalized.relevance;

  // Adjust the largest component to fix rounding errors
  normalized.recency += 1.0 - currentSum;
  normalized.recency = Math.round(normalized.recency * 1000) / 1000;

  return normalized;
}

/**
 * Validate that weights sum to approximately 1.0.
 */
export function validateWeightsSum(weights: GovernanceWeights): boolean {
  const sum =
    weights.recency +
    weights.engagement +
    weights.bridging +
    weights.sourceDiversity +
    weights.relevance;

  return Math.abs(sum - 1.0) < 0.01;
}

// ============================================================================
// Content Theme Governance Types
// ============================================================================

/**
 * Content filtering rules derived from community votes.
 * Applied during scoring to filter posts by keyword.
 */
export interface ContentRules {
  /** Posts must contain at least one of these keywords (OR logic) */
  includeKeywords: string[];
  /** Posts containing any of these keywords are filtered out (OR logic, takes precedence) */
  excludeKeywords: string[];
}

/**
 * Content vote payload (snake_case to match DB schema).
 */
export interface ContentVotePayload {
  include_keywords?: string[];
  exclude_keywords?: string[];
}

/**
 * Database row for content rules in governance_epochs.
 */
export interface ContentRulesRow {
  include_keywords?: string[];
  exclude_keywords?: string[];
}

/**
 * Result of content filtering check.
 */
export interface ContentFilterResult {
  passes: boolean;
  reason?: 'excluded_keyword' | 'no_include_match' | 'no_text_with_include_filter';
  matchedKeyword?: string;
}

/**
 * Normalize keywords: lowercase, trim, dedupe, enforce limits.
 * - Max 20 keywords per category
 * - Max 50 characters per keyword
 * - Removes empty strings and duplicates
 */
export function normalizeKeywords(keywords: string[]): string[] {
  const seen = new Set<string>();
  return keywords
    .map((k) => k.toLowerCase().trim())
    .filter((k) => k.length > 0 && k.length <= 50)
    .filter((k) => {
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, 20);
}

/**
 * Convert database row to ContentRules.
 */
export function toContentRules(row: ContentRulesRow | null): ContentRules {
  return {
    includeKeywords: row?.include_keywords ?? [],
    excludeKeywords: row?.exclude_keywords ?? [],
  };
}

/**
 * Create empty content rules.
 */
export function emptyContentRules(): ContentRules {
  return {
    includeKeywords: [],
    excludeKeywords: [],
  };
}
