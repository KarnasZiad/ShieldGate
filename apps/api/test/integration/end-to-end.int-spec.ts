import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { type App, buildApp } from '../../src/app.js';
import { createDependencies } from '../../src/container.js';
import { createPool } from '../../src/infrastructure/postgres.js';
import { PasswordHasher } from '../../src/modules/users/password-hasher.js';
import { testConfig } from '../../src/testing/config.js';

const ORIGIN = 'https://console.shieldgate.test';
const PASSWORD = 'le thé à la menthe de grand-mère';

/** The real wiring of main.ts, against real PostgreSQL, MongoDB and Redis. */
describe('ShieldGate end to end', () => {
  let app: App;
  let close: () => Promise<void>;

  beforeAll(async () => {
    const config = testConfig({
      DATABASE_URL: inject('postgresUrl'),
      MONGODB_URL: inject('mongoUrl'),
      MONGODB_DATABASE: 'shieldgate_e2e',
      REDIS_URL: inject('redisUrl'),
      // Unexpected errors are logged, so a failure here can be diagnosed from the CI output.
      LOG_LEVEL: 'error',
    });
    // Other suites share these databases: start from known state.
    const pool = createPool(config.DATABASE_URL);
    await pool.query('TRUNCATE users, policies CASCADE');
    await pool.end();

    const created = await createDependencies(config);
    close = created.close;
    app = await buildApp(created.deps);
    await created.deps.users.create({
      email: 'admin@shieldgate.ma',
      displayName: 'Admin',
      passwordHash: await new PasswordHasher().hash(PASSWORD),
      roles: ['admin'],
    });
  });

  afterAll(async () => {
    await app.close();
    await close();
  });

  it('reports every dependency as ready', async () => {
    const response = await app.inject({ method: 'GET', url: '/health/ready' });

    expect(response.json()).toEqual({
      status: 'ok',
      checks: { postgres: 'up', mongodb: 'up', redis: 'up' },
    });
  });

  it('signs in, issues an API key, decides, audits and signs out', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      headers: { origin: ORIGIN },
      payload: { email: 'admin@shieldgate.ma', password: PASSWORD },
    });
    expect(login.statusCode).toBe(200);
    const cookie = String(login.headers['set-cookie']).split(';')[0] ?? '';
    const headers = {
      cookie,
      origin: ORIGIN,
      'x-csrf-token': login.json<{ csrfToken: string }>().csrfToken,
    };

    const policy = await app.inject({
      method: 'PUT',
      url: '/v1/policies/read-invoices',
      headers,
      payload: { effect: 'allow', actions: ['invoice:read'], resources: ['invoice:*'] },
    });
    expect(policy.statusCode).toBe(201);

    const key = await app.inject({
      method: 'POST',
      url: '/v1/api-keys',
      headers,
      payload: { name: 'Invoicing', scopes: ['authorize'] },
    });
    const decision = await app.inject({
      method: 'POST',
      url: '/v1/authorize',
      headers: { authorization: `Bearer ${key.json<{ key: string }>().key}` },
      payload: {
        subject: { id: 'u-1' },
        action: 'invoice:read',
        resource: { type: 'invoice', id: '7' },
      },
    });
    expect(decision.json()).toMatchObject({ decision: 'allow', policyId: 'read-invoices' });

    const logout = await app.inject({ method: 'POST', url: '/v1/auth/logout', headers });
    expect(logout.statusCode).toBe(204);
    expect(
      (await app.inject({ method: 'GET', url: '/v1/me', headers: { cookie } })).statusCode,
    ).toBe(401);
  });

  it('writes the audit trail to MongoDB', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      headers: { origin: ORIGIN },
      payload: { email: 'admin@shieldgate.ma', password: PASSWORD },
    });
    const cookie = String(login.headers['set-cookie']).split(';')[0] ?? '';

    // The logger flushes every second.
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    const events = await app.inject({
      method: 'GET',
      url: '/v1/audit-events?limit=100',
      headers: { cookie },
    });
    const actions = events
      .json<{ items: { event: { action: string } }[] }>()
      .items.map((item) => item.event.action);

    expect(actions).toEqual(
      expect.arrayContaining([
        'user.login',
        'policy.changed',
        'api_key.created',
        'authz.decision',
        'user.logout',
      ]),
    );
  });
});
