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

import { db } from '../db/client.js';
import { redis } from '../db/redis.js';
import { logger } from './logger.js';

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

export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  components: {
    database: ComponentHealth;
    redis: ComponentHealth;
    jetstream: JetstreamHealth;
    scoring: ScoringHealth;
  };
}

// Timeout for health check queries (ms)
const HEALTH_CHECK_TIMEOUT = 2000;

// External references set by index.ts during startup
let jetstreamHealthFn: (() => JetstreamHealth) | null = null;
let scoringHealthFn: (() => ScoringHealth) | null = null;

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
 * Check PostgreSQL health with timeout.
 */
async function checkDatabase(): Promise<ComponentHealth> {
  const start = Date.now();

  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Database health check timed out')), HEALTH_CHECK_TIMEOUT);
    });

    const queryPromise = db.query('SELECT 1');
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

/**
 * Check Jetstream health.
 */
function checkJetstream(): JetstreamHealth {
  if (jetstreamHealthFn) {
    return jetstreamHealthFn();
  }

  // Jetstream not registered yet
  return {
    status: 'unhealthy',
    connected: false,
    error: 'Jetstream health check not registered',
  };
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
 * Perform a complete health check of all components.
 */
export async function getHealthStatus(): Promise<HealthStatus> {
  const [databaseHealth, redisHealth] = await Promise.all([
    checkDatabase(),
    checkRedis(),
  ]);

  const jetstreamHealth = checkJetstream();
  const scoringHealth = checkScoring();

  // Determine overall status
  const components = {
    database: databaseHealth,
    redis: redisHealth,
    jetstream: jetstreamHealth,
    scoring: scoringHealth,
  };

  // Count unhealthy components
  const unhealthyCount = Object.values(components).filter(
    (c) => c.status === 'unhealthy'
  ).length;

  let status: 'healthy' | 'degraded' | 'unhealthy';
  if (unhealthyCount === 0) {
    status = 'healthy';
  } else if (unhealthyCount <= 2) {
    // Degraded if 1-2 components are unhealthy (can still serve cached data)
    status = 'degraded';
  } else {
    // Unhealthy if 3+ components are down
    status = 'unhealthy';
  }

  return {
    status,
    timestamp: new Date().toISOString(),
    components,
  };
}

/**
 * Quick liveness check - just verifies the process is running.
 */
export function isLive(): boolean {
  return true;
}

/**
 * Readiness check - verifies all critical dependencies are healthy.
 */
export async function isReady(): Promise<boolean> {
  const health = await getHealthStatus();
  // Ready only if database and Redis are healthy
  return (
    health.components.database.status === 'healthy' &&
    health.components.redis.status === 'healthy'
  );
}
