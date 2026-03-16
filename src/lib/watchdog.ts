/**
 * Systemd Watchdog Integration
 *
 * Sends sd_notify messages to systemd via systemd-notify(1):
 * - READY=1     — signals successful startup (Type=notify)
 * - WATCHDOG=1  — heartbeat (must arrive within WatchdogSec or systemd kills us)
 *
 * If NOTIFY_SOCKET is not set (dev, Docker, tests) all calls are silent no-ops.
 * Uses execFile (not exec) with hardcoded args — no shell injection risk.
 */

import { execFile } from 'node:child_process';
import { logger } from './logger.js';
import { isReady } from './health.js';

// Default to 60s if systemd does not set WATCHDOG_USEC.
const DEFAULT_WATCHDOG_MS = 60_000;
// Never schedule faster than 1s to avoid tight loops on malformed env.
const MIN_HEARTBEAT_INTERVAL_MS = 1_000;

function hasNotifySocket(): boolean {
  return Boolean(process.env.NOTIFY_SOCKET);
}

function getWatchdogIntervalMs(): number {
  const raw = process.env.WATCHDOG_USEC;
  if (!raw) return DEFAULT_WATCHDOG_MS / 2;

  const watchdogUsec = Number(raw);
  if (!Number.isFinite(watchdogUsec) || watchdogUsec <= 0) {
    return DEFAULT_WATCHDOG_MS / 2;
  }

  const watchdogMs = Math.floor(watchdogUsec / 1000);
  return Math.max(MIN_HEARTBEAT_INTERVAL_MS, Math.floor(watchdogMs / 2));
}

/**
 * Send a watchdog heartbeat to systemd via systemd-notify(1).
 * No-op if NOTIFY_SOCKET is not set (non-systemd environments).
 */
function sdNotifyWatchdog(): void {
  if (!hasNotifySocket()) return;

  // execFile with hardcoded args — safe, no shell injection possible
  execFile('systemd-notify', ['WATCHDOG=1'], (err) => {
    if (err) {
      logger.warn({ err }, 'sd_notify WATCHDOG=1 failed');
    }
  });
}

/**
 * Tell systemd the service is ready to accept connections.
 * Call once after HTTP server is listening.
 */
export function sdNotifyReady(): void {
  if (!hasNotifySocket()) return;

  // execFile with hardcoded args — safe, no shell injection possible
  execFile('systemd-notify', ['--ready'], (err) => {
    if (err) {
      logger.warn({ err }, 'sd_notify READY=1 failed');
    } else {
      logger.info('sd_notify: READY=1 sent to systemd');
    }
  });
}

/**
 * Send a single watchdog heartbeat.
 * Only sends if health checks pass (DB + Redis healthy).
 */
async function sendHeartbeat(): Promise<void> {
  try {
    const healthy = await isReady();
    if (healthy) {
      sdNotifyWatchdog();
    } else {
      logger.warn('Watchdog heartbeat skipped — service not ready (DB or Redis unhealthy)');
    }
  } catch (err) {
    logger.warn({ err }, 'Watchdog heartbeat check failed');
    // Don't send heartbeat on error — let systemd kill us if this persists
  }
}

// Interval handle for cleanup during shutdown
let heartbeatInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Start the watchdog heartbeat loop.
 *
 * Sends WATCHDOG=1 every 30s (half of WatchdogSec=60 in the service file).
 * If isReady() returns false, the heartbeat is skipped. Two consecutive
 * skips (60s) cause systemd to kill the process, and Restart=on-failure
 * brings it back.
 *
 * No-op if NOTIFY_SOCKET is not set.
 */
export function startWatchdog(): void {
  if (!hasNotifySocket()) {
    logger.debug('NOTIFY_SOCKET not set — watchdog disabled (non-systemd environment)');
    return;
  }

  // Ensure we never leave a stale interval around if called twice.
  stopWatchdog();

  // Send first heartbeat immediately so long startup paths do not miss
  // the initial watchdog deadline.
  sendHeartbeat().catch((err) => {
    logger.error({ err }, 'Initial watchdog heartbeat failed');
  });

  const intervalMs = getWatchdogIntervalMs();

  heartbeatInterval = setInterval(() => {
    sendHeartbeat().catch((err) => {
      logger.error({ err }, 'Watchdog heartbeat loop error');
    });
  }, intervalMs);

  // Don't prevent process exit
  heartbeatInterval.unref();

  logger.info({ intervalMs }, 'Watchdog heartbeat started');
}

/**
 * Stop the watchdog heartbeat loop.
 * Called during graceful shutdown.
 */
export function stopWatchdog(): void {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
    logger.debug('Watchdog heartbeat stopped');
  }
}
