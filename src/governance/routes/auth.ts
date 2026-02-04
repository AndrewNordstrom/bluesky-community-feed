/**
 * Auth Route
 *
 * POST /api/governance/auth/login - Authenticate with Bluesky
 * GET /api/governance/auth/session - Get current session info
 * POST /api/governance/auth/logout - Logout and invalidate session
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { authenticateWithBluesky, getSession, invalidateSession } from '../auth.js';
import { logger } from '../../lib/logger.js';

const LoginSchema = z.object({
  handle: z.string().min(1, 'Handle is required'),
  appPassword: z.string().min(1, 'App password is required'),
});

export function registerAuthRoute(app: FastifyInstance): void {
  /**
   * POST /api/governance/auth/login
   * Authenticate with Bluesky using handle + app password.
   * Returns session token for subsequent authenticated requests.
   */
  app.post('/api/governance/auth/login', async (request: FastifyRequest, reply: FastifyReply) => {
    const parseResult = LoginSchema.safeParse(request.body);

    if (!parseResult.success) {
      return reply.code(400).send({
        error: 'ValidationError',
        message: 'Invalid request body',
        details: parseResult.error.issues,
      });
    }

    const { handle, appPassword } = parseResult.data;

    try {
      const session = await authenticateWithBluesky(handle, appPassword);

      if (!session) {
        return reply.code(401).send({
          error: 'AuthenticationFailed',
          message: 'Invalid handle or app password. Make sure you are using an app password from Bluesky settings.',
        });
      }

      logger.info({ did: session.did, handle: session.handle }, 'User logged in');

      return reply.send({
        success: true,
        did: session.did,
        handle: session.handle,
        accessJwt: session.accessJwt,
        expiresAt: session.expiresAt.toISOString(),
      });
    } catch (err) {
      logger.error({ err, handle }, 'Login error');
      return reply.code(500).send({
        error: 'InternalError',
        message: 'An error occurred during authentication',
      });
    }
  });

  /**
   * GET /api/governance/auth/session
   * Get current session info if authenticated.
   */
  app.get('/api/governance/auth/session', async (request: FastifyRequest, reply: FastifyReply) => {
    const session = getSession(request);

    if (!session) {
      return reply.code(401).send({
        error: 'NotAuthenticated',
        message: 'No valid session found',
      });
    }

    return reply.send({
      authenticated: true,
      did: session.did,
      handle: session.handle,
      expiresAt: session.expiresAt.toISOString(),
    });
  });

  /**
   * POST /api/governance/auth/logout
   * Invalidate the current session.
   */
  app.post('/api/governance/auth/logout', async (request: FastifyRequest, reply: FastifyReply) => {
    const authHeader = request.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return reply.send({ success: true, message: 'No session to invalidate' });
    }

    const token = authHeader.slice('Bearer '.length);
    invalidateSession(token);

    logger.info('User logged out');

    return reply.send({ success: true, message: 'Session invalidated' });
  });
}
