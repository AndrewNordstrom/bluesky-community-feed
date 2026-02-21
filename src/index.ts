import { config } from './config.js';
import { logger } from './lib/logger.js';
import { createServer } from './feed/server.js';
import { startJetstream, stopJetstream, isJetstreamConnected, getLastEventReceivedAt } from './ingestion/jetstream.js';
import { startScoring, stopScoring, isScoringInProgress } from './scoring/scheduler.js';
import { getLastScoringRunAt } from './scoring/pipeline.js';
import { runStartupChecks } from './lib/startup-checks.js';
import { registerShutdownHandlers } from './lib/shutdown.js';
import { registerJetstreamHealth, registerScoringHealth, JetstreamHealth, ScoringHealth } from './lib/health.js';
import { registerBotRoutes } from './bot/server.js';
import { initializeBot } from './bot/agent.js';
import { startEpochScheduler, stopEpochScheduler } from './scheduler/epoch-scheduler.js';
import { startCleanup, stopCleanup } from './maintenance/cleanup.js';
import { startInteractionLogger, stopInteractionLogger } from './maintenance/interaction-logger.js';

async function main() {
  logger.info('Starting Community Feed Generator...');

  // 0. Run startup checks (fail fast if dependencies are down)
  try {
    await runStartupChecks();
  } catch (err) {
    logger.fatal({ err }, 'Startup checks failed');
    process.exit(1);
  }

  // 1. Create and configure the HTTP server
  const app = await createServer();

  // 1.5. Register bot routes (if enabled)
  registerBotRoutes(app);

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

  // 4. Register Jetstream health check
  registerJetstreamHealth((): JetstreamHealth => {
    const connected = isJetstreamConnected();
    const lastEventAt = getLastEventReceivedAt();
    const lastEventAgeMs = lastEventAt ? Date.now() - lastEventAt.getTime() : undefined;

    // Consider unhealthy if no events for more than 5 minutes
    const isHealthy = connected && (lastEventAgeMs === undefined || lastEventAgeMs < 300_000);

    return {
      status: isHealthy ? 'healthy' : 'unhealthy',
      connected,
      last_event_age_ms: lastEventAgeMs,
      error: !connected ? 'WebSocket not connected' : undefined,
    };
  });

  // 5. Register scoring health check (before starting scoring so it's available during initial run)
  registerScoringHealth((): ScoringHealth => {
    const isRunning = isScoringInProgress();
    const lastRunAt = getLastScoringRunAt();

    // Consider healthy if we've had a successful run in the last 10 minutes
    // or if no run has happened yet (startup grace period)
    const lastRunAgeMs = lastRunAt ? Date.now() - lastRunAt.getTime() : undefined;
    const isHealthy = lastRunAgeMs === undefined || lastRunAgeMs < 600_000;

    return {
      status: isHealthy ? 'healthy' : 'unhealthy',
      is_running: isRunning,
      last_run_at: lastRunAt?.toISOString(),
      error: !isHealthy ? 'No successful scoring run in last 10 minutes' : undefined,
    };
  });

  // 6. Start scoring pipeline
  try {
    await startScoring();
    logger.info('Scoring pipeline started');
  } catch (err) {
    logger.fatal({ err }, 'Failed to start scoring pipeline');
    process.exit(1);
  }

  // 6.5. Initialize announcement bot (if enabled, non-fatal)
  try {
    await initializeBot();
  } catch (err) {
    logger.warn({ err }, 'Bot initialization failed - will retry on first announcement');
  }

  // 6.6. Start epoch scheduler (for auto-transitions)
  startEpochScheduler();

  // 6.7. Start cleanup scheduler (hourly post retention cleanup)
  try {
    await startCleanup();
    logger.info('Cleanup scheduler started');
  } catch (err) {
    logger.warn({ err }, 'Cleanup scheduler failed to start - non-fatal, will retry on next startup');
  }

  // 6.8. Start interaction logger (drains feed request queue from Redis to PostgreSQL)
  try {
    await startInteractionLogger();
    logger.info('Interaction logger started');
  } catch (err) {
    logger.warn({ err }, 'Interaction logger failed to start - non-fatal');
  }

  // 7. Register graceful shutdown handlers
  registerShutdownHandlers({
    server: app,
    stopScoring,
    stopJetstream,
    stopEpochScheduler,
    stopCleanup,
    stopInteractionLogger,
  });

  // 8. Log startup complete
  logger.info({
    serviceDid: config.FEEDGEN_SERVICE_DID,
    publisherDid: config.FEEDGEN_PUBLISHER_DID,
    hostname: config.FEEDGEN_HOSTNAME,
  }, 'All systems operational (Phase 6: Hardening)');
}

// Handle unhandled rejections
process.on('unhandledRejection', (err) => {
  logger.error({ err }, 'Unhandled promise rejection');
  // Don't crash - log and continue
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Uncaught exception - shutting down');
  process.exit(1);
});

main().catch((err) => {
  logger.fatal({ err }, 'Failed to start application');
  process.exit(1);
});
