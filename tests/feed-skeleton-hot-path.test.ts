import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';

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

describe('getFeedSkeleton requester auth hot path', () => {
  it('returns 200 without invoking requester auth verification', async () => {
    redisMock.zrevrange.mockResolvedValue([
      'at://did:plc:testauthor/app.bsky.feed.post/1',
      'at://did:plc:testauthor/app.bsky.feed.post/2',
    ]);
    redisMock.setex.mockResolvedValue('OK');
    redisMock.get.mockResolvedValue(null);

    const feedUri = `at://${config.FEEDGEN_PUBLISHER_DID}/app.bsky.feed.generator/community-gov`;

    const app = Fastify();
    registerFeedSkeleton(app);

    const response = await app.inject({
      method: 'GET',
      url: `/xrpc/app.bsky.feed.getFeedSkeleton?feed=${encodeURIComponent(feedUri)}&limit=2`,
      headers: {
        authorization: 'Bearer very.slow.token',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().feed).toHaveLength(2);

    await app.close();
  });
});
