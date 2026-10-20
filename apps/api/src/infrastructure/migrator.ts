import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type pg from 'pg';
import { sha256Hex } from '../lib/crypto/tokens.js';

/** Arbitrary constant identifying the migration lock among PostgreSQL advisory locks. */
const MIGRATION_LOCK_ID = 7_301_001;
const MIGRATION_FILE = /^[0-9]{4}_[a-z0-9_]+[.]sql$/;

/**
 * Applies `migrations/NNNN_name.sql` files in order, each in its own transaction.
 *
 * - An advisory lock serializes concurrent starts: two instances never migrate at the same time.
 * - A checksum per migration detects files edited after being applied.
 */
export async function migrate(
  pool: pg.Pool,
  directory: string,
  log: (message: string) => void = () => undefined,
): Promise<string[]> {
  const client = await pool.connect();
  const applied: string[] = [];
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_ID]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version text PRIMARY KEY,
        checksum text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )`);
    const { rows } = await client.query<{ version: string; checksum: string }>(
      'SELECT version, checksum FROM schema_migrations',
    );
    const known = new Map(rows.map((row) => [row.version, row.checksum]));
    const files = (await readdir(directory)).filter((file) => MIGRATION_FILE.test(file)).sort();

    for (const file of files) {
      const version = file.slice(0, -'.sql'.length);
      const sql = await readFile(join(directory, file), 'utf8');
      const checksum = sha256Hex(sql);
      const previous = known.get(version);
      if (previous !== undefined) {
        if (previous !== checksum) {
          throw new Error(`Migration ${version} was modified after being applied`);
        }
        continue;
      }
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)', [
          version,
          checksum,
        ]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
      applied.push(version);
      log(`Applied migration ${version}`);
    }
    return applied;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]).catch(() => undefined);
    client.release();
  }
}
