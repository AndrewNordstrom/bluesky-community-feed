import type { FastifyInstance } from 'fastify';
import { config } from '../../config.js';

/**
 * Register the well-known DID document endpoint.
 * This is used for did:web resolution (fallback, not recommended for production).
 * For production, use did:plc instead.
 *
 * Spec: §9.5 - GET /.well-known/did.json
 */
export function registerWellKnown(app: FastifyInstance): void {
  app.get('/.well-known/did.json', async (_request, reply) => {
    return reply.send({
      '@context': ['https://www.w3.org/ns/did/v1'],
      id: `did:web:${config.FEEDGEN_HOSTNAME}`,
      service: [
        {
          id: '#bsky_fg',
          type: 'BskyFeedGenerator',
          serviceEndpoint: `https://${config.FEEDGEN_HOSTNAME}`,
        },
      ],
    });
  });
}
