import pg from 'pg';

export type Pool = pg.Pool;

export function createPool(connectionString: string): pg.Pool {
  return new pg.Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    // A runaway query cannot hold a connection forever.
    statement_timeout: 5_000,
    application_name: 'shieldgate-api',
  });
}
