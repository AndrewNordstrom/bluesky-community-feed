import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';

async function loadDebugRoutesForEnv(nodeEnv: 'production' | 'development') {
  vi.resetModules();

  const requireAdminMock = vi.fn(async (_request: unknown, reply: { status: (code: number) => { send: (body: unknown) => void } }) => {
    reply.status(401).send({ error: 'Authentication required' });
  });
  const dbQueryMock = vi.fn();
  const redisZCardMock = vi.fn();
  const getCurrentContentRulesMock = vi.fn();
  const checkContentRulesMock = vi.fn();
  const filterPostsMock = vi.fn();

  vi.doMock('../src/config.js', () => ({
    config: {
      NODE_ENV: nodeEnv,
    },
  }));

  vi.doMock('../src/auth/admin.js', () => ({
    requireAdmin: requireAdminMock,
  }));

  vi.doMock('../src/db/client.js', () => ({
    db: {
      query: dbQueryMock,
    },
  }));

  vi.doMock('../src/db/redis.js', () => ({
    redis: {
      zcard: redisZCardMock,
    },
  }));

  vi.doMock('../src/governance/content-filter.js', () => ({
    getCurrentContentRules: getCurrentContentRulesMock,
    checkContentRules: checkContentRulesMock,
    filterPosts: filterPostsMock,
  }));

  const module = await import('../src/feed/routes/debug.js');

  return {
    registerDebugRoutes: module.registerDebugRoutes,
    requireAdminMock,
    dbQueryMock,
    redisZCardMock,
  };
}

describe('debug route access control', () => {
  it('requires admin auth in production', async () => {
    const { registerDebugRoutes, requireAdminMock, dbQueryMock } = await loadDebugRoutesForEnv('production');

    const app = Fastify();
    registerDebugRoutes(app);

    const response = await app.inject({
      method: 'GET',
      url: '/api/debug/scoring-weights',
    });

    expect(response.statusCode).toBe(401);
    expect(requireAdminMock).toHaveBeenCalledTimes(1);
    expect(dbQueryMock).not.toHaveBeenCalled();

    await app.close();
  });

  it('does not enforce admin auth in development', async () => {
    const { registerDebugRoutes, requireAdminMock, dbQueryMock } = await loadDebugRoutesForEnv('development');
    dbQueryMock.mockResolvedValueOnce({
      rows: [
        {
          id: 1,
          recency_weight: 0.2,
          engagement_weight: 0.2,
          bridging_weight: 0.2,
          source_diversity_weight: 0.2,
          relevance_weight: 0.2,
          created_at: '2026-02-09T00:00:00.000Z',
        },
      ],
    });

    const app = Fastify();
    registerDebugRoutes(app);

    const response = await app.inject({
      method: 'GET',
      url: '/api/debug/scoring-weights',
    });

    expect(response.statusCode).toBe(200);
    expect(requireAdminMock).not.toHaveBeenCalled();
    expect(dbQueryMock).toHaveBeenCalledTimes(1);

    await app.close();
  });
});
