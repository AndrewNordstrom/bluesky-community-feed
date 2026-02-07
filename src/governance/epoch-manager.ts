/**
 * Epoch Manager
 *
 * Handles governance epoch lifecycle:
 * - Opening voting periods
 * - Closing epochs and creating new ones
 * - Transaction-wrapped epoch transitions
 */

import { db } from '../db/client.js';
import { logger } from '../lib/logger.js';
import { config } from '../config.js';
import { aggregateVotes, aggregateContentVotes } from './aggregation.js';
import { GovernanceWeights, weightsToVotePayload, ContentRules } from './governance.types.js';
import { postAnnouncementSafe } from '../bot/safe-poster.js';
import { invalidateContentRulesCache } from './content-filter.js';

/**
 * Open the voting period for the current epoch.
 * Changes status from 'active' to 'voting'.
 */
export async function openVotingPeriod(): Promise<void> {
  const result = await db.query(
    `UPDATE governance_epochs
     SET status = 'voting'
     WHERE status = 'active'
     RETURNING id`
  );

  if (result.rows.length === 0) {
    throw new Error('No active epoch to open voting for');
  }

  const epochId = result.rows[0].id;

  // Audit log
  await db.query(
    `INSERT INTO governance_audit_log (action, epoch_id, details)
     VALUES ('voting_opened', $1, $2)`,
    [epochId, JSON.stringify({ opened_at: new Date().toISOString() })]
  );

  logger.info({ epochId }, 'Voting period opened');

  // Post announcement (fire-and-forget)
  postAnnouncementSafe({ type: 'voting_opened', epochId }).catch(() => {});
}

/**
 * Close the current epoch and create a new one with aggregated votes.
 * This is the main epoch transition function.
 *
 * @returns The ID of the newly created epoch
 */
export async function closeCurrentEpochAndCreateNext(): Promise<number> {
  const client = await db.connect();

  try {
    await client.query('BEGIN');

    // 1. Get current active/voting epoch
    const current = await client.query(
      `SELECT * FROM governance_epochs
       WHERE status IN ('active', 'voting')
       ORDER BY id DESC LIMIT 1
       FOR UPDATE`
    );

    if (!current.rows[0]) {
      throw new Error('No active epoch to close');
    }

    const currentEpoch = current.rows[0];
    const currentEpochId = currentEpoch.id;

    // 2. Check vote count
    const voteCountResult = await client.query(
      `SELECT COUNT(*) as count FROM governance_votes WHERE epoch_id = $1`,
      [currentEpochId]
    );
    const voteCount = parseInt(voteCountResult.rows[0].count);

    if (voteCount < config.GOVERNANCE_MIN_VOTES) {
      throw new Error(
        `Insufficient votes: ${voteCount} < ${config.GOVERNANCE_MIN_VOTES} required`
      );
    }

    // 3. Aggregate weight votes
    const newWeights = await aggregateVotes(currentEpochId);

    if (!newWeights) {
      throw new Error('Vote aggregation failed');
    }

    const newWeightsPayload = weightsToVotePayload(newWeights);

    // 3b. Aggregate content votes
    const contentRules = await aggregateContentVotes(currentEpochId);

    // 4. Close current epoch
    await client.query(
      `UPDATE governance_epochs
       SET status = 'closed', closed_at = NOW()
       WHERE id = $1`,
      [currentEpochId]
    );

    // 5. Create new epoch with aggregated weights and content rules
    const newEpoch = await client.query(
      `INSERT INTO governance_epochs (
        recency_weight, engagement_weight, bridging_weight,
        source_diversity_weight, relevance_weight,
        content_rules,
        vote_count, description
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id`,
      [
        newWeightsPayload.recency_weight,
        newWeightsPayload.engagement_weight,
        newWeightsPayload.bridging_weight,
        newWeightsPayload.source_diversity_weight,
        newWeightsPayload.relevance_weight,
        JSON.stringify({
          include_keywords: contentRules.includeKeywords,
          exclude_keywords: contentRules.excludeKeywords,
        }),
        voteCount,
        `Weights updated from epoch ${currentEpochId} based on ${voteCount} community votes.`,
      ]
    );

    const newEpochId = newEpoch.rows[0].id;

    // 6. Audit log - epoch closed
    const oldWeights: GovernanceWeights = {
      recency: currentEpoch.recency_weight,
      engagement: currentEpoch.engagement_weight,
      bridging: currentEpoch.bridging_weight,
      sourceDiversity: currentEpoch.source_diversity_weight,
      relevance: currentEpoch.relevance_weight,
    };

    await client.query(
      `INSERT INTO governance_audit_log (action, epoch_id, details)
       VALUES ('epoch_closed', $1, $2)`,
      [
        currentEpochId,
        JSON.stringify({
          old_weights: oldWeights,
          new_weights: newWeights,
          vote_count: voteCount,
          new_epoch_id: newEpochId,
        }),
      ]
    );

    // 7. Audit log - epoch created
    await client.query(
      `INSERT INTO governance_audit_log (action, epoch_id, details)
       VALUES ('epoch_created', $1, $2)`,
      [
        newEpochId,
        JSON.stringify({
          weights: newWeights,
          content_rules: contentRules,
          derived_from_epoch: currentEpochId,
          vote_count: voteCount,
        }),
      ]
    );

    await client.query('COMMIT');

    // Invalidate content rules cache so scoring pipeline picks up new rules
    await invalidateContentRulesCache();

    logger.info(
      {
        closedEpoch: currentEpochId,
        newEpoch: newEpochId,
        voteCount,
        oldWeights,
        newWeights,
        contentRules: {
          includeKeywords: contentRules.includeKeywords.length,
          excludeKeywords: contentRules.excludeKeywords.length,
        },
      },
      'Governance epoch transition complete'
    );

    // Post announcement (fire-and-forget)
    postAnnouncementSafe({
      type: 'epoch_transition',
      oldEpochId: currentEpochId,
      newEpochId,
      voteCount,
      oldWeights,
      newWeights,
    }).catch(() => {});

    return newEpochId;
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error({ err }, 'Failed to transition governance epoch');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Get the current epoch status.
 */
export async function getCurrentEpochStatus(): Promise<{
  epochId: number;
  status: string;
  voteCount: number;
  minVotesRequired: number;
  canTransition: boolean;
} | null> {
  const result = await db.query(
    `SELECT * FROM governance_epochs
     WHERE status IN ('active', 'voting')
     ORDER BY id DESC LIMIT 1`
  );

  if (result.rows.length === 0) {
    return null;
  }

  const epoch = result.rows[0];

  const voteCountResult = await db.query(
    `SELECT COUNT(*) as count FROM governance_votes WHERE epoch_id = $1`,
    [epoch.id]
  );
  const voteCount = parseInt(voteCountResult.rows[0].count);

  return {
    epochId: epoch.id,
    status: epoch.status,
    voteCount,
    minVotesRequired: config.GOVERNANCE_MIN_VOTES,
    canTransition: voteCount >= config.GOVERNANCE_MIN_VOTES,
  };
}

/**
 * Manually trigger epoch transition (admin function).
 * Only works if minimum votes met.
 */
export async function triggerEpochTransition(): Promise<{ success: boolean; newEpochId?: number; error?: string }> {
  try {
    const status = await getCurrentEpochStatus();

    if (!status) {
      return { success: false, error: 'No active epoch' };
    }

    if (!status.canTransition) {
      return {
        success: false,
        error: `Insufficient votes: ${status.voteCount}/${status.minVotesRequired}`,
      };
    }

    const newEpochId = await closeCurrentEpochAndCreateNext();
    return { success: true, newEpochId };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { success: false, error: message };
  }
}

/**
 * Force epoch transition (admin only).
 * Skips vote count check - for testing and emergency use.
 *
 * @returns The ID of the newly created epoch
 */
export async function forceEpochTransition(): Promise<number> {
  const client = await db.connect();

  try {
    await client.query('BEGIN');

    // 1. Get current active/voting epoch
    const current = await client.query(
      `SELECT * FROM governance_epochs
       WHERE status IN ('active', 'voting')
       ORDER BY id DESC LIMIT 1
       FOR UPDATE`
    );

    if (!current.rows[0]) {
      throw new Error('No active epoch to close');
    }

    const currentEpoch = current.rows[0];
    const currentEpochId = currentEpoch.id;

    // Get vote count (for logging, not validation)
    const voteCountResult = await client.query(
      `SELECT COUNT(*) as count FROM governance_votes WHERE epoch_id = $1`,
      [currentEpochId]
    );
    const voteCount = parseInt(voteCountResult.rows[0].count);

    // NOTE: Skipping vote count check - this is a forced transition

    // 2. Aggregate weight votes (use current epoch weights if no votes)
    let newWeights = await aggregateVotes(currentEpochId);

    if (!newWeights) {
      // Use current epoch weights if aggregation fails
      newWeights = {
        recency: currentEpoch.recency_weight,
        engagement: currentEpoch.engagement_weight,
        bridging: currentEpoch.bridging_weight,
        sourceDiversity: currentEpoch.source_diversity_weight,
        relevance: currentEpoch.relevance_weight,
      };
    }

    const newWeightsPayload = weightsToVotePayload(newWeights);

    // 3. Aggregate content votes
    const contentRules = await aggregateContentVotes(currentEpochId);

    // 4. Close current epoch
    await client.query(
      `UPDATE governance_epochs
       SET status = 'closed', closed_at = NOW()
       WHERE id = $1`,
      [currentEpochId]
    );

    // 5. Create new epoch with aggregated weights and content rules
    const newEpoch = await client.query(
      `INSERT INTO governance_epochs (
        recency_weight, engagement_weight, bridging_weight,
        source_diversity_weight, relevance_weight,
        content_rules,
        vote_count, description
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id`,
      [
        newWeightsPayload.recency_weight,
        newWeightsPayload.engagement_weight,
        newWeightsPayload.bridging_weight,
        newWeightsPayload.source_diversity_weight,
        newWeightsPayload.relevance_weight,
        JSON.stringify({
          include_keywords: contentRules.includeKeywords,
          exclude_keywords: contentRules.excludeKeywords,
        }),
        voteCount,
        `FORCED transition from epoch ${currentEpochId} with ${voteCount} votes.`,
      ]
    );

    const newEpochId = newEpoch.rows[0].id;

    // 6. Audit log - epoch closed
    const oldWeights: GovernanceWeights = {
      recency: currentEpoch.recency_weight,
      engagement: currentEpoch.engagement_weight,
      bridging: currentEpoch.bridging_weight,
      sourceDiversity: currentEpoch.source_diversity_weight,
      relevance: currentEpoch.relevance_weight,
    };

    await client.query(
      `INSERT INTO governance_audit_log (action, epoch_id, details)
       VALUES ('epoch_closed', $1, $2)`,
      [
        currentEpochId,
        JSON.stringify({
          old_weights: oldWeights,
          new_weights: newWeights,
          vote_count: voteCount,
          new_epoch_id: newEpochId,
          forced: true,
        }),
      ]
    );

    // 7. Audit log - epoch created
    await client.query(
      `INSERT INTO governance_audit_log (action, epoch_id, details)
       VALUES ('epoch_created', $1, $2)`,
      [
        newEpochId,
        JSON.stringify({
          weights: newWeights,
          content_rules: contentRules,
          derived_from_epoch: currentEpochId,
          vote_count: voteCount,
          forced: true,
        }),
      ]
    );

    await client.query('COMMIT');

    // Invalidate content rules cache so scoring pipeline picks up new rules
    await invalidateContentRulesCache();

    logger.warn(
      {
        closedEpoch: currentEpochId,
        newEpoch: newEpochId,
        voteCount,
        oldWeights,
        newWeights,
        contentRules: {
          includeKeywords: contentRules.includeKeywords,
          excludeKeywords: contentRules.excludeKeywords,
        },
      },
      'FORCED governance epoch transition complete'
    );

    return newEpochId;
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error({ err }, 'Failed to force transition governance epoch');
    throw err;
  } finally {
    client.release();
  }
}
