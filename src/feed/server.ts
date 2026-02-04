import Fastify, { FastifyRequest, FastifyReply } from 'fastify';
import cors from '@fastify/cors';
import { logger } from '../lib/logger.js';
import { registerDescribeGenerator } from './routes/describe-generator.js';
import { registerWellKnown } from './routes/well-known.js';
import { registerFeedSkeleton } from './routes/feed-skeleton.js';
import { registerGovernanceRoutes } from '../governance/server.js';
import { registerTransparencyRoutes } from '../transparency/server.js';
import { getHealthStatus, isLive, isReady } from '../lib/health.js';
import { generateCorrelationId } from '../lib/correlation.js';
import { AppError, isAppError } from '../lib/errors.js';

// Extend FastifyRequest to include correlationId
declare module 'fastify' {
  interface FastifyRequest {
    correlationId: string;
  }
}

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

  // Add correlation ID to every request
  app.addHook('onRequest', (request: FastifyRequest, reply: FastifyReply, done) => {
    const incomingId = request.headers['x-correlation-id'];
    const correlationId = typeof incomingId === 'string' ? incomingId : generateCorrelationId();
    request.correlationId = correlationId;
    reply.header('x-correlation-id', correlationId);
    done();
  });

  // Log all requests with correlation ID
  app.addHook('onResponse', (request: FastifyRequest, reply: FastifyReply, done) => {
    logger.info({
      correlationId: request.correlationId,
      method: request.method,
      url: request.url,
      statusCode: reply.statusCode,
      responseTime: reply.elapsedTime,
    }, 'Request completed');
    done();
  });

  // Register feed generator routes (required by Bluesky)
  registerDescribeGenerator(app);
  registerWellKnown(app);
  registerFeedSkeleton(app);

  // Register governance routes
  registerGovernanceRoutes(app);

  // Register transparency routes
  registerTransparencyRoutes(app);

  // Deep health check endpoint - returns detailed component status
  app.get('/health', async () => {
    return getHealthStatus();
  });

  // Liveness probe - just checks if process is running (k8s liveness)
  app.get('/health/live', async (_request, reply) => {
    if (isLive()) {
      return reply.status(200).send({ status: 'live' });
    }
    return reply.status(503).send({ status: 'not live' });
  });

  // Readiness probe - checks if all dependencies are healthy (k8s readiness)
  app.get('/health/ready', async (_request, reply) => {
    const ready = await isReady();
    if (ready) {
      return reply.status(200).send({ status: 'ready' });
    }
    return reply.status(503).send({ status: 'not ready' });
  });

  // Standardized error handler with correlation ID
  app.setErrorHandler((error: Error, request: FastifyRequest, reply: FastifyReply) => {
    const correlationId = request.correlationId || 'unknown';

    // Handle AppError (our custom error type)
    if (isAppError(error)) {
      logger.warn({
        err: error,
        correlationId,
        errorCode: error.errorCode,
      }, error.message);

      return reply.status(error.statusCode).send(error.toResponse(correlationId));
    }

    // Handle Fastify validation errors
    const fastifyError = error as Error & { validation?: unknown };
    if (fastifyError.validation) {
      logger.warn({
        err: error,
        correlationId,
        validation: fastifyError.validation,
      }, 'Validation error');

      return reply.status(400).send({
        error: 'VALIDATION_ERROR',
        message: error.message,
        correlationId,
        details: fastifyError.validation,
      });
    }

    // Handle unexpected errors
    logger.error({
      err: error,
      correlationId,
      stack: error.stack,
    }, 'Unexpected error');

    return reply.status(500).send({
      error: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
      correlationId,
    });
  });

  return app;
}
