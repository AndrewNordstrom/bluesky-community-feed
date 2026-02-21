import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '../src/config.js';

const {
  getAuthenticatedDidMock,
  isBotEnabledMock,
  getBotDidMock,
  getPinnedAnnouncementMock,
  getRetryQueueLengthMock,
} = vi.hoisted(() => ({
  getAuthenticatedDidMock: vi.fn(),
  isBotEnabledMock: vi.fn(),
  getBotDidMock: vi.fn(),
  getPinnedAnnouncementMock: vi.fn(),
  getRetryQueueLengthMock: vi.fn(),
}));

vi.mock('../src/governance/auth.js', () => ({
  getAuthenticatedDid: getAuthenticatedDidMock,
  SessionStoreUnavailableError: class SessionStoreUnavailableError extends Error {},
}));

vi.mock('../src/bot/agent.js', () => ({
  isBotEnabled: isBotEnabledMock,
  getBotDid: getBotDidMock,
}));

vi.mock('../src/bot/poster.js', () => ({
  getPinnedAnnouncement: getPinnedAnnouncementMock,
  getRecentAnnouncements: vi.fn(),
  postAnnouncement: vi.fn(),
  unpinAnnouncement: vi.fn(),
}));

vi.mock('../src/bot/safe-poster.js', () => ({
  getRetryQueueLength: getRetryQueueLengthMock,
  clearRetryQueue: vi.fn(),
  processRetryQueue: vi.fn(),
}));

import { registerAnnounceRoute } from '../src/bot/routes/announce.js';

describe('bot status auth', () => {
  let app: ReturnType<typeof Fastify>;
  const originalAdminDids = config.BOT_ADMIN_DIDS;

  beforeEach(() => {
    app = Fastify();
    registerAnnounceRoute(app);
    (config as { BOT_ADMIN_DIDS: string }).BOT_ADMIN_DIDS = 'did:plc:admin1';

    getAuthenticatedDidMock.mockReset();
    isBotEnabledMock.mockReset();
    getBotDidMock.mockReset();
    getPinnedAnnouncementMock.mockReset();
    getRetryQueueLengthMock.mockReset();

    isBotEnabledMock.mockReturnValue(true);
    getBotDidMock.mockReturnValue('did:plc:bot123');
    getPinnedAnnouncementMock.mockResolvedValue(null);
    getRetryQueueLengthMock.mockResolvedValue(0);
  });

  afterEach(async () => {
    (config as { BOT_ADMIN_DIDS: string }).BOT_ADMIN_DIDS = originalAdminDids;
    await app.close();
  });

  it('requires authentication for bot status endpoint', async () => {
    getAuthenticatedDidMock.mockResolvedValueOnce(null);

    const res = await app.inject({
      method: 'GET',
      url: '/api/bot/status',
    });

    expect(res.statusCode).toBe(401);
  });

  it('rejects non-admin for bot status endpoint', async () => {
    getAuthenticatedDidMock.mockResolvedValueOnce('did:plc:not-admin');

    const res = await app.inject({
      method: 'GET',
      url: '/api/bot/status',
    });

    expect(res.statusCode).toBe(403);
  });

  it('returns bot status for authenticated admins', async () => {
    getAuthenticatedDidMock.mockResolvedValueOnce('did:plc:admin1');

    const res = await app.inject({
      method: 'GET',
      url: '/api/bot/status',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      enabled: true,
      botDid: 'did:plc:bot123',
      pinned: null,
      retryQueueLength: 0,
    });
  });
});
