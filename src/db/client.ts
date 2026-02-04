import pg from 'pg';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';

const { Pool } = pg;

export const db = new Pool({
  connectionString: config.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

db.on('error', (err) => {
  logger.error({ err }, 'Unexpected PostgreSQL pool error');
});

db.on('connect', () => {
  logger.debug('New PostgreSQL client connected');
});
