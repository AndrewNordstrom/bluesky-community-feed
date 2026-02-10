import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { redisMock } = vi.hoisted(() => ({
  redisMock: {
    zrevrange: vi.fn(),
    setex: vi.fn(),
    get: vi.fn(),
  },
}));

vi.mock('../src/db/redis.js', () => ({
  redis: redisMock,
}));

import { config } from '../src/config.js';
import { registerFeedSkeleton } from '../src/feed/routes/feed-skeleton.js';

describe('getFeedSkeleton auth handling', () => {
  const feedUri = `at://${config.FEEDGEN_PUBLISHER_DID}/app.bsky.feed.generator/community-gov`;

  beforeEach(() => {
    redisMock.zrevrange.mockResolvedValue([
      'at://did:plc:testauthor/app.bsky.feed.post/1',
      'at://did:plc:testauthor/app.bsky.feed.post/2',
    ]);
    redisMock.setex.mockResolvedValue('OK');
    redisMock.get.mockResolvedValue(null);
  });

  it('returns 200 without auth header', async () => {
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

  it('returns 200 with malformed auth header', async () => {
    const app = Fastify();
    registerFeedSkeleton(app);

    const response = await app.inject({
      method: 'GET',
      url: `/xrpc/app.bsky.feed.getFeedSkeleton?feed=${encodeURIComponent(feedUri)}&limit=2`,
      headers: {
        authorization: 'Bearer malformed',
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.feed).toHaveLength(2);

    await app.close();
  });
});
