/**
 * Admin Governance Routes
 *
 * Unified governance control endpoints for admin dashboard.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { db } from '../../db/client.js';
import { getAdminDid } from '../../auth/admin.js';
import { logger } from '../../lib/logger.js';
import {
  ContentRules,
  GovernanceWeights,
  normalizeKeywords,
  normalizeWeights,
  toContentRules,
} from '../../governance/governance.types.js';
import { invalidateContentRulesCache } from '../../governance/content-filter.js';
import { aggregateContentVotes, aggregateVotes } from '../../governance/aggregation.js';
import { tryTriggerManualScoringRun } from '../../scoring/scheduler.js';
import { forceEpochTransition, triggerEpochTransition } from '../../governance/epoch-manager.js';
import {
  announceResultsApproved,
  announceVoteScheduled,
  announceVotingClosed,
  announceVotingOpen,
} from '../../bot/governance-announcements.js';

const KEYWORD_PATTERN = /^[a-z0-9][a-z0-9\s-]{0,49}$/i;

const ContentRulesPatchSchema = z
  .object({
    includeKeywords: z.array(z.string()).max(20).optional(),
    excludeKeywords: z.array(z.string()).max(20).optional(),
  })
  .refine((value) => value.includeKeywords !== undefined || value.excludeKeywords !== undefined, {
    message: 'At least one keyword list must be provided',
  });

const KeywordActionSchema = z.object({
  type: z.enum(['include', 'exclude']),
  keyword: z.string().min(1).max(50),
  confirm: z.boolean().optional(),
});

const WeightPatchSchema = z
  .object({
    recency: z.number().min(0).max(1).optional(),
    engagement: z.number().min(0).max(1).optional(),
    bridging: z.number().min(0).max(1).optional(),
    sourceDiversity: z.number().min(0).max(1).optional(),
    relevance: z.number().min(0).max(1).optional(),
  })
  .refine(
    (value) =>
      value.recency !== undefined ||
      value.engagement !== undefined ||
      value.bridging !== undefined ||
      value.sourceDiversity !== undefined ||
      value.relevance !== undefined,
    { message: 'At least one weight override is required' }
  );

const ExtendVotingSchema = z.object({
  hours: z.coerce.number().int().min(1).max(168),
});

const RoundIdParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
});

const StartVotingSchema = z.object({
  durationHours: z.coerce.number().int().min(1).max(168).default(72),
  announce: z.boolean().optional().default(true),
});

const EndVotingSchema = z.object({
  announce: z.boolean().optional().default(true),
});

const ApproveResultsSchema = z.object({
  announce: z.boolean().optional().default(true),
});

const ScheduleVoteSchema = z.object({
  startsAt: z.string().datetime(),
  durationHours: z.coerce.number().int().min(1).max(168).default(72),
});

interface GovernanceEpochRow {
  id: number;
  status: string;
  phase: string | null;
  voting_ends_at: string | null;
  voting_started_at: string | null;
  voting_closed_at: string | null;
  results_approved_at: string | null;
  results_approved_by: string | null;
  proposed_weights: unknown;
  proposed_content_rules: unknown;
  auto_transition: boolean;
  recency_weight: number | string;
  engagement_weight: number | string;
  bridging_weight: number | string;
  source_diversity_weight: number | string;
  relevance_weight: number | string;
  content_rules: unknown;
  created_at: string;
  closed_at: string | null;
}

interface ScheduledVoteRow {
  id: number;
  starts_at: string;
  duration_hours: number;
  announced: boolean;
  created_by: string;
  created_at: string;
}

function toNumber(value: number | string): number {
  return typeof value === 'number' ? value : parseFloat(value);
}

function toWeights(row: GovernanceEpochRow): GovernanceWeights {
  return {
    recency: toNumber(row.recency_weight),
    engagement: toNumber(row.engagement_weight),
    bridging: toNumber(row.bridging_weight),
    sourceDiversity: toNumber(row.source_diversity_weight),
    relevance: toNumber(row.relevance_weight),
  };
}

function toDbContentRules(rules: ContentRules): { include_keywords: string[]; exclude_keywords: string[] } {
  return {
    include_keywords: rules.includeKeywords,
    exclude_keywords: rules.excludeKeywords,
  };
}

function toPhase(row: GovernanceEpochRow): 'running' | 'voting' | 'results' {
  if (row.phase === 'voting' || row.phase === 'results' || row.phase === 'running') {
    return row.phase;
  }

  if (row.status === 'voting') {
    return 'voting';
  }

  return 'running';
}

function toProposedWeights(raw: unknown): GovernanceWeights | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const value = raw as Record<string, unknown>;
  const recency = typeof value.recency === 'number' ? value.recency : null;
  const engagement = typeof value.engagement === 'number' ? value.engagement : null;
  const bridging = typeof value.bridging === 'number' ? value.bridging : null;
  const sourceDiversity =
    typeof value.sourceDiversity === 'number' ? value.sourceDiversity : null;
  const relevance = typeof value.relevance === 'number' ? value.relevance : null;

  if (
    recency === null ||
    engagement === null ||
    bridging === null ||
    sourceDiversity === null ||
    relevance === null
  ) {
    return null;
  }

  return {
    recency,
    engagement,
    bridging,
    sourceDiversity,
    relevance,
  };
}

function toProposedContentRules(raw: unknown): ContentRules | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  return toContentRules(raw as any);
}

function toContentRulesPayload(rules: ContentRules): { include_keywords: string[]; exclude_keywords: string[] } {
  return {
    include_keywords: rules.includeKeywords,
    exclude_keywords: rules.excludeKeywords,
  };
}

function sanitizeKeywordList(keywords: string[]): string[] {
  const normalized = normalizeKeywords(keywords);

  if (normalized.length !== keywords.filter((keyword) => keyword.trim().length > 0).length) {
    throw new Error('Keywords must be non-empty and <= 50 characters');
  }

  for (const keyword of normalized) {
    if (!KEYWORD_PATTERN.test(keyword)) {
      throw new Error('Keywords may only include letters, numbers, spaces, and hyphens');
    }
  }

  return normalized;
}

function sanitizeSingleKeyword(rawKeyword: string): string {
  const normalized = sanitizeKeywordList([rawKeyword]);
  if (normalized.length !== 1) {
    throw new Error('Keyword is invalid');
  }
  return normalized[0];
}

function mapRound(row: GovernanceEpochRow, voteCount: number) {
  const contentRules = toContentRules((row.content_rules ?? null) as any);

  return {
    id: row.id,
    status: row.status,
    phase: toPhase(row),
    voteCount,
    createdAt: row.created_at,
    closedAt: row.closed_at,
    votingEndsAt: row.voting_ends_at,
    votingStartedAt: row.voting_started_at,
    votingClosedAt: row.voting_closed_at,
    resultsApprovedAt: row.results_approved_at,
    resultsApprovedBy: row.results_approved_by,
    proposedWeights: toProposedWeights(row.proposed_weights),
    proposedContentRules: toProposedContentRules(row.proposed_content_rules),
    autoTransition: row.auto_transition,
    weights: toWeights(row),
    contentRules: {
      includeKeywords: contentRules.includeKeywords,
      excludeKeywords: contentRules.excludeKeywords,
    },
  };
}

async function getCurrentEpochForUpdate(client: PoolClient): Promise<GovernanceEpochRow | null> {
  const result = await client.query<GovernanceEpochRow>(
    `SELECT *
     FROM governance_epochs
     WHERE status IN ('active', 'voting')
     ORDER BY id DESC
     LIMIT 1
     FOR UPDATE`
  );

  return result.rows[0] ?? null;
}

async function triggerManualRescore(reason: string): Promise<boolean> {
  const triggered = tryTriggerManualScoringRun();

  if (!triggered) {
    logger.warn({ reason }, 'Manual rescore skipped because scoring pipeline is already running');
  }

  return triggered;
}

async function getVoteCounts(client: PoolClient, epochId: number): Promise<{ total: number; content: number }> {
  const result = await client.query<{ total: string; content: string }>(
    `SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (
        WHERE
          (include_keywords IS NOT NULL AND array_length(include_keywords, 1) > 0)
          OR
          (exclude_keywords IS NOT NULL AND array_length(exclude_keywords, 1) > 0)
      )::int AS content
     FROM governance_votes
     WHERE epoch_id = $1`,
    [epochId]
  );

  return {
    total: parseInt(result.rows[0]?.total ?? '0', 10),
    content: parseInt(result.rows[0]?.content ?? '0', 10),
  };
}

function mapScheduledVote(row: ScheduledVoteRow) {
  return {
    id: row.id,
    startsAt: row.starts_at,
    durationHours: row.duration_hours,
    announced: row.announced,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

export function registerGovernanceRoutes(app: FastifyInstance): void {
  app.get('/governance', async (_request: FastifyRequest, reply: FastifyReply) => {
    const roundsResult = await db.query<GovernanceEpochRow & { vote_count: string }>(
      `SELECT
        e.id,
        e.status,
        e.phase,
        e.voting_ends_at,
        e.voting_started_at,
        e.voting_closed_at,
        e.results_approved_at,
        e.results_approved_by,
        e.proposed_weights,
        e.proposed_content_rules,
        e.auto_transition,
        e.recency_weight,
        e.engagement_weight,
        e.bridging_weight,
        e.source_diversity_weight,
        e.relevance_weight,
        e.content_rules,
        e.created_at,
        e.closed_at,
        COUNT(v.id)::int AS vote_count
       FROM governance_epochs e
       LEFT JOIN governance_votes v ON v.epoch_id = e.id
       GROUP BY e.id
       ORDER BY e.id DESC
       LIMIT 30`
    );

    const rounds = roundsResult.rows.map((row) => mapRound(row, parseInt(row.vote_count, 10)));
    const currentRound = rounds.find((round) => round.status === 'active' || round.status === 'voting') ?? null;

    return reply.send({
      currentRound,
      rounds,
      weights: currentRound?.weights ?? null,
      includeKeywords: currentRound?.contentRules.includeKeywords ?? [],
      excludeKeywords: currentRound?.contentRules.excludeKeywords ?? [],
      votingEndsAt: currentRound?.votingEndsAt ?? null,
      autoTransition: currentRound?.autoTransition ?? false,
    });
  });

  app.post('/governance/start-voting', async (request: FastifyRequest, reply: FastifyReply) => {
    const adminDid = getAdminDid(request);
    const parseResult = StartVotingSchema.safeParse(request.body ?? {});

    if (!parseResult.success) {
      return reply.code(400).send({
        error: 'ValidationError',
        message: 'Invalid start-voting request',
        details: parseResult.error.issues,
      });
    }

    const { durationHours, announce } = parseResult.data;
    const client = await db.connect();

    try {
      await client.query('BEGIN');

      const epoch = await getCurrentEpochForUpdate(client);
      if (!epoch) {
        await client.query('ROLLBACK');
        return reply.code(404).send({ error: 'NoActiveRound', message: 'No active round found' });
      }

      const phase = toPhase(epoch);
      if (phase === 'voting') {
        await client.query('ROLLBACK');
        return reply.code(409).send({
          error: 'AlreadyVoting',
          message: 'A voting period is already open for the current round',
        });
      }

      if (phase === 'results') {
        await client.query('ROLLBACK');
        return reply.code(409).send({
          error: 'ResultsPending',
          message: 'Current round is awaiting results approval/rejection',
        });
      }

      const updatedResult = await client.query<GovernanceEpochRow>(
        `UPDATE governance_epochs
         SET phase = 'voting',
             status = 'active',
             voting_started_at = NOW(),
             voting_closed_at = NULL,
             voting_ends_at = NOW() + make_interval(hours => $1),
             auto_transition = TRUE,
             results_approved_at = NULL,
             results_approved_by = NULL,
             proposed_weights = NULL,
             proposed_content_rules = NULL
         WHERE id = $2
         RETURNING *`,
        [durationHours, epoch.id]
      );

      const voteCounts = await getVoteCounts(client, epoch.id);

      await client.query(
        `INSERT INTO governance_audit_log (action, actor_did, epoch_id, details)
         VALUES ('admin_start_voting', $1, $2, $3)`,
        [
          adminDid,
          epoch.id,
          JSON.stringify({
            duration_hours: durationHours,
            announce,
          }),
        ]
      );

      await client.query('COMMIT');

      if (announce) {
        await announceVotingOpen({ id: epoch.id }, `${durationHours} hour(s)`);
      }

      return reply.send({
        success: true,
        round: mapRound(updatedResult.rows[0], voteCounts.total),
      });
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error({ error, adminDid }, 'Failed to start voting period');
      return reply.code(500).send({
        error: 'StartVotingFailed',
        message: 'Failed to start voting period',
      });
    } finally {
      client.release();
    }
  });

  app.post('/governance/end-voting', async (request: FastifyRequest, reply: FastifyReply) => {
    const adminDid = getAdminDid(request);
    const parseResult = EndVotingSchema.safeParse(request.body ?? {});

    if (!parseResult.success) {
      return reply.code(400).send({
        error: 'ValidationError',
        message: 'Invalid end-voting request',
        details: parseResult.error.issues,
      });
    }

    const { announce } = parseResult.data;
    const client = await db.connect();

    try {
      await client.query('BEGIN');

      const epoch = await getCurrentEpochForUpdate(client);
      if (!epoch) {
        await client.query('ROLLBACK');
        return reply.code(404).send({ error: 'NoActiveRound', message: 'No active round found' });
      }

      const phase = toPhase(epoch);
      if (phase !== 'voting') {
        await client.query('ROLLBACK');
        return reply.code(409).send({
          error: 'VotingNotOpen',
          message: 'Voting is not currently open for this round',
        });
      }

      const voteCounts = await getVoteCounts(client, epoch.id);
      const previousWeights = toWeights(epoch);
      const previousRules = toContentRules((epoch.content_rules ?? null) as any);

      let proposedWeights = previousWeights;
      let proposedRules = previousRules;

      if (voteCounts.total > 0) {
        const aggregatedWeights = await aggregateVotes(epoch.id);
        if (aggregatedWeights) {
          proposedWeights = aggregatedWeights;
        }
      }

      if (voteCounts.content > 0) {
        proposedRules = await aggregateContentVotes(epoch.id);
      }

      const updatedResult = await client.query<GovernanceEpochRow>(
        `UPDATE governance_epochs
         SET phase = 'results',
             voting_closed_at = NOW(),
             auto_transition = FALSE,
             proposed_weights = $1,
             proposed_content_rules = $2
         WHERE id = $3
         RETURNING *`,
        [JSON.stringify(proposedWeights), JSON.stringify(toDbContentRules(proposedRules)), epoch.id]
      );

      await client.query(
        `INSERT INTO governance_audit_log (action, actor_did, epoch_id, details)
         VALUES ('admin_end_voting', $1, $2, $3)`,
        [
          adminDid,
          epoch.id,
          JSON.stringify({
            vote_count: voteCounts.total,
            content_vote_count: voteCounts.content,
            proposed_weights: proposedWeights,
            proposed_content_rules: toDbContentRules(proposedRules),
            announce,
          }),
        ]
      );

      await client.query('COMMIT');

      if (announce) {
        await announceVotingClosed({ id: epoch.id }, voteCounts.total);
      }

      return reply.send({
        success: true,
        voteCount: voteCounts.total,
        proposedWeights,
        proposedContentRules: proposedRules,
        round: mapRound(updatedResult.rows[0], voteCounts.total),
      });
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error({ error, adminDid }, 'Failed to end voting period');
      return reply.code(500).send({
        error: 'EndVotingFailed',
        message: 'Failed to end voting period',
      });
    } finally {
      client.release();
    }
  });

  app.post('/governance/approve-results', async (request: FastifyRequest, reply: FastifyReply) => {
    const adminDid = getAdminDid(request);
    const parseResult = ApproveResultsSchema.safeParse(request.body ?? {});

    if (!parseResult.success) {
      return reply.code(400).send({
        error: 'ValidationError',
        message: 'Invalid approve-results request',
        details: parseResult.error.issues,
      });
    }

    const { announce } = parseResult.data;
    const client = await db.connect();

    try {
      await client.query('BEGIN');

      const epoch = await getCurrentEpochForUpdate(client);
      if (!epoch) {
        await client.query('ROLLBACK');
        return reply.code(404).send({ error: 'NoActiveRound', message: 'No active round found' });
      }

      if (toPhase(epoch) !== 'results') {
        await client.query('ROLLBACK');
        return reply.code(409).send({
          error: 'ResultsNotPending',
          message: 'No pending results to approve',
        });
      }

      const oldWeights = toWeights(epoch);
      const oldContentRules = toContentRules((epoch.content_rules ?? null) as any);
      const newWeights = toProposedWeights(epoch.proposed_weights) ?? oldWeights;
      const newContentRules = toProposedContentRules(epoch.proposed_content_rules) ?? oldContentRules;

      const updatedResult = await client.query<GovernanceEpochRow>(
        `UPDATE governance_epochs
         SET recency_weight = $1,
             engagement_weight = $2,
             bridging_weight = $3,
             source_diversity_weight = $4,
             relevance_weight = $5,
             content_rules = $6,
             phase = 'running',
             voting_ends_at = NULL,
             auto_transition = FALSE,
             proposed_weights = NULL,
             proposed_content_rules = NULL,
             results_approved_at = NOW(),
             results_approved_by = $7
         WHERE id = $8
         RETURNING *`,
        [
          newWeights.recency,
          newWeights.engagement,
          newWeights.bridging,
          newWeights.sourceDiversity,
          newWeights.relevance,
          JSON.stringify(toDbContentRules(newContentRules)),
          adminDid,
          epoch.id,
        ]
      );

      const voteCounts = await getVoteCounts(client, epoch.id);

      await client.query(
        `INSERT INTO governance_audit_log (action, actor_did, epoch_id, details)
         VALUES ('admin_approve_results', $1, $2, $3)`,
        [
          adminDid,
          epoch.id,
          JSON.stringify({
            old_weights: oldWeights,
            new_weights: newWeights,
            old_content_rules: toDbContentRules(oldContentRules),
            new_content_rules: toDbContentRules(newContentRules),
            announce,
          }),
        ]
      );

      await client.query('COMMIT');

      await invalidateContentRulesCache();
      const rescoreTriggered = await triggerManualRescore('admin_approve_results');

      if (announce) {
        await announceResultsApproved(
          { id: epoch.id },
          {
            oldWeights,
            newWeights,
            oldContentRules,
            newContentRules,
          }
        );
      }

      return reply.send({
        success: true,
        weights: newWeights,
        contentRules: newContentRules,
        rescoreTriggered,
        round: mapRound(updatedResult.rows[0], voteCounts.total),
      });
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error({ error, adminDid }, 'Failed to approve voting results');
      return reply.code(500).send({
        error: 'ApproveResultsFailed',
        message: 'Failed to approve voting results',
      });
    } finally {
      client.release();
    }
  });

  app.post('/governance/reject-results', async (request: FastifyRequest, reply: FastifyReply) => {
    const adminDid = getAdminDid(request);
    const client = await db.connect();

    try {
      await client.query('BEGIN');

      const epoch = await getCurrentEpochForUpdate(client);
      if (!epoch) {
        await client.query('ROLLBACK');
        return reply.code(404).send({ error: 'NoActiveRound', message: 'No active round found' });
      }

      if (toPhase(epoch) !== 'results') {
        await client.query('ROLLBACK');
        return reply.code(409).send({
          error: 'ResultsNotPending',
          message: 'No pending results to reject',
        });
      }

      const updatedResult = await client.query<GovernanceEpochRow>(
        `UPDATE governance_epochs
         SET phase = 'running',
             voting_ends_at = NULL,
             auto_transition = FALSE,
             proposed_weights = NULL,
             proposed_content_rules = NULL
         WHERE id = $1
         RETURNING *`,
        [epoch.id]
      );

      const voteCounts = await getVoteCounts(client, epoch.id);

      await client.query(
        `INSERT INTO governance_audit_log (action, actor_did, epoch_id, details)
         VALUES ('admin_reject_results', $1, $2, $3)`,
        [
          adminDid,
          epoch.id,
          JSON.stringify({
            rejected_at: new Date().toISOString(),
          }),
        ]
      );

      await client.query('COMMIT');

      return reply.send({
        success: true,
        round: mapRound(updatedResult.rows[0], voteCounts.total),
      });
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error({ error, adminDid }, 'Failed to reject voting results');
      return reply.code(500).send({
        error: 'RejectResultsFailed',
        message: 'Failed to reject voting results',
      });
    } finally {
      client.release();
    }
  });

  app.post('/governance/schedule-vote', async (request: FastifyRequest, reply: FastifyReply) => {
    const adminDid = getAdminDid(request);
    const parseResult = ScheduleVoteSchema.safeParse(request.body ?? {});

    if (!parseResult.success) {
      return reply.code(400).send({
        error: 'ValidationError',
        message: 'Invalid schedule-vote request',
        details: parseResult.error.issues,
      });
    }

    const startsAt = new Date(parseResult.data.startsAt);
    if (Number.isNaN(startsAt.getTime())) {
      return reply.code(400).send({
        error: 'ValidationError',
        message: 'startsAt must be a valid ISO datetime string',
      });
    }

    if (startsAt.getTime() <= Date.now()) {
      return reply.code(400).send({
        error: 'ValidationError',
        message: 'startsAt must be in the future',
      });
    }

    const result = await db.query<ScheduledVoteRow>(
      `INSERT INTO scheduled_votes (starts_at, duration_hours, created_by)
       VALUES ($1, $2, $3)
       RETURNING id, starts_at, duration_hours, announced, created_by, created_at`,
      [startsAt.toISOString(), parseResult.data.durationHours, adminDid]
    );

    const scheduledVote = mapScheduledVote(result.rows[0]);

    await db.query(
      `INSERT INTO governance_audit_log (action, actor_did, details)
       VALUES ('admin_schedule_vote', $1, $2)`,
      [
        adminDid,
        JSON.stringify({
          scheduled_vote_id: scheduledVote.id,
          starts_at: scheduledVote.startsAt,
          duration_hours: scheduledVote.durationHours,
        }),
      ]
    );

    await announceVoteScheduled({
      id: scheduledVote.id,
      startsAt: scheduledVote.startsAt,
      durationHours: scheduledVote.durationHours,
    });

    return reply.send({
      success: true,
      scheduledVote,
    });
  });

  app.get('/governance/schedule', async (_request: FastifyRequest, reply: FastifyReply) => {
    const result = await db.query<ScheduledVoteRow>(
      `SELECT id, starts_at, duration_hours, announced, created_by, created_at
       FROM scheduled_votes
       WHERE starts_at >= NOW() - INTERVAL '1 hour'
       ORDER BY starts_at ASC`
    );

    return reply.send({
      scheduledVotes: result.rows.map(mapScheduledVote),
    });
  });

  app.patch('/governance/content-rules', async (request: FastifyRequest, reply: FastifyReply) => {
    const adminDid = getAdminDid(request);
    const parseResult = ContentRulesPatchSchema.safeParse(request.body);

    if (!parseResult.success) {
      return reply.code(400).send({
        error: 'ValidationError',
        message: 'Invalid content rules payload',
        details: parseResult.error.issues,
      });
    }

    const client = await db.connect();

    try {
      await client.query('BEGIN');

      const epoch = await getCurrentEpochForUpdate(client);
      if (!epoch) {
        await client.query('ROLLBACK');
        return reply.code(404).send({ error: 'NoActiveRound', message: 'No active round found' });
      }

      const previousRules = toContentRules((epoch.content_rules ?? null) as any);
      const includeKeywords =
        parseResult.data.includeKeywords !== undefined
          ? sanitizeKeywordList(parseResult.data.includeKeywords)
          : previousRules.includeKeywords;
      const excludeKeywords =
        parseResult.data.excludeKeywords !== undefined
          ? sanitizeKeywordList(parseResult.data.excludeKeywords)
          : previousRules.excludeKeywords;

      const updatedRules: ContentRules = { includeKeywords, excludeKeywords };

      await client.query(
        `UPDATE governance_epochs
         SET content_rules = $1
         WHERE id = $2`,
        [JSON.stringify(toContentRulesPayload(updatedRules)), epoch.id]
      );

      await client.query(
        `INSERT INTO governance_audit_log (action, actor_did, epoch_id, details)
         VALUES ('admin_rules_override', $1, $2, $3)`,
        [
          adminDid,
          epoch.id,
          JSON.stringify({
            old_content_rules: toContentRulesPayload(previousRules),
            new_content_rules: toContentRulesPayload(updatedRules),
          }),
        ]
      );

      await client.query('COMMIT');

      await invalidateContentRulesCache();
      const rescoreTriggered = await triggerManualRescore('admin_rules_override');

      return reply.send({
        success: true,
        rules: updatedRules,
        rescoreTriggered,
      });
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error({ error, adminDid }, 'Failed to update content rules');

      const message = error instanceof Error ? error.message : 'Failed to update content rules';
      return reply.code(500).send({ error: 'UpdateFailed', message });
    } finally {
      client.release();
    }
  });

  app.post('/governance/content-rules/keyword', async (request: FastifyRequest, reply: FastifyReply) => {
    const adminDid = getAdminDid(request);
    const parseResult = KeywordActionSchema.safeParse(request.body);

    if (!parseResult.success) {
      return reply.code(400).send({
        error: 'ValidationError',
        message: 'Invalid keyword request',
        details: parseResult.error.issues,
      });
    }

    const { type } = parseResult.data;
    let keyword: string;

    try {
      keyword = sanitizeSingleKeyword(parseResult.data.keyword);
    } catch (error) {
      return reply.code(400).send({
        error: 'ValidationError',
        message: error instanceof Error ? error.message : 'Invalid keyword',
      });
    }

    const client = await db.connect();

    try {
      await client.query('BEGIN');

      const epoch = await getCurrentEpochForUpdate(client);
      if (!epoch) {
        await client.query('ROLLBACK');
        return reply.code(404).send({ error: 'NoActiveRound', message: 'No active round found' });
      }

      const previousRules = toContentRules((epoch.content_rules ?? null) as any);
      const nextRules: ContentRules = {
        includeKeywords: [...previousRules.includeKeywords],
        excludeKeywords: [...previousRules.excludeKeywords],
      };

      const target = type === 'include' ? nextRules.includeKeywords : nextRules.excludeKeywords;

      if (target.includes(keyword)) {
        await client.query('ROLLBACK');
        return reply.code(409).send({
          error: 'Conflict',
          message: 'Keyword already exists in this rule set',
        });
      }

      if (target.length >= 20) {
        await client.query('ROLLBACK');
        return reply.code(400).send({
          error: 'ValidationError',
          message: 'Maximum 20 keywords allowed per rule set',
        });
      }

      target.push(keyword);

      await client.query(
        `UPDATE governance_epochs
         SET content_rules = $1
         WHERE id = $2`,
        [JSON.stringify(toContentRulesPayload(nextRules)), epoch.id]
      );

      await client.query(
        `INSERT INTO governance_audit_log (action, actor_did, epoch_id, details)
         VALUES ('admin_keyword_added', $1, $2, $3)`,
        [
          adminDid,
          epoch.id,
          JSON.stringify({
            type,
            keyword,
            old_content_rules: toContentRulesPayload(previousRules),
            new_content_rules: toContentRulesPayload(nextRules),
          }),
        ]
      );

      await client.query('COMMIT');

      await invalidateContentRulesCache();
      const rescoreTriggered = await triggerManualRescore('admin_keyword_added');

      return reply.send({
        success: true,
        rules: nextRules,
        rescoreTriggered,
      });
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error({ error, adminDid, type }, 'Failed to add keyword');

      return reply.code(500).send({
        error: 'KeywordAddFailed',
        message: 'Failed to add keyword',
      });
    } finally {
      client.release();
    }
  });

  app.delete('/governance/content-rules/keyword', async (request: FastifyRequest, reply: FastifyReply) => {
    const adminDid = getAdminDid(request);
    const parseResult = KeywordActionSchema.safeParse(request.body);

    if (!parseResult.success) {
      return reply.code(400).send({
        error: 'ValidationError',
        message: 'Invalid keyword request',
        details: parseResult.error.issues,
      });
    }

    const { type, confirm } = parseResult.data;
    let keyword: string;

    try {
      keyword = sanitizeSingleKeyword(parseResult.data.keyword);
    } catch (error) {
      return reply.code(400).send({
        error: 'ValidationError',
        message: error instanceof Error ? error.message : 'Invalid keyword',
      });
    }

    const client = await db.connect();

    try {
      await client.query('BEGIN');

      const epoch = await getCurrentEpochForUpdate(client);
      if (!epoch) {
        await client.query('ROLLBACK');
        return reply.code(404).send({ error: 'NoActiveRound', message: 'No active round found' });
      }

      const previousRules = toContentRules((epoch.content_rules ?? null) as any);
      const nextRules: ContentRules = {
        includeKeywords: [...previousRules.includeKeywords],
        excludeKeywords: [...previousRules.excludeKeywords],
      };

      const target = type === 'include' ? nextRules.includeKeywords : nextRules.excludeKeywords;
      const index = target.indexOf(keyword);

      if (index === -1) {
        await client.query('ROLLBACK');
        return reply.code(404).send({
          error: 'NotFound',
          message: 'Keyword not found in this rule set',
        });
      }

      if (type === 'include' && target.length === 1 && confirm !== true) {
        await client.query('ROLLBACK');
        return reply.code(409).send({
          error: 'ConfirmationRequired',
          message: 'Removing the last include keyword requires confirm=true',
        });
      }

      target.splice(index, 1);

      await client.query(
        `UPDATE governance_epochs
         SET content_rules = $1
         WHERE id = $2`,
        [JSON.stringify(toContentRulesPayload(nextRules)), epoch.id]
      );

      await client.query(
        `INSERT INTO governance_audit_log (action, actor_did, epoch_id, details)
         VALUES ('admin_keyword_removed', $1, $2, $3)`,
        [
          adminDid,
          epoch.id,
          JSON.stringify({
            type,
            keyword,
            old_content_rules: toContentRulesPayload(previousRules),
            new_content_rules: toContentRulesPayload(nextRules),
          }),
        ]
      );

      await client.query('COMMIT');

      await invalidateContentRulesCache();
      const rescoreTriggered = await triggerManualRescore('admin_keyword_removed');

      return reply.send({
        success: true,
        rules: nextRules,
        rescoreTriggered,
      });
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error({ error, adminDid, type }, 'Failed to remove keyword');

      return reply.code(500).send({
        error: 'KeywordRemoveFailed',
        message: 'Failed to remove keyword',
      });
    } finally {
      client.release();
    }
  });

  app.patch('/governance/weights', async (request: FastifyRequest, reply: FastifyReply) => {
    const adminDid = getAdminDid(request);
    const parseResult = WeightPatchSchema.safeParse(request.body);

    if (!parseResult.success) {
      return reply.code(400).send({
        error: 'ValidationError',
        message: 'Invalid weight override payload',
        details: parseResult.error.issues,
      });
    }

    const client = await db.connect();

    try {
      await client.query('BEGIN');

      const epoch = await getCurrentEpochForUpdate(client);
      if (!epoch) {
        await client.query('ROLLBACK');
        return reply.code(404).send({ error: 'NoActiveRound', message: 'No active round found' });
      }

      const previousWeights = toWeights(epoch);
      const mergedWeights: GovernanceWeights = {
        recency: parseResult.data.recency ?? previousWeights.recency,
        engagement: parseResult.data.engagement ?? previousWeights.engagement,
        bridging: parseResult.data.bridging ?? previousWeights.bridging,
        sourceDiversity: parseResult.data.sourceDiversity ?? previousWeights.sourceDiversity,
        relevance: parseResult.data.relevance ?? previousWeights.relevance,
      };

      const normalizedWeights = normalizeWeights(mergedWeights);

      await client.query(
        `UPDATE governance_epochs
         SET recency_weight = $1,
             engagement_weight = $2,
             bridging_weight = $3,
             source_diversity_weight = $4,
             relevance_weight = $5
         WHERE id = $6`,
        [
          normalizedWeights.recency,
          normalizedWeights.engagement,
          normalizedWeights.bridging,
          normalizedWeights.sourceDiversity,
          normalizedWeights.relevance,
          epoch.id,
        ]
      );

      await client.query(
        `INSERT INTO governance_audit_log (action, actor_did, epoch_id, details)
         VALUES ('admin_weights_override', $1, $2, $3)`,
        [
          adminDid,
          epoch.id,
          JSON.stringify({
            old_weights: previousWeights,
            new_weights: normalizedWeights,
            override: parseResult.data,
          }),
        ]
      );

      await client.query('COMMIT');

      const rescoreTriggered = await triggerManualRescore('admin_weights_override');

      return reply.send({
        success: true,
        weights: normalizedWeights,
        rescoreTriggered,
      });
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error({ error, adminDid }, 'Failed to update governance weights');

      const message = error instanceof Error ? error.message : 'Failed to update weights';
      return reply.code(500).send({
        error: 'WeightUpdateFailed',
        message,
      });
    } finally {
      client.release();
    }
  });

  app.post('/governance/extend-voting', async (request: FastifyRequest, reply: FastifyReply) => {
    const adminDid = getAdminDid(request);
    const parseResult = ExtendVotingSchema.safeParse(request.body);

    if (!parseResult.success) {
      return reply.code(400).send({
        error: 'ValidationError',
        message: 'Invalid extend-voting request',
        details: parseResult.error.issues,
      });
    }

    const { hours } = parseResult.data;
    const client = await db.connect();

    try {
      await client.query('BEGIN');

      const epoch = await getCurrentEpochForUpdate(client);
      if (!epoch) {
        await client.query('ROLLBACK');
        return reply.code(404).send({ error: 'NoActiveRound', message: 'No active round found' });
      }

      const updatedResult = await client.query<GovernanceEpochRow>(
        `UPDATE governance_epochs
         SET voting_ends_at = COALESCE(voting_ends_at, NOW()) + make_interval(hours => $1)
         WHERE id = $2
         RETURNING *`,
        [hours, epoch.id]
      );

      const voteCountResult = await client.query<{ count: string }>(
        `SELECT COUNT(*)::int AS count FROM governance_votes WHERE epoch_id = $1`,
        [epoch.id]
      );
      const voteCount = parseInt(voteCountResult.rows[0]?.count ?? '0', 10);

      await client.query(
        `INSERT INTO governance_audit_log (action, actor_did, epoch_id, details)
         VALUES ('admin_extend_voting', $1, $2, $3)`,
        [
          adminDid,
          epoch.id,
          JSON.stringify({
            hours,
            previous_voting_ends_at: epoch.voting_ends_at,
            new_voting_ends_at: updatedResult.rows[0].voting_ends_at,
          }),
        ]
      );

      await client.query('COMMIT');

      return reply.send({
        success: true,
        round: mapRound(updatedResult.rows[0], voteCount),
      });
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error({ error, adminDid }, 'Failed to extend voting');

      return reply.code(500).send({
        error: 'ExtendVotingFailed',
        message: 'Failed to extend voting',
      });
    } finally {
      client.release();
    }
  });

  app.post('/governance/apply-results', async (request: FastifyRequest, reply: FastifyReply) => {
    const adminDid = getAdminDid(request);
    const client = await db.connect();

    try {
      await client.query('BEGIN');

      const epoch = await getCurrentEpochForUpdate(client);
      if (!epoch) {
        await client.query('ROLLBACK');
        return reply.code(404).send({ error: 'NoActiveRound', message: 'No active round found' });
      }

      const voteCountResult = await client.query<{ count: string }>(
        `SELECT COUNT(*)::int AS count FROM governance_votes WHERE epoch_id = $1`,
        [epoch.id]
      );
      const voteCount = parseInt(voteCountResult.rows[0]?.count ?? '0', 10);

      const previousWeights = toWeights(epoch);
      const previousRules = toContentRules((epoch.content_rules ?? null) as any);

      let nextWeights = previousWeights;
      let nextRules = previousRules;

      if (voteCount > 0) {
        const aggregatedWeights = await aggregateVotes(epoch.id);
        if (aggregatedWeights) {
          nextWeights = aggregatedWeights;
        }

        nextRules = await aggregateContentVotes(epoch.id);
      }

      const updatedResult = await client.query<GovernanceEpochRow>(
        `UPDATE governance_epochs
         SET recency_weight = $1,
             engagement_weight = $2,
             bridging_weight = $3,
             source_diversity_weight = $4,
             relevance_weight = $5,
             content_rules = $6,
             vote_count = $7,
             phase = 'running',
             voting_closed_at = NOW(),
             voting_ends_at = NULL,
             auto_transition = FALSE,
             proposed_weights = NULL,
             proposed_content_rules = NULL,
             results_approved_at = NOW(),
             results_approved_by = $8
         WHERE id = $9
         RETURNING *`,
        [
          nextWeights.recency,
          nextWeights.engagement,
          nextWeights.bridging,
          nextWeights.sourceDiversity,
          nextWeights.relevance,
          JSON.stringify(toContentRulesPayload(nextRules)),
          voteCount,
          adminDid,
          epoch.id,
        ]
      );

      await client.query(
        `INSERT INTO governance_audit_log (action, actor_did, epoch_id, details)
         VALUES ('admin_apply_results', $1, $2, $3)`,
        [
          adminDid,
          epoch.id,
          JSON.stringify({
            vote_count: voteCount,
            old_weights: previousWeights,
            new_weights: nextWeights,
            old_content_rules: toContentRulesPayload(previousRules),
            new_content_rules: toContentRulesPayload(nextRules),
          }),
        ]
      );

      await client.query('COMMIT');

      await invalidateContentRulesCache();
      const rescoreTriggered = await triggerManualRescore('admin_apply_results');

      return reply.send({
        success: true,
        voteCount,
        appliedWeights: voteCount > 0,
        weights: nextWeights,
        contentRules: nextRules,
        round: mapRound(updatedResult.rows[0], voteCount),
        rescoreTriggered,
      });
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error({ error, adminDid }, 'Failed to apply round results');

      return reply.code(500).send({
        error: 'ApplyResultsFailed',
        message: 'Failed to apply results',
      });
    } finally {
      client.release();
    }
  });

  app.get('/governance/rounds/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const parseResult = RoundIdParamsSchema.safeParse(request.params);

    if (!parseResult.success) {
      return reply.code(400).send({
        error: 'ValidationError',
        message: 'Round id must be a positive integer',
        details: parseResult.error.issues,
      });
    }

    const roundId = parseResult.data.id;

    const roundResult = await db.query<GovernanceEpochRow>(
      `SELECT * FROM governance_epochs WHERE id = $1`,
      [roundId]
    );

    if (roundResult.rows.length === 0) {
      return reply.code(404).send({
        error: 'RoundNotFound',
        message: `Round ${roundId} not found`,
      });
    }

    const round = roundResult.rows[0];
    const endingWeights = toWeights(round);
    const endingRules = toContentRules((round.content_rules ?? null) as any);

    const auditResult = await db.query<{ action: string; details: unknown; created_at: string }>(
      `SELECT action, details, created_at
       FROM governance_audit_log
       WHERE epoch_id = $1
       ORDER BY created_at ASC`,
      [roundId]
    );

    let startingWeights = endingWeights;
    let startingRules = endingRules;
    let foundStartingWeights = false;
    let foundStartingRules = false;

    for (const entry of auditResult.rows) {
      const details = (entry.details ?? null) as Record<string, unknown> | null;
      if (!details || typeof details !== 'object') {
        continue;
      }

      if (!foundStartingWeights && details.old_weights && typeof details.old_weights === 'object') {
        const oldWeights = details.old_weights as Record<string, number>;
        if (
          oldWeights.recency !== undefined &&
          oldWeights.engagement !== undefined &&
          oldWeights.bridging !== undefined &&
          oldWeights.sourceDiversity !== undefined &&
          oldWeights.relevance !== undefined
        ) {
          startingWeights = {
            recency: oldWeights.recency,
            engagement: oldWeights.engagement,
            bridging: oldWeights.bridging,
            sourceDiversity: oldWeights.sourceDiversity,
            relevance: oldWeights.relevance,
          };
          foundStartingWeights = true;
        }
      }

      if (!foundStartingRules && details.old_content_rules && typeof details.old_content_rules === 'object') {
        startingRules = toContentRules(details.old_content_rules as any);
        foundStartingRules = true;
      }
    }

    const voteCountResult = await db.query<{ count: string }>(
      `SELECT COUNT(*)::int AS count FROM governance_votes WHERE epoch_id = $1`,
      [roundId]
    );
    const voteCount = parseInt(voteCountResult.rows[0]?.count ?? '0', 10);

    const groupedVotesResult = await db.query<{
      recency_weight: number | null;
      engagement_weight: number | null;
      bridging_weight: number | null;
      source_diversity_weight: number | null;
      relevance_weight: number | null;
      count: string;
    }>(
      `SELECT
        recency_weight,
        engagement_weight,
        bridging_weight,
        source_diversity_weight,
        relevance_weight,
        COUNT(*)::int AS count
       FROM governance_votes
       WHERE epoch_id = $1
       GROUP BY recency_weight, engagement_weight, bridging_weight, source_diversity_weight, relevance_weight
       ORDER BY count DESC`,
      [roundId]
    );

    const nowMs = Date.now();
    const startMs = new Date(round.created_at).getTime();
    const endMs = round.closed_at ? new Date(round.closed_at).getTime() : nowMs;
    const durationMs = Math.max(0, endMs - startMs);

    return reply.send({
      round: mapRound(round, voteCount),
      startingWeights,
      endingWeights,
      startingRules,
      endingRules,
      voteCount,
      weightConfigurations: groupedVotesResult.rows.map((row) => ({
        count: parseInt(row.count, 10),
        weights:
          row.recency_weight === null ||
          row.engagement_weight === null ||
          row.bridging_weight === null ||
          row.source_diversity_weight === null ||
          row.relevance_weight === null
            ? null
            : {
                recency: row.recency_weight,
                engagement: row.engagement_weight,
                bridging: row.bridging_weight,
                sourceDiversity: row.source_diversity_weight,
                relevance: row.relevance_weight,
              },
      })),
      duration: {
        startedAt: round.created_at,
        endedAt: round.closed_at,
        durationMs,
      },
      auditTrail: auditResult.rows,
    });
  });

  app.post('/governance/end-round', async (request: FastifyRequest, reply: FastifyReply) => {
    const adminDid = getAdminDid(request);
    const parseResult = z
      .object({ force: z.boolean().optional().default(false) })
      .safeParse(request.body ?? {});

    if (!parseResult.success) {
      return reply.code(400).send({
        error: 'ValidationError',
        message: 'Invalid end-round payload',
        details: parseResult.error.issues,
      });
    }

    const { force } = parseResult.data;

    try {
      let newEpochId: number | undefined;

      if (force) {
        newEpochId = await forceEpochTransition();
      } else {
        const result = await triggerEpochTransition();
        if (!result.success || !result.newEpochId) {
          return reply.code(409).send({
            error: 'TransitionBlocked',
            message: result.error ?? 'Unable to transition round without force',
          });
        }
        newEpochId = result.newEpochId;
      }

      await db.query(
        `INSERT INTO governance_audit_log (action, actor_did, epoch_id, details)
         VALUES ('admin_end_round', $1, $2, $3)`,
        [adminDid, newEpochId, JSON.stringify({ force })]
      );

      return reply.send({
        success: true,
        newRoundId: newEpochId,
      });
    } catch (error) {
      logger.error({ error, adminDid }, 'Failed to end and start round');
      return reply.code(500).send({
        error: 'RoundTransitionFailed',
        message: 'Failed to end current round and start a new one',
      });
    }
  });
}
