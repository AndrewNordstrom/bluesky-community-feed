/**
 * Announce Route
 *
 * Admin API endpoints for managing announcements.
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { config } from '../../config.js';
import { logger } from '../../lib/logger.js';
import { getAuthenticatedDid, SessionStoreUnavailableError } from '../../governance/auth.js';
import { isBotEnabled, getBotDid } from '../agent.js';
import { postAnnouncement, getPinnedAnnouncement, unpinAnnouncement, getRecentAnnouncements } from '../poster.js';
import { getRetryQueueLength, clearRetryQueue, processRetryQueue } from '../safe-poster.js';

/**
 * Check if DID is an admin.
 */
function isAdmin(did: string): boolean {
  const adminDids = config.BOT_ADMIN_DIDS?.split(',').map((d) => d.trim()) ?? [];
  return adminDids.includes(did);
}

const ManualAnnouncementSchema = z.object({
  message: z.string().min(1).max(300),
});

export function registerAnnounceRoute(app: FastifyInstance): void {
  /**
   * GET /api/bot/status
   * Get bot status and current pinned announcement.
   */
  app.get('/api/bot/status', async (_request: FastifyRequest, reply: FastifyReply) => {
    const pinned = await getPinnedAnnouncement();
    const retryQueueLength = await getRetryQueueLength();

    return reply.send({
      enabled: isBotEnabled(),
      botDid: getBotDid(),
      pinned,
      retryQueueLength,
    });
  });

  /**
   * POST /api/bot/announce
   * Post a manual announcement. Requires admin DID.
   */
  app.post('/api/bot/announce', async (request: FastifyRequest, reply: FastifyReply) => {
    // Authenticate
    let requesterDid: string | null;
    try {
      requesterDid = await getAuthenticatedDid(request);
    } catch (err) {
      if (err instanceof SessionStoreUnavailableError) {
        return reply.code(503).send({
          error: 'SessionStoreUnavailable',
          message: 'Authentication service is temporarily unavailable. Please try again.',
        });
      }
      throw err;
    }
    if (!requesterDid) {
      return reply.code(401).send({
        error: 'Unauthorized',
        message: 'Authentication required',
      });
    }

    // Check admin
    if (!isAdmin(requesterDid)) {
      logger.warn({ did: requesterDid }, 'Non-admin attempted to post announcement');
      return reply.code(403).send({
        error: 'Forbidden',
        message: 'Admin access required',
      });
    }

    // Validate body
    const parseResult = ManualAnnouncementSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.code(400).send({
        error: 'ValidationError',
        message: 'Invalid request body',
        details: parseResult.error.issues,
      });
    }

    // Check bot enabled
    if (!isBotEnabled()) {
      return reply.code(503).send({
        error: 'ServiceUnavailable',
        message: 'Bot is not enabled. Set BOT_ENABLED=true with credentials.',
      });
    }

    try {
      const announcement = await postAnnouncement({
        type: 'manual',
        message: parseResult.data.message,
      });

      logger.info({ adminDid: requesterDid, announcementId: announcement?.id }, 'Manual announcement posted');

      return reply.send({
        success: true,
        announcement: announcement
          ? {
              id: announcement.id,
              uri: announcement.uri,
              type: announcement.type,
              createdAt: announcement.createdAt,
            }
          : null,
      });
    } catch (err) {
      logger.error({ err, adminDid: requesterDid }, 'Failed to post manual announcement');
      return reply.code(500).send({
        error: 'InternalError',
        message: 'Failed to post announcement',
      });
    }
  });

  /**
   * DELETE /api/bot/unpin
   * Unpin the current announcement. Requires admin DID.
   */
  app.delete('/api/bot/unpin', async (request: FastifyRequest, reply: FastifyReply) => {
    let requesterDid: string | null;
    try {
      requesterDid = await getAuthenticatedDid(request);
    } catch (err) {
      if (err instanceof SessionStoreUnavailableError) {
        return reply.code(503).send({
          error: 'SessionStoreUnavailable',
          message: 'Authentication service is temporarily unavailable. Please try again.',
        });
      }
      throw err;
    }
    if (!requesterDid) {
      return reply.code(401).send({
        error: 'Unauthorized',
        message: 'Authentication required',
      });
    }

    if (!isAdmin(requesterDid)) {
      return reply.code(403).send({
        error: 'Forbidden',
        message: 'Admin access required',
      });
    }

    const unpinned = await unpinAnnouncement();

    logger.info({ adminDid: requesterDid, unpinned }, 'Unpin announcement requested');

    return reply.send({
      success: true,
      unpinned,
    });
  });

  /**
   * GET /api/bot/announcements
   * Get recent announcements.
   */
  app.get('/api/bot/announcements', async (request: FastifyRequest<{ Querystring: { limit?: string } }>, reply: FastifyReply) => {
    const limit = Math.min(parseInt(request.query.limit ?? '10', 10) || 10, 50);
    const announcements = await getRecentAnnouncements(limit);

    return reply.send({
      announcements: announcements.map((a) => ({
        id: a.id,
        uri: a.uri,
        type: a.type,
        epochId: a.epochId,
        content: a.content,
        createdAt: a.createdAt,
      })),
    });
  });

  /**
   * POST /api/bot/retry
   * Process retry queue. Requires admin DID.
   */
  app.post('/api/bot/retry', async (request: FastifyRequest, reply: FastifyReply) => {
    let requesterDid: string | null;
    try {
      requesterDid = await getAuthenticatedDid(request);
    } catch (err) {
      if (err instanceof SessionStoreUnavailableError) {
        return reply.code(503).send({
          error: 'SessionStoreUnavailable',
          message: 'Authentication service is temporarily unavailable. Please try again.',
        });
      }
      throw err;
    }
    if (!requesterDid) {
      return reply.code(401).send({
        error: 'Unauthorized',
        message: 'Authentication required',
      });
    }

    if (!isAdmin(requesterDid)) {
      return reply.code(403).send({
        error: 'Forbidden',
        message: 'Admin access required',
      });
    }

    const processed = await processRetryQueue();

    return reply.send({
      success: true,
      processed,
      remainingInQueue: await getRetryQueueLength(),
    });
  });

  /**
   * DELETE /api/bot/retry
   * Clear retry queue. Requires admin DID.
   */
  app.delete('/api/bot/retry', async (request: FastifyRequest, reply: FastifyReply) => {
    let requesterDid: string | null;
    try {
      requesterDid = await getAuthenticatedDid(request);
    } catch (err) {
      if (err instanceof SessionStoreUnavailableError) {
        return reply.code(503).send({
          error: 'SessionStoreUnavailable',
          message: 'Authentication service is temporarily unavailable. Please try again.',
        });
      }
      throw err;
    }
    if (!requesterDid) {
      return reply.code(401).send({
        error: 'Unauthorized',
        message: 'Authentication required',
      });
    }

    if (!isAdmin(requesterDid)) {
      return reply.code(403).send({
        error: 'Forbidden',
        message: 'Admin access required',
      });
    }

    const cleared = await clearRetryQueue();

    logger.info({ adminDid: requesterDid, cleared }, 'Retry queue cleared');

    return reply.send({
      success: true,
      cleared,
    });
  });
}
