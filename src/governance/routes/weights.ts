/**
 * Weights Route
 *
 * GET /api/governance/weights - Current active epoch weights
 * GET /api/governance/weights/history - All epochs with weights
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { db } from '../../db/client.js';
import { toEpochInfo } from '../governance.types.js';

export function registerWeightsRoute(app: FastifyInstance): void {
  /**
   * GET /api/governance/weights
   * Returns the current active epoch's weights.
   */
  app.get('/api/governance/weights', async (_request: FastifyRequest, reply: FastifyReply) => {
    const result = await db.query(
      `SELECT * FROM governance_epochs
       WHERE status = 'active'
       ORDER BY id DESC LIMIT 1`
    );

    if (result.rows.length === 0) {
      return reply.code(404).send({
        error: 'NoActiveEpoch',
        message: 'No active governance epoch found.',
      });
    }

    const epoch = toEpochInfo(result.rows[0]);

    // Get vote count for this epoch
    const voteCount = await db.query(
      `SELECT COUNT(*) as count FROM governance_votes WHERE epoch_id = $1`,
      [epoch.id]
    );

    return reply.send({
      epoch_id: epoch.id,
      status: epoch.status,
      weights: epoch.weights,
      vote_count: parseInt(voteCount.rows[0].count),
      created_at: epoch.createdAt,
      description: epoch.description,
    });
  });

  /**
   * GET /api/governance/weights/history
   * Returns all epochs with their weights (for timeline visualization).
   */
  app.get('/api/governance/weights/history', async (request: FastifyRequest, reply: FastifyReply) => {
    const query = request.query as { limit?: string };
    const limit = Math.min(parseInt(query.limit ?? '20'), 100);

    const result = await db.query(
      `SELECT * FROM governance_epochs
       ORDER BY id DESC
       LIMIT $1`,
      [limit]
    );

    const epochs = await Promise.all(
      result.rows.map(async (row) => {
        const epoch = toEpochInfo(row);

        // Get actual vote count from governance_votes table
        const voteCount = await db.query(
          `SELECT COUNT(*) as count FROM governance_votes WHERE epoch_id = $1`,
          [epoch.id]
        );

        return {
          epoch_id: epoch.id,
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
   * GET /api/governance/weights/compare
   * Compare weights between two epochs.
   */
  app.get('/api/governance/weights/compare', async (request: FastifyRequest, reply: FastifyReply) => {
    const query = request.query as { epoch1?: string; epoch2?: string };

    if (!query.epoch1 || !query.epoch2) {
      return reply.code(400).send({
        error: 'MissingParameters',
        message: 'Both epoch1 and epoch2 query parameters are required.',
      });
    }

    const epoch1Id = parseInt(query.epoch1);
    const epoch2Id = parseInt(query.epoch2);

    const result = await db.query(
      `SELECT * FROM governance_epochs WHERE id IN ($1, $2) ORDER BY id`,
      [epoch1Id, epoch2Id]
    );

    if (result.rows.length !== 2) {
      return reply.code(404).send({
        error: 'EpochNotFound',
        message: 'One or both epochs not found.',
      });
    }

    const epoch1 = toEpochInfo(result.rows.find((r) => r.id === epoch1Id));
    const epoch2 = toEpochInfo(result.rows.find((r) => r.id === epoch2Id));

    // Calculate differences
    const diff = {
      recency: epoch2.weights.recency - epoch1.weights.recency,
      engagement: epoch2.weights.engagement - epoch1.weights.engagement,
      bridging: epoch2.weights.bridging - epoch1.weights.bridging,
      sourceDiversity: epoch2.weights.sourceDiversity - epoch1.weights.sourceDiversity,
      relevance: epoch2.weights.relevance - epoch1.weights.relevance,
    };

    return reply.send({
      epoch1: {
        id: epoch1.id,
        weights: epoch1.weights,
        status: epoch1.status,
      },
      epoch2: {
        id: epoch2.id,
        weights: epoch2.weights,
        status: epoch2.status,
      },
      difference: diff,
    });
  });
}
