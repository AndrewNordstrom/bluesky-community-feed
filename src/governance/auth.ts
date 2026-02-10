/**
 * Governance Authentication Module
 *
 * Handles authentication for governance actions using Bluesky's createSession API.
 * Users authenticate with their Bluesky handle and app password.
 */

import { FastifyRequest } from 'fastify';
import { AtpAgent } from '@atproto/api';
import { randomBytes } from 'crypto';
import { logger } from '../lib/logger.js';
import { SessionInfo } from './governance.types.js';
import { deleteSession, getSessionByToken, saveSession } from './session-store.js';
import { config } from '../config.js';

// Session expiration time (24 hours)
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

export class SessionStoreUnavailableError extends Error {
  constructor(message = 'Session store unavailable') {
    super(message);
    this.name = 'SessionStoreUnavailableError';
  }
}

function parseCookieHeader(cookieHeader: string | undefined): Record<string, string> {
  if (!cookieHeader) {
    return {};
  }

  return cookieHeader
    .split(';')
    .map((segment) => segment.trim())
    .filter(Boolean)
    .reduce<Record<string, string>>((acc, segment) => {
      const separatorIndex = segment.indexOf('=');
      if (separatorIndex <= 0) {
        return acc;
      }

      const key = segment.slice(0, separatorIndex).trim();
      const rawValue = segment.slice(separatorIndex + 1).trim();
      if (!key) {
        return acc;
      }

      try {
        acc[key] = decodeURIComponent(rawValue);
      } catch {
        acc[key] = rawValue;
      }

      return acc;
    }, {});
}

export function extractBearerToken(request: FastifyRequest): string | null {
  const authHeader = request.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  const token = authHeader.slice('Bearer '.length).trim();
  return token.length > 0 ? token : null;
}

export function extractSessionToken(request: FastifyRequest): string | null {
  const cookies = parseCookieHeader(request.headers.cookie);
  const cookieToken = cookies[config.GOVERNANCE_SESSION_COOKIE_NAME];
  if (cookieToken && cookieToken.length > 0) {
    return cookieToken;
  }

  return extractBearerToken(request);
}

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

    const sessionToken = randomBytes(32).toString('base64url');
    const sessionInfo: SessionInfo = {
      did: response.data.did,
      handle: response.data.handle,
      accessJwt: sessionToken,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    };

    try {
      await saveSession(sessionToken, sessionInfo);
    } catch (err) {
      logger.error({ err, did: sessionInfo.did }, 'Failed to persist session in Redis');
      throw new SessionStoreUnavailableError();
    }

    logger.info({ did: response.data.did, handle }, 'User authenticated');

    return sessionInfo;
  } catch (err) {
    if (err instanceof SessionStoreUnavailableError) {
      throw err;
    }
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
export async function getAuthenticatedDid(request: FastifyRequest): Promise<string | null> {
  const session = await getSession(request);
  return session?.did ?? null;
}

/**
 * Get full session info from the request.
 *
 * @param request - Fastify request
 * @returns Session info if authenticated, null otherwise
 */
export async function getSession(request: FastifyRequest): Promise<SessionInfo | null> {
  const token = extractSessionToken(request);
  if (!token) {
    return null;
  }

  try {
    return await getSessionByToken(token);
  } catch (err) {
    logger.error({ err }, 'Failed to read session from Redis');
    throw new SessionStoreUnavailableError();
  }
}

/**
 * Invalidate a session (logout).
 *
 * @param token - The session token to invalidate
 */
export async function invalidateSession(token: string): Promise<void> {
  try {
    await deleteSession(token);
  } catch (err) {
    logger.error({ err }, 'Failed to delete session from Redis');
    throw new SessionStoreUnavailableError();
  }
}
