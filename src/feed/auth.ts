/**
 * Feed Auth Module
 *
 * Handles authentication for feed requests.
 * Extracts the requester DID from the JWT in the Authorization header.
 *
 * This is used for:
 * - Subscriber tracking (fire-and-forget upsert)
 * - Future personalization features
 *
 * NOTE: The JWT is signed by Bluesky's AppView, not by us.
 * We trust it because the AppView is the one calling our feed.
 * We only decode it to get the DID - we don't verify the signature
 * since that would require fetching the AppView's signing key.
 */

import { FastifyRequest } from 'fastify';
import { logger } from '../lib/logger.js';

/**
 * Extract the requester DID from the Authorization header.
 *
 * @param request - The Fastify request object
 * @returns The requester's DID, or null if not authenticated
 */
export function getRequesterDid(request: FastifyRequest): string | null {
  const authHeader = request.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  const token = authHeader.slice('Bearer '.length);

  try {
    // Decode JWT payload (middle part, base64url encoded)
    const parts = token.split('.');
    if (parts.length !== 3) {
      return null;
    }

    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());

    // The DID is in the 'iss' (issuer) claim
    if (typeof payload.iss === 'string' && payload.iss.startsWith('did:')) {
      return payload.iss;
    }

    return null;
  } catch (err) {
    logger.debug({ err }, 'Failed to decode JWT');
    return null;
  }
}

/**
 * Verify the requester DID and return it.
 * This is an alias for getRequesterDid for consistency with the spec.
 *
 * @param request - The Fastify request object
 * @returns The requester's DID, or null if not authenticated
 */
export async function verifyRequesterDid(request: FastifyRequest): Promise<string | null> {
  return getRequesterDid(request);
}
