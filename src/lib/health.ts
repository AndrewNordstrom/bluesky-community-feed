/**
 * Health Check Module
 *
 * Provides deep health checks for all system dependencies:
 * - PostgreSQL: SELECT 1 query with timeout
 * - Redis: PING command with timeout
 * - Jetstream: WebSocket connection state
 * - Scoring: Scheduler status and last run time
 *
 * Returns structured health status for monitoring and k8s probes.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { db, healthDb } from '../db/client.js';
import { redis } from '../db/redis.js';
import { logger } from './logger.js';
import type { DiskStatus } from '../maintenance/disk-monitor.js';

export interface ComponentHealth {
  status: 'healthy' | 'unhealthy';
  latency_ms?: number;
  error?: string;
}

export interface JetstreamHealth extends ComponentHealth {
  connected: boolean;
  last_event_age_ms?: number;
}

export interface ScoringHealth extends ComponentHealth {
  is_running: boolean;
  last_run_at?: string;
}

export interface DiskHealth extends ComponentHealth {
  used_percent: number;
  available_gb: number;
  level: 'ok' | 'warning' | 'critical' | 'emergency';
}

export interface FeedFreshnessHealth extends ComponentHealth {
  feed_size: number;
  feed_age_ms?: number;
  scoring_age_ms?: number;
}

export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  components: {
    database: ComponentHealth;
    redis: ComponentHealth;
    jetstream: JetstreamHealth;
    scoring: ScoringHealth;
    disk: DiskHealth;
    feed_freshness: FeedFreshnessHealth;
  };
}

export interface PublicHealthStatus {
  status: 'ok' | 'degraded';
  revision: string | null;
}

export class ReleaseRevisionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReleaseRevisionError';
  }
}

const RELEASE_REVISION_PATTERN = /^[0-9a-f]{40}$/;

interface RuntimeReleaseState {
  revision: string | null;
  state: 'available' | 'missing' | 'invalid';
}

export function readReleaseRevision(revisionPath: string): string | null {
  let revision: string;
  try {
    // The workflow writer emits exactly one final line ending. Remove only
    // that delimiter: trim() would incorrectly accept injected whitespace.
    revision = readFileSync(revisionPath, 'utf8').replace(/\r?\n$/, '');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return null;
    }
    const cause = error instanceof Error ? error.message : String(error);
    throw new ReleaseRevisionError(
      `Could not read release revision: path=${revisionPath} cause=${cause}`
    );
  }

  if (!RELEASE_REVISION_PATTERN.test(revision)) {
    throw new ReleaseRevisionError(
      `Release revision must be a lowercase full 40-character SHA: path=${revisionPath}`
    );
  }
  return revision;
}

function loadRuntimeReleaseState(revisionPath: string): RuntimeReleaseState {
  try {
    const revision = readReleaseRevision(revisionPath);
    if (revision === null) {
      logger.warn({ revisionPath }, 'Release revision artifact is missing');
      return { revision: null, state: 'missing' };
    }
    return { revision, state: 'available' };
  } catch (error) {
    if (!(error instanceof ReleaseRevisionError)) {
      throw error;
    }
    logger.error({ err: error, revisionPath }, error.message);
    return { revision: null, state: 'invalid' };
  }
}

const runtimeReleaseState = loadRuntimeReleaseState(
  resolve(process.cwd(), 'dist', '.release-sha')
);

// Timeout for health check queries (ms)
const HEALTH_CHECK_TIMEOUT = 2000;
const INGESTION_FRESHNESS_SLO_MS = 120_000;

// Startup timestamp for grace period
const startupTime = Date.now();
const STARTUP_GRACE_MS = 15 * 60_000; // 15 minutes

// External references set by index.ts during startup
let jetstreamHealthFn: (() => JetstreamHealth) | null = null;
let scoringHealthFn: (() => ScoringHealth) | null = null;
let diskHealthFn: (() => DiskStatus | null) | null = null;

/**
 * Register the Jetstream health check function.
 * Called from index.ts after Jetstream starts.
 */
export function registerJetstreamHealth(fn: () => JetstreamHealth): void {
  jetstreamHealthFn = fn;
}

/**
 * Register the scoring health check function.
 * Called from index.ts after scoring starts.
 */
export function registerScoringHealth(fn: () => ScoringHealth): void {
  scoringHealthFn = fn;
}

/**
 * Register the disk health check function.
 * Called from index.ts after disk monitor starts.
 */
export function registerDiskHealth(fn: () => DiskStatus | null): void {
  diskHealthFn = fn;
}

/**
 * Check PostgreSQL health with timeout.
 *
 * Uses the dedicated `healthDb` pool (PROJ-917), not the main `db` pool —
 * see src/db/client.ts's healthDb comment for the 2026-07-06 incident this
 * fixes (main-pool exhaustion starved this check, which then failed
 * dependency readiness and got the service SIGABRT-killed by the systemd
 * watchdog that gates its heartbeat on isReady() -> this function).
 */
async function checkDatabase(): Promise<ComponentHealth> {
  const start = Date.now();

  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Database health check timed out')), HEALTH_CHECK_TIMEOUT);
    });

    const queryPromise = healthDb.query('SELECT 1');
    await Promise.race([queryPromise, timeoutPromise]);

    return {
      status: 'healthy',
      latency_ms: Date.now() - start,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    logger.warn({ err }, 'Database health check failed');
    return {
      status: 'unhealthy',
      latency_ms: Date.now() - start,
      error: message,
    };
  }
}

/**
 * Check Redis health with timeout.
 */
async function checkRedis(): Promise<ComponentHealth> {
  const start = Date.now();

  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Redis health check timed out')), HEALTH_CHECK_TIMEOUT);
    });

    const pingPromise = redis.ping();
    await Promise.race([pingPromise, timeoutPromise]);

    return {
      status: 'healthy',
      latency_ms: Date.now() - start,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    logger.warn({ err }, 'Redis health check failed');
    return {
      status: 'unhealthy',
      latency_ms: Date.now() - start,
      error: message,
    };
  }
}

async function hasFreshPersistedIngestion(): Promise<boolean> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timeoutHandle = setTimeout(
        () => reject(new Error('Persisted ingestion freshness check timed out')),
        HEALTH_CHECK_TIMEOUT
      );
    });
    const queryPromise = healthDb.query<{
      cursor_fresh: boolean;
      newest_post_fresh: boolean;
    }>(`
      SELECT
        COALESCE(
          (SELECT cursor_us FROM jetstream_cursor WHERE id = 1)
            BETWEEN FLOOR(EXTRACT(EPOCH FROM clock_timestamp() - ($1::double precision * INTERVAL '1 millisecond')) * 1000000)::bigint
                AND FLOOR(EXTRACT(EPOCH FROM clock_timestamp() + ($1::double precision * INTERVAL '1 millisecond')) * 1000000)::bigint,
          FALSE
        ) AS cursor_fresh,
        COALESCE(
          (SELECT MAX(indexed_at) FROM posts WHERE deleted = FALSE)
            BETWEEN clock_timestamp() - ($1::double precision * INTERVAL '1 millisecond')
                AND clock_timestamp() + ($1::double precision * INTERVAL '1 millisecond'),
          FALSE
        ) AS newest_post_fresh
    `, [INGESTION_FRESHNESS_SLO_MS]);
    const result = await Promise.race([queryPromise, timeoutPromise]);
    const freshness = result.rows[0];
    const fresh =
      freshness?.cursor_fresh === true && freshness.newest_post_fresh === true;
    if (!fresh) {
      logger.warn({
        cursorFresh: freshness?.cursor_fresh ?? null,
        newestPostFresh: freshness?.newest_post_fresh ?? null,
        sloMs: INGESTION_FRESHNESS_SLO_MS,
      }, 'Persisted ingestion is outside the freshness SLO');
    }
    return fresh;
  } catch (error) {
    logger.warn({ err: error }, 'Persisted ingestion freshness check failed');
    return false;
  } finally {
    if (timeoutHandle !== undefined) {
      clearTimeout(timeoutHandle);
    }
  }
}

/**
 * Check Jetstream health.
 */
function checkJetstream(): JetstreamHealth {
  if (!jetstreamHealthFn) {
    return {
      status: 'unhealthy',
      connected: false,
      error: 'Jetstream health check not registered',
    };
  }

  try {
    return jetstreamHealthFn();
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    logger.warn({ err }, 'Jetstream health check failed');
    return {
      status: 'unhealthy',
      connected: false,
      error: message,
    };
  }
}

/**
 * Check scoring scheduler health.
 */
function checkScoring(): ScoringHealth {
  if (scoringHealthFn) {
    return scoringHealthFn();
  }

  // Scoring not registered yet
  return {
    status: 'unhealthy',
    is_running: false,
    error: 'Scoring health check not registered',
  };
}

/**
 * Check disk health.
 */
function checkDisk(): DiskHealth {
  if (!diskHealthFn) {
    return {
      status: 'healthy',
      used_percent: 0,
      available_gb: 0,
      level: 'ok',
      error: 'Disk health not registered yet',
    };
  }

  let diskStatus: DiskStatus | null;
  try {
    diskStatus = diskHealthFn();
  } catch (error) {
    logger.warn({ err: error }, 'Disk health provider failed');
    return {
      status: 'unhealthy',
      used_percent: 0,
      available_gb: 0,
      level: 'emergency',
      error: error instanceof Error ? error.message : 'Disk health provider failed',
    };
  }

  if (diskStatus === null) {
    return {
      status: 'healthy',
      used_percent: 0,
      available_gb: 0,
      level: 'ok',
      error: 'No disk status available yet',
    };
  }

  if (
    !Number.isFinite(diskStatus.used_percent) ||
    diskStatus.used_percent < 0 ||
    diskStatus.used_percent > 100 ||
    !Number.isFinite(diskStatus.available_gb) ||
    diskStatus.available_gb < 0 ||
    !['ok', 'warning', 'critical', 'emergency'].includes(diskStatus.level)
  ) {
    logger.warn({ diskStatus }, 'Disk health provider returned an invalid status');
    return {
      status: 'unhealthy',
      used_percent: 0,
      available_gb: 0,
      level: 'emergency',
      error: 'Disk health provider returned an invalid status',
    };
  }

  return {
    // Only emergency (95%+) blocks readiness; critical (90%) degrades
    status: diskStatus.level === 'emergency' ? 'unhealthy' : 'healthy',
    used_percent: diskStatus.used_percent,
    available_gb: diskStatus.available_gb,
    level: diskStatus.level,
  };
}

/**
 * Check feed freshness via Redis.
 */
async function checkFeedFreshness(): Promise<FeedFreshnessHealth> {
  const withinGracePeriod = (Date.now() - startupTime) < STARTUP_GRACE_MS;

  try {
    const [feedSize, feedUpdatedAt] = await Promise.all([
      redis.zcard('feed:current'),
      redis.get('feed:updated_at'),
    ]);

    let feedAgeMs: number | undefined;
    if (feedUpdatedAt) {
      feedAgeMs = Date.now() - new Date(feedUpdatedAt).getTime();
    }

    // Get scoring age from system_status
    let scoringAgeMs: number | undefined;
    try {
      const result = await db.query(
        `SELECT value->>'timestamp' as ts FROM system_status WHERE key = 'current_scoring_run'`
      );
      if (result.rows.length > 0 && result.rows[0].ts) {
        scoringAgeMs = Date.now() - new Date(result.rows[0].ts).getTime();
      }
    } catch (err) {
      logger.debug({ err }, 'Scoring age query failed in feed freshness check (non-fatal)');
    }

    // During startup grace period, always report healthy
    if (withinGracePeriod) {
      return {
        status: 'healthy',
        feed_size: feedSize,
        feed_age_ms: feedAgeMs,
        scoring_age_ms: scoringAgeMs,
      };
    }

    // Check staleness conditions
    const isFeedEmpty = feedSize < 10;
    const isFeedStale = feedAgeMs !== undefined && feedAgeMs > 15 * 60_000; // >15 min
    const isScoringStale = scoringAgeMs !== undefined && scoringAgeMs > 10 * 60_000; // >10 min

    // Unhealthy if feed is empty or BOTH feed and scoring are stale
    // (single staleness = degraded, caught at component level)
    const isUnhealthy = isFeedEmpty || (isFeedStale && isScoringStale) || isFeedStale || isScoringStale;

    return {
      status: isUnhealthy ? 'unhealthy' : 'healthy',
      feed_size: feedSize,
      feed_age_ms: feedAgeMs,
      scoring_age_ms: scoringAgeMs,
      error: isUnhealthy
        ? `Feed ${isFeedEmpty ? 'empty' : 'stale'}: size=${feedSize}, age=${feedAgeMs ? Math.round(feedAgeMs / 1000) + 's' : 'unknown'}`
        : undefined,
    };
  } catch (err) {
    return {
      status: 'healthy', // Don't fail readiness if Redis check fails (Redis health covers that)
      feed_size: 0,
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}

/**
 * Perform a complete health check of all components.
 */
export async function getHealthStatus(): Promise<HealthStatus> {
  const [databaseHealth, redisHealth, feedFreshnessHealth] = await Promise.all([
    checkDatabase(),
    checkRedis(),
    checkFeedFreshness(),
  ]);

  const jetstreamHealth = checkJetstream();
  const scoringHealth = checkScoring();
  const diskHealth = checkDisk();

  const components = {
    database: databaseHealth,
    redis: redisHealth,
    jetstream: jetstreamHealth,
    scoring: scoringHealth,
    disk: diskHealth,
    feed_freshness: feedFreshnessHealth,
  };

  // Critical components (block readiness)
  const criticalUnhealthy = [
    databaseHealth,
    redisHealth,
    diskHealth,
  ].filter((c) => c.status === 'unhealthy').length;

  // Non-critical components (degrade but don't block)
  const nonCriticalUnhealthy = [
    jetstreamHealth,
    scoringHealth,
    feedFreshnessHealth,
  ].filter((c) => c.status === 'unhealthy').length;

  let status: 'healthy' | 'degraded' | 'unhealthy';
  if (criticalUnhealthy > 0) {
    status = 'unhealthy';
  } else if (nonCriticalUnhealthy > 0) {
    status = 'degraded';
  } else {
    status = 'healthy';
  }

  return {
    status,
    timestamp: new Date().toISOString(),
    components,
  };
}

export async function getPublicHealthStatus(): Promise<PublicHealthStatus> {
  const health = await getHealthStatus();
  return {
    status:
      isRuntimeReleaseReady() && health.status === 'healthy'
        ? 'ok'
        : 'degraded',
    revision: runtimeReleaseState.revision,
  };
}

/**
 * Quick liveness check - just verifies the process is running.
 */
export function isLive(): boolean {
  return true;
}

function isRuntimeReleaseReady(): boolean {
  return (
    runtimeReleaseState.state === 'available' ||
    (runtimeReleaseState.state === 'missing' && process.env.NODE_ENV !== 'production')
  );
}

/**
 * Dependency readiness check used by the systemd watchdog.
 *
 * Persisted-ingestion freshness and release identity deliberately do not gate
 * watchdog heartbeats. An upstream outage or quiet posting window must make
 * the public readiness probe fail without crash-looping an otherwise live
 * process. Disk health is also excluded here: emergency pressure blocks
 * isPromotionReady() and is persisted by the disk monitor's
 * disk_emergency_alert path.
 */
export async function isReady(): Promise<boolean> {
  const [databaseHealth, redisHealth] = await Promise.all([
    checkDatabase(),
    checkRedis(),
  ]);
  return (
    databaseHealth.status === 'healthy' &&
    redisHealth.status === 'healthy'
  );
}

/**
 * Loopback-only promotion readiness check.
 *
 * In addition to dependency readiness, production requires an immutable
 * release identity and both persisted ingestion signals within the 120-second
 * rollout SLO.
 */
export async function isPromotionReady(): Promise<boolean> {
  const [databaseHealth, redisHealth] = await Promise.all([
    checkDatabase(),
    checkRedis(),
  ]);
  const diskHealth = checkDisk();
  if (
    !isRuntimeReleaseReady() ||
    databaseHealth.status !== 'healthy' ||
    redisHealth.status !== 'healthy' ||
    diskHealth.status !== 'healthy'
  ) {
    return false;
  }
  return hasFreshPersistedIngestion();
}
