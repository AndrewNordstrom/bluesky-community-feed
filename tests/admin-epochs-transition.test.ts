import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { dbQueryMock, forceEpochTransitionMock, triggerEpochTransitionMock } = vi.hoisted(() => ({
  dbQueryMock: vi.fn(),
  forceEpochTransitionMock: vi.fn(),
  triggerEpochTransitionMock: vi.fn(),
}));

vi.mock('../src/db/client.js', () => ({
  db: {
    query: dbQueryMock,
  },
}));

vi.mock('../src/auth/admin.js', () => ({
  getAdminDid: () => 'did:plc:admin',
}));

vi.mock('../src/governance/epoch-manager.js', () => ({
  forceEpochTransition: forceEpochTransitionMock,
  triggerEpochTransition: triggerEpochTransitionMock,
}));

import { registerEpochRoutes } from '../src/admin/routes/epochs.js';

describe('admin epoch transition route', () => {
  beforeEach(() => {
    dbQueryMock.mockReset();
    forceEpochTransitionMock.mockReset();
    triggerEpochTransitionMock.mockReset();
  });

  it('uses normal transition path when force is false', async () => {
    dbQueryMock
      .mockResolvedValueOnce({
        rows: [{ id: 12, vote_count: '7', weight_vote_count: '7' }],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 13, status: 'active' }] });
    triggerEpochTransitionMock.mockResolvedValue({ success: true, newEpochId: 13 });

    const app = Fastify();
    registerEpochRoutes(app);

    const response = await app.inject({
      method: 'POST',
      url: '/epochs/transition',
      payload: { force: false },
    });

    expect(response.statusCode).toBe(200);
    expect(triggerEpochTransitionMock).toHaveBeenCalledTimes(1);
    expect(forceEpochTransitionMock).not.toHaveBeenCalled();
    expect(response.json()).toMatchObject({
      success: true,
      previousEpochId: 12,
      voteCount: 7,
      weightVoteCount: 7,
    });

    await app.close();
  });

  it('blocks non-forced transition when weight-eligible votes are below minimum', async () => {
    dbQueryMock.mockResolvedValueOnce({
      rows: [{ id: 12, vote_count: '20', weight_vote_count: '1' }],
    });

    const app = Fastify();
    registerEpochRoutes(app);

    const response = await app.inject({
      method: 'POST',
      url: '/epochs/transition',
      payload: { force: false },
    });

    expect(response.statusCode).toBe(400);
    expect(triggerEpochTransitionMock).not.toHaveBeenCalled();
    expect(forceEpochTransitionMock).not.toHaveBeenCalled();
    expect(String(response.json().error)).toContain('Insufficient weight votes');

    await app.close();
  });
});
