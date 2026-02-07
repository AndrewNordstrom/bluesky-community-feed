/**
 * Status Tracker
 *
 * Tracks system status like scoring run statistics.
 * Stores data in the system_status table for admin dashboard display.
 */

import { db } from '../db/client.js';

export interface ScoringStatus {
  timestamp: string | null;
  duration_ms: number | null;
  posts_scored: number;
  posts_filtered: number;
}

/**
 * Update the scoring status after a scoring run completes.
 */
export async function updateScoringStatus(status: ScoringStatus): Promise<void> {
  await db.query(
    `INSERT INTO system_status (key, value, updated_at)
     VALUES ('last_scoring_run', $1, NOW())
     ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
    [JSON.stringify(status)]
  );
}

/**
 * Get the current scoring status.
 */
export async function getScoringStatus(): Promise<ScoringStatus> {
  const result = await db.query(
    `SELECT value FROM system_status WHERE key = 'last_scoring_run'`
  );

  if (result.rows.length === 0) {
    return { timestamp: null, duration_ms: null, posts_scored: 0, posts_filtered: 0 };
  }

  return result.rows[0].value as ScoringStatus;
}
