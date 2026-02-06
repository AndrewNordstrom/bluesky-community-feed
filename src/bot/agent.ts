/**
 * Bot Agent
 *
 * BskyAgent wrapper with on-demand session management.
 * Sessions are cached in memory and backed up to Redis for persistence.
 */

import { BskyAgent } from '@atproto/api';
import { config } from '../config.js';
import { redis } from '../db/redis.js';
import { logger } from '../lib/logger.js';
import type { BotSession } from './bot.types.js';

// In-memory session cache
let cachedSession: BotSession | null = null;
let cachedAgent: BskyAgent | null = null;

// Redis key for session backup
const SESSION_KEY = 'bot:session';
const SESSION_TTL = 86400; // 24 hours

/**
 * Check if the bot is enabled.
 */
export function isBotEnabled(): boolean {
  return config.BOT_ENABLED && !!config.BOT_HANDLE && !!config.BOT_APP_PASSWORD;
}

/**
 * Get the bot's DID (if authenticated).
 */
export function getBotDid(): string | null {
  return cachedSession?.did ?? null;
}

/**
 * Get an authenticated BskyAgent for the bot.
 * Creates a new session if none exists or if expired.
 */
export async function getBotAgent(): Promise<BskyAgent> {
  if (!isBotEnabled()) {
    throw new Error('Bot is not enabled. Set BOT_ENABLED=true with BOT_HANDLE and BOT_APP_PASSWORD.');
  }

  // Check if we have a valid cached session
  if (cachedAgent && cachedSession) {
    const expiresAt = new Date(cachedSession.expiresAt);
    if (expiresAt > new Date()) {
      return cachedAgent;
    }
    logger.debug('Bot session expired, refreshing');
  }

  // Try to restore from Redis
  if (!cachedSession) {
    const storedSession = await redis.get(SESSION_KEY);
    if (storedSession) {
      try {
        cachedSession = JSON.parse(storedSession);
        const expiresAt = new Date(cachedSession!.expiresAt);
        if (expiresAt > new Date()) {
          logger.debug('Restored bot session from Redis');
          cachedAgent = new BskyAgent({ service: 'https://bsky.social' });
          await cachedAgent.resumeSession({
            did: cachedSession!.did,
            handle: cachedSession!.handle,
            accessJwt: cachedSession!.accessJwt,
            refreshJwt: cachedSession!.refreshJwt,
            active: true,
          });
          return cachedAgent;
        }
      } catch (err) {
        logger.warn({ err }, 'Failed to restore bot session from Redis');
        cachedSession = null;
      }
    }
  }

  // Create new session
  logger.info({ handle: config.BOT_HANDLE }, 'Creating new bot session');
  const agent = new BskyAgent({ service: 'https://bsky.social' });

  const response = await agent.login({
    identifier: config.BOT_HANDLE!,
    password: config.BOT_APP_PASSWORD!,
  });

  if (!response.success) {
    throw new Error('Bot login failed');
  }

  // Cache session
  const session = agent.session;
  if (!session) {
    throw new Error('No session after login');
  }

  cachedSession = {
    did: session.did,
    handle: session.handle,
    accessJwt: session.accessJwt,
    refreshJwt: session.refreshJwt,
    expiresAt: new Date(Date.now() + SESSION_TTL * 1000).toISOString(),
  };
  cachedAgent = agent;

  // Backup to Redis
  await redis.setex(SESSION_KEY, SESSION_TTL, JSON.stringify(cachedSession));

  logger.info({ did: session.did, handle: session.handle }, 'Bot session created');
  return agent;
}

/**
 * Clear the cached session (for logout or error recovery).
 */
export async function clearBotSession(): Promise<void> {
  cachedSession = null;
  cachedAgent = null;
  await redis.del(SESSION_KEY);
  logger.info('Bot session cleared');
}

/**
 * Initialize the bot (called on startup).
 * Pre-authenticates if enabled for faster first announcement.
 */
export async function initializeBot(): Promise<void> {
  if (!isBotEnabled()) {
    logger.info('Bot is disabled, skipping initialization');
    return;
  }

  try {
    const agent = await getBotAgent();
    logger.info({ did: agent.session?.did }, 'Bot initialized successfully');
  } catch (err) {
    logger.warn({ err }, 'Bot initialization failed - will retry on first announcement');
  }
}
