/**
 * Legal Server
 *
 * Registers all legal document routes with the Fastify application.
 * Provides the /api/legal/* namespace for Terms of Service and Privacy Policy.
 */

import { FastifyInstance } from 'fastify';
import { registerLegalDocsRoute } from './routes/legal-docs.js';
import { logger } from '../lib/logger.js';

/**
 * Register all legal routes with the Fastify application.
 *
 * Routes registered:
 * - GET /api/legal/tos - Terms of Service
 * - GET /api/legal/privacy - Privacy Policy
 */
export function registerLegalRoutes(app: FastifyInstance): void {
  logger.info('Registering legal routes');
  registerLegalDocsRoute(app);
  logger.info('Legal routes registered');
}
