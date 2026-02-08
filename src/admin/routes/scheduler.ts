/**
 * Admin Scheduler Routes
 *
 * GET /api/admin/scheduler/status - Get scheduler status
 * POST /api/admin/scheduler/check - Manually trigger scheduler check
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { db } from '../../db/client.js';
import { getAdminDid } from '../../auth/admin.js';
import { runSchedulerCheck, getSchedulerStatus } from '../../scheduler/epoch-scheduler.js';
import { logger } from '../../lib/logger.js';

export function registerSchedulerRoutes(app: FastifyInstance): void {
  /**
   * GET /api/admin/scheduler/status
   * Get scheduler status and pending transitions
   */
  app.get('/scheduler/status', async (_request: FastifyRequest, reply: FastifyReply) => {
    const status = getSchedulerStatus();

    // Get epochs that would be transitioned on next check
    const pendingResult = await db.query(`
      SELECT id, voting_ends_at, auto_transition
      FROM governance_epochs
      WHERE status = 'active'
        AND phase = 'voting'
        AND voting_ends_at IS NOT NULL
        AND auto_transition = true
    `);

    const pending = pendingResult.rows.map((row) => ({
      epochId: row.id,
      votingEndsAt: row.voting_ends_at,
      autoTransition: row.auto_transition,
      readyForTransition: new Date(row.voting_ends_at) <= new Date(),
    }));

    return reply.send({
      scheduler: status,
      pendingTransitions: pending,
    });
  });

  /**
   * POST /api/admin/scheduler/check
   * Manually trigger scheduler check
   */
  app.post('/scheduler/check', async (request: FastifyRequest, reply: FastifyReply) => {
    const adminDid = getAdminDid(request);

    logger.info({ adminDid }, 'Manual scheduler check triggered by admin');

    // Log to audit
    await db.query(
      `INSERT INTO governance_audit_log (action, actor_did, details)
       VALUES ('manual_scheduler_check', $1, $2)`,
      [adminDid, JSON.stringify({ triggeredAt: new Date().toISOString() })]
    );

    const result = await runSchedulerCheck();

    return reply.send({
      success: result.checked,
      transitioned: result.transitioned,
      errors: result.errors,
    });
  });
}
