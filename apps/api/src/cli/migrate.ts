import { loadConfig } from '../config.js';
import { migrate } from '../infrastructure/migrator.js';
import { MIGRATIONS_DIR } from '../infrastructure/paths.js';
import { createPool } from '../infrastructure/postgres.js';

const config = loadConfig();
const pool = createPool(config.DATABASE_URL);

try {
  const applied = await migrate(pool, MIGRATIONS_DIR, (message) => {
    console.log(message);
  });
  console.log(
    applied.length > 0 ? `${applied.length} migration(s) applied` : 'Database is up to date',
  );
} finally {
  await pool.end();
}
