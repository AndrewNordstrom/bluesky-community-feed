import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { dbQueryMock } = vi.hoisted(() => ({
  dbQueryMock: vi.fn(),
}));

vi.mock('../src/db/client.js', () => ({
  db: {
    query: dbQueryMock,
  },
}));

import { registerAuditAnalysisRoutes } from '../src/admin/routes/audit-analysis.js';

describe('admin weight impact audit endpoint', () => {
  beforeEach(() => {
    dbQueryMock.mockReset();
  });

  it('returns 404 when no active/voting epoch exists', async () => {
    dbQueryMock.mockResolvedValueOnce({ rows: [] });

    const app = Fastify();
    registerAuditAnalysisRoutes(app);

    const response = await app.inject({
      method: 'GET',
      url: '/audit/weight-impact',
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({
      error: 'NoActiveEpoch',
    });

    await app.close();
  });

  it('returns ranked decomposition and sensitivity metrics', async () => {
    dbQueryMock
      .mockResolvedValueOnce({
        rows: [
          {
            id: 2,
            recency_weight: 0.22,
            engagement_weight: 0.2,
            bridging_weight: 0.32,
            source_diversity_weight: 0.16,
            relevance_weight: 0.1,
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            post_uri: 'at://did:plc:a/post/1',
            text: 'first post',
            total_score: 0.82,
            recency_score: 0.95,
            engagement_score: 0.7,
            bridging_score: 0.9,
            source_diversity_score: 0.6,
            relevance_score: 0.5,
            recency_weighted: 0.209,
            engagement_weighted: 0.14,
            bridging_weighted: 0.288,
            source_diversity_weighted: 0.096,
            relevance_weighted: 0.05,
            current_rank: 1,
            equal_rank: 2,
          },
          {
            post_uri: 'at://did:plc:b/post/2',
            text: 'second post',
            total_score: 0.79,
            recency_score: 0.9,
            engagement_score: 0.85,
            bridging_score: 0.7,
            source_diversity_score: 0.7,
            relevance_score: 0.5,
            recency_weighted: 0.198,
            engagement_weighted: 0.17,
            bridging_weighted: 0.224,
            source_diversity_weighted: 0.112,
            relevance_weighted: 0.05,
            current_rank: 2,
            equal_rank: 1,
          },
          {
            post_uri: 'at://did:plc:c/post/3',
            text: 'third post',
            total_score: 0.7,
            recency_score: 0.8,
            engagement_score: 0.4,
            bridging_score: 0.8,
            source_diversity_score: 0.8,
            relevance_score: 0.5,
            recency_weighted: 0.176,
            engagement_weighted: 0.08,
            bridging_weighted: 0.256,
            source_diversity_weighted: 0.128,
            relevance_weighted: 0.05,
            current_rank: 3,
            equal_rank: 3,
          },
        ],
      });

    const app = Fastify();
    registerAuditAnalysisRoutes(app);

    const response = await app.inject({
      method: 'GET',
      url: '/audit/weight-impact?limit=2',
    });

    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body.currentEpochId).toBe(2);
    expect(body.topPosts).toHaveLength(2);
    expect(body.topPosts[0]).toMatchObject({
      rank: 1,
      dominantFactor: 'bridging',
      wouldRankWithEqualWeights: 2,
    });
    expect(body.weightSensitivity).toHaveProperty('recency');
    expect(body.weightSensitivity).toHaveProperty('engagement');
    expect(body.analyzedPosts).toBe(3);

    await app.close();
  });
});
