/**
 * Jetstream Event Types
 *
 * Jetstream is a lightweight JSON proxy for the AT Protocol firehose.
 * It provides ~1/10th the bandwidth of the raw firehose with pre-parsed events.
 */

export interface JetstreamEvent {
  did: string; // DID of the actor
  time_us: number; // Microsecond timestamp (use as cursor)
  kind: 'commit' | 'identity' | 'account';
  commit?: JetstreamCommit;
}

export interface JetstreamCommit {
  rev: string; // Revision
  operation: 'create' | 'update' | 'delete';
  collection: string; // e.g., 'app.bsky.feed.post'
  rkey: string; // Record key
  record?: Record<string, unknown>; // The actual record (absent on delete)
  cid?: string; // Content hash
}

/**
 * Build an AT-URI from event components.
 * Format: at://{did}/{collection}/{rkey}
 */
export function buildAtUri(did: string, collection: string, rkey: string): string {
  return `at://${did}/${collection}/${rkey}`;
}

// Collection constants
export const COLLECTIONS = {
  POST: 'app.bsky.feed.post',
  LIKE: 'app.bsky.feed.like',
  REPOST: 'app.bsky.feed.repost',
  FOLLOW: 'app.bsky.graph.follow',
} as const;

export type CollectionType = (typeof COLLECTIONS)[keyof typeof COLLECTIONS];
