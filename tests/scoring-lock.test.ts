import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- Mocks (vi.hoisted runs before imports) ---
const { redisSetMock, redisDelMock, runScoringPipelineMock } = vi.hoisted(() => ({
  redisSetMock: vi.fn(),
  redisDelMock: vi.fn(),
  runScoringPipelineMock: vi.fn(),
}));

vi.mock('../src/db/redis.js', () => ({
  redis: {
    set: redisSetMock,
    del: redisDelMock,
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

vi.mock('../src/config.js', () => ({
  config: {
    SCORING_INTERVAL_MS: 300_000,
  },
}));

vi.mock('../src/scoring/pipeline.js', () => ({
  runScoringPipeline: runScoringPipelineMock,
}));

import {
  startScoring,
  stopScoring,
  tryTriggerManualScoringRun,
  isScoringInProgress,
} from '../src/scoring/scheduler.js';

describe('scoring Redis distributed lock', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runScoringPipelineMock.mockResolvedValue(undefined);
  });

  it('acquires lock via Redis SET NX EX', async () => {
    // First call: SET NX succeeds (lock acquired)
    redisSetMock.mockResolvedValue('OK');
    redisDelMock.mockResolvedValue(1);

    const triggered = await tryTriggerManualScoringRun();

    expect(triggered).toBe(true);
    expect(redisSetMock).toHaveBeenCalledWith(
      'lock:scoring',
      expect.any(String),
      'EX',
      300,
      'NX'
    );
  });

  it('returns false when Redis SET NX returns null (lock held)', async () => {
    // SET NX returns null when key already exists
    redisSetMock.mockResolvedValue(null);

    const triggered = await tryTriggerManualScoringRun();

    expect(triggered).toBe(false);
  });

  it('releases lock by deleting the Redis key', async () => {
    redisSetMock.mockResolvedValue('OK');
    redisDelMock.mockResolvedValue(1);
    runScoringPipelineMock.mockResolvedValue(undefined);

    // Use triggerManualRun (awaitable) via startScoring + stopScoring
    // Or just trigger and wait for the fire-and-forget to settle
    await tryTriggerManualScoringRun();

    // Give the fire-and-forget pipeline time to complete
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(redisDelMock).toHaveBeenCalledWith('lock:scoring');
  });

  it('releases lock even when scoring pipeline throws', async () => {
    redisSetMock.mockResolvedValue('OK');
    redisDelMock.mockResolvedValue(1);
    runScoringPipelineMock.mockRejectedValue(new Error('pipeline crashed'));

    await tryTriggerManualScoringRun();

    // Give the fire-and-forget pipeline time to complete
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Lock should still be released despite pipeline failure
    expect(redisDelMock).toHaveBeenCalledWith('lock:scoring');
  });

  it('falls back to local boolean when Redis SET fails', async () => {
    redisSetMock.mockRejectedValue(new Error('redis connection refused'));
    redisDelMock.mockResolvedValue(1);

    // Should still acquire (local fallback)
    const triggered = await tryTriggerManualScoringRun();
    expect(triggered).toBe(true);
  });

  it('updates local isScoring mirror for health checks', async () => {
    redisSetMock.mockResolvedValue('OK');
    redisDelMock.mockResolvedValue(1);

    // Create a long-running pipeline to check isScoring mid-run
    let resolvePipeline: () => void;
    runScoringPipelineMock.mockImplementation(
      () => new Promise<void>((resolve) => { resolvePipeline = resolve; })
    );

    await tryTriggerManualScoringRun();

    // While pipeline is running, isScoring should be true
    expect(isScoringInProgress()).toBe(true);

    // Complete the pipeline
    resolvePipeline!();
    await new Promise((resolve) => setTimeout(resolve, 50));

    // After completion, isScoring should be false
    expect(isScoringInProgress()).toBe(false);
  });

  it('rejects when scheduler is shutting down', async () => {
    redisSetMock.mockResolvedValue('OK');
    redisDelMock.mockResolvedValue(1);

    // Start and immediately stop to set isShuttingDown = true
    await startScoring();
    await stopScoring();

    const triggered = await tryTriggerManualScoringRun();
    expect(triggered).toBe(false);
  });
});
