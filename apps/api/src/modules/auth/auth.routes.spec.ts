import { afterEach, describe, expect, it } from 'vitest';
import {
  createTestApp,
  createUser,
  ORIGIN,
  signIn,
  STRONG_PASSWORD,
  type TestContext,
  type TestAppOptions,
} from '../../testing/test-app.js';

const MINUTE = 60_000;

describe('authentication (HTTP)', () => {
  let context: TestContext;

  afterEach(async () => {
    await context.app.close();
  });

  async function start(options: TestAppOptions = {}) {
    context = await createTestApp(options);
    await createUser(context, { email: 'amina@exemple.ma' });
    return context;
  }

  function login(
    email: string,
    password: string,
    ip = '203.0.113.10',
    extraHeaders: Record<string, string> = {},
  ) {
    return context.app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      headers: { origin: ORIGIN, ...extraHeaders },
      remoteAddress: ip,
      payload: { email, password },
    });
  }

  function getSession(cookie: string) {
    return context.app.inject({ method: 'GET', url: '/v1/auth/session', headers: { cookie } });
  }

  it('opens a session with a hardened cookie and a CSRF token', async () => {
    await start();

    const response = await login(' Amina@Exemple.MA ', STRONG_PASSWORD);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: 'authenticated',
      user: { email: 'amina@exemple.ma', roles: ['member'] },
      csrfToken: expect.any(String) as unknown,
      mfa: false,
    });
    const cookie = String(response.headers['set-cookie']);
    expect(cookie).toMatch(/^__Host-sg_session=[\w-]{43};/);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toContain('Path=/');
    expect(cookie).not.toContain('Domain');
  });

  it('gives the same answer for an unknown account, a wrong password and a disabled account', async () => {
    await start();
    const disabled = await createUser(context, { email: 'off@exemple.ma' });
    await context.users.update(disabled.id, { status: 'disabled' });

    const responses = await Promise.all([
      login('nobody@exemple.ma', STRONG_PASSWORD),
      login('amina@exemple.ma', 'wrong password!!'),
      login('off@exemple.ma', STRONG_PASSWORD),
    ]);
    await context.audit.flush();

    for (const response of responses) {
      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({
        type: 'about:blank',
        title: 'Unauthorized',
        status: 401,
        detail: 'Invalid e-mail or password',
      });
    }
    expect(context.auditStore.events.map((event) => event.event.reason)).toEqual(
      expect.arrayContaining(['invalid_credentials', 'account_disabled']),
    );
  });

  it('locks an account after 5 failures, silently, then unlocks after the window', async () => {
    await start();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await login('amina@exemple.ma', 'wrong password!!');
    }

    const whileLocked = await login('amina@exemple.ma', STRONG_PASSWORD);
    await context.audit.flush();

    expect(whileLocked.statusCode).toBe(401);
    expect(whileLocked.json()).toMatchObject({ detail: 'Invalid e-mail or password' });
    expect(context.auditStore.actions().filter((action) => action === 'user.locked')).toHaveLength(
      1,
    );
    expect(context.auditStore.events.at(-1)?.event.reason).toBe('account_locked');

    context.clock.advance(15 * MINUTE);
    expect((await login('amina@exemple.ma', STRONG_PASSWORD)).statusCode).toBe(200);
  });

  it('blocks an IP that fails on too many accounts (credential stuffing)', async () => {
    await start({ throttleRules: { maxAccountsPerIp: 3 } });
    const attacker = '198.51.100.66';
    for (const email of ['a@x.ma', 'b@x.ma', 'c@x.ma', 'd@x.ma']) {
      await login(email, 'leaked password 123', attacker);
    }

    const fromAttacker = await login('amina@exemple.ma', STRONG_PASSWORD, attacker);
    const fromElsewhere = await login('amina@exemple.ma', STRONG_PASSWORD, '203.0.113.99');
    await context.audit.flush();

    expect(fromAttacker.statusCode).toBe(429);
    expect(fromElsewhere.statusCode).toBe(200);
    expect(context.auditStore.events).toContainEqual(
      expect.objectContaining({
        event: expect.objectContaining({
          action: 'security.ip_blocked',
          reason: 'credential_stuffing',
        }) as unknown,
        source: { ip: attacker },
      }),
    );
  });

  it('rate limits the login endpoint per IP', async () => {
    await start();
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 11; attempt += 1) {
      statuses.push((await login(`user${attempt}@x.ma`, 'whatever pass', '192.0.2.1')).statusCode);
    }

    expect(statuses.slice(0, 10).every((status) => status === 401)).toBe(true);
    expect(statuses[10]).toBe(429);
  });

  it('replaces any existing session on sign-in (no session fixation)', async () => {
    await start();
    const first = await signIn(context, 'amina@exemple.ma');

    const again = await login('amina@exemple.ma', STRONG_PASSWORD, '203.0.113.10', {
      cookie: first.cookie,
    });

    expect(again.statusCode).toBe(200);

    expect((await getSession(first.cookie)).statusCode).toBe(401);
  });

  it('requires authentication to read the session', async () => {
    await start();

    expect((await getSession('__Host-sg_session=forged')).statusCode).toBe(401);
    expect((await context.app.inject({ method: 'GET', url: '/v1/auth/session' })).statusCode).toBe(
      401,
    );
  });

  it('protects logout with the CSRF token and the Origin header', async () => {
    await start();
    const { cookie, csrfToken, headers } = await signIn(context, 'amina@exemple.ma');
    const logout = (extra: Record<string, string>) =>
      context.app.inject({ method: 'POST', url: '/v1/auth/logout', headers: { cookie, ...extra } });

    expect((await logout({ origin: ORIGIN })).statusCode).toBe(403);
    expect((await logout({ origin: ORIGIN, 'x-csrf-token': 'forged' })).statusCode).toBe(403);
    expect((await logout({ 'x-csrf-token': csrfToken })).statusCode).toBe(403);
    expect(
      (await logout({ origin: 'https://evil.example', 'x-csrf-token': csrfToken })).statusCode,
    ).toBe(403);

    const response = await logout(headers);
    expect(response.statusCode).toBe(204);
    expect(String(response.headers['set-cookie'])).toMatch(/__Host-sg_session=;/);
    expect((await getSession(cookie)).statusCode).toBe(401);
  });

  it('refuses a login posted from another origin', async () => {
    await start();

    const response = await login('amina@exemple.ma', STRONG_PASSWORD, '203.0.113.10', {
      origin: 'https://evil.example',
    });

    expect(response.statusCode).toBe(403);
  });

  it('expires idle sessions after 30 minutes', async () => {
    await start();
    const { cookie } = await signIn(context, 'amina@exemple.ma');

    context.clock.advance(29 * MINUTE);
    expect((await getSession(cookie)).statusCode).toBe(200);
    context.clock.advance(29 * MINUTE);
    expect((await getSession(cookie)).statusCode).toBe(200);
    context.clock.advance(31 * MINUTE);
    expect((await getSession(cookie)).statusCode).toBe(401);
  });

  it('ends even an active session after 12 hours', async () => {
    await start();
    const { cookie } = await signIn(context, 'amina@exemple.ma');

    for (let elapsed = 0; elapsed < 12 * 60 - 20; elapsed += 20) {
      context.clock.advance(20 * MINUTE);
      expect((await getSession(cookie)).statusCode).toBe(200);
    }
    context.clock.advance(20 * MINUTE);
    expect((await getSession(cookie)).statusCode).toBe(401);
  });

  it('validates credentials input before doing any work', async () => {
    await start();

    const response = await context.app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      headers: { origin: ORIGIN },
      payload: { email: 'not-an-email', password: 'x'.repeat(1_000) },
    });

    expect(response.statusCode).toBe(400);
    expect(
      response.json<{ errors: { path: string }[] }>().errors.map((error) => error.path),
    ).toEqual(['email', 'password']);
  });
});
