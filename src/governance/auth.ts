/**
 * Governance Authentication Module
 *
 * Handles authentication for governance actions using Bluesky's createSession API.
 * Users authenticate with their Bluesky handle and app password.
 *
 * For the feed skeleton, we just decode the JWT from Bluesky's AppView.
 * For governance voting, we need stronger auth - verifying the user controls the DID.
 */

import { FastifyRequest } from 'fastify';
import { AtpAgent } from '@atproto/api';
import { logger } from '../lib/logger.js';
import { SessionInfo } from './governance.types.js';

// In-memory session store (for MVP - use Redis in production)
const sessions = new Map<string, SessionInfo>();

// Session expiration time (24 hours)
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Authenticate a user with Bluesky using handle + app password.
 * This proves the user controls the DID.
 *
 * @param handle - Bluesky handle (e.g., "user.bsky.social")
 * @param appPassword - App-specific password from Bluesky settings
 * @returns Session info if successful, null if authentication fails
 */
export async function authenticateWithBluesky(
  handle: string,
  appPassword: string
): Promise<SessionInfo | null> {
  try {
    const agent = new AtpAgent({ service: 'https://bsky.social' });

    const response = await agent.login({
      identifier: handle,
      password: appPassword,
    });

    if (!response.success || !response.data.did) {
      logger.warn({ handle }, 'Bluesky authentication failed');
      return null;
    }

    const sessionInfo: SessionInfo = {
      did: response.data.did,
      handle: response.data.handle,
      accessJwt: response.data.accessJwt,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    };

    // Store session by access token
    sessions.set(response.data.accessJwt, sessionInfo);

    logger.info({ did: response.data.did, handle }, 'User authenticated');

    return sessionInfo;
  } catch (err) {
    logger.error({ err, handle }, 'Bluesky authentication error');
    return null;
  }
}

/**
 * Get the authenticated DID from the request.
 * Checks for a session token in the Authorization header.
 *
 * @param request - Fastify request
 * @returns The user's DID if authenticated, null otherwise
 */
export function getAuthenticatedDid(request: FastifyRequest): string | null {
  const authHeader = request.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  const token = authHeader.slice('Bearer '.length);
  const session = sessions.get(token);

  if (!session) {
    return null;
  }

  // Check if session expired
  if (session.expiresAt < new Date()) {
    sessions.delete(token);
    return null;
  }

  return session.did;
}

/**
 * Get full session info from the request.
 *
 * @param request - Fastify request
 * @returns Session info if authenticated, null otherwise
 */
export function getSession(request: FastifyRequest): SessionInfo | null {
  const authHeader = request.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  const token = authHeader.slice('Bearer '.length);
  const session = sessions.get(token);

  if (!session) {
    return null;
  }

  // Check if session expired
  if (session.expiresAt < new Date()) {
    sessions.delete(token);
    return null;
  }

  return session;
}

/**
 * Invalidate a session (logout).
 *
 * @param token - The session token to invalidate
 */
export function invalidateSession(token: string): void {
  sessions.delete(token);
}

/**
 * Clean up expired sessions.
 * Call this periodically to prevent memory leaks.
 */
export function cleanupExpiredSessions(): void {
  const now = new Date();
  let cleaned = 0;

  for (const [token, session] of sessions.entries()) {
    if (session.expiresAt < now) {
      sessions.delete(token);
      cleaned++;
    }
  }

  if (cleaned > 0) {
    logger.debug({ cleaned }, 'Cleaned up expired sessions');
  }
}

// Clean up expired sessions every hour
setInterval(cleanupExpiredSessions, 60 * 60 * 1000);
