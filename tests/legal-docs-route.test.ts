import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';

import { registerLegalDocsRoute } from '../src/legal/routes/legal-docs.js';

interface LegalDocResponse {
  content: string;
  document: 'tos' | 'privacy';
  version: string;
  lastUpdated: string;
}

describe('legal document routes', () => {
  it('serves Terms metadata matching the document dates', async () => {
    const app = Fastify();
    registerLegalDocsRoute(app);
    try {
      const response = await app.inject({ method: 'GET', url: '/api/legal/tos' });
      expect(response.statusCode).toBe(200);
      const body = response.json<LegalDocResponse>();
      expect(body.document).toBe('tos');
      expect(body.version).toBe('2026-08-13-v4');
      expect(body.lastUpdated).toBe('2026-08-13');
      expect(body.content).toContain('**Last Updated:** August 13, 2026');
      expect(body.content).toContain('**Effective Date:** August 13, 2026');
    } finally {
      await app.close();
    }
  });

  it('serves Privacy metadata matching the document dates', async () => {
    const app = Fastify();
    registerLegalDocsRoute(app);
    try {
      const response = await app.inject({ method: 'GET', url: '/api/legal/privacy' });
      expect(response.statusCode).toBe(200);
      const body = response.json<LegalDocResponse>();
      expect(body.document).toBe('privacy');
      expect(body.version).toBe('2026-02-19-v3');
      expect(body.lastUpdated).toBe('2026-02-19');
      expect(body.content).toContain('**Last Updated:** February 19, 2026');
      expect(body.content).toContain('**Effective Date:** February 19, 2026');
    } finally {
      await app.close();
    }
  });
});
