import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { redisMock, dbQueryMock } = vi.hoisted(() => ({
  redisMock: {
    zrevrange: vi.fn(),
    setex: vi.fn(),
    get: vi.fn(),
  },
  dbQueryMock: vi.fn(),
}));

vi.mock('../src/db/redis.js', () => ({
  redis: redisMock,
}));

vi.mock('../src/db/client.js', () => ({
  db: {
    query: dbQueryMock,
  },
}));

import { config } from '../src/config.js';
import { registerFeedSkeleton } from '../src/feed/routes/feed-skeleton.js';

describe('getFeedSkeleton query validation', () => {
  const feedUri = `at://${config.FEEDGEN_PUBLISHER_DID}/app.bsky.feed.generator/community-gov`;

  beforeEach(() => {
    redisMock.zrevrange.mockResolvedValue([
      'at://did:plc:testauthor/app.bsky.feed.post/1',
      'at://did:plc:testauthor/app.bsky.feed.post/2',
    ]);
    redisMock.setex.mockResolvedValue('OK');
    redisMock.get.mockResolvedValue(null);
    dbQueryMock.mockReset();
  });

  it.each(['0', '101', '2.5', 'abc'])(
    'returns 400 for invalid limit value %s',
    async (limit) => {
      const app = Fastify();
      registerFeedSkeleton(app);

      const response = await app.inject({
        method: 'GET',
        url: `/xrpc/app.bsky.feed.getFeedSkeleton?feed=${encodeURIComponent(feedUri)}&limit=${encodeURIComponent(limit)}`,
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        error: 'ValidationError',
      });

      await app.close();
    }
  );

  it('returns 400 for invalid cursor', async () => {
    const app = Fastify();
    registerFeedSkeleton(app);

    const response = await app.inject({
      method: 'GET',
      url: `/xrpc/app.bsky.feed.getFeedSkeleton?feed=${encodeURIComponent(feedUri)}&cursor=not-a-valid-cursor`,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: 'ValidationError',
    });

    await app.close();
  });

  it.each([
    { s: 'snap', o: -1 },
    { s: 'snap', o: 1.5 },
    { s: 'snap', o: '2' },
  ])('returns 400 for structurally invalid cursor payload %o', async (payload) => {
    const app = Fastify();
    registerFeedSkeleton(app);

    const cursor = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const response = await app.inject({
      method: 'GET',
      url: `/xrpc/app.bsky.feed.getFeedSkeleton?feed=${encodeURIComponent(feedUri)}&cursor=${encodeURIComponent(cursor)}`,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: 'ValidationError',
    });

    await app.close();
  });

  it('returns 200 for valid query', async () => {
    const app = Fastify();
    registerFeedSkeleton(app);

    const response = await app.inject({
      method: 'GET',
      url: `/xrpc/app.bsky.feed.getFeedSkeleton?feed=${encodeURIComponent(feedUri)}&limit=2`,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.feed).toHaveLength(2);

    await app.close();
  });
});
