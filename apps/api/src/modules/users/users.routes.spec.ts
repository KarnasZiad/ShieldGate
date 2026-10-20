import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createTestApp,
  createUser,
  ORIGIN,
  signIn,
  STRONG_PASSWORD,
  type SignedIn,
  type TestContext,
} from '../../testing/test-app.js';

describe('account administration (HTTP)', () => {
  let context: TestContext;
  let admin: SignedIn;
  let analyst: SignedIn;
  let member: SignedIn;
  let memberId: string;

  beforeEach(async () => {
    context = await createTestApp();
    await createUser(context, { email: 'admin@shieldgate.ma', roles: ['admin'] });
    await createUser(context, { email: 'analyst@shieldgate.ma', roles: ['security-analyst'] });
    memberId = (await createUser(context, { email: 'amina@exemple.ma' })).id;
    admin = await signIn(context, 'admin@shieldgate.ma');
    analyst = await signIn(context, 'analyst@shieldgate.ma');
    member = await signIn(context, 'amina@exemple.ma');
  });

  afterEach(async () => {
    await context.app.close();
  });

  function call(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    url: string,
    as: SignedIn,
    payload?: object,
  ) {
    return context.app.inject({
      method,
      url,
      headers: as.headers,
      ...(payload ? { payload } : {}),
    });
  }

  it('enforces permissions per role', async () => {
    expect((await call('GET', '/v1/users', member)).statusCode).toBe(403);
    expect((await call('GET', '/v1/users', analyst)).statusCode).toBe(200);
    expect(
      (
        await call('POST', '/v1/users', analyst, {
          email: 'x@x.ma',
          displayName: 'X',
          password: STRONG_PASSWORD,
        })
      ).statusCode,
    ).toBe(403);
    expect((await context.app.inject({ method: 'GET', url: '/v1/users' })).statusCode).toBe(401);
  });

  it('lists accounts without ever exposing secrets', async () => {
    const response = await call('GET', '/v1/users?limit=2', admin);
    const body = response.json<{ items: Record<string, unknown>[]; nextCursor: string | null }>();

    expect(body.items).toHaveLength(2);
    expect(body.nextCursor).not.toBeNull();
    for (const user of body.items) {
      expect(Object.keys(user).sort()).toEqual([
        'createdAt',
        'displayName',
        'email',
        'id',
        'mfaEnabled',
        'roles',
        'status',
      ]);
    }
  });

  it('creates accounts and enforces the password policy', async () => {
    const created = await call('POST', '/v1/users', admin, {
      email: 'Youssef@Exemple.ma',
      displayName: 'Youssef Alaoui',
      password: STRONG_PASSWORD,
    });
    const weak = await call('POST', '/v1/users', admin, {
      email: 'weak@exemple.ma',
      displayName: 'Weak',
      password: 'Password1234',
    });
    const duplicate = await call('POST', '/v1/users', admin, {
      email: 'amina@exemple.ma',
      displayName: 'Again',
      password: STRONG_PASSWORD,
    });

    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ email: 'youssef@exemple.ma', roles: ['member'] });
    expect(weak.statusCode).toBe(422);
    expect(weak.json()).toMatchObject({ problems: ['common'] });
    expect(duplicate.statusCode).toBe(409);
  });

  it('disabling an account closes its sessions immediately', async () => {
    const response = await call('PATCH', `/v1/users/${memberId}`, admin, { status: 'disabled' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'disabled' });
    expect((await call('GET', '/v1/me', member)).statusCode).toBe(401);
  });

  it('changing roles closes the sessions holding the old permissions', async () => {
    await call('PATCH', `/v1/users/${memberId}`, admin, { roles: ['security-analyst'] });

    expect((await call('GET', '/v1/me', member)).statusCode).toBe(401);
    const again = await signIn(context, 'amina@exemple.ma');
    expect((await call('GET', '/v1/users', again)).statusCode).toBe(200);
  });

  it('unlocks a locked account', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await context.app.inject({
        method: 'POST',
        url: '/v1/auth/login',
        headers: { origin: ORIGIN },
        remoteAddress: '203.0.113.50',
        payload: { email: 'amina@exemple.ma', password: 'wrong password!!' },
      });
    }

    expect((await call('POST', `/v1/users/${memberId}/unlock`, admin)).statusCode).toBe(204);
    await expect(signIn(context, 'amina@exemple.ma')).resolves.toBeDefined();
  });

  it('lets security staff see and revoke the sessions of an account', async () => {
    const sessions = await call('GET', `/v1/users/${memberId}/sessions`, analyst);
    expect(sessions.json()).toHaveLength(1);

    expect((await call('DELETE', `/v1/users/${memberId}/sessions`, analyst)).statusCode).toBe(403);
    const revoked = await call('DELETE', `/v1/users/${memberId}/sessions`, admin);
    await context.audit.flush();

    expect(revoked.json()).toEqual({ revoked: 1 });
    expect((await call('GET', '/v1/me', member)).statusCode).toBe(401);
    expect(context.auditStore.events.at(-1)).toMatchObject({
      event: { action: 'session.revoked' },
      user: { email: 'admin@shieldgate.ma', target: { id: memberId } },
    });
  });

  it('validates identifiers and payloads', async () => {
    expect((await call('GET', '/v1/users/not-a-uuid', admin)).statusCode).toBe(400);
    expect((await call('PATCH', `/v1/users/${memberId}`, admin, {})).statusCode).toBe(400);
    expect(
      (await call('GET', '/v1/users/00000000-0000-4000-8000-000000000000', admin)).statusCode,
    ).toBe(404);
  });

  it('lists the roles', async () => {
    const response = await call('GET', '/v1/roles', admin);

    expect(response.json<{ name: string }[]>().map((role) => role.name)).toEqual([
      'admin',
      'security-analyst',
      'member',
    ]);
  });
});
