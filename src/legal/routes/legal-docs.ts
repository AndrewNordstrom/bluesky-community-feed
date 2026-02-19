/**
 * Legal Document Routes
 *
 * Serves Terms of Service and Privacy Policy as JSON.
 * Documents are read once at startup and cached in memory.
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import { logger } from '../../lib/logger.js';

const LEGAL_DIR = path.resolve(process.cwd(), 'legal');
const VERSION = '2026-02-19-v3';
const LAST_UPDATED = '2026-02-19';

interface LegalDocResponse {
  content: string;
  document: 'tos' | 'privacy';
  version: string;
  lastUpdated: string;
}

// Read and cache at module load time
function loadDocument(filename: string): string | null {
  const filePath = path.join(LEGAL_DIR, filename);
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    logger.warn({ filePath }, 'Legal document not found');
    return null;
  }
}

const tosContent = loadDocument('TERMS_OF_SERVICE.md');
const privacyContent = loadDocument('PRIVACY_POLICY.md');

export function registerLegalDocsRoute(app: FastifyInstance): void {
  app.get('/api/legal/tos', async (_request: FastifyRequest, reply: FastifyReply) => {
    if (!tosContent) {
      return reply.code(404).send({ error: 'NotFound', message: 'Document not available' });
    }

    const response: LegalDocResponse = {
      content: tosContent,
      document: 'tos',
      version: VERSION,
      lastUpdated: LAST_UPDATED,
    };
    return reply.send(response);
  });

  app.get('/api/legal/privacy', async (_request: FastifyRequest, reply: FastifyReply) => {
    if (!privacyContent) {
      return reply.code(404).send({ error: 'NotFound', message: 'Document not available' });
    }

    const response: LegalDocResponse = {
      content: privacyContent,
      document: 'privacy',
      version: VERSION,
      lastUpdated: LAST_UPDATED,
    };
    return reply.send(response);
  });
}
