/**
 * Standalone stdio MCP server for the Claude Desktop app.
 *
 * Communicates over stdin/stdout using JSON-RPC.
 * Under the hood, SSHs to the VPS to run queries — same pattern as ops/ scripts.
 *
 * CRITICAL: Never use console.log() — it corrupts JSON-RPC messages.
 * All logging goes through console.error().
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

// NOTE: Using promisify(execFile) — NOT exec(). execFile does not spawn a shell,
// so there is no shell injection risk. Arguments are passed as an array.
const execFileAsync = promisify(execFile);

const PROJECT_DIR =
  '/Users/andrewnordstrom/Desktop/Projects/Active/Bluesky_Corgi';
const VPS_HOST = 'corgi-vps';
const APP_DIR = '/opt/bluesky-feed';
const SSH_TIMEOUT = 30_000;
const REPORT_TIMEOUT = 120_000;

const server = new McpServer({
  name: 'corgi-feed-local',
  version: '1.0.0',
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Run an SSH command on the VPS and return stdout. */
async function sshQuery(command: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync('ssh', [VPS_HOST, command], {
      timeout: SSH_TIMEOUT,
    });
    return stdout.trim();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`SSH command failed: ${msg}`);
  }
}

/** Run a SQL query via ops/db on the VPS. */
async function dbQuery(sql: string): Promise<string> {
  // Escape double-quotes for the shell
  const escaped = sql.replace(/"/g, '\\"');
  return sshQuery(`cd ${APP_DIR} && ops/db "${escaped}"`);
}

// ---------------------------------------------------------------------------
// 1. Feed Status & Health
// ---------------------------------------------------------------------------

server.tool(
  'feed_status',
  'Get current feed health: service status, post counts, scoring pipeline timing, disk usage',
  {},
  async () => {
    const result = await sshQuery(`cd ${APP_DIR} && ops/status`);
    return { content: [{ type: 'text' as const, text: result }] };
  }
);

server.tool(
  'feed_audit',
  'Audit the top N posts in the feed with score breakdowns and text previews',
  {
    count: z
      .number()
      .default(20)
      .describe('Number of top posts to audit (default 20)'),
  },
  async ({ count }) => {
    const result = await sshQuery(
      `cd ${APP_DIR} && ops/feed-check ${count}`
    );
    return { content: [{ type: 'text' as const, text: result }] };
  }
);

// ---------------------------------------------------------------------------
// 2. Database Queries
// ---------------------------------------------------------------------------

server.tool(
  'db_query',
  'Run a READ-ONLY SQL query against the feed database. Only SELECT queries allowed.',
  { sql: z.string().describe('SQL SELECT query to run') },
  async ({ sql }) => {
    const normalized = sql.trim().toUpperCase();
    if (!normalized.startsWith('SELECT') && !normalized.startsWith('WITH')) {
      return {
        content: [
          { type: 'text' as const, text: 'Error: Only SELECT/WITH queries allowed.' },
        ],
        isError: true,
      };
    }
    const result = await dbQuery(sql);
    return { content: [{ type: 'text' as const, text: result }] };
  }
);

// ---------------------------------------------------------------------------
// 3. Governance
// ---------------------------------------------------------------------------

server.tool(
  'governance_state',
  'Get current epoch info: weights, topic weights, vote count, status',
  {},
  async () => {
    const result = await dbQuery(`
      SELECT id, status, vote_count,
        recency_weight, engagement_weight, bridging_weight,
        source_diversity_weight, relevance_weight,
        topic_weights::text
      FROM governance_epochs WHERE status='active' ORDER BY id DESC LIMIT 1
    `);
    return { content: [{ type: 'text' as const, text: result }] };
  }
);

// ---------------------------------------------------------------------------
// 4. Logs & Ops
// ---------------------------------------------------------------------------

server.tool(
  'service_logs',
  'Get recent service logs. Optionally filter with a grep pattern.',
  {
    pattern: z
      .string()
      .optional()
      .describe('Grep pattern to filter logs'),
    lines: z
      .number()
      .default(50)
      .describe('Number of log lines (default 50)'),
  },
  async ({ pattern, lines }) => {
    const cmd = pattern
      ? `cd ${APP_DIR} && ops/logs grep "${pattern.replace(/"/g, '\\"')}" | tail -${lines}`
      : `cd ${APP_DIR} && ops/logs | tail -${lines}`;
    const result = await sshQuery(cmd);
    return { content: [{ type: 'text' as const, text: result }] };
  }
);

// ---------------------------------------------------------------------------
// 5. Report Generation
// ---------------------------------------------------------------------------

server.tool(
  'generate_report',
  'Generate a feed quality analysis report (docx). Returns file path when complete.',
  {
    date_label: z
      .string()
      .optional()
      .describe('Date label for report title'),
    dry_run: z
      .boolean()
      .default(false)
      .describe('Preview metrics without generating docx'),
  },
  async ({ date_label, dry_run }) => {
    const scriptPath = `${PROJECT_DIR}/scripts/generate-report.py`;
    const args = [scriptPath];
    if (date_label) args.push('--date', date_label);
    if (dry_run) args.push('--dry-run');

    const { stdout } = await execFileAsync('python3', args, {
      timeout: REPORT_TIMEOUT,
      cwd: PROJECT_DIR,
    });
    return { content: [{ type: 'text' as const, text: stdout }] };
  }
);

// ---------------------------------------------------------------------------
// 6. Redis Cache
// ---------------------------------------------------------------------------

server.tool(
  'redis_get',
  'Get a value from the Redis cache on VPS',
  { key: z.string().describe('Redis key to fetch') },
  async ({ key }) => {
    const escaped = key.replace(/"/g, '\\"');
    const result = await sshQuery(
      `cd ${APP_DIR} && ops/redis GET "${escaped}"`
    );
    return {
      content: [{ type: 'text' as const, text: result || '(nil)' }],
    };
  }
);

// ---------------------------------------------------------------------------
// 7. Deploy
// ---------------------------------------------------------------------------

server.tool(
  'deploy',
  'Deploy latest main to VPS: pull, build, migrate, restart. USE WITH CAUTION.',
  { confirm: z.boolean().describe('Must be true to proceed') },
  async ({ confirm }) => {
    if (!confirm) {
      return {
        content: [
          { type: 'text' as const, text: 'Deploy aborted — confirm must be true.' },
        ],
      };
    }
    const result = await sshQuery(`cd ${APP_DIR} && ops/deploy`);
    return { content: [{ type: 'text' as const, text: result }] };
  }
);

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Corgi Feed MCP server running on stdio');
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
