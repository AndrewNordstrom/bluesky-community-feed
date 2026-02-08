import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { dbQueryMock, tryTriggerManualScoringRunMock, getScoringStatusMock } = vi.hoisted(() => ({
  dbQueryMock: vi.fn(),
  tryTriggerManualScoringRunMock: vi.fn(),
  getScoringStatusMock: vi.fn(),
}));

vi.mock('../src/db/client.js', () => ({
  db: {
    query: dbQueryMock,
  },
}));

vi.mock('../src/db/redis.js', () => ({
  redis: {
    get: vi.fn(),
    zcard: vi.fn(),
  },
}));

vi.mock('../src/admin/status-tracker.js', () => ({
  getScoringStatus: getScoringStatusMock,
}));

vi.mock('../src/auth/admin.js', () => ({
  getAdminDid: () => 'did:plc:admin',
}));

vi.mock('../src/scoring/scheduler.js', () => ({
  tryTriggerManualScoringRun: tryTriggerManualScoringRunMock,
}));

import { registerFeedHealthRoutes } from '../src/admin/routes/feed-health.js';

describe('admin manual rescore overlap guard', () => {
  beforeEach(() => {
    dbQueryMock.mockReset();
    tryTriggerManualScoringRunMock.mockReset();
    getScoringStatusMock.mockReset();
  });

  it('returns 409 when scoring is already in progress', async () => {
    tryTriggerManualScoringRunMock.mockReturnValue(false);

    const app = Fastify();
    registerFeedHealthRoutes(app);

    const response = await app.inject({
      method: 'POST',
      url: '/feed/rescore',
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      error: 'Conflict',
    });
    expect(dbQueryMock).not.toHaveBeenCalled();

    await app.close();
  });

  it('starts manual scoring and writes audit log when idle', async () => {
    tryTriggerManualScoringRunMock.mockReturnValue(true);
    dbQueryMock.mockResolvedValue({ rows: [] });

    const app = Fastify();
    registerFeedHealthRoutes(app);

    const response = await app.inject({
      method: 'POST',
      url: '/feed/rescore',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      success: true,
    });
    expect(tryTriggerManualScoringRunMock).toHaveBeenCalledTimes(1);
    expect(dbQueryMock).toHaveBeenCalledTimes(1);
    expect(dbQueryMock.mock.calls[0]?.[0]).toContain('INSERT INTO governance_audit_log');

    await app.close();
  });
});
