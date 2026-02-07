/**
 * Admin Auth Helper
 *
 * Provides admin authentication utilities for the admin dashboard.
 * Checks if users are in the BOT_ADMIN_DIDS list.
 */

import { FastifyRequest, FastifyReply } from 'fastify';
import { getSession } from '../governance/auth.js';
import { logger } from '../lib/logger.js';
import { config } from '../config.js';

/**
 * Check if a DID is in the admin list.
 */
export function isAdmin(did: string): boolean {
  const adminDids =
    config.BOT_ADMIN_DIDS?.split(',')
      .map((d) => d.trim())
      .filter(Boolean) || [];
  return adminDids.includes(did);
}

/**
 * Get the current user's DID from session, or null if not logged in.
 */
export function getCurrentUserDid(request: FastifyRequest): string | null {
  const session = getSession(request);
  return session?.did || null;
}

/**
 * Fastify preHandler hook that requires admin access.
 * Returns 401 if not logged in, 403 if not admin.
 */
export async function requireAdmin(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const did = getCurrentUserDid(request);

  if (!did) {
    logger.warn({ path: request.url }, 'Admin access attempted without login');
    return reply.status(401).send({ error: 'Authentication required' });
  }

  if (!isAdmin(did)) {
    logger.warn({ did, path: request.url }, 'Admin access attempted by non-admin');
    return reply.status(403).send({ error: 'Admin access required' });
  }

  // Attach admin DID to request for later use
  (request as any).adminDid = did;
}

/**
 * Get admin DID from request (after requireAdmin has run).
 */
export function getAdminDid(request: FastifyRequest): string {
  return (request as any).adminDid;
}
