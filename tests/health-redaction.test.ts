import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  dbQueryMock,
  healthDbQueryMock,
  rateLimitState,
  redisPingMock,
  redisRateLimitMock,
} = vi.hoisted(() => ({
  dbQueryMock: vi.fn().mockResolvedValue({ rows: [] }),
  healthDbQueryMock: vi.fn(),
  rateLimitState: { enabled: false },
  redisPingMock: vi.fn(),
  redisRateLimitMock: vi.fn((...args: unknown[]) => {
    const callback = args.at(-1);
    if (typeof callback !== 'function') {
      throw new TypeError('Redis rate-limit callback is required');
    }
    callback(null, [1, 60_000]);
  }),
}));

// PROJ-917: checkDatabase() in src/lib/health.ts now queries the dedicated
// healthDb pool (src/db/client.ts), not the shared `db` pool — the "database
// down/up" scenarios below drive healthDbQueryMock. `dbQueryMock` remains
// wired to the main pool for the other query checkFeedFreshness makes
// (current_scoring_run), which this suite doesn't otherwise exercise.
vi.mock('../src/db/client.js', () => ({
  db: {
    query: dbQueryMock,
  },
  healthDb: {
    query: healthDbQueryMock,
  },
}));

vi.mock('../src/db/redis.js', () => ({
  redis: {
    defineCommand: vi.fn(),
    ping: redisPingMock,
    rateLimit: redisRateLimitMock,
  },
}));

vi.mock('../src/demo/rate-limit.js', async () => {
  const actual = await vi.importActual<typeof import('../src/demo/rate-limit.js')>(
    '../src/demo/rate-limit.js'
  );
  return {
    ...actual,
    createRedisDemoRateLimitGuard: vi.fn(() => ({ check: vi.fn() })),
  };
});

vi.mock('../src/lib/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
  },
}));

vi.mock('../src/config.js', async () => {
  const actual = await vi.importActual<typeof import('../src/config.js')>('../src/config.js');
  const config = {
    ...actual.config,
    RATE_LIMIT_GLOBAL_MAX: 1,
  };
  Object.defineProperty(config, 'RATE_LIMIT_ENABLED', {
    enumerable: true,
    get: () => rateLimitState.enabled,
  });
  return {
    ...actual,
    config,
  };
});

import {
  getPublicHealthStatus,
  initializeRuntimeRelease,
  isPromotionReady,
  isReady,
  readReleaseRevision,
  registerDiskHealth,
  registerJetstreamHealth,
  registerScoringHealth,
} from '../src/lib/health.js';
import { registerAdminHealthRoutes } from '../src/admin/routes/health.js';
import { createServer, isDirectLoopbackRequest, isLoopbackAddress } from '../src/feed/server.js';
import { config } from '../src/config.js';
import type { DiskStatus } from '../src/maintenance/disk-monitor.js';

// health.ts wraps this query in a try/catch that swallows any error
// (including a thrown assertion) and returns `false`. An `expect()` call
// inside the mock implementation itself would therefore be neutered by that
// catch: a failing assertion here would just make the freshness check
// resolve false, not fail the test. Record the received arguments instead and
// assert on them after the act phase, once the surrounding catch can no
// longer intercept a failure.
let capturedFreshnessQueryParameters: readonly unknown[] | undefined;

function mockHealthyDatabase(cursorFresh: boolean, newestPostFresh: boolean): void {
  healthDbQueryMock.mockImplementation((query: string, parameters?: readonly unknown[]) => {
    if (query.includes('cursor_fresh')) {
      capturedFreshnessQueryParameters = parameters;
      return Promise.resolve({
        rows: [{ cursor_fresh: cursorFresh, newest_post_fresh: newestPostFresh }],
      });
    }
    return Promise.resolve({ rows: [{ '?column?': 1 }] });
  });
}

describe('health response redaction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rateLimitState.enabled = false;
    capturedFreshnessQueryParameters = undefined;

    registerJetstreamHealth(() => ({
      status: 'healthy',
      connected: true,
    }));
    registerScoringHealth(() => ({
      status: 'healthy',
      is_running: false,
    }));
    registerDiskHealth(() => null);
  });

  it('returns only redacted status for public health when database is down', async () => {
    healthDbQueryMock.mockRejectedValue(new Error('db down'));
    redisPingMock.mockResolvedValue('PONG');

    const status = await getPublicHealthStatus();

    expect(status).toEqual({ status: 'degraded', revision: null });
  });

  it.each([
    { address: '127.0.0.1', expected: true },
    { address: '::1', expected: true },
    { address: '::ffff:127.0.0.1', expected: true },
    { address: '::FFFF:127.0.0.1', expected: true },
    { address: '203.0.113.10', expected: false },
    { address: '127.0.0.2', expected: false },
    { address: '', expected: false },
    { address: '::ffff:7f00:1', expected: false },
    { address: ' 127.0.0.1', expected: false },
    { address: '127.0.0.1 ', expected: false },
    { address: undefined, expected: false },
  ])('classifies $address loopback=$expected', ({ address, expected }) => {
    expect(isLoopbackAddress(address)).toBe(expected);
  });

  function fakeLoopbackRequest(options: {
    remoteAddress?: string;
    headers?: Record<string, string>;
  }): Parameters<typeof isDirectLoopbackRequest>[0] {
    return {
      raw: { socket: { remoteAddress: options.remoteAddress } },
      headers: options.headers ?? {},
    } as Parameters<typeof isDirectLoopbackRequest>[0];
  }

  it.each([
    {
      name: 'clean loopback request',
      remoteAddress: '127.0.0.1',
      headers: undefined,
      expected: true,
    },
    {
      // The socket check is primary: an undefined remoteAddress (e.g. a
      // torn-down or non-TCP socket) must be rejected outright, not
      // fall through to the header denylist.
      name: 'undefined remoteAddress',
      remoteAddress: undefined,
      headers: undefined,
      expected: false,
    },
    {
      // x-client-ip is not one of the three headers the denylist checked
      // before this fix (forwarded, x-forwarded-for, x-real-ip) -- a proxy
      // that only sets x-client-ip must still be caught.
      name: 'x-client-ip spoof attempt',
      remoteAddress: '127.0.0.1',
      headers: { 'x-client-ip': '203.0.113.10' },
      expected: false,
    },
    {
      name: 'true-client-ip spoof attempt',
      remoteAddress: '127.0.0.1',
      headers: { 'true-client-ip': '203.0.113.10' },
      expected: false,
    },
    {
      name: 'non-loopback socket with no forwarding headers',
      remoteAddress: '203.0.113.10',
      headers: undefined,
      expected: false,
    },
  ])('isDirectLoopbackRequest: $name', ({ remoteAddress, headers, expected }) => {
    expect(isDirectLoopbackRequest(fakeLoopbackRequest({ remoteAddress, headers }))).toBe(
      expected
    );
  });

  it('serializes a null release revision on the public health route', async () => {
    mockHealthyDatabase(true, true);
    redisPingMock.mockResolvedValue('PONG');
    const app = await createServer({ shadowDemoService: null });

    try {
      const response = await app.inject({ method: 'GET', url: '/health' });

      expect(response.statusCode).toBe(200);
      expect(response.payload).toContain('"revision":null');
      expect(app.swagger().paths).not.toHaveProperty('/health/promotion-ready');
    } finally {
      await app.close();
    }
  });

  it('keeps the promotion-readiness route loopback-only and fail-closed', async () => {
    mockHealthyDatabase(true, true);
    redisPingMock.mockResolvedValue('PONG');
    const app = await createServer({ shadowDemoService: null });

    try {
      const remoteResponse = await app.inject({
        method: 'GET',
        url: '/health/promotion-ready',
        remoteAddress: '203.0.113.10',
      });
      expect(remoteResponse.statusCode).toBe(403);
      expect(remoteResponse.json()).toEqual({ status: 'not ready' });

      for (const headers of [
        { forwarded: 'for=127.0.0.1' },
        { 'x-forwarded-for': '127.0.0.1, 203.0.113.10' },
        { 'x-forwarded-for': '203.0.113.10' },
        { 'x-real-ip': '127.0.0.1' },
        { 'x-real-ip': '' },
        { 'x-client-ip': '203.0.113.10' },
      ]) {
        const spoofedResponse = await app.inject({
          method: 'GET',
          url: '/health/promotion-ready',
          remoteAddress: '127.0.0.1',
          headers,
        });
        expect(spoofedResponse.statusCode).toBe(403);
        expect(spoofedResponse.json()).toEqual({ status: 'not ready' });
      }

      const loopbackResponse = await app.inject({
        method: 'GET',
        url: '/health/promotion-ready',
        remoteAddress: '127.0.0.1',
        headers: { 'user-agent': 'corgi-deploy-probe' },
      });
      expect(loopbackResponse.statusCode).toBe(200);
      expect(loopbackResponse.json()).toEqual({ status: 'ready' });

      const ipv6LoopbackResponse = await app.inject({
        method: 'GET',
        url: '/health/promotion-ready',
        remoteAddress: '::1',
      });
      expect(ipv6LoopbackResponse.statusCode).toBe(200);
      expect(ipv6LoopbackResponse.json()).toEqual({ status: 'ready' });

      registerDiskHealth(() => {
        throw new Error('disk probe failed');
      });
      const rejectedResponse = await app.inject({
        method: 'GET',
        url: '/health/promotion-ready',
        remoteAddress: '127.0.0.1',
      });
      expect(rejectedResponse.statusCode).toBe(503);
      expect(rejectedResponse.json()).toEqual({ status: 'not ready' });
    } finally {
      await app.close();
    }
  });

  it('gives the loopback promotion probe its own rate-limit bucket instead of the tight global cap', async () => {
    rateLimitState.enabled = true;
    mockHealthyDatabase(true, true);
    redisPingMock.mockResolvedValue('PONG');
    const app = await createServer({ shadowDemoService: null });

    try {
      // '/health/promotion-ready' is registered inside createServer(),
      // before the app is returned here -- so a second onRoute hook (the
      // technique used below for the synthetic routes) can't observe it:
      // onRoute hooks only fire for routes registered *after* the hook is
      // added (fastify/lib/route.js runs each onRoute hook synchronously
      // at registration time). Instead, capture this route's *final*
      // resolved config through the public `request.routeOptions.config`
      // API via a preHandler hook added before the app is ever
      // readied/injected -- Fastify compiles each route's request-lifecycle
      // hook chain lazily at boot (the first .ready()/.inject()), so a hook
      // added beforehand still applies to routes declared earlier.
      let capturedConfig: Record<string, unknown> | undefined;
      app.addHook('preHandler', async (request) => {
        if (request.routeOptions.url === '/health/promotion-ready') {
          capturedConfig = request.routeOptions.config as Record<string, unknown>;
        }
      });

      // The mocked config sets RATE_LIMIT_GLOBAL_MAX to 1 -- three
      // consecutive 200s show this route isn't rejected by the tight
      // global default, and confirm the route is live end-to-end.
      for (let requestNumber = 0; requestNumber < 3; requestNumber += 1) {
        const response = await app.inject({
          method: 'GET',
          url: '/health/promotion-ready',
          remoteAddress: '127.0.0.1',
        });
        expect(response.statusCode).toBe(200);
      }
      // Unlike the old `rateLimit: false` exemption, this route is no longer
      // invisible to the rate limiter entirely.
      expect(redisRateLimitMock).toHaveBeenCalled();
      // Load-bearing proof of *which* bucket is attached: redisRateLimitMock
      // always yields [1, 60_000] regardless of the configured max (see the
      // mock above), so the three 200s alone don't distinguish the dedicated
      // promotion-ready bucket from any other sufficiently large one.
      // Assert the route's resolved config directly instead.
      expect(capturedConfig?.rateLimit).toEqual({
        max: config.RATE_LIMIT_PROMOTION_READY_MAX,
        timeWindow: config.RATE_LIMIT_PROMOTION_READY_WINDOW_MS,
      });
    } finally {
      rateLimitState.enabled = false;
      await app.close();
    }
  });

  it('preserves a route-declared rateLimit object instead of overwriting it with the generated config', async () => {
    rateLimitState.enabled = true;
    // Declared outside the try (and only closed if construction actually
    // succeeded) so a createServer() rejection can't leave rateLimitState
    // mutated for later tests without running the finally below.
    let app: Awaited<ReturnType<typeof createServer>> | undefined;

    try {
      app = await createServer({ shadowDemoService: null });

      // '/api/admin/' is a URL prefix buildRouteRateLimitConfig() matches
      // and would generate its own { max, timeWindow } for -- proving the
      // onRoute hook's guard must check `!== undefined`, not `=== false`,
      // or this declared object gets silently replaced.
      const declaredRateLimit = { max: 999, timeWindow: 999_000 };
      let capturedConfig: Record<string, unknown> | undefined;
      let capturedControlConfig: Record<string, unknown> | undefined;
      // Registered after the server's own onRoute hook, so it observes each
      // route's final config once that hook has already run.
      app.addHook('onRoute', (routeOptions) => {
        if (routeOptions.url === '/api/admin/rate-limit-guard-check') {
          capturedConfig = routeOptions.config as Record<string, unknown>;
        }
        if (routeOptions.url === '/api/admin/rate-limit-guard-check-control') {
          capturedControlConfig = routeOptions.config as Record<string, unknown>;
        }
      });

      // Control route: same method + '/api/admin/' prefix, but no declared
      // rateLimit at all. This proves buildRouteRateLimitConfig() actually
      // matches this URL and the hook attaches its generated config --
      // otherwise the test below would pass vacuously even if the pattern
      // match drifted and stopped applying to this route entirely.
      app.get('/api/admin/rate-limit-guard-check-control', async () => ({ ok: true }));
      app.get(
        '/api/admin/rate-limit-guard-check',
        { config: { rateLimit: declaredRateLimit } },
        async () => ({ ok: true })
      );

      expect(capturedControlConfig?.rateLimit).toEqual({
        max: config.RATE_LIMIT_ADMIN_MAX,
        timeWindow: config.RATE_LIMIT_ADMIN_WINDOW_MS,
      });
      expect(capturedConfig?.rateLimit).toEqual(declaredRateLimit);
    } finally {
      rateLimitState.enabled = false;
      await app?.close();
    }
  });

  it('supports a missing startup release artifact for legacy runtimes', async () => {
    const originalNodeEnvironment = process.env.NODE_ENV;
    const directory = mkdtempSync(join(tmpdir(), 'corgi-missing-release-revision-'));

    try {
      process.env.NODE_ENV = 'test';
      vi.resetModules();
      const {
        getPublicHealthStatus: getPublicHealthStatusFresh,
        initializeRuntimeRelease: initializeRuntimeReleaseFresh,
        isLive: isLiveFresh,
        isPromotionReady: isPromotionReadyFresh,
        isReady: isReadyFresh,
        registerJetstreamHealth: registerJetstreamHealthFresh,
        registerScoringHealth: registerScoringHealthFresh,
      } = await import('../src/lib/health.js');
      // No process.cwd()/chdir() here: the artifact path is passed explicitly
      // and this directory never contains a dist/.release-sha file.
      initializeRuntimeReleaseFresh(join(directory, 'dist', '.release-sha'));
      mockHealthyDatabase(true, true);
      redisPingMock.mockResolvedValue('PONG');
      registerJetstreamHealthFresh(() => ({
        status: 'healthy',
        connected: true,
      }));
      registerScoringHealthFresh(() => ({
        status: 'healthy',
        is_running: false,
      }));

      await expect(getPublicHealthStatusFresh()).resolves.toEqual({
        status: 'ok',
        revision: null,
      });
      expect(isLiveFresh()).toBe(true);
      await expect(isReadyFresh()).resolves.toBe(true);
      await expect(isPromotionReadyFresh()).resolves.toBe(true);
    } finally {
      if (originalNodeEnvironment === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = originalNodeEnvironment;
      }
      vi.resetModules();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('fails production readiness when the startup release artifact is missing', async () => {
    const originalNodeEnvironment = process.env.NODE_ENV;
    const directory = mkdtempSync(join(tmpdir(), 'corgi-production-release-revision-'));

    try {
      process.env.NODE_ENV = 'production';
      vi.resetModules();
      const {
        getPublicHealthStatus: getPublicHealthStatusFresh,
        initializeRuntimeRelease: initializeRuntimeReleaseFresh,
        isPromotionReady: isPromotionReadyFresh,
        isReady: isReadyFresh,
      } = await import('../src/lib/health.js');
      initializeRuntimeReleaseFresh(join(directory, 'dist', '.release-sha'));
      mockHealthyDatabase(true, true);
      redisPingMock.mockResolvedValue('PONG');

      await expect(getPublicHealthStatusFresh()).resolves.toEqual({
        status: 'degraded',
        revision: null,
      });
      await expect(isReadyFresh()).resolves.toBe(true);
      await expect(isPromotionReadyFresh()).resolves.toBe(false);
    } finally {
      if (originalNodeEnvironment === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = originalNodeEnvironment;
      }
      vi.resetModules();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('returns only redacted status for public health when jetstream provider throws', async () => {
    healthDbQueryMock.mockResolvedValue({ rows: [{ '?column?': 1 }] });
    redisPingMock.mockResolvedValue('PONG');
    registerJetstreamHealth(() => {
      throw new Error('jetstream probe failed');
    });
    registerScoringHealth(() => ({
      status: 'healthy',
      is_running: false,
    }));

    const status = await getPublicHealthStatus();

    expect(status).toEqual({ status: 'degraded', revision: null });
  });

  it.each([
    { cursorFresh: false, newestPostFresh: true, staleSignal: 'cursor' },
    { cursorFresh: true, newestPostFresh: false, staleSignal: 'newest indexed post' },
    { cursorFresh: false, newestPostFresh: false, staleSignal: 'both persisted signals' },
  ])('fails readiness when the persisted $staleSignal exceeds 120 seconds', async ({
    cursorFresh,
    newestPostFresh,
  }) => {
    mockHealthyDatabase(cursorFresh, newestPostFresh);
    redisPingMock.mockResolvedValue('PONG');

    await expect(isReady()).resolves.toBe(true);
    await expect(isPromotionReady()).resolves.toBe(false);
    expect(healthDbQueryMock.mock.calls.some(([query]) =>
      typeof query === 'string' && query.includes('cursor_fresh')
    )).toBe(true);
    expect(capturedFreshnessQueryParameters).toEqual([120_000]);
  });

  it.each([
    { name: 'no row', rows: [] },
    {
      name: 'null values',
      rows: [{ cursor_fresh: null, newest_post_fresh: null }],
    },
  ])('blocks promotion when the freshness query returns $name', async ({ rows }) => {
    let receivedParameters: readonly unknown[] | undefined;
    healthDbQueryMock.mockImplementation((query: string, parameters?: readonly unknown[]) => {
      if (query.includes('cursor_fresh')) {
        receivedParameters = parameters;
        return Promise.resolve({ rows });
      }
      return Promise.resolve({ rows: [{ '?column?': 1 }] });
    });
    redisPingMock.mockResolvedValue('PONG');

    await expect(isPromotionReady()).resolves.toBe(false);
    expect(healthDbQueryMock.mock.calls.some(([query]) =>
      typeof query === 'string' && query.includes('cursor_fresh')
    )).toBe(true);
    expect(receivedParameters).toEqual([120_000]);
  });

  it('times out a hung freshness query and clears the timeout', async () => {
    vi.useFakeTimers();
    let receivedParameters: readonly unknown[] | undefined;
    try {
      healthDbQueryMock.mockImplementation((query: string, parameters?: readonly unknown[]) => {
        if (query.includes('cursor_fresh')) {
          receivedParameters = parameters;
          return new Promise(() => {});
        }
        return Promise.resolve({ rows: [{ '?column?': 1 }] });
      });
      redisPingMock.mockResolvedValue('PONG');

      const readyPromise = isPromotionReady();
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(2000);

      await expect(readyPromise).resolves.toBe(false);
      expect(healthDbQueryMock.mock.calls.some(([query]) =>
        typeof query === 'string' && query.includes('cursor_fresh')
      )).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
      expect(receivedParameters).toEqual([120_000]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps dependency readiness while a freshness query failure blocks promotion', async () => {
    let receivedParameters: readonly unknown[] | undefined;
    healthDbQueryMock.mockImplementation((query: string, parameters?: readonly unknown[]) => {
      if (query.includes('cursor_fresh')) {
        receivedParameters = parameters;
        return Promise.reject(new Error('freshness query failed'));
      }
      return Promise.resolve({ rows: [{ '?column?': 1 }] });
    });
    redisPingMock.mockResolvedValue('PONG');

    await expect(isReady()).resolves.toBe(true);
    await expect(isPromotionReady()).resolves.toBe(false);
    expect(receivedParameters).toEqual([120_000]);
  });

  it('fails dependency readiness and promotion when checkRedis() rejects uncaught', async () => {
    mockHealthyDatabase(true, true);
    redisPingMock.mockRejectedValue(new Error('redis connection refused'));

    // checkRedis() wraps redis.ping() in its own try/catch, so a rejection
    // here must resolve to `false`, not propagate as an unhandled rejection
    // out of isReady()/isPromotionReady().
    await expect(isReady()).resolves.toBe(false);
    await expect(isPromotionReady()).resolves.toBe(false);
  });

  it('blocks promotion on a Redis failure even while the database succeeds', async () => {
    mockHealthyDatabase(true, true);
    redisPingMock.mockRejectedValue(new Error('redis connection refused'));

    const status = await isReady();
    // Redis alone must be able to fail readiness -- the database side of
    // this same call is healthy, proving the two checks are independent.
    expect(status).toBe(false);
    expect(healthDbQueryMock).toHaveBeenCalled();
    await expect(isPromotionReady()).resolves.toBe(false);
  });

  it('caps the persisted-ingestion freshness window at the DB clock with no future slack', async () => {
    // This suite mocks healthDb.query() entirely (see the module header
    // comment and tests/harness/global-setup.ts, which keeps the default
    // `npm test` suite Docker-free), so it cannot execute the real SQL
    // against a live clock to prove a value 60 seconds in the future, or one
    // sitting exactly on the 120-second boundary, is (or isn't) reported
    // fresh. Instead this pins the query TEXT: the upper bound of both
    // BETWEEN clauses must be exactly `clock_timestamp()`. Reintroducing
    // `+ ($1::double precision * INTERVAL '1 millisecond')` on either upper
    // bound would silently restore up to 120s of future-dated tolerance.
    mockHealthyDatabase(true, true);
    redisPingMock.mockResolvedValue('PONG');

    await isPromotionReady();

    const freshnessQuery = healthDbQueryMock.mock.calls
      .map(([query]) => query)
      .find((query): query is string => typeof query === 'string' && query.includes('cursor_fresh'));

    expect(freshnessQuery).toBeDefined();
    expect(freshnessQuery).toContain(
      "FLOOR(EXTRACT(EPOCH FROM clock_timestamp()) * 1000000)::bigint"
    );
    expect(freshnessQuery).toMatch(
      /BETWEEN clock_timestamp\(\) - \(\$1::double precision \* INTERVAL '1 millisecond'\)\s+AND clock_timestamp\(\),/
    );
    expect(freshnessQuery).not.toMatch(/clock_timestamp\(\)\s*\+\s*\(\$1/);
  });

  it('keeps dependency readiness isolated from nondependency provider failures', async () => {
    mockHealthyDatabase(true, true);
    redisPingMock.mockResolvedValue('PONG');
    registerDiskHealth(() => {
      throw new Error('disk provider failed');
    });
    registerScoringHealth(() => {
      throw new Error('scoring provider failed');
    });

    await expect(isReady()).resolves.toBe(true);
    await expect(isPromotionReady()).resolves.toBe(false);
  });

  it('fails promotion readiness closed for a malformed disk provider result', async () => {
    mockHealthyDatabase(true, true);
    redisPingMock.mockResolvedValue('PONG');
    registerDiskHealth(() => ({
      used_percent: Number.NaN,
      available_gb: -1,
      total_gb: 100,
      level: 'invalid',
      last_checked_at: '2026-08-02T05:00:00Z',
    } as unknown as DiskStatus));

    await expect(isPromotionReady()).resolves.toBe(false);
  });

  it.each([
    { level: 'critical', expectedReady: true },
    { level: 'emergency', expectedReady: false },
  ] as const)('$level disk pressure yields promotion readiness $expectedReady', async ({
    level,
    expectedReady,
  }) => {
    mockHealthyDatabase(true, true);
    redisPingMock.mockResolvedValue('PONG');
    registerDiskHealth(() => ({
      used_percent: level === 'emergency' ? 96 : 91,
      available_gb: level === 'emergency' ? 1 : 4,
      total_gb: 100,
      level,
      last_checked_at: '2026-08-02T05:00:00Z',
    }));

    await expect(isReady()).resolves.toBe(true);
    await expect(isPromotionReady()).resolves.toBe(expectedReady);
  });

  it('returns detailed diagnostics for admin health', async () => {
    healthDbQueryMock.mockRejectedValue(new Error('db down'));
    redisPingMock.mockResolvedValue('PONG');

    const app = Fastify();
    registerAdminHealthRoutes(app);
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/health',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        status: 'unhealthy',
        components: {
          database: {
            status: 'unhealthy',
            error: 'db down',
          },
          redis: {
            status: 'healthy',
          },
        },
      });
    } finally {
      await app.close();
    }
  });

  it('returns degraded admin health when only jetstream is unhealthy', async () => {
    healthDbQueryMock.mockResolvedValue({ rows: [{ '?column?': 1 }] });
    redisPingMock.mockResolvedValue('PONG');
    registerJetstreamHealth(() => ({
      status: 'unhealthy',
      connected: false,
    }));

    const app = Fastify();
    registerAdminHealthRoutes(app);
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/health',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        status: 'degraded',
        components: {
          database: {
            status: 'healthy',
          },
          jetstream: {
            status: 'unhealthy',
            connected: false,
          },
        },
      });
    } finally {
      await app.close();
    }
  });

  it('returns unhealthy admin health when database and jetstream are both unhealthy', async () => {
    healthDbQueryMock.mockRejectedValue(new Error('db down'));
    redisPingMock.mockResolvedValue('PONG');
    registerJetstreamHealth(() => ({
      status: 'unhealthy',
      connected: false,
    }));
    registerScoringHealth(() => ({
      status: 'healthy',
      is_running: false,
    }));

    const app = Fastify();
    registerAdminHealthRoutes(app);
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/health',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        status: 'unhealthy',
        components: {
          database: {
            status: 'unhealthy',
            error: 'db down',
          },
          jetstream: {
            status: 'unhealthy',
            connected: false,
          },
        },
      });
    } finally {
      await app.close();
    }
  });

  it('returns degraded admin health when jetstream provider throws and critical components are healthy', async () => {
    healthDbQueryMock.mockResolvedValue({ rows: [{ '?column?': 1 }] });
    redisPingMock.mockResolvedValue('PONG');
    registerJetstreamHealth(() => {
      throw new Error('jetstream probe failed');
    });
    registerScoringHealth(() => ({
      status: 'healthy',
      is_running: false,
    }));

    const app = Fastify();
    registerAdminHealthRoutes(app);
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/health',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        status: 'degraded',
        components: {
          database: {
            status: 'healthy',
          },
          jetstream: {
            status: 'unhealthy',
            connected: false,
            error: 'jetstream probe failed',
          },
        },
      });
    } finally {
      await app.close();
    }
  });

  it('returns degraded admin health when jetstream health is not registered', async () => {
    vi.resetModules();

    const { registerScoringHealth: registerScoringHealthFresh } = await import('../src/lib/health.js');
    const { registerAdminHealthRoutes: registerAdminHealthRoutesFresh } = await import('../src/admin/routes/health.js');

    healthDbQueryMock.mockResolvedValue({ rows: [{ '?column?': 1 }] });
    redisPingMock.mockResolvedValue('PONG');
    registerScoringHealthFresh(() => ({
      status: 'healthy',
      is_running: false,
    }));

    const app = Fastify();
    registerAdminHealthRoutesFresh(app);
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/health',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        status: 'degraded',
        components: {
          jetstream: {
            status: 'unhealthy',
            connected: false,
            error: 'Jetstream health check not registered',
          },
        },
      });
    } finally {
      await app.close();
    }
  });

  it('returns only redacted status for public health when jetstream health is not registered', async () => {
    vi.resetModules();

    const {
      getPublicHealthStatus: getPublicHealthStatusFresh,
      registerScoringHealth: registerScoringHealthFresh,
    } = await import('../src/lib/health.js');

    healthDbQueryMock.mockResolvedValue({ rows: [{ '?column?': 1 }] });
    redisPingMock.mockResolvedValue('PONG');
    registerScoringHealthFresh(() => ({
      status: 'healthy',
      is_running: false,
    }));

    const status = await getPublicHealthStatusFresh();

    expect(status).toEqual({ status: 'degraded', revision: null });
  });

  it('accepts only a lowercase full release SHA from the startup artifact', () => {
    const directory = mkdtempSync(join(tmpdir(), 'corgi-release-revision-'));
    const revisionPath = join(directory, '.release-sha');
    const validRevision = '0123456789abcdef0123456789abcdef01234567';

    try {
      expect(readReleaseRevision(join(directory, 'missing-release-sha'))).toBeNull();
      writeFileSync(revisionPath, `${validRevision}\n`, 'utf8');
      expect(readReleaseRevision(revisionPath)).toBe(validRevision);
      writeFileSync(revisionPath, `${validRevision}\r\n`, 'utf8');
      expect(readReleaseRevision(revisionPath)).toBe(validRevision);
      writeFileSync(revisionPath, validRevision, 'utf8');
      expect(readReleaseRevision(revisionPath)).toBe(validRevision);

      for (const invalidRevision of [
        '',
        '0123456',
        'a'.repeat(39),
        'a'.repeat(41),
        validRevision.toUpperCase(),
        'g123456789abcdef0123456789abcdef01234567',
        ` ${validRevision}`,
        `${validRevision} `,
        `\t${validRevision}`,
        `${validRevision}\t`,
        `${validRevision}\n\n`,
        `${validRevision}\n${validRevision}`,
      ]) {
        writeFileSync(revisionPath, invalidRevision, 'utf8');
        expect(() => readReleaseRevision(revisionPath)).toThrow(
          'Release revision must be a lowercase full 40-character SHA'
        );
      }
      expect(() => readReleaseRevision(directory)).toThrow(
        'Could not read release revision'
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it.each([
    {
      name: 'malformed',
      prepareArtifact: (artifactPath: string) => {
        writeFileSync(artifactPath, 'not-a-release-sha\n', 'utf8');
      },
    },
    {
      name: 'unreadable',
      prepareArtifact: (artifactPath: string) => {
        mkdirSync(artifactPath);
      },
    },
  ])('keeps health available when the release artifact is $name', async ({
    prepareArtifact,
  }) => {
    const directory = mkdtempSync(join(tmpdir(), 'corgi-malformed-release-revision-'));
    const distDirectory = join(directory, 'dist');

    try {
      mkdirSync(distDirectory);
      prepareArtifact(join(distDirectory, '.release-sha'));
      vi.resetModules();
      const {
        getPublicHealthStatus: getPublicHealthStatusFresh,
        initializeRuntimeRelease: initializeRuntimeReleaseFresh,
        isLive: isLiveFresh,
        isPromotionReady: isPromotionReadyFresh,
        isReady: isReadyFresh,
        registerJetstreamHealth: registerJetstreamHealthFresh,
        registerScoringHealth: registerScoringHealthFresh,
      } = await import('../src/lib/health.js');
      initializeRuntimeReleaseFresh(join(distDirectory, '.release-sha'));
      mockHealthyDatabase(true, true);
      redisPingMock.mockResolvedValue('PONG');
      registerJetstreamHealthFresh(() => ({
        status: 'healthy',
        connected: true,
      }));
      registerScoringHealthFresh(() => ({
        status: 'healthy',
        is_running: false,
      }));

      await expect(getPublicHealthStatusFresh()).resolves.toEqual({
        status: 'degraded',
        revision: null,
      });
      expect(isLiveFresh()).toBe(true);
      await expect(isReadyFresh()).resolves.toBe(true);
      await expect(isPromotionReadyFresh()).resolves.toBe(false);
    } finally {
      vi.resetModules();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('keeps the Docker health-check command pointed at /health/ready', () => {
    const dockerfile = readFileSync(join(process.cwd(), 'Dockerfile'), 'utf8');
    const healthcheckIndex = dockerfile.indexOf('HEALTHCHECK');
    expect(healthcheckIndex).toBeGreaterThanOrEqual(0);
    const healthcheckBlock = dockerfile.slice(healthcheckIndex, dockerfile.indexOf('\n\n', healthcheckIndex));

    // Loosened to the container's own contract (references /health/ready,
    // never the loopback-only /health/promotion-ready) rather than the exact
    // command string, so unrelated wget flag/timeout tuning doesn't fail
    // this test.
    expect(healthcheckBlock).toContain('/health/ready');
    expect(healthcheckBlock).not.toContain('/health/promotion-ready');
  });

  it('loads the startup release artifact through the public health API', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'corgi-public-health-revision-'));
    const distDirectory = join(directory, 'dist');
    const validRevision = '0123456789abcdef0123456789abcdef01234567';

    try {
      mkdirSync(distDirectory);
      writeFileSync(join(distDirectory, '.release-sha'), `${validRevision}\n`, 'utf8');
      vi.resetModules();
      const {
        getPublicHealthStatus: getPublicHealthStatusFresh,
        initializeRuntimeRelease: initializeRuntimeReleaseFresh,
        isPromotionReady: isPromotionReadyFresh,
        isReady: isReadyFresh,
        registerJetstreamHealth: registerJetstreamHealthFresh,
        registerScoringHealth: registerScoringHealthFresh,
      } = await import('../src/lib/health.js');
      initializeRuntimeReleaseFresh(join(distDirectory, '.release-sha'));
      mockHealthyDatabase(true, true);
      redisPingMock.mockResolvedValue('PONG');
      registerJetstreamHealthFresh(() => ({
        status: 'healthy',
        connected: true,
      }));
      registerScoringHealthFresh(() => ({
        status: 'healthy',
        is_running: false,
      }));

      const status = await getPublicHealthStatusFresh();

      expect(status).toEqual({ status: 'ok', revision: validRevision });
      await expect(isReadyFresh()).resolves.toBe(true);
      await expect(isPromotionReadyFresh()).resolves.toBe(true);

      healthDbQueryMock.mockRejectedValue(new Error('db down'));
      const degradedStatus = await getPublicHealthStatusFresh();

      expect(degradedStatus).toEqual({ status: 'degraded', revision: validRevision });
      await expect(isReadyFresh()).resolves.toBe(false);
      await expect(isPromotionReadyFresh()).resolves.toBe(false);
    } finally {
      vi.resetModules();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
