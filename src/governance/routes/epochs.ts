/**
 * Epochs Route
 *
 * GET /api/governance/epochs - List all epochs
 * GET /api/governance/epochs/:id - Get single epoch details
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { db } from '../../db/client.js';
import { toEpochInfo } from '../governance.types.js';

export function registerEpochsRoute(app: FastifyInstance): void {
  /**
   * GET /api/governance/epochs
   * Returns a list of all governance epochs.
   */
  app.get('/api/governance/epochs', async (request: FastifyRequest, reply: FastifyReply) => {
    const query = request.query as { limit?: string; status?: string };
    const limit = Math.min(parseInt(query.limit ?? '50'), 100);

    let sql = `SELECT * FROM governance_epochs`;
    const params: unknown[] = [];

    if (query.status) {
      sql += ` WHERE status = $1`;
      params.push(query.status);
    }

    sql += ` ORDER BY id DESC LIMIT $${params.length + 1}`;
    params.push(limit);

    const result = await db.query(sql, params);

    const epochs = await Promise.all(
      result.rows.map(async (row) => {
        const epoch = toEpochInfo(row);

        // Get actual vote count
        const voteCount = await db.query(
          `SELECT COUNT(*) as count FROM governance_votes WHERE epoch_id = $1`,
          [epoch.id]
        );

        return {
          id: epoch.id,
          status: epoch.status,
          weights: epoch.weights,
          vote_count: parseInt(voteCount.rows[0].count),
          created_at: epoch.createdAt,
          closed_at: epoch.closedAt,
          description: epoch.description,
        };
      })
    );

    return reply.send({
      epochs,
      total: epochs.length,
    });
  });

  /**
   * GET /api/governance/epochs/current
   * Returns the current active epoch.
   */
  app.get('/api/governance/epochs/current', async (_request: FastifyRequest, reply: FastifyReply) => {
    const result = await db.query(
      `SELECT * FROM governance_epochs
       WHERE status IN ('active', 'voting')
       ORDER BY id DESC LIMIT 1`
    );

    if (result.rows.length === 0) {
      return reply.code(404).send({
        error: 'NoActiveEpoch',
        message: 'No active governance epoch found.',
      });
    }

    const epoch = toEpochInfo(result.rows[0]);

    // Get vote count
    const voteCount = await db.query(
      `SELECT COUNT(*) as count FROM governance_votes WHERE epoch_id = $1`,
      [epoch.id]
    );

    // Get subscriber count (potential voters)
    const subscriberCount = await db.query(
      `SELECT COUNT(*) as count FROM subscribers WHERE is_active = TRUE`
    );

    return reply.send({
      id: epoch.id,
      status: epoch.status,
      weights: epoch.weights,
      vote_count: parseInt(voteCount.rows[0].count),
      subscriber_count: parseInt(subscriberCount.rows[0].count),
      created_at: epoch.createdAt,
      description: epoch.description,
    });
  });

  /**
   * GET /api/governance/epochs/:id
   * Returns details for a specific epoch.
   */
  app.get('/api/governance/epochs/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const params = request.params as { id: string };
    const epochId = parseInt(params.id);

    if (isNaN(epochId)) {
      return reply.code(400).send({
        error: 'InvalidEpochId',
        message: 'Epoch ID must be a number.',
      });
    }

    const result = await db.query(`SELECT * FROM governance_epochs WHERE id = $1`, [epochId]);

    if (result.rows.length === 0) {
      return reply.code(404).send({
        error: 'EpochNotFound',
        message: `Epoch ${epochId} not found.`,
      });
    }

    const epoch = toEpochInfo(result.rows[0]);

    // Get vote count
    const voteCount = await db.query(
      `SELECT COUNT(*) as count FROM governance_votes WHERE epoch_id = $1`,
      [epochId]
    );

    // Get vote distribution (aggregate stats, not individual votes for privacy)
    const voteStats = await db.query(
      `SELECT
        AVG(recency_weight) as avg_recency,
        AVG(engagement_weight) as avg_engagement,
        AVG(bridging_weight) as avg_bridging,
        AVG(source_diversity_weight) as avg_source_diversity,
        AVG(relevance_weight) as avg_relevance,
        MIN(recency_weight) as min_recency,
        MAX(recency_weight) as max_recency,
        MIN(engagement_weight) as min_engagement,
        MAX(engagement_weight) as max_engagement,
        MIN(bridging_weight) as min_bridging,
        MAX(bridging_weight) as max_bridging,
        MIN(source_diversity_weight) as min_source_diversity,
        MAX(source_diversity_weight) as max_source_diversity,
        MIN(relevance_weight) as min_relevance,
        MAX(relevance_weight) as max_relevance
       FROM governance_votes
       WHERE epoch_id = $1`,
      [epochId]
    );

    const stats = voteStats.rows[0];

    return reply.send({
      id: epoch.id,
      status: epoch.status,
      weights: epoch.weights,
      vote_count: parseInt(voteCount.rows[0].count),
      created_at: epoch.createdAt,
      closed_at: epoch.closedAt,
      description: epoch.description,
      vote_statistics:
        parseInt(voteCount.rows[0].count) > 0
          ? {
              average: {
                recency: parseFloat(stats.avg_recency) || 0,
                engagement: parseFloat(stats.avg_engagement) || 0,
                bridging: parseFloat(stats.avg_bridging) || 0,
                sourceDiversity: parseFloat(stats.avg_source_diversity) || 0,
                relevance: parseFloat(stats.avg_relevance) || 0,
              },
              range: {
                recency: {
                  min: parseFloat(stats.min_recency) || 0,
                  max: parseFloat(stats.max_recency) || 0,
                },
                engagement: {
                  min: parseFloat(stats.min_engagement) || 0,
                  max: parseFloat(stats.max_engagement) || 0,
                },
                bridging: {
                  min: parseFloat(stats.min_bridging) || 0,
                  max: parseFloat(stats.max_bridging) || 0,
                },
                sourceDiversity: {
                  min: parseFloat(stats.min_source_diversity) || 0,
                  max: parseFloat(stats.max_source_diversity) || 0,
                },
                relevance: {
                  min: parseFloat(stats.min_relevance) || 0,
                  max: parseFloat(stats.max_relevance) || 0,
                },
              },
            }
          : null,
    });
  });
}
