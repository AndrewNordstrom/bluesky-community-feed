/**
 * Vote Route
 *
 * POST /api/governance/vote
 *
 * Allows authenticated subscribers to vote on algorithm weights.
 * - Validates weights sum to 1.0
 * - Normalizes before storing
 * - Uses UPSERT to allow vote updates
 * - Logs to audit trail
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { db } from '../../db/client.js';
import { logger } from '../../lib/logger.js';
import { getAuthenticatedDid } from '../auth.js';
import { normalizeWeights, votePayloadToWeights, weightsToVotePayload } from '../governance.types.js';

/**
 * Zod schema for vote validation.
 * Weights must be 0.0-1.0 and sum to 1.0.
 */
const VoteSchema = z
  .object({
    recency_weight: z.number().min(0).max(1),
    engagement_weight: z.number().min(0).max(1),
    bridging_weight: z.number().min(0).max(1),
    source_diversity_weight: z.number().min(0).max(1),
    relevance_weight: z.number().min(0).max(1),
  })
  .refine(
    (data) => {
      const sum =
        data.recency_weight +
        data.engagement_weight +
        data.bridging_weight +
        data.source_diversity_weight +
        data.relevance_weight;
      return Math.abs(sum - 1.0) < 0.01;
    },
    { message: 'Weights must sum to 1.0' }
  );

export function registerVoteRoute(app: FastifyInstance): void {
  /**
   * POST /api/governance/vote
   * Submit or update a vote for the current epoch.
   */
  app.post('/api/governance/vote', async (request: FastifyRequest, reply: FastifyReply) => {
    // 1. Authenticate voter
    const voterDid = getAuthenticatedDid(request);
    if (!voterDid) {
      return reply.code(401).send({
        error: 'Unauthorized',
        message: 'Authentication required. Please log in first.',
      });
    }

    // 2. Verify they're an active subscriber
    const subscriber = await db.query(
      `SELECT did FROM subscribers WHERE did = $1 AND is_active = TRUE`,
      [voterDid]
    );

    if (subscriber.rows.length === 0) {
      return reply.code(403).send({
        error: 'Forbidden',
        message: 'You must be an active feed subscriber to vote. Use the feed first to become a subscriber.',
      });
    }

    // 3. Validate vote body
    const parseResult = VoteSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.code(400).send({
        error: 'InvalidVote',
        message: 'Invalid vote weights',
        details: parseResult.error.errors,
      });
    }

    const vote = parseResult.data;

    // 4. Normalize weights to ensure exact sum of 1.0
    const normalized = normalizeWeights(votePayloadToWeights(vote));
    const normalizedPayload = weightsToVotePayload(normalized);

    // 5. Get current epoch (must be active or voting)
    const epoch = await db.query(
      `SELECT id, status FROM governance_epochs
       WHERE status IN ('active', 'voting')
       ORDER BY id DESC LIMIT 1`
    );

    if (!epoch.rows[0]) {
      return reply.code(500).send({
        error: 'NoActiveEpoch',
        message: 'No active governance epoch. Please try again later.',
      });
    }

    const epochId = epoch.rows[0].id;

    try {
      // 6. UPSERT vote (allows updating existing vote)
      // Use xmax = 0 to detect if this was an INSERT (new) or UPDATE (existing)
      const voteResult = await db.query(
        `INSERT INTO governance_votes (
          voter_did, epoch_id,
          recency_weight, engagement_weight, bridging_weight,
          source_diversity_weight, relevance_weight
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (voter_did, epoch_id) DO UPDATE SET
          recency_weight = $3,
          engagement_weight = $4,
          bridging_weight = $5,
          source_diversity_weight = $6,
          relevance_weight = $7,
          voted_at = NOW()
        RETURNING id, (xmax = 0) as is_new_vote`,
        [
          voterDid,
          epochId,
          normalizedPayload.recency_weight,
          normalizedPayload.engagement_weight,
          normalizedPayload.bridging_weight,
          normalizedPayload.source_diversity_weight,
          normalizedPayload.relevance_weight,
        ]
      );

      const isNewVote = voteResult.rows[0].is_new_vote;
      const auditAction = isNewVote ? 'vote_cast' : 'vote_updated';

      // 7. Log to audit trail with appropriate action
      await db.query(
        `INSERT INTO governance_audit_log (action, actor_did, epoch_id, details)
         VALUES ($1, $2, $3, $4)`,
        [
          auditAction,
          voterDid,
          epochId,
          JSON.stringify({
            weights: normalized,
            original_weights: vote,
          }),
        ]
      );

      logger.info({ voterDid, epochId, weights: normalized, isNewVote }, 'Vote recorded');

      const message = isNewVote
        ? 'Your vote has been recorded.'
        : 'Your vote has been updated.';

      return reply.send({
        success: true,
        epoch_id: epochId,
        weights: normalized,
        is_update: !isNewVote,
        message,
      });
    } catch (err) {
      logger.error({ err, voterDid, epochId }, 'Failed to record vote');
      return reply.code(500).send({
        error: 'VoteFailed',
        message: 'Failed to record your vote. Please try again.',
      });
    }
  });

  /**
   * GET /api/governance/vote
   * Get the current user's vote for the active epoch.
   */
  app.get('/api/governance/vote', async (request: FastifyRequest, reply: FastifyReply) => {
    const voterDid = getAuthenticatedDid(request);
    if (!voterDid) {
      return reply.code(401).send({
        error: 'Unauthorized',
        message: 'Authentication required.',
      });
    }

    // Get current epoch
    const epoch = await db.query(
      `SELECT id FROM governance_epochs
       WHERE status IN ('active', 'voting')
       ORDER BY id DESC LIMIT 1`
    );

    if (!epoch.rows[0]) {
      return reply.send({ vote: null, epoch_id: null });
    }

    const epochId = epoch.rows[0].id;

    // Get user's vote for this epoch
    const vote = await db.query(
      `SELECT recency_weight, engagement_weight, bridging_weight,
              source_diversity_weight, relevance_weight, voted_at
       FROM governance_votes
       WHERE voter_did = $1 AND epoch_id = $2`,
      [voterDid, epochId]
    );

    if (vote.rows.length === 0) {
      return reply.send({ vote: null, epoch_id: epochId });
    }

    const v = vote.rows[0];
    return reply.send({
      vote: {
        recency: v.recency_weight,
        engagement: v.engagement_weight,
        bridging: v.bridging_weight,
        sourceDiversity: v.source_diversity_weight,
        relevance: v.relevance_weight,
      },
      voted_at: v.voted_at,
      epoch_id: epochId,
    });
  });
}
