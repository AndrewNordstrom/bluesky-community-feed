/**
 * Startup Checks
 *
 * Fail-fast validation of all critical dependencies before the server starts.
 * If any check fails, the application exits immediately with a clear error.
 */

import { db } from '../db/client.js';
import { redis } from '../db/redis.js';
import { logger } from './logger.js';

const STARTUP_CHECK_TIMEOUT = 5000; // 5 seconds per check

/**
 * Run all startup checks.
 * Throws an error if any check fails.
 */
export async function runStartupChecks(): Promise<void> {
  logger.info('Running startup checks...');

  try {
    // 1. Verify PostgreSQL connection
    await checkPostgres();
    logger.info('PostgreSQL: OK');

    // 2. Verify Redis connection
    await checkRedis();
    logger.info('Redis: OK');

    logger.info('All startup checks passed');
  } catch (err) {
    logger.fatal({ err }, 'Startup check failed');
    throw err;
  }
}

/**
 * Check PostgreSQL connectivity.
 */
async function checkPostgres(): Promise<void> {
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(
      () => reject(new Error('PostgreSQL connection timed out')),
      STARTUP_CHECK_TIMEOUT
    );
  });

  const queryPromise = db.query('SELECT 1 as ok');

  try {
    const result = await Promise.race([queryPromise, timeoutPromise]);
    if (!result.rows[0]?.ok) {
      throw new Error('PostgreSQL returned unexpected result');
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    throw new Error(`PostgreSQL startup check failed: ${message}`);
  }
}

/**
 * Check Redis connectivity.
 */
async function checkRedis(): Promise<void> {
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(
      () => reject(new Error('Redis connection timed out')),
      STARTUP_CHECK_TIMEOUT
    );
  });

  const pingPromise = redis.ping();

  try {
    const result = await Promise.race([pingPromise, timeoutPromise]);
    if (result !== 'PONG') {
      throw new Error(`Redis returned unexpected response: ${result}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    throw new Error(`Redis startup check failed: ${message}`);
  }
}
