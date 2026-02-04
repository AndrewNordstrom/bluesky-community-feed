/**
 * Feed Stats Route
 *
 * GET /api/transparency/stats
 *
 * Returns aggregate statistics for the current feed:
 * - Current epoch weights and status
 * - Feed statistics (posts scored, unique authors, avg/median bridging)
 * - Governance info (vote count)
 * - Optional: Gini coefficient for author concentration
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { db } from '../../db/client.js';
import { logger } from '../../lib/logger.js';
import type { FeedStats } from '../transparency.types.js';

export function registerFeedStatsRoute(app: FastifyInstance): void {
  app.get('/api/transparency/stats', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      // Get current epoch
      const epochResult = await db.query(
        `SELECT * FROM governance_epochs WHERE status = 'active' ORDER BY id DESC LIMIT 1`
      );

      if (epochResult.rows.length === 0) {
        return reply.code(500).send({
          error: 'NoActiveEpoch',
          message: 'No active governance epoch found',
        });
      }

      const epoch = epochResult.rows[0];
      const epochId = epoch.id;

      // Aggregate metrics for current epoch
      const statsResult = await db.query(
        `
        SELECT
          COUNT(*) as total_posts,
          COUNT(DISTINCT p.author_did) as unique_authors,
          AVG(ps.bridging_score) as avg_bridging,
          AVG(ps.engagement_score) as avg_engagement,
          PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ps.bridging_score) as median_bridging,
          PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ps.total_score) as median_total
        FROM post_scores ps
        JOIN posts p ON ps.post_uri = p.uri
        WHERE ps.epoch_id = $1
        `,
        [epochId]
      );

      // Vote count for current epoch
      const voteCountResult = await db.query(
        `SELECT COUNT(*) as count FROM governance_votes WHERE epoch_id = $1`,
        [epochId]
      );

      // Get latest epoch metrics if available
      const metricsResult = await db.query(
        `SELECT * FROM epoch_metrics WHERE epoch_id = $1 ORDER BY computed_at DESC LIMIT 1`,
        [epochId]
      );

      const stats = statsResult.rows[0];
      const metrics = metricsResult.rows[0];

      const response: FeedStats = {
        epoch: {
          id: epochId,
          status: epoch.status,
          weights: {
            recency: parseFloat(epoch.recency_weight),
            engagement: parseFloat(epoch.engagement_weight),
            bridging: parseFloat(epoch.bridging_weight),
            source_diversity: parseFloat(epoch.source_diversity_weight),
            relevance: parseFloat(epoch.relevance_weight),
          },
          created_at: epoch.created_at,
        },
        feed_stats: {
          total_posts_scored: parseInt(stats.total_posts, 10) || 0,
          unique_authors: parseInt(stats.unique_authors, 10) || 0,
          avg_bridging_score: parseFloat(stats.avg_bridging) || 0,
          avg_engagement_score: parseFloat(stats.avg_engagement) || 0,
          median_bridging_score: parseFloat(stats.median_bridging) || 0,
          median_total_score: parseFloat(stats.median_total) || 0,
        },
        governance: {
          votes_this_epoch: parseInt(voteCountResult.rows[0].count, 10) || 0,
        },
      };

      // Add metrics if available
      if (metrics) {
        response.metrics = {
          author_gini: metrics.author_gini ? parseFloat(metrics.author_gini) : null,
          vs_chronological_overlap: metrics.vs_chronological_overlap
            ? parseFloat(metrics.vs_chronological_overlap)
            : null,
          vs_engagement_overlap: metrics.vs_engagement_overlap
            ? parseFloat(metrics.vs_engagement_overlap)
            : null,
        };
      }

      return reply.send(response);
    } catch (err) {
      logger.error({ err }, 'Error fetching feed stats');
      return reply.code(500).send({
        error: 'InternalError',
        message: 'An error occurred while fetching feed statistics',
      });
    }
  });
}
