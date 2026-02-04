/**
 * Delete Handler
 *
 * CRITICAL: This handler must be wired up from day one.
 * Missing deletions = serving content the author removed = broken trust.
 *
 * All deletions are SOFT deletes (set deleted=TRUE, never hard delete).
 * This preserves referential integrity for engagement records.
 */

import { db } from '../../db/client.js';
import { logger } from '../../lib/logger.js';
import { COLLECTIONS } from '../jetstream.types.js';

export async function handleDelete(uri: string, collection: string): Promise<void> {
  try {
    switch (collection) {
      case COLLECTIONS.POST:
        await db.query(`UPDATE posts SET deleted = TRUE WHERE uri = $1`, [uri]);
        logger.debug({ uri }, 'Post marked as deleted');
        break;

      case COLLECTIONS.LIKE:
        // First get the subject URI so we can decrement the counter
        const likeResult = await db.query(`SELECT subject_uri FROM likes WHERE uri = $1`, [uri]);
        await db.query(`UPDATE likes SET deleted = TRUE WHERE uri = $1`, [uri]);

        if (likeResult.rows[0]?.subject_uri) {
          await db.query(
            `UPDATE post_engagement
             SET like_count = GREATEST(like_count - 1, 0), updated_at = NOW()
             WHERE post_uri = $1`,
            [likeResult.rows[0].subject_uri]
          );
        }
        logger.debug({ uri }, 'Like marked as deleted');
        break;

      case COLLECTIONS.REPOST:
        // First get the subject URI so we can decrement the counter
        const repostResult = await db.query(`SELECT subject_uri FROM reposts WHERE uri = $1`, [uri]);
        await db.query(`UPDATE reposts SET deleted = TRUE WHERE uri = $1`, [uri]);

        if (repostResult.rows[0]?.subject_uri) {
          await db.query(
            `UPDATE post_engagement
             SET repost_count = GREATEST(repost_count - 1, 0), updated_at = NOW()
             WHERE post_uri = $1`,
            [repostResult.rows[0].subject_uri]
          );
        }
        logger.debug({ uri }, 'Repost marked as deleted');
        break;

      case COLLECTIONS.FOLLOW:
        await db.query(`UPDATE follows SET deleted = TRUE WHERE uri = $1`, [uri]);
        logger.debug({ uri }, 'Follow marked as deleted');
        break;

      default:
        // Ignore deletions for collections we don't track
        break;
    }
  } catch (err) {
    logger.error({ err, uri, collection }, 'Failed to handle deletion');
    // Don't rethrow - log and continue processing other events
  }
}
