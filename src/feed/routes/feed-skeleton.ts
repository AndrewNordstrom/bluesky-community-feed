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
import { db } from '../../db/client.js';
import { encodeCursor, decodeCursor } from '../cursor.js';

// The AT-URI for this feed
const FEED_URI = `at://${config.FEEDGEN_PUBLISHER_DID}/app.bsky.feed.generator/community-gov`;

/**
 * Extract the requester's DID from a Bluesky AppView JWT.
 *
 * The AppView sends Authorization: Bearer <jwt> on feed requests.
 * We decode the payload (no signature verification — that would require
 * a network call to resolve the DID document, violating the <50ms target).
 * The DID is in the 'sub' or 'iss' claim.
 *
 * If the JWT is missing, malformed, or doesn't contain a DID, returns null.
 */
export function extractDidFromJwt(authHeader: string | undefined): string | null {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  try {
    const token = authHeader.slice(7); // Remove "Bearer "
    const parts = token.split('.');
    if (parts.length !== 3) {
      return null;
    }

    // Decode the payload (middle segment)
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());

    // The requester DID is in 'iss' (AT Protocol service auth) or 'sub'
    const did: unknown = payload.iss ?? payload.sub;
    if (typeof did === 'string' && did.startsWith('did:')) {
      return did;
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Fire-and-forget subscriber UPSERT.
 * Inserts new subscribers or updates last_seen for existing ones.
 * Non-blocking — errors are logged but never propagated.
 */
function upsertSubscriberAsync(did: string): void {
  setImmediate(() => {
    db.query(
      `INSERT INTO subscribers (did, first_seen, last_seen, is_active)
       VALUES ($1, NOW(), NOW(), TRUE)
       ON CONFLICT (did) DO UPDATE SET last_seen = NOW(), is_active = TRUE`,
      [did]
    ).catch((err) => logger.warn({ err, did }, 'Subscriber upsert failed'));
  });
}

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
      const startTime = performance.now();

      // Extract requester DID from JWT (if present — auth is optional on feed endpoints)
      const viewerDid = extractDidFromJwt(request.headers.authorization);

      // Fire-and-forget subscriber tracking (populates subscribers table for governance eligibility)
      if (viewerDid) {
        upsertSubscriberAsync(viewerDid);
      }

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
      const responseTimeMs = Math.round(performance.now() - startTime);

      logger.debug(
        { feedItems: feedItems.length, hasMore, snapshotId, viewerDid: viewerDid ?? 'anonymous', responseTimeMs },
        'Returning feed skeleton'
      );

      // Fire-and-forget: log this request to Redis queue for async processing
      // The background worker (interaction-logger) drains this into PostgreSQL
      const epochIdStr = await redis.get('feed:epoch');
      const logEntry = JSON.stringify({
        viewer_did: viewerDid,
        epoch_id: epochIdStr ? parseInt(epochIdStr, 10) : 0,
        snapshot_id: snapshotId,
        page_offset: offset,
        posts_served: feedItems.length,
        post_uris: postUris,
        position_start: offset,
        response_time_ms: responseTimeMs,
        requested_at: new Date().toISOString(),
      });
      redis.rpush('feed:request_log', logEntry).catch((err) =>
        logger.warn({ err }, 'Failed to log feed request to Redis')
      );

      return reply.send({
        feed: feedItems,
        cursor: hasMore ? encodeCursor(snapshotId, nextOffset) : undefined,
      });
    }
  );
}
