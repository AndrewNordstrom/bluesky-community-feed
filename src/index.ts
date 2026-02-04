import { config } from './config.js';
import { logger } from './lib/logger.js';
import { createServer } from './feed/server.js';
import { startJetstream, stopJetstream } from './ingestion/jetstream.js';
import { db } from './db/client.js';
import { redis } from './db/redis.js';

async function main() {
  logger.info('Starting Community Feed Generator...');

  // 1. Create and configure the HTTP server
  const app = await createServer();

  // 2. Start HTTP server
  try {
    await app.listen({
      port: config.FEEDGEN_PORT,
      host: config.FEEDGEN_LISTENHOST,
    });
    logger.info(
      { port: config.FEEDGEN_PORT, host: config.FEEDGEN_LISTENHOST },
      'Feed generator server started'
    );
  } catch (err) {
    logger.fatal({ err }, 'Failed to start HTTP server');
    process.exit(1);
  }

  // 3. Start Jetstream ingestion
  try {
    await startJetstream();
    logger.info('Jetstream ingestion started');
  } catch (err) {
    logger.fatal({ err }, 'Failed to start Jetstream ingestion');
    process.exit(1);
  }

  // 4. Log startup complete
  logger.info({
    serviceDid: config.FEEDGEN_SERVICE_DID,
    publisherDid: config.FEEDGEN_PUBLISHER_DID,
    hostname: config.FEEDGEN_HOSTNAME,
  }, 'All systems operational (Phase 2: Ingestion)');

  // Graceful shutdown
  const shutdown = async () => {
    logger.info('Shutting down...');

    // 1. Stop Jetstream first (saves final cursor)
    try {
      await stopJetstream();
      logger.info('Jetstream stopped');
    } catch (err) {
      logger.error({ err }, 'Error stopping Jetstream');
    }

    // 2. Close HTTP server
    try {
      await app.close();
      logger.info('HTTP server closed');
    } catch (err) {
      logger.error({ err }, 'Error closing HTTP server');
    }

    // 3. Close database connections
    try {
      await db.end();
      logger.info('PostgreSQL connection closed');
    } catch (err) {
      logger.error({ err }, 'Error closing PostgreSQL');
    }

    // 4. Close Redis connection
    try {
      redis.disconnect();
      logger.info('Redis connection closed');
    } catch (err) {
      logger.error({ err }, 'Error closing Redis');
    }

    logger.info('Shutdown complete');
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  logger.fatal({ err }, 'Failed to start application');
  process.exit(1);
});
