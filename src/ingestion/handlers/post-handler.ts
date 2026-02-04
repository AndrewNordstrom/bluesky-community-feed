/**
 * Post Handler
 *
 * Handles new posts from Jetstream.
 * Uses UPSERT pattern to handle duplicates gracefully.
 */

import { db } from '../../db/client.js';
import { logger } from '../../lib/logger.js';

interface PostRecord {
  text?: string;
  langs?: string[];
  createdAt?: string;
  reply?: {
    root?: { uri: string };
    parent?: { uri: string };
  };
  embed?: {
    images?: unknown[];
    video?: unknown;
  };
}

export async function handlePost(
  uri: string,
  authorDid: string,
  cid: string,
  record: Record<string, unknown>
): Promise<void> {
  const postRecord = record as PostRecord;

  const text = postRecord.text ?? null;
  const langs = postRecord.langs ?? [];
  const createdAt = postRecord.createdAt ?? new Date().toISOString();

  // Extract reply info
  const replyRoot = postRecord.reply?.root?.uri ?? null;
  const replyParent = postRecord.reply?.parent?.uri ?? null;

  // Check for media
  const hasMedia = !!(postRecord.embed?.images?.length || postRecord.embed?.video);

  try {
    // UPSERT post - ON CONFLICT DO NOTHING handles duplicates
    await db.query(
      `INSERT INTO posts (uri, cid, author_did, text, reply_root, reply_parent, langs, has_media, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (uri) DO NOTHING`,
      [uri, cid, authorDid, text, replyRoot, replyParent, langs, hasMedia, createdAt]
    );

    // Initialize engagement counters - UPSERT pattern
    await db.query(
      `INSERT INTO post_engagement (post_uri) VALUES ($1) ON CONFLICT DO NOTHING`,
      [uri]
    );

    // If this is a reply, increment reply count on the root post
    if (replyRoot) {
      await db.query(
        `UPDATE post_engagement SET reply_count = reply_count + 1, updated_at = NOW()
         WHERE post_uri = $1`,
        [replyRoot]
      );
    }

    logger.debug({ uri, authorDid }, 'Post indexed');
  } catch (err) {
    logger.error({ err, uri }, 'Failed to insert post');
    // Don't rethrow - log and continue processing other events
  }
}
