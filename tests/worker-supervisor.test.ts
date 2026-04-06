import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    debug: vi.fn(),
  },
}));

import type { ManagedWorker } from '../src/maintenance/worker-supervisor.js';
import { createWorkerSupervisor } from '../src/maintenance/worker-supervisor.js';

describe('worker supervisor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('retries worker startup and succeeds on third attempt', async () => {
    let running = false;
    const start = vi.fn(async () => {
      if (start.mock.calls.length < 3) {
        throw new Error('transient startup failure');
      }
      running = true;
    });
    const stop = vi.fn(async () => {
      running = false;
    });
    const worker: ManagedWorker = {
      name: 'cleanup',
      start,
      stop,
      isRunning: () => running,
    };

    const sleep = vi.fn(async () => {});
    const setIntervalFn = vi.fn(() => 1 as unknown as NodeJS.Timeout);
    const clearIntervalFn = vi.fn();

    const supervisor = createWorkerSupervisor({
      workers: [worker],
      retryAttempts: 3,
      retryDelayMs: 5_000,
      healthCheckIntervalMs: 300_000,
      sleep,
      setIntervalFn,
      clearIntervalFn,
      exitFn: vi.fn(),
    });

    await supervisor.start();

    expect(start).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(supervisor.isRunning()).toBe(true);

    await supervisor.stop();
    expect(stop).toHaveBeenCalledTimes(1);
    expect(clearIntervalFn).toHaveBeenCalledTimes(1);
  });

  it('exits when worker startup keeps failing after retries', async () => {
    const worker: ManagedWorker = {
      name: 'interaction-logger',
      start: vi.fn(async () => {
        throw new Error('persistent startup failure');
      }),
      stop: vi.fn(async () => {}),
      isRunning: () => false,
    };

    const sleep = vi.fn(async () => {});
    const exitFn = vi.fn();
    const setIntervalFn = vi.fn(() => 1 as unknown as NodeJS.Timeout);
    const clearIntervalFn = vi.fn();

    const supervisor = createWorkerSupervisor({
      workers: [worker],
      retryAttempts: 3,
      retryDelayMs: 5_000,
      healthCheckIntervalMs: 300_000,
      sleep,
      setIntervalFn,
      clearIntervalFn,
      exitFn,
    });

    await expect(supervisor.start()).rejects.toThrow(
      'Maintenance worker interaction-logger failed to start',
    );
    expect(worker.start).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(exitFn).toHaveBeenCalledWith(1);
    expect(supervisor.isRunning()).toBe(false);
  });

  it('restarts stopped workers during health checks', async () => {
    let running = false;
    const start = vi.fn(async () => {
      running = true;
    });
    const stop = vi.fn(async () => {
      running = false;
    });

    const worker: ManagedWorker = {
      name: 'interaction-aggregator',
      start,
      stop,
      isRunning: () => running,
    };

    const setIntervalFn = vi.fn(() => 1 as unknown as NodeJS.Timeout);
    const clearIntervalFn = vi.fn();
    const supervisor = createWorkerSupervisor({
      workers: [worker],
      setIntervalFn,
      clearIntervalFn,
      sleep: vi.fn(async () => {}),
      exitFn: vi.fn(),
    });

    await supervisor.start();
    expect(start).toHaveBeenCalledTimes(1);

    // Simulate worker unexpectedly stopping.
    running = false;
    await supervisor.checkNow();
    expect(start).toHaveBeenCalledTimes(2);

    await supervisor.stop();
    expect(stop).toHaveBeenCalledTimes(1);
  });
});
