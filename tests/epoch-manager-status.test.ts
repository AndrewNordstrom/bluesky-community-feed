import { beforeEach, describe, expect, it, vi } from 'vitest';

const { dbQueryMock } = vi.hoisted(() => ({
  dbQueryMock: vi.fn(),
}));

vi.mock('../src/db/client.js', () => ({
  db: {
    query: dbQueryMock,
  },
}));

import { getCurrentEpochStatus } from '../src/governance/epoch-manager.js';

describe('epoch manager vote eligibility status', () => {
  beforeEach(() => {
    dbQueryMock.mockReset();
  });

  it('uses weight-eligible votes for canTransition', async () => {
    dbQueryMock
      .mockResolvedValueOnce({
        rows: [{ id: 4, status: 'active' }],
      })
      .mockResolvedValueOnce({
        rows: [{ total: '11', weight_eligible: '4' }],
      });

    const status = await getCurrentEpochStatus();

    expect(status).toMatchObject({
      epochId: 4,
      status: 'active',
      voteCount: 4,
      totalVoteCount: 11,
      canTransition: false,
    });
    expect(String(dbQueryMock.mock.calls[1]?.[0])).toContain('recency_weight IS NOT NULL');
  });
});
