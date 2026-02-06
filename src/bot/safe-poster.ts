/**
 * Safe Poster
 *
 * Fire-and-forget wrapper for announcements.
 * Ensures governance operations never fail due to announcement failures.
 * Queues failed announcements for retry.
 */

import { db } from '../db/client.js';
import { redis } from '../db/redis.js';
import { logger } from '../lib/logger.js';
import { isBotEnabled } from './agent.js';
import { postAnnouncement } from './poster.js';
import type { AnnouncementPayload, RetryQueueItem } from './bot.types.js';

// Redis key for retry queue
const RETRY_QUEUE_KEY = 'bot:retry_queue';
const MAX_RETRY_ATTEMPTS = 3;

/**
 * Post an announcement safely (fire-and-forget).
 * Catches all errors and queues failed attempts for retry.
 *
 * @param payload - The announcement payload
 */
export async function postAnnouncementSafe(payload: AnnouncementPayload): Promise<void> {
  // Skip if bot is disabled
  if (!isBotEnabled()) {
    logger.debug({ type: payload.type }, 'Bot disabled, skipping announcement');
    return;
  }

  try {
    await postAnnouncement(payload);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    logger.error({ err, payload }, 'Failed to post announcement');

    // Queue for retry
    const retryItem: RetryQueueItem = {
      payload,
      attempts: 1,
      lastAttempt: new Date().toISOString(),
      error: errorMessage,
    };

    await redis.lpush(RETRY_QUEUE_KEY, JSON.stringify(retryItem));

    // Log failure to audit trail
    await db.query(
      `INSERT INTO governance_audit_log (action, details)
       VALUES ('announcement_failed', $1)`,
      [
        JSON.stringify({
          payload,
          error: errorMessage,
          queued_for_retry: true,
        }),
      ]
    ).catch((auditErr) => {
      logger.error({ err: auditErr }, 'Failed to log announcement failure to audit');
    });
  }
}

/**
 * Process the retry queue.
 * Called periodically to retry failed announcements.
 */
export async function processRetryQueue(): Promise<number> {
  if (!isBotEnabled()) {
    return 0;
  }

  let processed = 0;
  const maxProcess = 5; // Process up to 5 items per run

  for (let i = 0; i < maxProcess; i++) {
    const itemJson = await redis.rpop(RETRY_QUEUE_KEY);
    if (!itemJson) {
      break;
    }

    let item: RetryQueueItem;
    try {
      item = JSON.parse(itemJson);
    } catch {
      logger.warn({ itemJson }, 'Invalid retry queue item');
      continue;
    }

    if (item.attempts >= MAX_RETRY_ATTEMPTS) {
      logger.warn(
        { payload: item.payload, attempts: item.attempts },
        'Announcement retry limit reached, dropping'
      );

      await db.query(
        `INSERT INTO governance_audit_log (action, details)
         VALUES ('announcement_dropped', $1)`,
        [
          JSON.stringify({
            payload: item.payload,
            attempts: item.attempts,
            final_error: item.error,
          }),
        ]
      ).catch(() => {});

      processed++;
      continue;
    }

    try {
      await postAnnouncement(item.payload);
      logger.info(
        { payload: item.payload, attempt: item.attempts + 1 },
        'Retry announcement succeeded'
      );
      processed++;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      logger.warn(
        { err, payload: item.payload, attempt: item.attempts + 1 },
        'Retry announcement failed'
      );

      // Re-queue with incremented attempts
      const updatedItem: RetryQueueItem = {
        ...item,
        attempts: item.attempts + 1,
        lastAttempt: new Date().toISOString(),
        error: errorMessage,
      };

      await redis.lpush(RETRY_QUEUE_KEY, JSON.stringify(updatedItem));
      processed++;
    }
  }

  if (processed > 0) {
    logger.debug({ processed }, 'Processed retry queue items');
  }

  return processed;
}

/**
 * Get the retry queue length.
 */
export async function getRetryQueueLength(): Promise<number> {
  return redis.llen(RETRY_QUEUE_KEY);
}

/**
 * Clear the retry queue (for testing/admin).
 */
export async function clearRetryQueue(): Promise<number> {
  const length = await redis.llen(RETRY_QUEUE_KEY);
  await redis.del(RETRY_QUEUE_KEY);
  return length;
}
