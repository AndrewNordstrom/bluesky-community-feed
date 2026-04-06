/**
 * Topic Weight Aggregation Tests
 *
 * Tests for aggregateTopicWeights() trimmed mean calculation.
 * Mocks DB to control vote data.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- Mocks (vi.hoisted runs before imports) ---
const { dbQueryMock } = vi.hoisted(() => ({
  dbQueryMock: vi.fn(),
}));

vi.mock('../src/db/client.js', () => ({
  db: {
    query: dbQueryMock,
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

import { aggregateTopicWeights } from '../src/governance/aggregation.js';

const ACTIVE_SLUGS = [
  { slug: 'software-development' },
  { slug: 'dogs-pets' },
  { slug: 'politics' },
];

/**
 * Setup db.query to return votes and active slugs.
 * Call index 0 = votes query, call index 1 = slug query.
 */
function setupMocks(votes: Array<{ topic_weight_votes: Record<string, number> }>): void {
  dbQueryMock.mockImplementation((sql: string) => {
    if (sql.includes('topic_weight_votes')) {
      return Promise.resolve({ rows: votes });
    }
    if (sql.includes('topic_catalog')) {
      return Promise.resolve({ rows: ACTIVE_SLUGS });
    }
    return Promise.resolve({ rows: [] });
  });
}

describe('aggregateTopicWeights', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty object when no votes are cast', async () => {
    setupMocks([]);
    const result = await aggregateTopicWeights(1);
    expect(result).toEqual({});
  });

  it('returns single voter values directly (no trimming)', async () => {
    setupMocks([{ topic_weight_votes: { 'software-development': 0.8, 'dogs-pets': 0.3 } }]);

    const result = await aggregateTopicWeights(1);

    expect(result['software-development']).toBe(0.8);
    expect(result['dogs-pets']).toBe(0.3);
    // politics not voted → excluded from result
    expect(result['politics']).toBeUndefined();
  });

  it('averages 3 voters for same topic without trimming (< 10 voters)', async () => {
    setupMocks([
      { topic_weight_votes: { 'software-development': 0.6 } },
      { topic_weight_votes: { 'software-development': 0.8 } },
      { topic_weight_votes: { 'software-development': 1.0 } },
    ]);

    const result = await aggregateTopicWeights(1);

    // Mean of [0.6, 0.8, 1.0] = 0.8
    expect(result['software-development']).toBeCloseTo(0.8, 3);
  });

  it('excludes topics with no votes (defaults to 0.5 at scoring time)', async () => {
    setupMocks([
      { topic_weight_votes: { 'software-development': 0.9 } },
      { topic_weight_votes: { 'software-development': 0.7 } },
    ]);

    const result = await aggregateTopicWeights(1);

    expect(result['software-development']).toBeDefined();
    // dogs-pets and politics not voted by anyone → not in result
    expect(result['dogs-pets']).toBeUndefined();
    expect(result['politics']).toBeUndefined();
  });

  it('handles voters who vote on different subsets of topics', async () => {
    setupMocks([
      { topic_weight_votes: { 'software-development': 0.9, 'dogs-pets': 0.4 } },
      { topic_weight_votes: { 'software-development': 0.7, politics: 0.2 } },
      { topic_weight_votes: { 'dogs-pets': 0.8 } },
    ]);

    const result = await aggregateTopicWeights(1);

    // software-development: mean([0.9, 0.7]) = 0.8
    expect(result['software-development']).toBeCloseTo(0.8, 3);
    // dogs-pets: mean([0.4, 0.8]) = 0.6
    expect(result['dogs-pets']).toBeCloseTo(0.6, 3);
    // politics: single voter = 0.2
    expect(result['politics']).toBeCloseTo(0.2, 3);
  });

  it('applies trimmed mean when 10+ voters exist', async () => {
    // 10 voters voting on software-development
    // Values: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0]
    // 10% trim = 1 from each end → trim 0.1 and 1.0
    // Remaining: [0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]
    // Mean = (0.2+0.3+0.4+0.5+0.6+0.7+0.8+0.9)/8 = 4.4/8 = 0.55
    const votes = Array.from({ length: 10 }, (_, i) => ({
      topic_weight_votes: { 'software-development': (i + 1) / 10 },
    }));

    setupMocks(votes);
    const result = await aggregateTopicWeights(1);

    expect(result['software-development']).toBeCloseTo(0.55, 3);
  });

  it('rounds results to 3 decimal places', async () => {
    setupMocks([
      { topic_weight_votes: { 'software-development': 0.333 } },
      { topic_weight_votes: { 'software-development': 0.666 } },
      { topic_weight_votes: { 'software-development': 0.111 } },
    ]);

    const result = await aggregateTopicWeights(1);

    // Mean = (0.333+0.666+0.111)/3 = 1.11/3 = 0.37
    // Should be rounded to 3 decimal places
    const str = result['software-development']!.toString();
    const decimals = str.split('.')[1] ?? '';
    expect(decimals.length).toBeLessThanOrEqual(3);
  });
});
