/**
 * Follow Handler
 *
 * Handles follow events from Jetstream.
 * Stores the follow relationship in the social graph.
 */

import { db } from '../../db/client.js';
import { logger } from '../../lib/logger.js';

interface FollowRecord {
  subject?: string; // The DID being followed
  createdAt?: string;
}

export async function handleFollow(
  uri: string,
  authorDid: string,
  record: Record<string, unknown>
): Promise<void> {
  const followRecord = record as FollowRecord;

  const subjectDid = followRecord.subject;
  if (!subjectDid) {
    logger.warn({ uri }, 'Follow missing subject DID');
    return;
  }

  const createdAt = followRecord.createdAt ?? new Date().toISOString();

  try {
    // UPSERT follow relationship
    await db.query(
      `INSERT INTO follows (uri, author_did, subject_did, created_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (uri) DO NOTHING`,
      [uri, authorDid, subjectDid, createdAt]
    );

    logger.debug({ uri, authorDid, subjectDid }, 'Follow indexed');
  } catch (err) {
    logger.error({ err, uri }, 'Failed to insert follow');
    // Don't rethrow - log and continue processing other events
  }
}
