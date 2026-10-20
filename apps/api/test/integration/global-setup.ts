import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer } from '@testcontainers/redis';
import { GenericContainer, Wait } from 'testcontainers';
import type { TestProject } from 'vitest/node';
import { migrate } from '../../src/infrastructure/migrator.js';
import { MIGRATIONS_DIR } from '../../src/infrastructure/paths.js';
import { createPool } from '../../src/infrastructure/postgres.js';

declare module 'vitest' {
  export interface ProvidedContext {
    postgresUrl: string;
    mongoUrl: string;
    redisUrl: string;
  }
}

/** One PostgreSQL, MongoDB and Redis for the whole suite; migrations applied once. */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const [postgres, mongo, redis] = await Promise.all([
    new PostgreSqlContainer('postgres:17-alpine').withDatabase('shieldgate').start(),
    // Standalone server: the audit trail needs no replica set (no multi-document transactions).
    new GenericContainer('mongo:8.0')
      .withExposedPorts(27017)
      .withWaitStrategy(Wait.forLogMessage(/Waiting for connections/))
      .start(),
    new RedisContainer('redis:7.4-alpine').start(),
  ]);

  const pool = createPool(postgres.getConnectionUri());
  await migrate(pool, MIGRATIONS_DIR);
  await pool.end();

  project.provide('postgresUrl', postgres.getConnectionUri());
  project.provide('mongoUrl', `mongodb://${mongo.getHost()}:${mongo.getMappedPort(27017)}`);
  project.provide('redisUrl', redis.getConnectionUrl());

  return async () => {
    await Promise.all([postgres.stop(), mongo.stop(), redis.stop()]);
  };
}
