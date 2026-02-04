/**
 * Event Processor
 *
 * Routes Jetstream events to the appropriate handlers.
 * Deletions are handled for ALL collection types.
 */

import { JetstreamEvent, buildAtUri, COLLECTIONS } from './jetstream.types.js';
import { handlePost } from './handlers/post-handler.js';
import { handleLike } from './handlers/like-handler.js';
import { handleRepost } from './handlers/repost-handler.js';
import { handleFollow } from './handlers/follow-handler.js';
import { handleDelete } from './handlers/delete-handler.js';
import { logger } from '../lib/logger.js';

export async function processEvent(event: JetstreamEvent): Promise<void> {
  // Only process commit events
  if (event.kind !== 'commit' || !event.commit) {
    return;
  }

  const { commit, did } = event;
  const uri = buildAtUri(did, commit.collection, commit.rkey);

  // CRITICAL: Handle deletions for ALL collection types FIRST
  if (commit.operation === 'delete') {
    await handleDelete(uri, commit.collection);
    return;
  }

  // Only process creates (skip updates for now - they're rare and complex)
  if (commit.operation !== 'create') {
    return;
  }

  // Route to appropriate handler based on collection
  switch (commit.collection) {
    case COLLECTIONS.POST:
      if (!commit.cid || !commit.record) {
        logger.warn({ uri }, 'Post missing cid or record');
        return;
      }
      await handlePost(uri, did, commit.cid, commit.record);
      break;

    case COLLECTIONS.LIKE:
      if (!commit.record) {
        logger.warn({ uri }, 'Like missing record');
        return;
      }
      await handleLike(uri, did, commit.record);
      break;

    case COLLECTIONS.REPOST:
      if (!commit.record) {
        logger.warn({ uri }, 'Repost missing record');
        return;
      }
      await handleRepost(uri, did, commit.record);
      break;

    case COLLECTIONS.FOLLOW:
      if (!commit.record) {
        logger.warn({ uri }, 'Follow missing record');
        return;
      }
      await handleFollow(uri, did, commit.record);
      break;

    default:
      // Ignore other collections
      break;
  }
}
