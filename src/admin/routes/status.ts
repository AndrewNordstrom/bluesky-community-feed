/**
 * Admin Status Routes
 *
 * GET /api/admin/status - Returns system overview for admin dashboard
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { db } from '../../db/client.js';
import { getScoringStatus } from '../status-tracker.js';
import { getCurrentContentRules } from '../../governance/content-filter.js';
import { logger } from '../../lib/logger.js';

export function registerStatusRoutes(app: FastifyInstance): void {
  /**
   * GET /api/admin/status
   * Returns admin status check and system overview
   */
  app.get('/status', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      // Get current epoch
      logger.debug('Fetching current epoch...');
      const epochResult = await db.query(`
        SELECT
          id,
          status,
          voting_ends_at,
          auto_transition,
          recency_weight,
          engagement_weight,
          bridging_weight,
          source_diversity_weight,
          relevance_weight,
          content_rules,
          created_at
        FROM governance_epochs
        WHERE status = 'active'
        ORDER BY id DESC
        LIMIT 1
      `);

      const currentEpoch = epochResult.rows[0] || null;
      logger.debug({ epochId: currentEpoch?.id }, 'Epoch fetched');

      // Get vote count for current epoch
      let voteCount = 0;
      if (currentEpoch) {
        logger.debug('Fetching vote count...');
        const voteResult = await db.query(
          `SELECT COUNT(*) as count FROM governance_votes WHERE epoch_id = $1`,
          [currentEpoch.id]
        );
        voteCount = parseInt(voteResult.rows[0].count, 10);
        logger.debug({ voteCount }, 'Vote count fetched');
      }

      // Get feed stats
      logger.debug('Fetching feed stats...');
      const feedStats = await db.query(`
        SELECT
          COUNT(*) as total_posts,
          COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours') as posts_24h
        FROM posts
        WHERE deleted = FALSE
      `);
      logger.debug({ totalPosts: feedStats.rows[0]?.total_posts }, 'Feed stats fetched');

      // Get subscriber count
      logger.debug('Fetching subscriber count...');
      const subResult = await db.query(`
        SELECT COUNT(*) as count FROM subscribers WHERE is_active = true
      `);
      logger.debug({ subCount: subResult.rows[0]?.count }, 'Subscriber count fetched');

      // Get scoring status
      logger.debug('Fetching scoring status...');
      const scoringStatus = await getScoringStatus();
      logger.debug({ scoringStatus }, 'Scoring status fetched');

      // Get content rules
      logger.debug('Fetching content rules...');
      const contentRules = await getCurrentContentRules();
      logger.debug('Content rules fetched');

      return reply.send({
        isAdmin: true,
        system: {
          currentEpoch: currentEpoch
            ? {
                id: currentEpoch.id,
                status: currentEpoch.status,
                votingEndsAt: currentEpoch.voting_ends_at,
                autoTransition: currentEpoch.auto_transition,
                voteCount,
                weights: {
                  recency: parseFloat(currentEpoch.recency_weight),
                  engagement: parseFloat(currentEpoch.engagement_weight),
                  bridging: parseFloat(currentEpoch.bridging_weight),
                  sourceDiversity: parseFloat(currentEpoch.source_diversity_weight),
                  relevance: parseFloat(currentEpoch.relevance_weight),
                },
                contentRules: currentEpoch.content_rules,
                createdAt: currentEpoch.created_at,
              }
            : null,
          feed: {
            totalPosts: parseInt(feedStats.rows[0].total_posts, 10),
            postsLast24h: parseInt(feedStats.rows[0].posts_24h, 10),
            scoredPosts: scoringStatus.posts_scored,
            lastScoringRun: scoringStatus.timestamp,
            lastScoringDuration: scoringStatus.duration_ms,
            subscriberCount: parseInt(subResult.rows[0].count, 10),
          },
          contentRules: {
            includeKeywords: contentRules.includeKeywords,
            excludeKeywords: contentRules.excludeKeywords,
          },
        },
      });
    } catch (err) {
      logger.error({ err }, 'Admin status endpoint failed');
      throw err;
    }
  });
}
