/**
 * Audit Log Route
 *
 * GET /api/transparency/audit
 *
 * Returns paginated list of governance audit log entries.
 * The audit log is append-only and provides a transparent record
 * of all governance actions.
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { db } from '../../db/client.js';
import { logger } from '../../lib/logger.js';
import type { AuditLogResponse, AuditLogEntry } from '../transparency.types.js';

const AuditLogQuerySchema = z.object({
  limit: z.coerce.number().min(1).max(100).default(20),
  offset: z.coerce.number().min(0).default(0),
  action: z.string().optional(),
  epoch_id: z.coerce.number().optional(),
});

export function registerAuditLogRoute(app: FastifyInstance): void {
  app.get('/api/transparency/audit', async (request: FastifyRequest, reply: FastifyReply) => {
    const parseResult = AuditLogQuerySchema.safeParse(request.query);

    if (!parseResult.success) {
      return reply.code(400).send({
        error: 'ValidationError',
        message: 'Invalid query parameters',
        details: parseResult.error.issues,
      });
    }

    const { limit, offset, action, epoch_id } = parseResult.data;

    try {
      // Build query with optional filters
      const conditions: string[] = [];
      const params: (string | number)[] = [];
      let paramIndex = 1;

      if (action) {
        conditions.push(`action = $${paramIndex++}`);
        params.push(action);
      }

      if (epoch_id !== undefined) {
        conditions.push(`epoch_id = $${paramIndex++}`);
        params.push(epoch_id);
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      // Get total count
      const countResult = await db.query(
        `SELECT COUNT(*) as total FROM governance_audit_log ${whereClause}`,
        params
      );
      const total = parseInt(countResult.rows[0].total, 10);

      // Get entries with pagination
      params.push(limit, offset);
      const entriesResult = await db.query(
        `SELECT id, action, actor_did, epoch_id, details, created_at
         FROM governance_audit_log
         ${whereClause}
         ORDER BY created_at DESC
         LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
        params
      );

      const entries: AuditLogEntry[] = entriesResult.rows.map((row) => ({
        id: row.id,
        action: row.action,
        actor_did: row.actor_did,
        epoch_id: row.epoch_id,
        details: row.details || {},
        created_at: row.created_at,
      }));

      const response: AuditLogResponse = {
        entries,
        pagination: {
          total,
          limit,
          offset,
          has_more: offset + entries.length < total,
        },
      };

      return reply.send(response);
    } catch (err) {
      logger.error({ err }, 'Error fetching audit log');
      return reply.code(500).send({
        error: 'InternalError',
        message: 'An error occurred while fetching the audit log',
      });
    }
  });
}
