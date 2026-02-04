import type { FastifyInstance } from 'fastify';
import { config } from '../../config.js';

/**
 * Register the describeFeedGenerator endpoint.
 * This is called by Bluesky to discover what feeds this generator provides.
 *
 * Spec: §9.4 - GET /xrpc/app.bsky.feed.describeFeedGenerator
 */
export function registerDescribeGenerator(app: FastifyInstance): void {
  app.get('/xrpc/app.bsky.feed.describeFeedGenerator', async (_request, reply) => {
    return reply.send({
      did: config.FEEDGEN_SERVICE_DID,
      feeds: [
        {
          uri: `at://${config.FEEDGEN_PUBLISHER_DID}/app.bsky.feed.generator/community-gov`,
        },
      ],
    });
  });
}
