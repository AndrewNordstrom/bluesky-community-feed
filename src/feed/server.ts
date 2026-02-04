import Fastify from 'fastify';
import cors from '@fastify/cors';
import { logger } from '../lib/logger.js';
import { registerDescribeGenerator } from './routes/describe-generator.js';
import { registerWellKnown } from './routes/well-known.js';
import { registerFeedSkeleton } from './routes/feed-skeleton.js';
import { registerGovernanceRoutes } from '../governance/server.js';

/**
 * Create and configure the Fastify server instance.
 * Registers all feed-related routes.
 */
export async function createServer() {
  const app = Fastify({
    logger: false, // We use our own pino logger
    trustProxy: true,
  });

  // Register CORS for cross-origin requests
  await app.register(cors, {
    origin: true,
  });

  // Register feed generator routes (required by Bluesky)
  registerDescribeGenerator(app);
  registerWellKnown(app);
  registerFeedSkeleton(app);

  // Register governance routes
  registerGovernanceRoutes(app);

  // Health check endpoint
  app.get('/health', async () => ({
    status: 'ok',
    timestamp: new Date().toISOString(),
  }));

  // Error handler
  app.setErrorHandler((error, _request, reply) => {
    logger.error({ err: error }, 'Request error');
    reply.status(500).send({
      error: 'InternalServerError',
      message: 'An unexpected error occurred',
    });
  });

  return app;
}
