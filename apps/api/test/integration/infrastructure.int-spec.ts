import { Redis } from 'ioredis';
import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';
import { migrate } from '../../src/infrastructure/migrator.js';
import { MIGRATIONS_DIR } from '../../src/infrastructure/paths.js';
import { createPool } from '../../src/infrastructure/postgres.js';
import { FixedClock } from '../../src/lib/clock.js';
import { PostgresApiKeyRepository } from '../../src/modules/api-keys/api-key-repository.postgres.js';
import { LoginThrottle } from '../../src/modules/auth/login-throttle.js';
import { RedisLoginThrottleStore } from '../../src/modules/auth/login-throttle.redis.js';
import { RedisMfaChallengeStore } from '../../src/modules/auth/mfa-challenge.redis.js';
import { PolicySchema } from '../../src/modules/authorization/policy.js';
import { PostgresPolicyRepository } from '../../src/modules/authorization/policy-repository.postgres.js';
import { RedisSessionStore } from '../../src/modules/sessions/session-store.redis.js';
import { EmailTakenError, UnknownRoleError } from '../../src/modules/users/user.js';
import {
  PostgresRoleRepository,
  PostgresUserRepository,
} from '../../src/modules/users/user-repository.postgres.js';

let pool: pg.Pool;
let redis: Redis;

beforeAll(() => {
  pool = createPool(inject('postgresUrl'));
  redis = new Redis(inject('redisUrl'));
});

afterAll(async () => {
  await Promise.all([pool.end(), redis.quit()]);
});

beforeEach(async () => {
  await pool.query('TRUNCATE users, policies CASCADE');
  await redis.flushdb();
});

function newUser(email: string, roles: string[] = ['member']) {
  return { email, displayName: email.split('@')[0] ?? email, passwordHash: 'argon2-hash', roles };
}

describe('migrator', () => {
  it('serializes concurrent runs, is idempotent and detects edited migrations', async () => {
    await pool.query('DROP DATABASE IF EXISTS migrator_scratch');
    await pool.query('CREATE DATABASE migrator_scratch');
    const scratch = createPool(
      inject('postgresUrl').replace(/[/]shieldgate$/, '/migrator_scratch'),
    );
    try {
      // Two instances starting together: the advisory lock lets one apply everything.
      const runs = await Promise.all([
        migrate(scratch, MIGRATIONS_DIR),
        migrate(scratch, MIGRATIONS_DIR),
      ]);
      expect(runs.map((applied) => applied.length).sort()).toEqual([0, 3]);
      await expect(migrate(scratch, MIGRATIONS_DIR)).resolves.toEqual([]);

      await scratch.query(
        `UPDATE schema_migrations SET checksum = 'edited' WHERE version = '0001_users_and_roles'`,
      );
      await expect(migrate(scratch, MIGRATIONS_DIR)).rejects.toThrow(
        'was modified after being applied',
      );
    } finally {
      await scratch.end();
    }
  });
});

describe('PostgresUserRepository', () => {
  it('enforces case-insensitive e-mail uniqueness', async () => {
    const users = new PostgresUserRepository(pool);
    await users.create(newUser('amina@exemple.ma'));

    await expect(users.create(newUser('Amina@Exemple.MA'))).rejects.toBeInstanceOf(EmailTakenError);
    await expect(users.findByEmail('AMINA@exemple.ma')).resolves.toMatchObject({
      roles: ['member'],
    });
  });

  it('rolls back an account created with an unknown role', async () => {
    const users = new PostgresUserRepository(pool);

    await expect(users.create(newUser('ghost@exemple.ma', ['root']))).rejects.toBeInstanceOf(
      UnknownRoleError,
    );
    await expect(users.findByEmail('ghost@exemple.ma')).resolves.toBeNull();
  });

  it('paginates newest first and escapes LIKE wildcards in searches', async () => {
    const users = new PostgresUserRepository(pool);
    for (const email of ['a@x.ma', 'b@x.ma', 'c@x.ma', '100%off@x.ma']) {
      await users.create(newUser(email));
    }

    const first = await users.list({ limit: 2 });
    const second = await users.list({ limit: 2, cursor: first.nextCursor ?? '' });
    const percent = await users.list({ limit: 10, search: '%' });

    expect([...first.items, ...second.items].map((user) => user.email)).toEqual([
      '100%off@x.ma',
      'c@x.ma',
      'b@x.ma',
      'a@x.ma',
    ]);
    expect(second.nextCursor).toBeNull();
    expect(percent.items.map((user) => user.email)).toEqual(['100%off@x.ma']);
  });

  it('replaces roles and keeps a TOTP step single-use under concurrency', async () => {
    const users = new PostgresUserRepository(pool);
    const user = await users.create(newUser('amina@exemple.ma'));

    await expect(users.setRoles(user.id, ['admin', 'security-analyst'])).resolves.toMatchObject({
      roles: ['admin', 'security-analyst'],
    });
    const results = await Promise.all(
      Array.from({ length: 5 }, () => users.recordTotpStep(user.id, 42)),
    );
    expect(results.filter(Boolean)).toHaveLength(1);
    await expect(users.recordTotpStep(user.id, 41)).resolves.toBe(false);
    await expect(users.recordTotpStep(user.id, 43)).resolves.toBe(true);
  });

  it('lists the seeded roles', async () => {
    const roles = await new PostgresRoleRepository(pool).list();

    expect(roles.map((role) => role.name)).toEqual(['admin', 'member', 'security-analyst']);
  });
});

describe('RedisSessionStore', () => {
  const lifetime = { idleMs: 60_000, absoluteMs: 3_600_000 };

  it('creates, resolves, lists and revokes sessions', async () => {
    const clock = new FixedClock(Date.now());
    const store = new RedisSessionStore(redis, clock, lifetime);
    const input = {
      userId: 'u-1',
      email: 'amina@exemple.ma',
      displayName: 'Amina',
      roles: ['member'],
      permissions: [],
      mfa: false,
      ip: '203.0.113.1',
      userAgent: 'test',
    };
    const first = await store.create(input);
    const second = await store.create(input);

    expect(await redis.exists(`sg:session:${first.session.handle}`)).toBe(1);
    expect(await redis.keys(`*${first.id}*`)).toEqual([]);
    await expect(store.touch(first.id)).resolves.toMatchObject({ userId: 'u-1' });
    await expect(store.list('u-1')).resolves.toHaveLength(2);

    await store.revoke(first.session.handle);
    await expect(store.touch(first.id)).resolves.toBeNull();

    await expect(store.revokeAllForUser('u-1')).resolves.toBe(1);
    await expect(store.touch(second.id)).resolves.toBeNull();
    await expect(store.list('u-1')).resolves.toEqual([]);
  });

  it('enforces the absolute lifetime', async () => {
    const clock = new FixedClock(Date.now());
    const store = new RedisSessionStore(redis, clock, lifetime);
    const { id } = await store.create({
      userId: 'u-2',
      email: 'x@x.ma',
      displayName: 'X',
      roles: [],
      permissions: [],
      mfa: false,
      ip: '203.0.113.1',
      userAgent: 'test',
    });

    clock.advance(lifetime.absoluteMs);

    await expect(store.touch(id)).resolves.toBeNull();
  });
});

describe('Redis login throttle and MFA challenges', () => {
  it('counts failures per account and distinct accounts per IP', async () => {
    const store = new RedisLoginThrottleStore(redis);
    const throttle = new LoginThrottle(store, {
      maxAccountFailures: 3,
      accountWindowMs: 60_000,
      maxAccountsPerIp: 2,
      stuffingWindowMs: 60_000,
      ipBlockMs: 60_000,
    });

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await throttle.onFailure('amina@exemple.ma', '198.51.100.1');
    }
    await expect(throttle.check('amina@exemple.ma', '203.0.113.9')).resolves.toBe('account_locked');

    await throttle.onFailure('b@x.ma', '198.51.100.1');
    const third = await throttle.onFailure('c@x.ma', '198.51.100.1');
    expect(third.ipBlockedNow).toBe(true);
    await expect(throttle.check('anyone@x.ma', '198.51.100.1')).resolves.toBe('ip_blocked');
    expect(
      await redis.pttl(`sg:login:fail:${LoginThrottle.accountKey('amina@exemple.ma')}`),
    ).toBeGreaterThan(0);
  });

  it('counts MFA attempts and leaves nothing behind for unknown challenges', async () => {
    const challenges = new RedisMfaChallengeStore(redis);
    const id = await challenges.create('u-1', 60_000);

    await expect(challenges.attempt(id)).resolves.toEqual({ userId: 'u-1', attempts: 1 });
    await expect(challenges.attempt(id)).resolves.toEqual({ userId: 'u-1', attempts: 2 });
    await expect(challenges.attempt('unknown')).resolves.toBeNull();
    expect(await redis.exists('sg:mfa:challenge:unknown')).toBe(0);
  });
});

describe('PostgreSQL API keys and policies', () => {
  it('stores API keys and revokes them once', async () => {
    const owner = await new PostgresUserRepository(pool).create(newUser('admin@x.ma', ['admin']));
    const keys = new PostgresApiKeyRepository(pool);
    const key = await keys.create({
      ownerId: owner.id,
      name: 'App',
      prefix: 'abcdefgh',
      secretHmac: Buffer.alloc(32, 1),
      scopes: ['authorize'],
      expiresAt: null,
    });

    await expect(keys.findByPrefix('abcdefgh')).resolves.toMatchObject({
      id: key.id,
      scopes: ['authorize'],
    });
    await expect(keys.revoke(key.id, new Date())).resolves.toBe(true);
    await expect(keys.revoke(key.id, new Date())).resolves.toBe(false);
  });

  it('upserts policies, tells creation from update, and validates rows on read', async () => {
    const owner = await new PostgresUserRepository(pool).create(newUser('admin@x.ma', ['admin']));
    const policies = new PostgresPolicyRepository(pool);
    const policy = PolicySchema.parse({
      id: 'no-self-approval',
      effect: 'deny',
      actions: ['invoice:approve'],
      resources: ['invoice:*'],
      condition: { equals: [{ ref: 'resource.attributes.ownerId' }, { ref: 'subject.id' }] },
    });

    await expect(policies.upsert(policy, owner.id)).resolves.toBe(true);
    await expect(policies.upsert({ ...policy, description: 'updated' }, owner.id)).resolves.toBe(
      false,
    );
    await expect(policies.list()).resolves.toEqual([{ ...policy, description: 'updated' }]);

    await pool.query(`UPDATE policies SET condition = '{"eval": "x"}'`);
    await expect(policies.list()).rejects.toThrow('Stored policy "no-self-approval" is invalid');
    await pool.query('TRUNCATE policies');
  });
});
