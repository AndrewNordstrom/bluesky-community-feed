/**
 * Poster Module
 *
 * Core logic for posting announcements to Bluesky.
 * Stores announcements in PostgreSQL and pins to Redis.
 */

import { config } from '../config.js';
import { db } from '../db/client.js';
import { redis } from '../db/redis.js';
import { logger } from '../lib/logger.js';
import { getBotAgent, isBotEnabled } from './agent.js';
import { generateAnnouncementText } from './announcements.js';
import type { Announcement, AnnouncementPayload, PinnedAnnouncement } from './bot.types.js';

// Redis key for pinned announcement
const PINNED_KEY = 'bot:latest_announcement';

/**
 * Post an announcement to Bluesky.
 *
 * @param payload - The announcement payload
 * @returns The stored announcement record, or null if bot is disabled
 */
export async function postAnnouncement(payload: AnnouncementPayload): Promise<Announcement | null> {
  // 1. Check if bot is enabled
  if (!isBotEnabled()) {
    logger.debug('Bot disabled, skipping announcement');
    return null;
  }

  // 2. Generate announcement text
  const text = generateAnnouncementText(payload);
  logger.debug({ type: payload.type, textLength: text.length }, 'Generated announcement text');

  // 3. Get authenticated agent
  const agent = await getBotAgent();

  // 4. Post to Bluesky
  const response = await agent.post({ text });

  if (!response.uri || !response.cid) {
    throw new Error('Post response missing uri or cid');
  }

  logger.info({ uri: response.uri, type: payload.type }, 'Posted announcement to Bluesky');

  // 5. Determine epoch ID
  let epochId: number | null = null;
  if (payload.type === 'voting_opened') {
    epochId = payload.epochId;
  } else if (payload.type === 'epoch_transition') {
    epochId = payload.newEpochId;
  }

  // 6. Store in PostgreSQL
  const result = await db.query(
    `INSERT INTO bot_announcements (uri, cid, type, epoch_id, content)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, uri, cid, type, epoch_id, content, created_at, deleted`,
    [response.uri, response.cid, payload.type, epochId, text]
  );

  const row = result.rows[0];
  const announcement: Announcement = {
    id: row.id,
    uri: row.uri,
    cid: row.cid,
    type: row.type,
    epochId: row.epoch_id,
    content: row.content,
    createdAt: row.created_at,
    deleted: row.deleted,
  };

  // 7. Pin to Redis
  const pinned: PinnedAnnouncement = {
    uri: response.uri,
    type: payload.type,
    createdAt: new Date().toISOString(),
  };

  const ttlSeconds = config.BOT_PIN_TTL_HOURS * 3600;
  await redis.setex(PINNED_KEY, ttlSeconds, JSON.stringify(pinned));

  logger.info(
    { announcementId: announcement.id, uri: announcement.uri, ttlHours: config.BOT_PIN_TTL_HOURS },
    'Announcement pinned to feed'
  );

  // 8. Log to audit trail
  await db.query(
    `INSERT INTO governance_audit_log (action, details)
     VALUES ('announcement_posted', $1)`,
    [
      JSON.stringify({
        announcement_id: announcement.id,
        uri: announcement.uri,
        type: announcement.type,
        epoch_id: announcement.epochId,
      }),
    ]
  );

  return announcement;
}

/**
 * Get the current pinned announcement.
 */
export async function getPinnedAnnouncement(): Promise<PinnedAnnouncement | null> {
  const data = await redis.get(PINNED_KEY);
  if (!data) {
    return null;
  }

  try {
    return JSON.parse(data) as PinnedAnnouncement;
  } catch {
    logger.warn('Failed to parse pinned announcement from Redis');
    return null;
  }
}

/**
 * Unpin the current announcement.
 */
export async function unpinAnnouncement(): Promise<boolean> {
  const result = await redis.del(PINNED_KEY);
  if (result > 0) {
    logger.info('Announcement unpinned');
    return true;
  }
  return false;
}

/**
 * Get recent announcements from the database.
 */
export async function getRecentAnnouncements(limit: number = 10): Promise<Announcement[]> {
  const result = await db.query(
    `SELECT id, uri, cid, type, epoch_id, content, created_at, deleted
     FROM bot_announcements
     WHERE deleted = FALSE
     ORDER BY created_at DESC
     LIMIT $1`,
    [limit]
  );

  return result.rows.map((row) => ({
    id: row.id,
    uri: row.uri,
    cid: row.cid,
    type: row.type,
    epochId: row.epoch_id,
    content: row.content,
    createdAt: row.created_at,
    deleted: row.deleted,
  }));
}
