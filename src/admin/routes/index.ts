/**
 * Admin Routes Index
 *
 * Registers all admin API routes under /api/admin prefix.
 * All routes require admin authentication via requireAdmin preHandler.
 */

import { FastifyInstance } from 'fastify';
import { requireAdmin } from '../../auth/admin.js';
import { registerStatusRoutes } from './status.js';
import { registerEpochRoutes } from './epochs.js';
import { logger } from '../../lib/logger.js';

export function registerAdminRoutes(app: FastifyInstance): void {
  app.register(
    async (adminApp) => {
      // All admin routes require admin authentication
      adminApp.addHook('preHandler', requireAdmin);

      // Register route modules
      registerStatusRoutes(adminApp);
      registerEpochRoutes(adminApp);

      logger.info('Admin routes registered');
    },
    { prefix: '/api/admin' }
  );
}
