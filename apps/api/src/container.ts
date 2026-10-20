import type { AppDeps } from './app.js';
import type { AppConfig } from './config.js';
import { connectMongo } from './infrastructure/mongo.js';
import { createPool } from './infrastructure/postgres.js';
import { createRedis } from './infrastructure/redis.js';
import { systemClock } from './lib/clock.js';
import { RedisEphemeralStore } from './lib/ephemeral-store.js';
import { AuditLogger } from './modules/audit/audit-logger.js';
import { MongoAuditStore } from './modules/audit/audit-store.mongo.js';
import { RedisLoginThrottleStore } from './modules/auth/login-throttle.redis.js';
import { RedisMfaChallengeStore } from './modules/auth/mfa-challenge.redis.js';
import { RedisSessionStore } from './modules/sessions/session-store.redis.js';
import {
  PostgresRoleRepository,
  PostgresUserRepository,
} from './modules/users/user-repository.postgres.js';

/** Wires the real infrastructure. Tests use in-memory implementations instead (src/testing). */
export async function createDependencies(
  config: AppConfig,
): Promise<{ deps: AppDeps; close: () => Promise<void> }> {
  const pool = createPool(config.DATABASE_URL);
  const redis = createRedis(config.REDIS_URL, (error) => {
    console.error(`Redis connection error: ${error.message}`);
  });
  const mongo = await connectMongo(config.MONGODB_URL, config.MONGODB_DATABASE);
  const auditStore = await MongoAuditStore.create(mongo.db, config.AUDIT_RETENTION_DAYS);

  const deps: AppDeps = {
    config,
    clock: systemClock,
    redis,
    healthProbes: [
      { name: 'postgres', check: () => pool.query('SELECT 1') },
      { name: 'mongodb', check: () => mongo.db.command({ ping: 1 }) },
      { name: 'redis', check: () => redis.ping() },
    ],
    users: new PostgresUserRepository(pool),
    roles: new PostgresRoleRepository(pool),
    sessions: new RedisSessionStore(redis, systemClock, {
      idleMs: config.SESSION_IDLE_MINUTES * 60_000,
      absoluteMs: config.SESSION_ABSOLUTE_HOURS * 3_600_000,
    }),
    loginThrottle: new RedisLoginThrottleStore(redis),
    mfaChallenges: new RedisMfaChallengeStore(redis),
    pendingMfaSetups: new RedisEphemeralStore(redis, 'sg:mfa:setup:'),
    audit: new AuditLogger(auditStore, systemClock, {
      onError: (error, buffered) => {
        console.error(`Audit write failed (${buffered} events buffered): ${String(error)}`);
      },
    }),
  };

  return {
    deps,
    close: async () => {
      await Promise.allSettled([pool.end(), redis.quit(), mongo.client.close()]);
    },
  };
}
