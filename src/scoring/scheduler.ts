/**
 * Scoring Scheduler
 *
 * Runs the scoring pipeline at regular intervals (default: every 5 minutes).
 * Uses simple setInterval - reliable and easy to understand.
 *
 * Features:
 * - Runs immediately on start (don't wait 5 minutes for first run)
 * - Prevents overlapping runs (skips if previous run is still in progress)
 * - Graceful shutdown (completes current run before stopping)
 * - Error isolation (failed runs don't crash the scheduler)
 */

import { config } from '../config.js';
import { logger } from '../lib/logger.js';
import { runScoringPipeline } from './pipeline.js';

/** Whether the scheduler is currently running */
let isRunning = false;

/** Whether a scoring run is in progress */
let isScoring = false;

/** The interval timer */
let intervalId: NodeJS.Timeout | null = null;

/** Whether we're in the middle of shutting down */
let isShuttingDown = false;

/**
 * Start the scoring scheduler.
 * Runs immediately, then at SCORING_INTERVAL_MS intervals.
 */
export async function startScoring(): Promise<void> {
  if (isRunning) {
    logger.warn('Scoring scheduler already running');
    return;
  }

  isRunning = true;
  isShuttingDown = false;

  logger.info(
    { intervalMs: config.SCORING_INTERVAL_MS },
    'Starting scoring scheduler'
  );

  // Run immediately on start
  await runWithGuard();

  // Schedule recurring runs
  intervalId = setInterval(runWithGuard, config.SCORING_INTERVAL_MS);

  logger.info('Scoring scheduler started');
}

/**
 * Stop the scoring scheduler.
 * Waits for any in-progress scoring run to complete.
 */
export async function stopScoring(): Promise<void> {
  if (!isRunning) {
    return;
  }

  logger.info('Stopping scoring scheduler...');
  isShuttingDown = true;

  // Clear the interval
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }

  // Wait for any in-progress scoring to complete
  while (isScoring) {
    logger.info('Waiting for scoring run to complete...');
    await sleep(1000);
  }

  isRunning = false;
  logger.info('Scoring scheduler stopped');
}

/**
 * Run the scoring pipeline with guards against overlapping runs.
 */
async function runWithGuard(): Promise<void> {
  // Don't start if we're shutting down
  if (isShuttingDown) {
    return;
  }

  // Don't start if previous run is still going
  if (!acquireScoringLock()) {
    logger.warn('Skipping scoring run - previous run still in progress');
    return;
  }

  try {
    await runScoringPipeline();
  } catch (err) {
    // Log error but don't crash - next run will try again
    logger.error({ err }, 'Scoring pipeline failed');
  } finally {
    releaseScoringLock();
  }
}

/**
 * Try to trigger a manual scoring run without waiting for completion.
 * Returns false when a run is already in progress or scheduler is shutting down.
 */
export function tryTriggerManualScoringRun(): boolean {
  if (isShuttingDown) {
    logger.warn('Manual scoring run rejected - scheduler is shutting down');
    return false;
  }

  if (!acquireScoringLock()) {
    logger.warn('Manual scoring run rejected - scoring already in progress');
    return false;
  }

  logger.info('Manual scoring run triggered');

  void runScoringPipeline()
    .catch((err) => {
      logger.error({ err }, 'Manual scoring pipeline failed');
    })
    .finally(() => {
      releaseScoringLock();
    });

  return true;
}

/**
 * Manually trigger a scoring run and wait for completion.
 * Respects the same guards as scheduled runs.
 */
export async function triggerManualRun(): Promise<void> {
  logger.info('Manual scoring run triggered');
  await runWithGuard();
}

/**
 * Check if the scheduler is running.
 */
export function isSchedulerRunning(): boolean {
  return isRunning;
}

/**
 * Check if a scoring run is in progress.
 */
export function isScoringInProgress(): boolean {
  return isScoring;
}

/**
 * Sleep for a given number of milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function acquireScoringLock(): boolean {
  if (isScoring) {
    return false;
  }

  isScoring = true;
  return true;
}

function releaseScoringLock(): void {
  isScoring = false;
}
