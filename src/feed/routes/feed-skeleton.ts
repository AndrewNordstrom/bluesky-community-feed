import type { FastifyInstance, FastifyRequest } from 'fastify';
import { config } from '../../config.js';
import { logger } from '../../lib/logger.js';

// The AT-URI for this feed
const FEED_URI = `at://${config.FEEDGEN_PUBLISHER_DID}/app.bsky.feed.generator/community-gov`;

// Phase 1: Hardcoded post URIs for testing
// These are real posts from Bluesky that can be verified
// Replace with actual post URIs from bsky.app for production testing
const HARDCODED_POSTS = [
  'at://did:plc:z72i7hdynmk6r22z27h6tvur/app.bsky.feed.post/3l2zpbbhuvs2f',
  'at://did:plc:z72i7hdynmk6r22z27h6tvur/app.bsky.feed.post/3l2zoxdiopc2b',
  'at://did:plc:z72i7hdynmk6r22z27h6tvur/app.bsky.feed.post/3l2znpjn7xk2v',
];

interface FeedSkeletonQuery {
  feed: string;
  cursor?: string;
  limit?: string;
}

/**
 * Register the getFeedSkeleton endpoint.
 * This is the core feed endpoint that Bluesky calls to get post URIs.
 *
 * Phase 1: Returns hardcoded posts for testing.
 * Phase 3: Will read from Redis sorted set with real ranked posts.
 *
 * Spec: §9.1-9.3 - GET /xrpc/app.bsky.feed.getFeedSkeleton
 */
export function registerFeedSkeleton(app: FastifyInstance): void {
  app.get(
    '/xrpc/app.bsky.feed.getFeedSkeleton',
    async (request: FastifyRequest<{ Querystring: FeedSkeletonQuery }>, reply) => {
      const { feed, cursor, limit: limitStr } = request.query;
      const limit = Math.min(parseInt(limitStr ?? '50', 10) || 50, 100);

      // Validate this is a request for OUR feed
      if (feed !== FEED_URI) {
        logger.warn({ feed, expected: FEED_URI }, 'Unknown feed requested');
        return reply.code(400).send({
          error: 'UnsupportedAlgorithm',
          message: 'Unknown feed',
        });
      }

      // Phase 1: Simple hardcoded response
      // No cursor handling - just return all hardcoded posts
      if (cursor) {
        // If cursor is provided, return empty (we only have one page)
        return reply.send({ feed: [] });
      }

      const feedItems = HARDCODED_POSTS.slice(0, limit).map((uri) => ({ post: uri }));

      logger.debug({ feedItems: feedItems.length }, 'Returning feed skeleton');

      return reply.send({
        feed: feedItems,
        // No cursor in Phase 1 - single page only
      });
    }
  );
}
