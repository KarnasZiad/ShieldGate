import type { AppDeps } from './app.js';
import type { AppConfig } from './config.js';
import { connectMongo } from './infrastructure/mongo.js';
import { createPool } from './infrastructure/postgres.js';
import { createRedis } from './infrastructure/redis.js';
import { systemClock } from './lib/clock.js';

/** Wires the real infrastructure. Tests use in-memory implementations instead (src/testing). */
export async function createDependencies(
  config: AppConfig,
): Promise<{ deps: AppDeps; close: () => Promise<void> }> {
  const pool = createPool(config.DATABASE_URL);
  const redis = createRedis(config.REDIS_URL, (error) => {
    console.error(`Redis connection error: ${error.message}`);
  });
  const mongo = await connectMongo(config.MONGODB_URL, config.MONGODB_DATABASE);

  const deps: AppDeps = {
    config,
    clock: systemClock,
    redis,
    healthProbes: [
      { name: 'postgres', check: () => pool.query('SELECT 1') },
      { name: 'mongodb', check: () => mongo.db.command({ ping: 1 }) },
      { name: 'redis', check: () => redis.ping() },
    ],
  };

  return {
    deps,
    close: async () => {
      await Promise.allSettled([pool.end(), redis.quit(), mongo.client.close()]);
    },
  };
}
