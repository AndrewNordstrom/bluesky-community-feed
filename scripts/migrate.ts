import 'dotenv/config';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';

const { Client } = pg;
const MIGRATIONS_DIR = path.resolve(process.cwd(), 'src/db/migrations');
const MIGRATIONS_TABLE = 'schema_migrations';

async function ensureMigrationsTable(client: pg.Client): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function getMigrationFiles(): Promise<string[]> {
  const files = await readdir(MIGRATIONS_DIR);
  return files
    .filter((filename) => filename.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

async function runMigrations(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required to run migrations');
  }

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    await ensureMigrationsTable(client);

    const files = await getMigrationFiles();
    const appliedResult = await client.query<{ filename: string }>(
      `SELECT filename FROM ${MIGRATIONS_TABLE}`
    );
    const applied = new Set(appliedResult.rows.map((row) => row.filename));

    if (files.length === 0) {
      console.log(`No migration files found in ${MIGRATIONS_DIR}`);
      return;
    }

    for (const filename of files) {
      if (applied.has(filename)) {
        console.log(`[skip] ${filename}`);
        continue;
      }

      const migrationPath = path.join(MIGRATIONS_DIR, filename);
      const sql = await readFile(migrationPath, 'utf8');

      console.log(`[apply] ${filename}`);
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(`INSERT INTO ${MIGRATIONS_TABLE} (filename) VALUES ($1)`, [filename]);
        await client.query('COMMIT');
        console.log(`[done] ${filename}`);
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`[failed] ${filename}`);
        throw err;
      }
    }
  } finally {
    await client.end();
  }
}

runMigrations().catch((err) => {
  console.error('Migration run failed');
  console.error(err);
  process.exit(1);
});
