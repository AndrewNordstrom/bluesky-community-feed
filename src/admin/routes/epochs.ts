/**
 * Admin Epoch Routes
 *
 * Epoch management endpoints for admin dashboard:
 * - GET /epochs - List all epochs
 * - PATCH /epochs/current - Update current epoch settings
 * - POST /epochs/transition - Trigger epoch transition
 * - POST /epochs/close-voting - Close voting
 * - POST /epochs/open-voting - Open voting
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { db } from '../../db/client.js';
import { getAdminDid } from '../../auth/admin.js';
import { forceEpochTransition } from '../../governance/epoch-manager.js';
import { logger } from '../../lib/logger.js';

const UpdateEpochSchema = z.object({
  votingEndsAt: z.string().datetime().nullable().optional(),
  autoTransition: z.boolean().optional(),
});

const TransitionSchema = z.object({
  force: z.boolean().optional().default(false),
});

export function registerEpochRoutes(app: FastifyInstance): void {
  /**
   * GET /api/admin/epochs
   * List all epochs with details
   */
  app.get('/epochs', async (_request: FastifyRequest, reply: FastifyReply) => {
    const result = await db.query(`
      SELECT
        e.id,
        e.status,
        e.voting_ends_at,
        e.auto_transition,
        e.recency_weight,
        e.engagement_weight,
        e.bridging_weight,
        e.source_diversity_weight,
        e.relevance_weight,
        e.content_rules,
        e.created_at,
        e.closed_at,
        COUNT(v.id) as vote_count
      FROM governance_epochs e
      LEFT JOIN governance_votes v ON v.epoch_id = e.id
      GROUP BY e.id
      ORDER BY e.id DESC
      LIMIT 20
    `);

    return reply.send({
      epochs: result.rows.map((row) => ({
        id: row.id,
        status: row.status,
        votingEndsAt: row.voting_ends_at,
        autoTransition: row.auto_transition,
        weights: {
          recency: parseFloat(row.recency_weight),
          engagement: parseFloat(row.engagement_weight),
          bridging: parseFloat(row.bridging_weight),
          sourceDiversity: parseFloat(row.source_diversity_weight),
          relevance: parseFloat(row.relevance_weight),
        },
        contentRules: row.content_rules,
        voteCount: parseInt(row.vote_count, 10),
        createdAt: row.created_at,
        closedAt: row.closed_at,
      })),
    });
  });

  /**
   * PATCH /api/admin/epochs/current
   * Update current epoch settings
   */
  app.patch('/epochs/current', async (request: FastifyRequest, reply: FastifyReply) => {
    const adminDid = getAdminDid(request);
    const parseResult = UpdateEpochSchema.safeParse(request.body);

    if (!parseResult.success) {
      return reply.status(400).send({ error: 'Invalid request body', details: parseResult.error.issues });
    }

    const body = parseResult.data;

    // Get current epoch
    const current = await db.query(`
      SELECT id FROM governance_epochs WHERE status = 'active' LIMIT 1
    `);

    if (current.rows.length === 0) {
      return reply.status(404).send({ error: 'No active epoch found' });
    }

    const epochId = current.rows[0].id;
    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (body.votingEndsAt !== undefined) {
      // Validate future date if setting
      if (body.votingEndsAt && new Date(body.votingEndsAt) <= new Date()) {
        return reply.status(400).send({ error: 'Voting end date must be in the future' });
      }
      updates.push(`voting_ends_at = $${paramIndex++}`);
      values.push(body.votingEndsAt);
    }

    if (body.autoTransition !== undefined) {
      updates.push(`auto_transition = $${paramIndex++}`);
      values.push(body.autoTransition);
    }

    if (updates.length === 0) {
      return reply.status(400).send({ error: 'No updates provided' });
    }

    values.push(epochId);

    const result = await db.query(
      `UPDATE governance_epochs
       SET ${updates.join(', ')}
       WHERE id = $${paramIndex}
       RETURNING *`,
      values
    );

    // Log to audit
    await db.query(
      `INSERT INTO governance_audit_log (action, epoch_id, actor_did, details)
       VALUES ('epoch_updated', $1, $2, $3)`,
      [epochId, adminDid, JSON.stringify({ updates: body })]
    );

    logger.info({ epochId, updates: body, adminDid }, 'Epoch updated by admin');

    return reply.send({
      success: true,
      epoch: {
        id: result.rows[0].id,
        status: result.rows[0].status,
        votingEndsAt: result.rows[0].voting_ends_at,
        autoTransition: result.rows[0].auto_transition,
      },
    });
  });

  /**
   * POST /api/admin/epochs/transition
   * Manually trigger epoch transition
   */
  app.post('/epochs/transition', async (request: FastifyRequest, reply: FastifyReply) => {
    const adminDid = getAdminDid(request);
    const parseResult = TransitionSchema.safeParse(request.body || {});

    if (!parseResult.success) {
      return reply.status(400).send({ error: 'Invalid request body', details: parseResult.error.issues });
    }

    const body = parseResult.data;

    // Get current epoch info before transition
    const current = await db.query(`
      SELECT id,
        (SELECT COUNT(*) FROM governance_votes WHERE epoch_id = governance_epochs.id) as vote_count
      FROM governance_epochs
      WHERE status = 'active'
      LIMIT 1
    `);

    if (current.rows.length === 0) {
      return reply.status(404).send({ error: 'No active epoch found' });
    }

    const previousEpochId = current.rows[0].id;
    const voteCount = parseInt(current.rows[0].vote_count, 10);

    // Check minimum votes unless forcing
    const minVotes = 5;
    if (!body.force && voteCount < minVotes) {
      return reply.status(400).send({
        error: `Insufficient votes for transition. Need ${minVotes}, have ${voteCount}. Use force=true to override.`,
      });
    }

    try {
      // Perform transition using existing function
      const newEpochId = await forceEpochTransition();

      // Log to audit
      await db.query(
        `INSERT INTO governance_audit_log (action, epoch_id, actor_did, details)
         VALUES ('epoch_transition', $1, $2, $3)`,
        [newEpochId, adminDid, JSON.stringify({ fromEpoch: previousEpochId, forced: body.force, voteCount })]
      );

      logger.info(
        { fromEpoch: previousEpochId, toEpoch: newEpochId, forced: body.force, adminDid },
        'Epoch transition triggered by admin'
      );

      // Get new epoch data
      const newEpoch = await db.query(`SELECT * FROM governance_epochs WHERE id = $1`, [newEpochId]);

      return reply.send({
        success: true,
        previousEpochId,
        newEpoch: {
          id: newEpochId,
          status: newEpoch.rows[0].status,
        },
        voteCount,
      });
    } catch (err) {
      logger.error({ err }, 'Epoch transition failed');
      return reply.status(500).send({ error: 'Epoch transition failed' });
    }
  });

  // Note: close-voting and open-voting endpoints removed
  // The schema uses status='active'/'closed' instead of a separate voting_open column
}
