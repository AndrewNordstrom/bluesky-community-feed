/**
 * Bot Server
 *
 * Registers bot routes with the Fastify application.
 * Skips registration if bot is disabled.
 */

import { FastifyInstance } from 'fastify';
import { logger } from '../lib/logger.js';
import { isBotEnabled } from './agent.js';
import { registerAnnounceRoute } from './routes/announce.js';

/**
 * Register bot routes with the application.
 * Skips registration if BOT_ENABLED is false.
 */
export function registerBotRoutes(app: FastifyInstance): void {
  if (!isBotEnabled()) {
    logger.info('Bot is disabled, skipping route registration');
    return;
  }

  logger.info('Registering bot routes');
  registerAnnounceRoute(app);
  logger.info('Bot routes registered');
}
