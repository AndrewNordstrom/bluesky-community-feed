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

import { registerPostExplainRoute } from '../src/transparency/routes/post-explain.js';
import { registerFeedStatsRoute } from '../src/transparency/routes/feed-stats.js';
import { registerCounterfactualRoute } from '../src/transparency/routes/counterfactual.js';

describe('transparency routes current-run scoping', () => {
  beforeEach(() => {
    dbQueryMock.mockReset();
  });

  it('scopes feed stats to current scoring run when run metadata exists', async () => {
    dbQueryMock
      .mockResolvedValueOnce({
        rows: [{ id: 2, status: 'active', recency_weight: 0.2, engagement_weight: 0.2, bridging_weight: 0.2, source_diversity_weight: 0.2, relevance_weight: 0.2, created_at: '2026-02-09T00:00:00.000Z' }],
      })
      .mockResolvedValueOnce({
        rows: [{ value: { run_id: 'run-1', epoch_id: 2 } }],
      })
      .mockResolvedValueOnce({
        rows: [{ total_posts: '10', unique_authors: '8', avg_bridging: '0.3', avg_engagement: '0.4', median_bridging: '0.25', median_total: '0.5' }],
      })
      .mockResolvedValueOnce({ rows: [{ count: '5' }] })
      .mockResolvedValueOnce({ rows: [] });

    const app = Fastify();
    registerFeedStatsRoute(app);

    const response = await app.inject({
      method: 'GET',
      url: '/api/transparency/stats',
    });

    expect(response.statusCode).toBe(200);
    expect(String(dbQueryMock.mock.calls[2]?.[0])).toContain("component_details->>'run_id'");

    await app.close();
  });

  it('scopes counterfactual ranking query to current run', async () => {
    dbQueryMock
      .mockResolvedValueOnce({
        rows: [{ id: 2, recency_weight: 0.2, engagement_weight: 0.2, bridging_weight: 0.2, source_diversity_weight: 0.2, relevance_weight: 0.2 }],
      })
      .mockResolvedValueOnce({
        rows: [{ value: { run_id: 'run-2', epoch_id: 2 } }],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            post_uri: 'at://did:plc:a/app.bsky.feed.post/1',
            recency_score: 0.8,
            engagement_score: 0.7,
            bridging_score: 0.6,
            source_diversity_score: 0.5,
            relevance_score: 0.4,
            total_score: 0.6,
          },
        ],
      });

    const app = Fastify();
    registerCounterfactualRoute(app);

    const response = await app.inject({
      method: 'GET',
      url: '/api/transparency/counterfactual',
    });

    expect(response.statusCode).toBe(200);
    expect(String(dbQueryMock.mock.calls[2]?.[0])).toContain("component_details->>'run_id'");

    await app.close();
  });

  it('scopes post explanation rank calculations to current run', async () => {
    dbQueryMock
      .mockResolvedValueOnce({ rows: [{ id: 3 }] })
      .mockResolvedValueOnce({ rows: [{ value: { run_id: 'run-3', epoch_id: 3 } }] })
      .mockResolvedValueOnce({
        rows: [
          {
            post_uri: 'at://did:plc:a/app.bsky.feed.post/1',
            epoch_id: 3,
            epoch_description: 'epoch',
            total_score: 0.7,
            recency_score: 0.8,
            engagement_score: 0.6,
            bridging_score: 0.5,
            source_diversity_score: 0.4,
            relevance_score: 0.3,
            recency_weight: 0.2,
            engagement_weight: 0.2,
            bridging_weight: 0.2,
            source_diversity_weight: 0.2,
            relevance_weight: 0.2,
            recency_weighted: 0.16,
            engagement_weighted: 0.12,
            bridging_weighted: 0.1,
            source_diversity_weighted: 0.08,
            relevance_weighted: 0.06,
            scored_at: '2026-02-09T00:00:00.000Z',
            component_details: { run_id: 'run-3' },
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ rank: '2' }] })
      .mockResolvedValueOnce({ rows: [{ rank: '5' }] });

    const app = Fastify();
    registerPostExplainRoute(app);

    const response = await app.inject({
      method: 'GET',
      url: `/api/transparency/post/${encodeURIComponent('at://did:plc:a/app.bsky.feed.post/1')}`,
    });

    expect(response.statusCode).toBe(200);
    expect(String(dbQueryMock.mock.calls[3]?.[0])).toContain("component_details->>'run_id'");
    expect(String(dbQueryMock.mock.calls[4]?.[0])).toContain("component_details->>'run_id'");

    await app.close();
  });
});
