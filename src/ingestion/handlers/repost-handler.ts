/**
 * Repost Handler
 *
 * Handles reposts from Jetstream.
 * Stores the repost record and increments engagement counter.
 */

import { db } from '../../db/client.js';
import { logger } from '../../lib/logger.js';

interface RepostRecord {
  subject?: {
    uri: string;
    cid?: string;
  };
  createdAt?: string;
}

export async function handleRepost(
  uri: string,
  authorDid: string,
  record: Record<string, unknown>
): Promise<void> {
  const repostRecord = record as RepostRecord;

  const subjectUri = repostRecord.subject?.uri;
  if (!subjectUri) {
    logger.warn({ uri }, 'Repost missing subject URI');
    return;
  }

  const createdAt = repostRecord.createdAt ?? new Date().toISOString();

  try {
    // UPSERT repost record
    const result = await db.query(
      `INSERT INTO reposts (uri, author_did, subject_uri, created_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (uri) DO NOTHING
       RETURNING uri`,
      [uri, authorDid, subjectUri, createdAt]
    );

    // Only increment counter if this was a new insert (not a duplicate)
    if (result.rowCount && result.rowCount > 0) {
      await db.query(
        `UPDATE post_engagement SET repost_count = repost_count + 1, updated_at = NOW()
         WHERE post_uri = $1`,
        [subjectUri]
      );
    }

    logger.debug({ uri, subjectUri }, 'Repost indexed');
  } catch (err) {
    logger.error({ err, uri }, 'Failed to insert repost');
    // Don't rethrow - log and continue processing other events
  }
}
