/**
 * Admin Feed Health Routes
 *
 * GET /api/admin/feed-health - Detailed feed statistics
 * POST /api/admin/feed/rescore - Manually trigger scoring pipeline
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { db } from '../../db/client.js';
import { redis } from '../../db/redis.js';
import { getScoringStatus } from '../status-tracker.js';
import { getAdminDid } from '../../auth/admin.js';
import { tryTriggerManualScoringRun } from '../../scoring/scheduler.js';
import { logger } from '../../lib/logger.js';

export function registerFeedHealthRoutes(app: FastifyInstance): void {
  /**
   * GET /api/admin/feed-health
   * Detailed feed statistics
   */
  app.get('/feed-health', async (_request: FastifyRequest, reply: FastifyReply) => {
    // Database stats
    const dbStats = await db.query(`
      SELECT
        COUNT(*) as total_posts,
        COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours') as posts_24h,
        COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days') as posts_7d,
        MIN(created_at) as oldest_post,
        MAX(created_at) as newest_post
      FROM posts
      WHERE deleted = FALSE
    `);

    // Scoring status
    const scoringStatus = await getScoringStatus();

    // Jetstream status (check Redis for last event)
    let jetstreamStatus: { connected: boolean; lastEvent: string | null; eventsLast5min: number } = {
      connected: false,
      lastEvent: null,
      eventsLast5min: 0,
    };
    try {
      const lastEvent = await redis.get('jetstream:last_event');
      const eventCount = await redis.get('jetstream:event_count_5min');

      if (lastEvent) {
        const lastEventTime = new Date(lastEvent);
        const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
        jetstreamStatus = {
          connected: lastEventTime > fiveMinutesAgo,
          lastEvent,
          eventsLast5min: parseInt(eventCount || '0', 10),
        };
      }
    } catch (err) {
      logger.warn({ err }, 'Failed to get Jetstream status from Redis');
    }

    // Subscriber stats
    const subStats = await db.query(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (
          WHERE did IN (SELECT DISTINCT voter_did FROM governance_votes)
        ) as with_votes
      FROM subscribers
      WHERE is_active = TRUE
    `);

    // Content rules from current epoch
    const epochResult = await db.query(`
      SELECT content_rules, created_at as rules_updated
      FROM governance_epochs
      WHERE status = 'active'
      LIMIT 1
    `);

    const contentRules = epochResult.rows[0]?.content_rules || {
      include_keywords: [],
      exclude_keywords: [],
    };

    // Feed size from Redis
    let feedSize = 0;
    try {
      feedSize = await redis.zcard('feed:current');
    } catch (err) {
      logger.warn({ err }, 'Failed to get feed size from Redis');
    }

    return reply.send({
      database: {
        totalPosts: parseInt(dbStats.rows[0].total_posts, 10),
        postsLast24h: parseInt(dbStats.rows[0].posts_24h, 10),
        postsLast7d: parseInt(dbStats.rows[0].posts_7d, 10),
        oldestPost: dbStats.rows[0].oldest_post,
        newestPost: dbStats.rows[0].newest_post,
      },
      scoring: {
        lastRun: scoringStatus.timestamp,
        lastRunDuration: scoringStatus.duration_ms,
        postsScored: scoringStatus.posts_scored,
        postsFiltered: scoringStatus.posts_filtered,
      },
      jetstream: jetstreamStatus,
      subscribers: {
        total: parseInt(subStats.rows[0].total, 10),
        withVotes: parseInt(subStats.rows[0].with_votes, 10),
      },
      contentRules: {
        includeKeywords: contentRules.include_keywords || [],
        excludeKeywords: contentRules.exclude_keywords || [],
        lastUpdated: epochResult.rows[0]?.rules_updated,
      },
      feedSize,
    });
  });

  /**
   * POST /api/admin/feed/rescore
   * Manually trigger scoring pipeline
   */
  app.post('/feed/rescore', async (request: FastifyRequest, reply: FastifyReply) => {
    const adminDid = getAdminDid(request);

    if (!tryTriggerManualScoringRun()) {
      logger.warn({ adminDid }, 'Manual rescore rejected because scoring is already in progress');
      return reply.code(409).send({
        error: 'Conflict',
        message: 'Scoring pipeline is already running. Try again after it completes.',
      });
    }

    // Log to audit
    await db.query(
      `INSERT INTO governance_audit_log (action, actor_did, details)
       VALUES ('manual_rescore', $1, $2)`,
      [adminDid, JSON.stringify({ triggeredAt: new Date().toISOString() })]
    );

    logger.info({ adminDid }, 'Manual rescore triggered by admin');

    return reply.send({
      success: true,
      message: 'Scoring pipeline started. Check feed-health endpoint for results.',
    });
  });
}
