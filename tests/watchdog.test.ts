import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { isReadyMock, execFileMock } = vi.hoisted(() => ({
  isReadyMock: vi.fn(),
  execFileMock: vi.fn((_cmd: string, _args: string[], cb?: (err?: Error | null) => void) => cb?.(null)),
}));

vi.mock('../src/lib/health.js', () => ({
  isReady: isReadyMock,
}));

vi.mock('node:child_process', () => ({
  execFile: execFileMock,
}));

vi.mock('../src/lib/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
  },
}));

import { sdNotifyReady, startWatchdog, stopWatchdog } from '../src/lib/watchdog.js';

describe('watchdog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    delete process.env.NOTIFY_SOCKET;
    delete process.env.WATCHDOG_USEC;
    isReadyMock.mockResolvedValue(true);
  });

  afterEach(() => {
    stopWatchdog();
    vi.useRealTimers();
  });

  it('sdNotifyReady is a no-op without NOTIFY_SOCKET', () => {
    // Should not throw when NOTIFY_SOCKET is not set
    expect(() => sdNotifyReady()).not.toThrow();
  });

  it('startWatchdog is a no-op without NOTIFY_SOCKET', () => {
    expect(() => startWatchdog()).not.toThrow();
    expect(isReadyMock).not.toHaveBeenCalled();
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it('stopWatchdog is safe to call even if not started', () => {
    expect(() => stopWatchdog()).not.toThrow();
  });

  it('stopWatchdog can be called multiple times', () => {
    expect(() => {
      stopWatchdog();
      stopWatchdog();
    }).not.toThrow();
  });

  it('sends an immediate heartbeat after start when notify socket is present', async () => {
    process.env.NOTIFY_SOCKET = '/run/systemd/notify';
    process.env.WATCHDOG_USEC = '60000000'; // 60s watchdog => 30s heartbeat

    startWatchdog();
    await Promise.resolve();
    await Promise.resolve();

    expect(isReadyMock).toHaveBeenCalledTimes(1);
    expect(execFileMock).toHaveBeenCalledWith('systemd-notify', ['WATCHDOG=1'], expect.any(Function));
  });

  it('uses half of WATCHDOG_USEC for recurring heartbeat interval', async () => {
    process.env.NOTIFY_SOCKET = '/run/systemd/notify';
    process.env.WATCHDOG_USEC = '120000000'; // 120s watchdog => 60s heartbeat

    startWatchdog();
    await Promise.resolve();
    await Promise.resolve();
    expect(isReadyMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(59_000);
    expect(isReadyMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(isReadyMock).toHaveBeenCalledTimes(2);
  });
});
