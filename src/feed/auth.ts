/**
 * Feed Auth Module
 *
 * Handles authentication for feed requests.
 * Verifies the requester DID from the JWT in the Authorization header.
 *
 * This is used for:
 * - Subscriber tracking (fire-and-forget upsert)
 * - Future personalization features
 *
 * NOTE: Feed requests are public. JWT verification failures should
 * never fail the request. We treat invalid tokens as anonymous.
 */

import { FastifyRequest } from 'fastify';
import { logger } from '../lib/logger.js';
import { verifyRequesterJwt } from './jwt-verifier.js';

/**
 * Verify the requester DID and return it.
 *
 * @param request - The Fastify request object
 * @returns The requester's DID, or null if not authenticated
 */
export async function verifyRequesterDid(request: FastifyRequest): Promise<string | null> {
  const authHeader = request.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  const token = authHeader.slice('Bearer '.length);
  const result = await verifyRequesterJwt(token);
  if (result.did === null) {
    logger.warn({ reason: result.reason }, 'Rejected requester JWT for feed request');
    return null;
  }

  return result.did;
}
