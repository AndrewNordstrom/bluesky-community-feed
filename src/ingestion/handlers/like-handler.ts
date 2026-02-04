/**
 * Like Handler
 *
 * Handles likes from Jetstream.
 * Stores the like record and increments engagement counter.
 */

import { db } from '../../db/client.js';
import { logger } from '../../lib/logger.js';

interface LikeRecord {
  subject?: {
    uri: string;
    cid?: string;
  };
  createdAt?: string;
}

export async function handleLike(
  uri: string,
  authorDid: string,
  record: Record<string, unknown>
): Promise<void> {
  const likeRecord = record as LikeRecord;

  const subjectUri = likeRecord.subject?.uri;
  if (!subjectUri) {
    logger.warn({ uri }, 'Like missing subject URI');
    return;
  }

  const createdAt = likeRecord.createdAt ?? new Date().toISOString();

  try {
    // UPSERT like record
    const result = await db.query(
      `INSERT INTO likes (uri, author_did, subject_uri, created_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (uri) DO NOTHING
       RETURNING uri`,
      [uri, authorDid, subjectUri, createdAt]
    );

    // Only increment counter if this was a new insert (not a duplicate)
    if (result.rowCount && result.rowCount > 0) {
      await db.query(
        `UPDATE post_engagement SET like_count = like_count + 1, updated_at = NOW()
         WHERE post_uri = $1`,
        [subjectUri]
      );
    }

    logger.debug({ uri, subjectUri }, 'Like indexed');
  } catch (err) {
    logger.error({ err, uri }, 'Failed to insert like');
    // Don't rethrow - log and continue processing other events
  }
}
