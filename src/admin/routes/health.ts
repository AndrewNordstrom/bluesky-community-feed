import type { FastifyInstance } from 'fastify';
import { getHealthStatus } from '../../lib/health.js';

export function registerAdminHealthRoutes(app: FastifyInstance): void {
  app.get('/health', async () => {
    return getHealthStatus();
  });
}
