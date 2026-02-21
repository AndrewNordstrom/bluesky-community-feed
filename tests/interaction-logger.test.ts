/**
 * Tests for the interaction logger background worker.
 * Verifies Redis queue draining and PostgreSQL insertion patterns.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { redisMock, dbQueryMock } = vi.hoisted(() => ({
  redisMock: {
    lpop: vi.fn(),
    rpush: vi.fn().mockResolvedValue(1),
  },
  dbQueryMock: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
}));

vi.mock('../src/db/redis.js', () => ({
  redis: redisMock,
}));

vi.mock('../src/db/client.js', () => ({
  db: {
    query: dbQueryMock,
  },
}));

// Suppress logger output in tests
vi.mock('../src/lib/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Import AFTER mocks are set up
const { startInteractionLogger, stopInteractionLogger } = await import(
  '../src/maintenance/interaction-logger.js'
);

function makeLogEntry(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    viewer_did: 'did:plc:test123',
    epoch_id: 2,
    snapshot_id: 'abc12345',
    page_offset: 0,
    posts_served: 2,
    post_uris: [
      'at://did:plc:author1/app.bsky.feed.post/1',
      'at://did:plc:author2/app.bsky.feed.post/2',
    ],
    position_start: 0,
    response_time_ms: 12,
    requested_at: '2026-02-20T10:00:00.000Z',
    ...overrides,
  });
}

describe('interaction logger', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('drains queue entries and inserts into feed_requests', async () => {
    // Return one entry then null (queue empty)
    redisMock.lpop
      .mockResolvedValueOnce(makeLogEntry())
      .mockResolvedValueOnce(null);

    // Start will run immediately then we stop
    await startInteractionLogger();
    await stopInteractionLogger();

    // Should have called db.query with INSERT INTO feed_requests
    const feedRequestCalls = dbQueryMock.mock.calls.filter(
      (call: unknown[]) => typeof call[0] === 'string' && call[0].includes('feed_requests')
    );
    expect(feedRequestCalls.length).toBeGreaterThanOrEqual(1);

    const sql = feedRequestCalls[0][0] as string;
    expect(sql).toContain('INSERT INTO feed_requests');
    expect(sql).toContain('viewer_did');
    expect(sql).toContain('epoch_id');
    expect(sql).toContain('snapshot_id');
  });

  it('creates engagement_attributions for authenticated requests', async () => {
    redisMock.lpop
      .mockResolvedValueOnce(makeLogEntry({ viewer_did: 'did:plc:authenticated' }))
      .mockResolvedValueOnce(null);

    await startInteractionLogger();
    await stopInteractionLogger();

    const attributionCalls = dbQueryMock.mock.calls.filter(
      (call: unknown[]) => typeof call[0] === 'string' && call[0].includes('engagement_attributions')
    );
    expect(attributionCalls.length).toBeGreaterThanOrEqual(1);

    const sql = attributionCalls[0][0] as string;
    expect(sql).toContain('INSERT INTO engagement_attributions');
    expect(sql).toContain('ON CONFLICT');
    expect(sql).toContain('DO NOTHING');
  });

  it('skips engagement_attributions for anonymous requests', async () => {
    redisMock.lpop
      .mockResolvedValueOnce(makeLogEntry({ viewer_did: null }))
      .mockResolvedValueOnce(null);

    await startInteractionLogger();
    await stopInteractionLogger();

    // Should still insert feed_requests
    const feedRequestCalls = dbQueryMock.mock.calls.filter(
      (call: unknown[]) => typeof call[0] === 'string' && call[0].includes('feed_requests')
    );
    expect(feedRequestCalls.length).toBeGreaterThanOrEqual(1);

    // But NOT engagement_attributions
    const attributionCalls = dbQueryMock.mock.calls.filter(
      (call: unknown[]) => typeof call[0] === 'string' && call[0].includes('engagement_attributions')
    );
    expect(attributionCalls).toHaveLength(0);
  });

  it('handles empty queue gracefully', async () => {
    redisMock.lpop.mockResolvedValue(null);

    await startInteractionLogger();
    await stopInteractionLogger();

    // No INSERT calls should happen
    const insertCalls = dbQueryMock.mock.calls.filter(
      (call: unknown[]) => typeof call[0] === 'string' && call[0].includes('INSERT')
    );
    expect(insertCalls).toHaveLength(0);
  });

  it('skips malformed entries without crashing', async () => {
    redisMock.lpop
      .mockResolvedValueOnce('not valid json {{{')
      .mockResolvedValueOnce(makeLogEntry()) // valid entry after malformed one
      .mockResolvedValueOnce(null);

    await startInteractionLogger();
    await stopInteractionLogger();

    // Should still process the valid entry
    const feedRequestCalls = dbQueryMock.mock.calls.filter(
      (call: unknown[]) => typeof call[0] === 'string' && call[0].includes('feed_requests')
    );
    expect(feedRequestCalls.length).toBeGreaterThanOrEqual(1);
  });

  it('processes multiple entries in one batch', async () => {
    redisMock.lpop
      .mockResolvedValueOnce(makeLogEntry({ snapshot_id: 'snap1' }))
      .mockResolvedValueOnce(makeLogEntry({ snapshot_id: 'snap2' }))
      .mockResolvedValueOnce(makeLogEntry({ snapshot_id: 'snap3' }))
      .mockResolvedValueOnce(null);

    await startInteractionLogger();
    await stopInteractionLogger();

    // Should batch all 3 into a single INSERT
    const feedRequestCalls = dbQueryMock.mock.calls.filter(
      (call: unknown[]) => typeof call[0] === 'string' && call[0].includes('INSERT INTO feed_requests')
    );
    expect(feedRequestCalls.length).toBeGreaterThanOrEqual(1);

    // The INSERT should contain multiple value placeholders
    const sql = feedRequestCalls[0][0] as string;
    const placeholderCount = (sql.match(/\$\d+/g) || []).length;
    // 3 entries × 7 columns = 21 placeholders
    expect(placeholderCount).toBe(21);
  });
});
