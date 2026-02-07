/**
 * Epoch Scheduler
 *
 * Runs periodically to check for epochs that need auto-transition.
 * When an epoch has voting_ends_at in the past and auto_transition enabled,
 * it will automatically close the epoch and create a new one.
 */

import cron from 'node-cron';
import { db } from '../db/client.js';
import { forceEpochTransition } from '../governance/epoch-manager.js';
import { logger } from '../lib/logger.js';

let schedulerTask: cron.ScheduledTask | null = null;

/**
 * Start the epoch scheduler.
 * Runs every 5 minutes to check for epochs that need auto-transition.
 */
export function startEpochScheduler(): void {
  if (schedulerTask) {
    logger.warn('Epoch scheduler already running');
    return;
  }

  // Run at minute 0, 5, 10, 15... of every hour (every 5 minutes)
  schedulerTask = cron.schedule('*/5 * * * *', async () => {
    logger.debug('Epoch scheduler running');
    await checkScheduledTransitions();
  });

  logger.info('Epoch scheduler started (runs every 5 minutes)');

  // Also run immediately on startup to catch any missed transitions
  checkScheduledTransitions().catch((err) => {
    logger.error({ err }, 'Initial scheduler check failed');
  });
}

/**
 * Stop the epoch scheduler.
 */
export function stopEpochScheduler(): void {
  if (schedulerTask) {
    schedulerTask.stop();
    schedulerTask = null;
    logger.info('Epoch scheduler stopped');
  }
}

/**
 * Check for epochs that need auto-transition.
 */
async function checkScheduledTransitions(): Promise<void> {
  try {
    // Find epochs where:
    // - status is 'active'
    // - voting_ends_at has passed
    // - auto_transition is enabled
    const result = await db.query(`
      SELECT id, voting_ends_at
      FROM governance_epochs
      WHERE status = 'active'
        AND voting_ends_at IS NOT NULL
        AND voting_ends_at <= NOW()
        AND auto_transition = true
    `);

    if (result.rows.length === 0) {
      logger.debug('No epochs ready for auto-transition');
      return;
    }

    for (const epoch of result.rows) {
      logger.info(
        { epochId: epoch.id, votingEndsAt: epoch.voting_ends_at },
        'Auto-transitioning epoch'
      );

      try {
        // Get vote count for logging
        const voteResult = await db.query(
          `SELECT COUNT(*) as count FROM governance_votes WHERE epoch_id = $1`,
          [epoch.id]
        );
        const voteCount = parseInt(voteResult.rows[0].count, 10);

        // Force transition (skips vote count check for scheduled transitions)
        const newEpochId = await forceEpochTransition();

        // Log to audit
        await db.query(
          `INSERT INTO governance_audit_log (action, epoch_id, details)
           VALUES ('auto_epoch_transition', $1, $2)`,
          [
            epoch.id,
            JSON.stringify({
              fromEpoch: epoch.id,
              toEpoch: newEpochId,
              trigger: 'scheduled',
              votingEndsAt: epoch.voting_ends_at,
              voteCount,
            }),
          ]
        );

        logger.info(
          { fromEpoch: epoch.id, toEpoch: newEpochId, voteCount },
          'Auto-transition completed'
        );
      } catch (err) {
        logger.error({ epochId: epoch.id, err }, 'Auto-transition failed for epoch');

        // Log failure to audit
        await db.query(
          `INSERT INTO governance_audit_log (action, epoch_id, details)
           VALUES ('auto_epoch_transition_failed', $1, $2)`,
          [epoch.id, JSON.stringify({ error: String(err) })]
        );
      }
    }
  } catch (err) {
    logger.error({ err }, 'Scheduler check failed');
  }
}

/**
 * Manually trigger a scheduler check (for testing/admin use).
 */
export async function runSchedulerCheck(): Promise<{
  checked: boolean;
  transitioned: number;
  errors: number;
}> {
  let transitioned = 0;
  let errors = 0;

  try {
    const result = await db.query(`
      SELECT id, voting_ends_at
      FROM governance_epochs
      WHERE status = 'active'
        AND voting_ends_at IS NOT NULL
        AND voting_ends_at <= NOW()
        AND auto_transition = true
    `);

    for (const epoch of result.rows) {
      try {
        await forceEpochTransition();
        transitioned++;

        await db.query(
          `INSERT INTO governance_audit_log (action, epoch_id, details)
           VALUES ('auto_epoch_transition', $1, $2)`,
          [
            epoch.id,
            JSON.stringify({
              fromEpoch: epoch.id,
              trigger: 'manual_scheduler_check',
              votingEndsAt: epoch.voting_ends_at,
            }),
          ]
        );
      } catch {
        errors++;
      }
    }

    return { checked: true, transitioned, errors };
  } catch {
    return { checked: false, transitioned: 0, errors: 1 };
  }
}

/**
 * Get scheduler status.
 */
export function getSchedulerStatus(): { running: boolean; schedule: string } {
  return {
    running: schedulerTask !== null,
    schedule: 'Every 5 minutes (*/5 * * * *)',
  };
}
