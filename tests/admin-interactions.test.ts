/**
 * Tests for admin interaction API endpoints.
 * Verifies response shapes and empty data handling.
 */

import Fastify from 'fastify';
import { describe, it, expect, vi, beforeEach } from 'vitest';

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

// Skip admin auth for unit tests
vi.mock('../src/auth/admin.js', () => ({
  requireAdmin: vi.fn().mockImplementation(async () => {}),
  getAdminDid: vi.fn().mockReturnValue('did:plc:admin'),
}));

import { registerInteractionRoutes } from '../src/admin/routes/interactions.js';

describe('admin interaction endpoints', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /interactions/overview', () => {
    it('returns correct shape with empty data', async () => {
      // Today stats
      dbQueryMock.mockResolvedValueOnce({
        rows: [{
          total_requests: '0',
          unique_viewers: '0',
          anonymous_requests: '0',
          avg_scroll_depth: null,
          avg_response_time_ms: null,
        }],
      });
      // Returning viewers
      dbQueryMock.mockResolvedValueOnce({
        rows: [{ returning_viewers: '0' }],
      });
      // Yesterday
      dbQueryMock.mockResolvedValueOnce({ rows: [] });
      // Trend
      dbQueryMock.mockResolvedValueOnce({ rows: [] });

      const app = Fastify();
      registerInteractionRoutes(app);

      const response = await app.inject({
        method: 'GET',
        url: '/interactions/overview',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.today).toBeDefined();
      expect(body.today.totalRequests).toBe(0);
      expect(body.today.uniqueViewers).toBe(0);
      expect(body.yesterday).toBeNull();
      expect(body.trend).toEqual([]);

      await app.close();
    });
  });

  describe('GET /interactions/scroll-depth', () => {
    it('returns histogram with empty data', async () => {
      dbQueryMock.mockResolvedValueOnce({ rows: [] });

      const app = Fastify();
      registerInteractionRoutes(app);

      const response = await app.inject({
        method: 'GET',
        url: '/interactions/scroll-depth',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.histogram).toEqual([]);

      await app.close();
    });
  });

  describe('GET /interactions/engagement', () => {
    it('returns correct shape with zero engagement', async () => {
      // Overall
      dbQueryMock.mockResolvedValueOnce({
        rows: [{
          total_served: '0',
          total_engaged: '0',
          engagement_rate: '0',
          likes: '0',
          reposts: '0',
        }],
      });
      // By position
      dbQueryMock.mockResolvedValueOnce({ rows: [] });

      const app = Fastify();
      registerInteractionRoutes(app);

      const response = await app.inject({
        method: 'GET',
        url: '/interactions/engagement',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.overall.totalServed).toBe(0);
      expect(body.overall.engagementRate).toBe(0);
      expect(body.byPosition).toEqual([]);

      await app.close();
    });
  });

  describe('GET /interactions/epoch-comparison', () => {
    it('returns epochs array with data', async () => {
      dbQueryMock.mockResolvedValueOnce({
        rows: [
          {
            epoch_id: 1,
            total_feed_loads: 100,
            unique_viewers: 25,
            avg_scroll_depth: '75.5',
            returning_viewer_pct: '40.0',
            engagement_rate: '0.1',
            avg_engagement_position: '12.5',
            posts_served: 5000,
            posts_with_engagement: 50,
            computed_at: '2026-02-20T10:00:00Z',
            epoch_started_at: '2026-02-15T00:00:00Z',
          },
        ],
      });

      const app = Fastify();
      registerInteractionRoutes(app);

      const response = await app.inject({
        method: 'GET',
        url: '/interactions/epoch-comparison',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.epochs).toHaveLength(1);
      expect(body.epochs[0].epochId).toBe(1);
      expect(body.epochs[0].engagementRate).toBe(0.1);

      await app.close();
    });
  });

  describe('GET /interactions/keyword-performance', () => {
    it('returns empty keywords when no epoch stats exist', async () => {
      // Epoch stats
      dbQueryMock.mockResolvedValueOnce({ rows: [] });
      // Rules
      dbQueryMock.mockResolvedValueOnce({ rows: [] });

      const app = Fastify();
      registerInteractionRoutes(app);

      const response = await app.inject({
        method: 'GET',
        url: '/interactions/keyword-performance',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.keywords).toEqual([]);

      await app.close();
    });
  });
});
