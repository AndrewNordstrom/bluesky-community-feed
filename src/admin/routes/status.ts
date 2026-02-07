/**
 * Admin Status Routes
 *
 * GET /api/admin/status - Returns system overview for admin dashboard
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { db } from '../../db/client.js';
import { getScoringStatus } from '../status-tracker.js';
import { getCurrentContentRules } from '../../governance/content-filter.js';

export function registerStatusRoutes(app: FastifyInstance): void {
  /**
   * GET /api/admin/status
   * Returns admin status check and system overview
   */
  app.get('/status', async (_request: FastifyRequest, reply: FastifyReply) => {
    // Get current epoch
    const epochResult = await db.query(`
      SELECT
        id,
        status,
        voting_open,
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

    // Get vote count for current epoch
    let voteCount = 0;
    if (currentEpoch) {
      const voteResult = await db.query(
        `SELECT COUNT(*) as count FROM governance_votes WHERE epoch_id = $1`,
        [currentEpoch.id]
      );
      voteCount = parseInt(voteResult.rows[0].count, 10);
    }

    // Get feed stats
    const feedStats = await db.query(`
      SELECT
        COUNT(*) as total_posts,
        COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours') as posts_24h
      FROM posts
      WHERE deleted = FALSE
    `);

    // Get subscriber count
    const subResult = await db.query(`
      SELECT COUNT(DISTINCT subscriber_did) as count FROM subscribers WHERE subscribed = true
    `);

    // Get scoring status
    const scoringStatus = await getScoringStatus();

    // Get content rules
    const contentRules = await getCurrentContentRules();

    return reply.send({
      isAdmin: true,
      system: {
        currentEpoch: currentEpoch
          ? {
              id: currentEpoch.id,
              status: currentEpoch.status,
              votingOpen: currentEpoch.voting_open,
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
  });
}
