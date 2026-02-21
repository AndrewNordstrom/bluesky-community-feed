/**
 * Interaction Logger — Background Worker
 *
 * Drains the Redis `feed:request_log` queue (populated by getFeedSkeleton)
 * and batch-inserts rows into PostgreSQL:
 *   - feed_requests: one row per feed load
 *   - engagement_attributions: one row per (post_uri, viewer_did, epoch_id)
 *     with engaged_at = NULL (pending attribution)
 *
 * Runs every 5 seconds. Each tick processes up to 100 entries.
 * Follows the same start/stop/guard pattern as cleanup.ts.
 */

import { db } from '../db/client.js';
import { redis } from '../db/redis.js';
import { logger } from '../lib/logger.js';

const DRAIN_INTERVAL_MS = 5_000; // 5 seconds
const BATCH_SIZE = 100;

let isRunning = false;
let isDraining = false;
let intervalId: NodeJS.Timeout | null = null;
let isShuttingDown = false;

interface FeedRequestLogEntry {
  viewer_did: string | null;
  epoch_id: number;
  snapshot_id: string;
  page_offset: number;
  posts_served: number;
  post_uris: string[];
  position_start: number;
  response_time_ms: number;
  requested_at: string;
}

/**
 * Start the interaction logger.
 * Runs immediately, then every 5 seconds.
 */
export async function startInteractionLogger(): Promise<void> {
  if (isRunning) {
    logger.warn('Interaction logger already running');
    return;
  }

  isRunning = true;
  isShuttingDown = false;

  logger.info(
    { intervalMs: DRAIN_INTERVAL_MS, batchSize: BATCH_SIZE },
    'Starting interaction logger'
  );

  // Run immediately on start
  await runWithGuard();

  // Schedule recurring runs
  intervalId = setInterval(runWithGuard, DRAIN_INTERVAL_MS);

  logger.info('Interaction logger started');
}

/**
 * Stop the interaction logger.
 * Drains remaining entries before stopping.
 */
export async function stopInteractionLogger(): Promise<void> {
  if (!isRunning) {
    return;
  }

  logger.info('Stopping interaction logger...');
  isShuttingDown = true;

  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }

  // Wait for in-progress drain to complete
  while (isDraining) {
    logger.info('Waiting for interaction logger drain to complete...');
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  // Final drain to process any remaining entries
  try {
    await drainQueue();
  } catch (err) {
    logger.warn({ err }, 'Final interaction logger drain failed');
  }

  isRunning = false;
  logger.info('Interaction logger stopped');
}

async function runWithGuard(): Promise<void> {
  if (isShuttingDown) return;

  if (isDraining) {
    logger.debug('Skipping interaction logger tick - previous drain still in progress');
    return;
  }

  isDraining = true;
  try {
    await drainQueue();
  } catch (err) {
    logger.error({ err }, 'Interaction logger drain failed');
  } finally {
    isDraining = false;
  }
}

/**
 * Drain up to BATCH_SIZE entries from the Redis queue into PostgreSQL.
 */
async function drainQueue(): Promise<void> {
  const entries: FeedRequestLogEntry[] = [];

  // LPOP entries one at a time (Redis < 6.2 doesn't support LPOP count)
  for (let i = 0; i < BATCH_SIZE; i++) {
    const raw = await redis.lpop('feed:request_log');
    if (!raw) break;

    try {
      const entry = JSON.parse(raw) as FeedRequestLogEntry;
      entries.push(entry);
    } catch (err) {
      logger.warn({ err, raw: raw.substring(0, 200) }, 'Malformed feed request log entry, skipping');
    }
  }

  if (entries.length === 0) return;

  logger.debug({ count: entries.length }, 'Draining feed request log entries');

  // Batch INSERT feed_requests
  await insertFeedRequests(entries);

  // Batch INSERT engagement_attributions for authenticated requests
  const authenticatedEntries = entries.filter((e) => e.viewer_did !== null);
  if (authenticatedEntries.length > 0) {
    await insertEngagementAttributions(authenticatedEntries);
  }
}

/**
 * Batch INSERT into feed_requests table.
 */
async function insertFeedRequests(entries: FeedRequestLogEntry[]): Promise<void> {
  // Build multi-row INSERT
  const values: unknown[] = [];
  const placeholders: string[] = [];

  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const base = i * 7;
    placeholders.push(
      `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7})`
    );
    values.push(
      e.viewer_did,
      e.epoch_id,
      e.snapshot_id,
      e.page_offset,
      e.posts_served,
      e.response_time_ms,
      e.requested_at
    );
  }

  try {
    await db.query(
      `INSERT INTO feed_requests (viewer_did, epoch_id, snapshot_id, page_offset, posts_served, response_time_ms, requested_at)
       VALUES ${placeholders.join(', ')}`,
      values
    );
  } catch (err) {
    logger.error({ err, count: entries.length }, 'Failed to insert feed_requests batch');
  }
}

/**
 * Batch INSERT into engagement_attributions for authenticated requests.
 * Creates one row per (post_uri, viewer_did, epoch_id) with engaged_at = NULL.
 * ON CONFLICT DO NOTHING — keep first impression if served again in same epoch.
 */
async function insertEngagementAttributions(entries: FeedRequestLogEntry[]): Promise<void> {
  const values: unknown[] = [];
  const placeholders: string[] = [];
  let paramIndex = 0;

  for (const entry of entries) {
    if (!entry.viewer_did) continue;

    for (let j = 0; j < entry.post_uris.length; j++) {
      const base = paramIndex * 5;
      placeholders.push(
        `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`
      );
      values.push(
        entry.post_uris[j],
        entry.viewer_did,
        entry.epoch_id,
        entry.requested_at,
        entry.position_start + j
      );
      paramIndex++;
    }
  }

  if (placeholders.length === 0) return;

  try {
    await db.query(
      `INSERT INTO engagement_attributions (post_uri, viewer_did, epoch_id, served_at, position_in_feed)
       VALUES ${placeholders.join(', ')}
       ON CONFLICT (post_uri, viewer_did, epoch_id) DO NOTHING`,
      values
    );
  } catch (err) {
    logger.error(
      { err, count: placeholders.length },
      'Failed to insert engagement_attributions batch'
    );
  }
}
