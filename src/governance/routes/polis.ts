/**
 * Polis Route (Placeholder)
 *
 * Placeholder for future Polis integration.
 * Polis provides deliberation infrastructure for gathering nuanced community input.
 *
 * Future integration points:
 * - GET /api/governance/polis - Get Polis conversation info
 * - POST /api/governance/polis/sync - Sync Polis results to governance system
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { config } from '../../config.js';

export function registerPolisRoute(app: FastifyInstance): void {
  /**
   * GET /api/governance/polis
   * Returns Polis conversation info if configured.
   * Currently a placeholder for future integration.
   */
  app.get('/api/governance/polis', async (_request: FastifyRequest, reply: FastifyReply) => {
    // Check if Polis is configured
    const polisConversationId = process.env.POLIS_CONVERSATION_ID;

    if (!polisConversationId) {
      return reply.send({
        enabled: false,
        message: 'Polis integration is not configured. Set POLIS_CONVERSATION_ID to enable.',
        documentation: 'https://pol.is/docs',
      });
    }

    return reply.send({
      enabled: true,
      conversationId: polisConversationId,
      embedUrl: `https://pol.is/${polisConversationId}`,
      description: 'Polis deliberation for feed governance. Participate in discussions about how the feed algorithm should work.',
      status: 'placeholder',
      message: 'Full Polis integration coming in a future release.',
    });
  });

  /**
   * GET /api/governance/polis/status
   * Check Polis integration status.
   */
  app.get('/api/governance/polis/status', async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.send({
      integration: 'planned',
      features: [
        {
          name: 'deliberation_embedding',
          status: 'not_implemented',
          description: 'Embed Polis conversations in the governance UI',
        },
        {
          name: 'opinion_groups',
          status: 'not_implemented',
          description: 'Show opinion group clustering from Polis',
        },
        {
          name: 'consensus_detection',
          status: 'not_implemented',
          description: 'Identify areas of consensus for weight recommendations',
        },
        {
          name: 'vote_influence',
          status: 'not_implemented',
          description: 'Use Polis results to inform governance voting',
        },
      ],
    });
  });
}
