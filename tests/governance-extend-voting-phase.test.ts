import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  dbConnectMock,
  clientQueryMock,
  invalidateContentRulesCacheMock,
  aggregateVotesMock,
  aggregateContentVotesMock,
  tryTriggerManualScoringRunMock,
  forceEpochTransitionMock,
  triggerEpochTransitionMock,
} = vi.hoisted(() => ({
  dbConnectMock: vi.fn(),
  clientQueryMock: vi.fn(),
  invalidateContentRulesCacheMock: vi.fn(),
  aggregateVotesMock: vi.fn(),
  aggregateContentVotesMock: vi.fn(),
  tryTriggerManualScoringRunMock: vi.fn(),
  forceEpochTransitionMock: vi.fn(),
  triggerEpochTransitionMock: vi.fn(),
}));

vi.mock('../src/db/client.js', () => ({
  db: {
    connect: dbConnectMock,
  },
}));

vi.mock('../src/auth/admin.js', () => ({
  getAdminDid: () => 'did:plc:admin',
}));

vi.mock('../src/governance/content-filter.js', () => ({
  invalidateContentRulesCache: invalidateContentRulesCacheMock,
}));

vi.mock('../src/governance/aggregation.js', () => ({
  aggregateVotes: aggregateVotesMock,
  aggregateContentVotes: aggregateContentVotesMock,
}));

vi.mock('../src/scoring/scheduler.js', () => ({
  tryTriggerManualScoringRun: tryTriggerManualScoringRunMock,
}));

vi.mock('../src/governance/epoch-manager.js', () => ({
  forceEpochTransition: forceEpochTransitionMock,
  triggerEpochTransition: triggerEpochTransitionMock,
}));

import { registerGovernanceRoutes } from '../src/admin/routes/governance.js';

function epochRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 7,
    status: 'active',
    phase: 'running',
    voting_ends_at: '2026-02-10T00:00:00.000Z',
    auto_transition: true,
    recency_weight: 0.2,
    engagement_weight: 0.2,
    bridging_weight: 0.2,
    source_diversity_weight: 0.2,
    relevance_weight: 0.2,
    content_rules: {
      include_keywords: ['atproto'],
      exclude_keywords: ['spam'],
    },
    created_at: '2026-02-08T00:00:00.000Z',
    closed_at: null,
    ...overrides,
  };
}

describe('extend voting phase guard', () => {
  beforeEach(() => {
    dbConnectMock.mockReset();
    clientQueryMock.mockReset();
    invalidateContentRulesCacheMock.mockReset();
    aggregateVotesMock.mockReset();
    aggregateContentVotesMock.mockReset();
    tryTriggerManualScoringRunMock.mockReset();
    forceEpochTransitionMock.mockReset();
    triggerEpochTransitionMock.mockReset();

    dbConnectMock.mockResolvedValue({
      query: clientQueryMock,
      release: vi.fn(),
    });
  });

  it('returns 409 when extend-voting is called outside voting phase', async () => {
    clientQueryMock
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [epochRow({ phase: 'running', status: 'active' })] }) // current round
      .mockResolvedValueOnce({ rows: [] }); // ROLLBACK

    const app = Fastify();
    registerGovernanceRoutes(app);

    const response = await app.inject({
      method: 'POST',
      url: '/governance/extend-voting',
      payload: { hours: 24 },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: 'VotingClosed' });

    await app.close();
  });

  it('extends voting when phase is voting', async () => {
    clientQueryMock
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [epochRow({ phase: 'voting', status: 'active' })] }) // current round
      .mockResolvedValueOnce({
        rows: [epochRow({ phase: 'voting', status: 'active', voting_ends_at: '2026-02-12T00:00:00.000Z' })],
      }) // UPDATE
      .mockResolvedValueOnce({ rows: [{ count: '3' }] }) // vote count
      .mockResolvedValueOnce({ rows: [] }) // audit insert
      .mockResolvedValueOnce({ rows: [] }); // COMMIT

    const app = Fastify();
    registerGovernanceRoutes(app);

    const response = await app.inject({
      method: 'POST',
      url: '/governance/extend-voting',
      payload: { hours: 24 },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      success: true,
      round: {
        phase: 'voting',
        votingEndsAt: '2026-02-12T00:00:00.000Z',
      },
    });

    await app.close();
  });
});
