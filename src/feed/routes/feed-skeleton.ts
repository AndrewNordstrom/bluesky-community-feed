/**
 * Feed Skeleton Route
 *
 * This is the core feed endpoint that Bluesky calls to get post URIs.
 * CRITICAL: Response time target is <50ms. Only read from Redis/PostgreSQL.
 * NEVER call external APIs from this endpoint.
 *
 * Phase 3: Reads from Redis sorted set with real ranked posts.
 * Uses snapshot-based cursors for stable pagination.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { config } from '../../config.js';
import { logger } from '../../lib/logger.js';
import { redis } from '../../db/redis.js';
import { encodeCursor, decodeCursor } from '../cursor.js';

// The AT-URI for this feed
const FEED_URI = `at://${config.FEEDGEN_PUBLISHER_DID}/app.bsky.feed.generator/community-gov`;

// Snapshot TTL in seconds (5 minutes - matches scoring interval)
const SNAPSHOT_TTL = 300;

interface FeedSkeletonQuery {
  feed: string;
  cursor?: string;
  limit?: string;
}

const FeedSkeletonQuerySchema = z
  .object({
    feed: z.string(),
    cursor: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .superRefine((query, ctx) => {
    if (query.cursor && decodeCursor(query.cursor) === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['cursor'],
        message: 'Cursor must be a valid feed pagination cursor',
      });
    }
  });

/**
 * Register the getFeedSkeleton endpoint.
 *
 * Spec: §9.1-9.3 - GET /xrpc/app.bsky.feed.getFeedSkeleton
 */
export function registerFeedSkeleton(app: FastifyInstance): void {
  app.get(
    '/xrpc/app.bsky.feed.getFeedSkeleton',
    async (request: FastifyRequest<{ Querystring: FeedSkeletonQuery }>, reply) => {
      const parseResult = FeedSkeletonQuerySchema.safeParse(request.query);
      if (!parseResult.success) {
        return reply.code(400).send({
          error: 'ValidationError',
          message: 'Invalid query parameters',
          details: parseResult.error.issues,
        });
      }

      const { feed, cursor, limit } = parseResult.data;

      // Validate this is a request for OUR feed
      if (feed !== FEED_URI) {
        logger.warn({ feed, expected: FEED_URI }, 'Unknown feed requested');
        return reply.code(400).send({
          error: 'UnsupportedAlgorithm',
          message: 'Unknown feed',
        });
      }

      let postUris: string[];
      let offset: number;
      let snapshotId: string;

      if (cursor) {
        // Subsequent page: read from existing snapshot
        const parsed = decodeCursor(cursor);
        if (!parsed) {
          logger.warn({ cursor }, 'Invalid cursor');
          return reply.code(400).send({
            error: 'ValidationError',
            message: 'Invalid query parameters',
            details: [
              {
                path: ['cursor'],
                message: 'Cursor must be a valid feed pagination cursor',
              },
            ],
          });
        }

        snapshotId = parsed.snapshotId;
        offset = parsed.offset;

        // Try to get snapshot from Redis
        const snapshotData = await redis.get(`snapshot:${snapshotId}`);
        if (!snapshotData) {
          // Snapshot expired, return empty to signal client to refresh
          logger.debug({ snapshotId }, 'Snapshot expired');
          return reply.send({ feed: [] });
        }

        const allUris: string[] = JSON.parse(snapshotData);
        postUris = allUris.slice(offset, offset + limit);
      } else {
        // First page: create new snapshot from current rankings
        snapshotId = randomUUID().substring(0, 8);
        offset = 0;

        // Get ranked posts from Redis sorted set (descending by score)
        const rankedUris = await redis.zrevrange('feed:current', 0, config.FEED_MAX_POSTS - 1);

        if (rankedUris.length === 0) {
          logger.debug('No posts in feed');
          return reply.send({ feed: [] });
        }

        // Cache snapshot for pagination stability
        await redis.setex(`snapshot:${snapshotId}`, SNAPSHOT_TTL, JSON.stringify(rankedUris));

        postUris = rankedUris.slice(0, limit);
      }

      // Check for pinned announcement (first page only)
      let pinnedUri: string | null = null;
      if (offset === 0) {
        const pinnedData = await redis.get('bot:latest_announcement');
        if (pinnedData) {
          try {
            const { uri } = JSON.parse(pinnedData);
            // Don't duplicate if already in feed
            if (uri && !postUris.includes(uri)) {
              pinnedUri = uri;
            }
          } catch {
            // Ignore parse errors
          }
        }
      }

      // Build response with pinned post first
      const feedItems = pinnedUri
        ? [{ post: pinnedUri }, ...postUris.slice(0, limit - 1).map((uri) => ({ post: uri }))]
        : postUris.map((uri) => ({ post: uri }));

      const nextOffset = offset + postUris.length;
      const hasMore = postUris.length === limit;

      logger.debug(
        { feedItems: feedItems.length, hasMore, snapshotId },
        'Returning feed skeleton'
      );

      return reply.send({
        feed: feedItems,
        cursor: hasMore ? encodeCursor(snapshotId, nextOffset) : undefined,
      });
    }
  );
}
