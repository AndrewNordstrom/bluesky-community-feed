import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- Mocks (vi.hoisted runs before imports) ---
const {
  dbQueryMock,
  dbConnectMock,
  clientQueryMock,
  clientReleaseMock,
  redisZrangeMock,
} = vi.hoisted(() => ({
  dbQueryMock: vi.fn(),
  dbConnectMock: vi.fn(),
  clientQueryMock: vi.fn(),
  clientReleaseMock: vi.fn(),
  redisZrangeMock: vi.fn(),
}));

vi.mock('../src/db/client.js', () => ({
  db: {
    query: dbQueryMock,
    connect: dbConnectMock,
  },
}));

vi.mock('../src/db/redis.js', () => ({
  redis: {
    zrange: redisZrangeMock,
  },
}));

vi.mock('../src/lib/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { triggerManualCleanup } from '../src/maintenance/cleanup.js';

describe('cleanup job', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default: db.connect() returns a mock client
    dbConnectMock.mockResolvedValue({
      query: clientQueryMock,
      release: clientReleaseMock,
    });

    // Default: empty feed
    redisZrangeMock.mockResolvedValue([]);

    // Default: system_status write succeeds
    dbQueryMock.mockResolvedValue({ rows: [], rowCount: 0 });
  });

  it('deletes old unscored posts and preserves scored ones', async () => {
    // First batch: 95 posts deleted (simulating 100 total, 5 scored)
    // Second batch: 0 (done)
    let postDeleteCallCount = 0;
    clientQueryMock.mockImplementation(async (sql: string) => {
      if (typeof sql === 'string' && sql.includes('SET statement_timeout')) {
        return { rows: [], rowCount: 0 };
      }
      if (typeof sql === 'string' && sql.includes('DELETE FROM posts')) {
        postDeleteCallCount++;
        if (postDeleteCallCount === 1) {
          return { rowCount: 95, rows: Array(95).fill({}) };
        }
        return { rowCount: 0, rows: [] };
      }
      if (typeof sql === 'string' && sql.includes('DELETE FROM likes')) {
        return { rowCount: 0, rows: [] };
      }
      if (typeof sql === 'string' && sql.includes('DELETE FROM reposts')) {
        return { rowCount: 0, rows: [] };
      }
      return { rowCount: 0, rows: [] };
    });

    const result = await triggerManualCleanup();

    expect(result).not.toBeNull();
    expect(result!.postsDeleted).toBe(95);
    expect(result!.orphanedLikesDeleted).toBe(0);
    expect(result!.orphanedRepostsDeleted).toBe(0);

    // Verify the DELETE query includes NOT EXISTS (post_scores)
    const deleteCall = clientQueryMock.mock.calls.find(
      (call: unknown[]) => typeof call[0] === 'string' && (call[0] as string).includes('DELETE FROM posts')
    );
    expect(deleteCall).toBeDefined();
    expect(deleteCall![0]).toContain('NOT EXISTS');
    expect(deleteCall![0]).toContain('post_scores');
  });

  it('protects posts in Redis feed snapshot', async () => {
    const feedUris = ['at://did:plc:abc/app.bsky.feed.post/feed1', 'at://did:plc:abc/app.bsky.feed.post/feed2'];
    redisZrangeMock.mockResolvedValue(feedUris);

    clientQueryMock.mockResolvedValue({ rowCount: 0, rows: [] });

    await triggerManualCleanup();

    // Verify feed URIs were passed as the exclusion parameter
    const deleteCall = clientQueryMock.mock.calls.find(
      (call: unknown[]) => typeof call[0] === 'string' && (call[0] as string).includes('DELETE FROM posts')
    );
    expect(deleteCall).toBeDefined();
    expect(deleteCall![1]).toEqual(expect.arrayContaining([feedUris, expect.any(Number)]));
  });

  it('cleans orphaned likes and reposts', async () => {
    let postBatch = 0;
    let likeBatch = 0;
    let repostBatch = 0;

    clientQueryMock.mockImplementation(async (sql: string) => {
      if (typeof sql === 'string' && sql.includes('SET statement_timeout')) {
        return { rows: [], rowCount: 0 };
      }
      if (typeof sql === 'string' && sql.includes('DELETE FROM posts')) {
        postBatch++;
        if (postBatch === 1) return { rowCount: 50, rows: Array(50).fill({}) };
        return { rowCount: 0, rows: [] };
      }
      if (typeof sql === 'string' && sql.includes('DELETE FROM likes')) {
        likeBatch++;
        if (likeBatch === 1) return { rowCount: 12, rows: Array(12).fill({}) };
        return { rowCount: 0, rows: [] };
      }
      if (typeof sql === 'string' && sql.includes('DELETE FROM reposts')) {
        repostBatch++;
        if (repostBatch === 1) return { rowCount: 5, rows: Array(5).fill({}) };
        return { rowCount: 0, rows: [] };
      }
      return { rowCount: 0, rows: [] };
    });

    const result = await triggerManualCleanup();

    expect(result).not.toBeNull();
    expect(result!.postsDeleted).toBe(50);
    expect(result!.orphanedLikesDeleted).toBe(12);
    expect(result!.orphanedRepostsDeleted).toBe(5);
  });

  it('runs VACUUM only when threshold exceeded', async () => {
    // Delete 1500 posts (above VACUUM_THRESHOLD of 1000)
    let postBatch = 0;
    clientQueryMock.mockImplementation(async (sql: string) => {
      if (typeof sql === 'string' && sql.includes('SET statement_timeout')) {
        return { rows: [], rowCount: 0 };
      }
      if (typeof sql === 'string' && sql.includes('DELETE FROM posts')) {
        postBatch++;
        if (postBatch === 1) return { rowCount: 1500, rows: Array(1500).fill({}) };
        return { rowCount: 0, rows: [] };
      }
      if (typeof sql === 'string' && sql.includes('DELETE FROM likes')) {
        return { rowCount: 0, rows: [] };
      }
      if (typeof sql === 'string' && sql.includes('DELETE FROM reposts')) {
        return { rowCount: 0, rows: [] };
      }
      if (typeof sql === 'string' && sql.includes('VACUUM')) {
        return { rows: [], rowCount: 0 };
      }
      return { rowCount: 0, rows: [] };
    });

    const result = await triggerManualCleanup();

    expect(result).not.toBeNull();
    expect(result!.vacuumRan).toBe(true);

    // Verify VACUUM was called
    const vacuumCalls = clientQueryMock.mock.calls.filter(
      (call: unknown[]) => typeof call[0] === 'string' && (call[0] as string).includes('VACUUM')
    );
    expect(vacuumCalls.length).toBeGreaterThan(0);
  });

  it('skips VACUUM when below threshold', async () => {
    // Delete only 50 posts (below VACUUM_THRESHOLD)
    let postBatch = 0;
    clientQueryMock.mockImplementation(async (sql: string) => {
      if (typeof sql === 'string' && sql.includes('SET statement_timeout')) {
        return { rows: [], rowCount: 0 };
      }
      if (typeof sql === 'string' && sql.includes('DELETE FROM posts')) {
        postBatch++;
        if (postBatch === 1) return { rowCount: 50, rows: Array(50).fill({}) };
        return { rowCount: 0, rows: [] };
      }
      if (typeof sql === 'string' && sql.includes('DELETE FROM likes')) {
        return { rowCount: 0, rows: [] };
      }
      if (typeof sql === 'string' && sql.includes('DELETE FROM reposts')) {
        return { rowCount: 0, rows: [] };
      }
      return { rowCount: 0, rows: [] };
    });

    const result = await triggerManualCleanup();

    expect(result).not.toBeNull();
    expect(result!.vacuumRan).toBe(false);

    // Verify VACUUM was NOT called
    const vacuumCalls = clientQueryMock.mock.calls.filter(
      (call: unknown[]) => typeof call[0] === 'string' && (call[0] as string).includes('VACUUM')
    );
    expect(vacuumCalls.length).toBe(0);
  });

  it('handles empty feed:current gracefully', async () => {
    redisZrangeMock.mockResolvedValue([]);
    clientQueryMock.mockResolvedValue({ rowCount: 0, rows: [] });

    const result = await triggerManualCleanup();

    expect(result).not.toBeNull();
    expect(result!.postsDeleted).toBe(0);

    // Verify cleanup still ran (zrange was called)
    expect(redisZrangeMock).toHaveBeenCalledWith('feed:current', 0, -1);
  });

  it('handles Redis feed:current failure gracefully', async () => {
    redisZrangeMock.mockRejectedValue(new Error('redis connection failed'));
    clientQueryMock.mockResolvedValue({ rowCount: 0, rows: [] });

    const result = await triggerManualCleanup();

    // Should still complete (with empty protection list)
    expect(result).not.toBeNull();
    expect(result!.postsDeleted).toBe(0);
  });

  it('releases client connections even on error', async () => {
    clientQueryMock.mockImplementation(async (sql: string) => {
      if (typeof sql === 'string' && sql.includes('SET statement_timeout')) {
        return { rows: [], rowCount: 0 };
      }
      if (typeof sql === 'string' && sql.includes('DELETE FROM posts')) {
        throw new Error('query failed');
      }
      return { rowCount: 0, rows: [] };
    });

    // Should not throw (errors are caught internally)
    const result = await triggerManualCleanup();

    // Client should be released despite the error
    expect(clientReleaseMock).toHaveBeenCalled();

    // Result should still be returned (with 0 deletes since the error happened)
    expect(result).not.toBeNull();
  });
});
