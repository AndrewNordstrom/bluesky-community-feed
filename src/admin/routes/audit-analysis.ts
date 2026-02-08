/**
 * Admin Audit Analysis Routes
 *
 * Analytics endpoints for governance integrity and ranking impact.
 */

import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { db } from '../../db/client.js';
import { GovernanceWeights, normalizeWeights } from '../../governance/governance.types.js';

type ComponentKey = keyof GovernanceWeights;

const COMPONENT_KEYS: ComponentKey[] = [
  'recency',
  'engagement',
  'bridging',
  'sourceDiversity',
  'relevance',
];

const QuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

interface EpochRow {
  id: number;
  recency_weight: number | string;
  engagement_weight: number | string;
  bridging_weight: number | string;
  source_diversity_weight: number | string;
  relevance_weight: number | string;
}

interface RankedScoreRow {
  post_uri: string;
  text: string | null;
  total_score: number | string;
  recency_score: number | string;
  engagement_score: number | string;
  bridging_score: number | string;
  source_diversity_score: number | string;
  relevance_score: number | string;
  recency_weighted: number | string;
  engagement_weighted: number | string;
  bridging_weighted: number | string;
  source_diversity_weighted: number | string;
  relevance_weighted: number | string;
  current_rank: number | string;
  equal_rank: number | string;
}

interface ScoreVector {
  recency: number;
  engagement: number;
  bridging: number;
  sourceDiversity: number;
  relevance: number;
}

function toNumber(value: number | string): number {
  return typeof value === 'number' ? value : parseFloat(value);
}

function toWeights(row: EpochRow): GovernanceWeights {
  return {
    recency: toNumber(row.recency_weight),
    engagement: toNumber(row.engagement_weight),
    bridging: toNumber(row.bridging_weight),
    sourceDiversity: toNumber(row.source_diversity_weight),
    relevance: toNumber(row.relevance_weight),
  };
}

function extractRawScores(row: RankedScoreRow): ScoreVector {
  return {
    recency: toNumber(row.recency_score),
    engagement: toNumber(row.engagement_score),
    bridging: toNumber(row.bridging_score),
    sourceDiversity: toNumber(row.source_diversity_score),
    relevance: toNumber(row.relevance_score),
  };
}

function scoreWithWeights(raw: ScoreVector, weights: GovernanceWeights): number {
  return (
    raw.recency * weights.recency +
    raw.engagement * weights.engagement +
    raw.bridging * weights.bridging +
    raw.sourceDiversity * weights.sourceDiversity +
    raw.relevance * weights.relevance
  );
}

function shiftSingleWeight(
  base: GovernanceWeights,
  targetKey: ComponentKey,
  multiplier: number
): GovernanceWeights {
  const next: GovernanceWeights = { ...base };
  const originalTarget = base[targetKey];
  const adjustedTarget = Math.min(1, Math.max(0, originalTarget * multiplier));
  const delta = adjustedTarget - originalTarget;

  if (Math.abs(delta) < 0.0000001) {
    return normalizeWeights(next);
  }

  const otherKeys = COMPONENT_KEYS.filter((key) => key !== targetKey);
  const othersTotal = otherKeys.reduce((sum, key) => sum + base[key], 0);

  next[targetKey] = adjustedTarget;

  if (delta > 0) {
    if (othersTotal <= 0) {
      return normalizeWeights(base);
    }

    for (const key of otherKeys) {
      next[key] = Math.max(0, base[key] - (delta * base[key]) / othersTotal);
    }
  } else {
    const increase = Math.abs(delta);

    if (othersTotal > 0) {
      for (const key of otherKeys) {
        next[key] = base[key] + (increase * base[key]) / othersTotal;
      }
    } else {
      const evenIncrease = increase / otherKeys.length;
      for (const key of otherKeys) {
        next[key] = base[key] + evenIncrease;
      }
    }
  }

  return normalizeWeights(next);
}

function simulateRankMap(
  rows: RankedScoreRow[],
  weights: GovernanceWeights
): Map<string, number> {
  const scored = rows
    .map((row) => ({
      uri: row.post_uri,
      simulatedScore: scoreWithWeights(extractRawScores(row), weights),
    }))
    .sort((a, b) => {
      if (b.simulatedScore !== a.simulatedScore) {
        return b.simulatedScore - a.simulatedScore;
      }
      return a.uri.localeCompare(b.uri);
    });

  const rankMap = new Map<string, number>();
  scored.forEach((item, index) => {
    rankMap.set(item.uri, index + 1);
  });

  return rankMap;
}

function computeScenarioMetrics(
  baselineRankMap: Map<string, number>,
  simulatedRankMap: Map<string, number>
): { changedCount: number; avgAbsRankChange: number } {
  let changedCount = 0;
  let absDeltaSum = 0;

  for (const [uri, baselineRank] of baselineRankMap.entries()) {
    const simulatedRank = simulatedRankMap.get(uri);
    if (!simulatedRank) {
      continue;
    }

    const delta = Math.abs(simulatedRank - baselineRank);
    if (delta > 0) {
      changedCount += 1;
      absDeltaSum += delta;
    }
  }

  return {
    changedCount,
    avgAbsRankChange: changedCount > 0 ? absDeltaSum / changedCount : 0,
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function getDominantFactor(row: RankedScoreRow): ComponentKey {
  const weightedValues: Record<ComponentKey, number> = {
    recency: toNumber(row.recency_weighted),
    engagement: toNumber(row.engagement_weighted),
    bridging: toNumber(row.bridging_weighted),
    sourceDiversity: toNumber(row.source_diversity_weighted),
    relevance: toNumber(row.relevance_weighted),
  };

  let dominant: ComponentKey = 'recency';
  for (const key of COMPONENT_KEYS) {
    if (weightedValues[key] > weightedValues[dominant]) {
      dominant = key;
    }
  }

  return dominant;
}

function toTextPreview(text: string | null): string | null {
  if (!text) {
    return null;
  }

  const trimmed = text.trim();
  if (trimmed.length <= 160) {
    return trimmed;
  }

  return `${trimmed.slice(0, 157)}...`;
}

export function registerAuditAnalysisRoutes(app: FastifyInstance): void {
  app.get('/audit/weight-impact', async (request: FastifyRequest, reply: FastifyReply) => {
    const parseResult = QuerySchema.safeParse(request.query);

    if (!parseResult.success) {
      return reply.code(400).send({
        error: 'ValidationError',
        message: 'Invalid weight impact query parameters',
        details: parseResult.error.issues,
      });
    }

    const { limit } = parseResult.data;

    const epochResult = await db.query<EpochRow>(
      `SELECT id,
              recency_weight,
              engagement_weight,
              bridging_weight,
              source_diversity_weight,
              relevance_weight
       FROM governance_epochs
       WHERE status IN ('active', 'voting')
       ORDER BY id DESC
       LIMIT 1`
    );

    if (epochResult.rows.length === 0) {
      return reply.code(404).send({
        error: 'NoActiveEpoch',
        message: 'No active governance epoch found',
      });
    }

    const epoch = epochResult.rows[0];
    const currentWeights = toWeights(epoch);

    const rankedResult = await db.query<RankedScoreRow>(
      `WITH ranked AS (
         SELECT
           ps.post_uri,
           p.text,
           ps.total_score,
           ps.recency_score,
           ps.engagement_score,
           ps.bridging_score,
           ps.source_diversity_score,
           ps.relevance_score,
           ps.recency_weighted,
           ps.engagement_weighted,
           ps.bridging_weighted,
           ps.source_diversity_weighted,
           ps.relevance_weighted,
           ROW_NUMBER() OVER (ORDER BY ps.total_score DESC, ps.post_uri) AS current_rank,
           ROW_NUMBER() OVER (
             ORDER BY (
               ps.recency_score * 0.2 +
               ps.engagement_score * 0.2 +
               ps.bridging_score * 0.2 +
               ps.source_diversity_score * 0.2 +
               ps.relevance_score * 0.2
             ) DESC,
             ps.post_uri
           ) AS equal_rank
         FROM post_scores ps
         LEFT JOIN posts p ON p.uri = ps.post_uri
         WHERE ps.epoch_id = $1
       )
       SELECT *
       FROM ranked
       ORDER BY current_rank`,
      [epoch.id]
    );

    const rows = rankedResult.rows;

    if (rows.length === 0) {
      return reply.send({
        currentEpochId: epoch.id,
        currentWeights,
        topPosts: [],
        weightSensitivity: {},
        analyzedPosts: 0,
        generatedAt: new Date().toISOString(),
      });
    }

    const topPosts = rows
      .filter((row) => toNumber(row.current_rank) <= limit)
      .map((row) => ({
        uri: row.post_uri,
        textPreview: toTextPreview(row.text),
        rank: toNumber(row.current_rank),
        totalScore: toNumber(row.total_score),
        components: {
          recency: {
            raw: toNumber(row.recency_score),
            weighted: toNumber(row.recency_weighted),
          },
          engagement: {
            raw: toNumber(row.engagement_score),
            weighted: toNumber(row.engagement_weighted),
          },
          bridging: {
            raw: toNumber(row.bridging_score),
            weighted: toNumber(row.bridging_weighted),
          },
          sourceDiversity: {
            raw: toNumber(row.source_diversity_score),
            weighted: toNumber(row.source_diversity_weighted),
          },
          relevance: {
            raw: toNumber(row.relevance_score),
            weighted: toNumber(row.relevance_weighted),
          },
        },
        dominantFactor: getDominantFactor(row),
        wouldRankWithEqualWeights: toNumber(row.equal_rank),
      }));

    const sensitivityBaseRows = rows.filter((row) => toNumber(row.current_rank) <= 100);
    const baselineRankMap = new Map<string, number>(
      sensitivityBaseRows.map((row) => [row.post_uri, toNumber(row.current_rank)])
    );

    const weightSensitivity = Object.fromEntries(
      COMPONENT_KEYS.map((key) => {
        const plusWeights = shiftSingleWeight(currentWeights, key, 1.1);
        const minusWeights = shiftSingleWeight(currentWeights, key, 0.9);

        const plusMetrics = computeScenarioMetrics(
          baselineRankMap,
          simulateRankMap(sensitivityBaseRows, plusWeights)
        );
        const minusMetrics = computeScenarioMetrics(
          baselineRankMap,
          simulateRankMap(sensitivityBaseRows, minusWeights)
        );

        return [
          key,
          {
            postsAffected: Math.round((plusMetrics.changedCount + minusMetrics.changedCount) / 2),
            avgRankChange: round2((plusMetrics.avgAbsRankChange + minusMetrics.avgAbsRankChange) / 2),
          },
        ];
      })
    );

    return reply.send({
      currentEpochId: epoch.id,
      currentWeights,
      topPosts,
      weightSensitivity,
      analyzedPosts: sensitivityBaseRows.length,
      generatedAt: new Date().toISOString(),
    });
  });
}
