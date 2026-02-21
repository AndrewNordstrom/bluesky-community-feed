import { randomUUID } from 'crypto';
import { spawn } from 'child_process';
import { promisify } from 'util';
import { setTimeout as setTimeoutCb } from 'timers';
import { db } from '../../src/db/client.js';
import { redis } from '../../src/db/redis.js';

const sleepInternal = promisify(setTimeoutCb);

export interface AssertionResult {
  name: string;
  pass: boolean;
  detail: string;
}

export interface ScenarioResult {
  name: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  success: boolean;
  metrics: Record<string, unknown>;
  assertions: AssertionResult[];
  errors: string[];
}

export interface TableSizeRow {
  table_name: string;
  row_estimate: number;
  total_bytes: number;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function rssMb(): number {
  return Math.round((process.memoryUsage().rss / (1024 * 1024)) * 100) / 100;
}

export async function sleep(ms: number): Promise<void> {
  await sleepInternal(ms);
}

export function makeJwt(did: string): string {
  const header = Buffer.from(JSON.stringify({ alg: 'ES256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ iss: did, sub: did, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
  const sig = Buffer.from(randomUUID()).toString('base64url');
  return `${header}.${payload}.${sig}`;
}

export function summarizeAssertions(assertions: AssertionResult[]): boolean {
  return assertions.every((a) => a.pass);
}

export async function truncateStressData(): Promise<void> {
  await db.query(`
    TRUNCATE TABLE
      feed_requests,
      feed_request_daily_stats,
      engagement_attributions,
      epoch_engagement_stats,
      likes,
      reposts,
      post_engagement,
      post_scores,
      posts,
      follows,
      subscribers,
      governance_votes,
      governance_audit_log,
      governance_epochs,
      scheduled_votes,
      announcements,
      bot_announcements,
      system_status
    RESTART IDENTITY CASCADE
  `);

  const keys = await redis.keys('feed:*');
  if (keys.length > 0) {
    await redis.del(...keys);
  }

  const snapshotKeys = await redis.keys('snapshot:*');
  if (snapshotKeys.length > 0) {
    await redis.del(...snapshotKeys);
  }

  await redis.del('feed:request_log');
}

export async function ensureActiveEpoch(): Promise<number> {
  const existing = await db.query<{ id: number }>(
    `SELECT id FROM governance_epochs WHERE status = 'active' ORDER BY id DESC LIMIT 1`
  );
  if (existing.rows[0]) {
    return existing.rows[0].id;
  }

  const inserted = await db.query<{ id: number }>(
    `INSERT INTO governance_epochs (
      status,
      recency_weight,
      engagement_weight,
      bridging_weight,
      source_diversity_weight,
      relevance_weight,
      vote_count,
      description,
      phase,
      auto_transition,
      content_rules
    )
    VALUES (
      'active',
      0.2,
      0.2,
      0.2,
      0.2,
      0.2,
      0,
      'Stress test epoch',
      'running',
      TRUE,
      '{"include_keywords":[],"exclude_keywords":[]}'::jsonb
    )
    RETURNING id`
  );

  return inserted.rows[0].id;
}

export async function readQueueLength(queue = 'feed:request_log'): Promise<number> {
  const len = await redis.llen(queue);
  return Number(len);
}

export async function getTableSizes(): Promise<TableSizeRow[]> {
  const result = await db.query<TableSizeRow>(`
    SELECT
      c.relname AS table_name,
      GREATEST(c.reltuples::bigint, 0)::bigint AS row_estimate,
      pg_total_relation_size(c.oid)::bigint AS total_bytes
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
    ORDER BY c.relname ASC
  `);

  return result.rows.map((row) => ({
    table_name: row.table_name,
    row_estimate: Number(row.row_estimate),
    total_bytes: Number(row.total_bytes),
  }));
}

export function bytesToMb(bytes: number): number {
  return Math.round((bytes / (1024 * 1024)) * 100) / 100;
}

export async function spawnCommand(
  command: string,
  args: string[],
  opts?: { cwd?: string; env?: NodeJS.ProcessEnv }
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: opts?.cwd,
      env: opts?.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', reject);
    child.on('close', (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}
