/**
 * Post Explain Route
 *
 * GET /api/transparency/post/:uri
 *
 * Returns full explanation of why a post is ranked where it is:
 * - All 5 component scores (raw, weight, weighted)
 * - Current rank in feed
 * - Counterfactual: what rank would be with pure engagement
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { db } from '../../db/client.js';
import { logger } from '../../lib/logger.js';
import type { PostExplanation } from '../transparency.types.js';

interface CurrentScoringRunValue {
  run_id?: unknown;
  epoch_id?: unknown;
}

async function getCurrentScoringRunScope(): Promise<{ runId: string; epochId: number } | null> {
  const result = await db.query<{ value: CurrentScoringRunValue }>(
    `SELECT value
     FROM system_status
     WHERE key = 'current_scoring_run'`
  );

  const value = result.rows[0]?.value;
  if (!value || typeof value !== 'object') {
    return null;
  }

  if (typeof value.run_id !== 'string' || typeof value.epoch_id !== 'number') {
    return null;
  }

  return {
    runId: value.run_id,
    epochId: value.epoch_id,
  };
}

export function registerPostExplainRoute(app: FastifyInstance): void {
  app.get(
    '/api/transparency/post/:uri',
    async (request: FastifyRequest<{ Params: { uri: string } }>, reply: FastifyReply) => {
      const { uri } = request.params;

      // Decode the URI (may be URL-encoded)
      const decodedUri = decodeURIComponent(uri);

      try {
        const epochResult = await db.query<{ id: number }>(
          `SELECT id
           FROM governance_epochs
           WHERE status = 'active'
           ORDER BY id DESC
           LIMIT 1`
        );

        if (epochResult.rows.length === 0) {
          return reply.code(404).send({
            error: 'NoActiveEpoch',
            message: 'No active governance epoch found.',
          });
        }

        const epochId = epochResult.rows[0].id;
        const runScope = await getCurrentScoringRunScope();

        // Get the most recent score for this post in the active epoch/current run
        const scoreParams: unknown[] = [decodedUri, epochId];
        let runScopeClause = '';
        if (runScope?.epochId === epochId) {
          scoreParams.push(runScope.runId);
          runScopeClause = `AND ps.component_details->>'run_id' = $${scoreParams.length}`;
        }

        const scoreResult = await db.query(
          `SELECT ps.*, ge.description as epoch_description
           FROM post_scores ps
           JOIN governance_epochs ge ON ps.epoch_id = ge.id
           WHERE ps.post_uri = $1
             AND ps.epoch_id = $2
             ${runScopeClause}
           ORDER BY ps.scored_at DESC
           LIMIT 1`,
          scoreParams
        );

        if (scoreResult.rows.length === 0) {
          return reply.code(404).send({
            error: 'NotFound',
            message: 'Score not found for this post. The post may not have been scored yet.',
          });
        }

        const s = scoreResult.rows[0];
        const scopedRunId =
          s.component_details &&
          typeof s.component_details === 'object' &&
          typeof (s.component_details as { run_id?: unknown }).run_id === 'string'
            ? (s.component_details as { run_id: string }).run_id
            : null;

        // Get rank position (how many posts have higher scores in same epoch)
        const rankParams: unknown[] = [s.epoch_id, s.total_score];
        let rankRunClause = '';
        if (scopedRunId) {
          rankParams.push(scopedRunId);
          rankRunClause = `AND component_details->>'run_id' = $${rankParams.length}`;
        }

        const rankResult = await db.query(
          `SELECT COUNT(*) + 1 as rank
           FROM post_scores
           WHERE epoch_id = $1 AND total_score > $2
             ${rankRunClause}`,
          rankParams
        );

        // Compute counterfactual: what would rank be with pure engagement?
        const engagementRankParams: unknown[] = [s.epoch_id, s.engagement_score];
        let engagementRunClause = '';
        if (scopedRunId) {
          engagementRankParams.push(scopedRunId);
          engagementRunClause = `AND component_details->>'run_id' = $${engagementRankParams.length}`;
        }

        const engagementRankResult = await db.query(
          `SELECT COUNT(*) + 1 as rank
           FROM post_scores
           WHERE epoch_id = $1 AND engagement_score > $2
             ${engagementRunClause}`,
          engagementRankParams
        );

        const rank = parseInt(rankResult.rows[0].rank, 10);
        const pureEngagementRank = parseInt(engagementRankResult.rows[0].rank, 10);

        const explanation: PostExplanation = {
          post_uri: s.post_uri,
          epoch_id: s.epoch_id,
          epoch_description: s.epoch_description,
          total_score: parseFloat(s.total_score),
          rank,
          components: {
            recency: {
              raw_score: parseFloat(s.recency_score),
              weight: parseFloat(s.recency_weight),
              weighted: parseFloat(s.recency_weighted),
            },
            engagement: {
              raw_score: parseFloat(s.engagement_score),
              weight: parseFloat(s.engagement_weight),
              weighted: parseFloat(s.engagement_weighted),
            },
            bridging: {
              raw_score: parseFloat(s.bridging_score),
              weight: parseFloat(s.bridging_weight),
              weighted: parseFloat(s.bridging_weighted),
            },
            source_diversity: {
              raw_score: parseFloat(s.source_diversity_score),
              weight: parseFloat(s.source_diversity_weight),
              weighted: parseFloat(s.source_diversity_weighted),
            },
            relevance: {
              raw_score: parseFloat(s.relevance_score),
              weight: parseFloat(s.relevance_weight),
              weighted: parseFloat(s.relevance_weighted),
            },
          },
          governance_weights: {
            recency: parseFloat(s.recency_weight),
            engagement: parseFloat(s.engagement_weight),
            bridging: parseFloat(s.bridging_weight),
            source_diversity: parseFloat(s.source_diversity_weight),
            relevance: parseFloat(s.relevance_weight),
          },
          counterfactual: {
            pure_engagement_rank: pureEngagementRank,
            community_governed_rank: rank,
            difference: pureEngagementRank - rank,
          },
          scored_at: s.scored_at,
          component_details: s.component_details,
        };

        return reply.send(explanation);
      } catch (err) {
        logger.error({ err, uri: decodedUri }, 'Error fetching post explanation');
        return reply.code(500).send({
          error: 'InternalError',
          message: 'An error occurred while fetching the post explanation',
        });
      }
    }
  );
}
