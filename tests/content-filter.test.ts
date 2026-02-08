import { beforeEach, describe, expect, it, vi } from 'vitest';

const { dbQueryMock, redisGetMock, redisSetMock, redisDelMock } = vi.hoisted(() => ({
  dbQueryMock: vi.fn(),
  redisGetMock: vi.fn(),
  redisSetMock: vi.fn(),
  redisDelMock: vi.fn(),
}));

vi.mock('../src/db/client.js', () => ({
  db: {
    query: dbQueryMock,
  },
}));

vi.mock('../src/db/redis.js', () => ({
  redis: {
    get: redisGetMock,
    set: redisSetMock,
    del: redisDelMock,
  },
}));

import { getCurrentContentRules } from '../src/governance/content-filter.js';

describe('content filter cache fallback', () => {
  beforeEach(() => {
    dbQueryMock.mockReset();
    redisGetMock.mockReset();
    redisSetMock.mockReset();
    redisDelMock.mockReset();
  });

  it('returns cached rules on cache hit', async () => {
    redisGetMock.mockResolvedValue(
      JSON.stringify({
        includeKeywords: ['ai'],
        excludeKeywords: ['spam'],
      })
    );

    const rules = await getCurrentContentRules();

    expect(rules).toEqual({
      includeKeywords: ['ai'],
      excludeKeywords: ['spam'],
    });
    expect(dbQueryMock).not.toHaveBeenCalled();
  });

  it('falls back to database when Redis read fails', async () => {
    redisGetMock.mockRejectedValue(new Error('redis unavailable'));
    dbQueryMock.mockResolvedValue({
      rows: [
        {
          content_rules: {
            include_keywords: ['science'],
            exclude_keywords: ['ads'],
          },
        },
      ],
    });
    redisSetMock.mockResolvedValue('OK');

    const rules = await getCurrentContentRules();

    expect(rules).toEqual({
      includeKeywords: ['science'],
      excludeKeywords: ['ads'],
    });
    expect(dbQueryMock).toHaveBeenCalledTimes(1);
  });

  it('returns empty rules when Redis read fails and database query fails', async () => {
    redisGetMock.mockRejectedValue(new Error('redis unavailable'));
    dbQueryMock.mockRejectedValue(new Error('db unavailable'));

    const rules = await getCurrentContentRules();

    expect(rules).toEqual({
      includeKeywords: [],
      excludeKeywords: [],
    });
  });

  it('still returns database rules when cache write fails', async () => {
    redisGetMock.mockResolvedValue(null);
    dbQueryMock.mockResolvedValue({
      rows: [
        {
          content_rules: {
            include_keywords: ['governance'],
            exclude_keywords: ['politics'],
          },
        },
      ],
    });
    redisSetMock.mockRejectedValue(new Error('redis write failed'));

    const rules = await getCurrentContentRules();

    expect(rules).toEqual({
      includeKeywords: ['governance'],
      excludeKeywords: ['politics'],
    });
    expect(dbQueryMock).toHaveBeenCalledTimes(1);
  });
});
