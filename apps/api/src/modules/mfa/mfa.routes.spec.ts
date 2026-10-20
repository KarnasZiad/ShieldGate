import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { base32Decode } from '../../lib/base32.js';
import { totp } from '../../lib/totp.js';
import {
  createTestApp,
  createUser,
  ORIGIN,
  signIn,
  STRONG_PASSWORD,
  type SignedIn,
  type TestContext,
} from '../../testing/test-app.js';

const STEP_MS = 30_000;

describe('two-factor authentication (HTTP)', () => {
  let context: TestContext;
  let amina: SignedIn;

  beforeEach(async () => {
    context = await createTestApp();
    await createUser(context, { email: 'amina@exemple.ma' });
    amina = await signIn(context, 'amina@exemple.ma');
  });

  afterEach(async () => {
    await context.app.close();
  });

  function post(url: string, payload?: object, headers = amina.headers) {
    return context.app.inject({ method: 'POST', url, headers, ...(payload ? { payload } : {}) });
  }

  async function enroll(): Promise<Buffer> {
    const setup = await post('/v1/me/mfa/totp');
    const { secret, otpauthUri } = setup.json<{ secret: string; otpauthUri: string }>();
    expect(otpauthUri).toContain(`secret=${secret}`);
    const seed = base32Decode(secret);
    expect(
      (await post('/v1/me/mfa/totp/activate', { code: totp(seed, context.clock.now()) }))
        .statusCode,
    ).toBe(204);
    return seed;
  }

  function passwordStep() {
    return context.app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      headers: { origin: ORIGIN },
      payload: { email: 'amina@exemple.ma', password: STRONG_PASSWORD },
    });
  }

  function codeStep(challengeId: string, code: string) {
    return context.app.inject({
      method: 'POST',
      url: '/v1/auth/mfa',
      headers: { origin: ORIGIN },
      payload: { challengeId, code },
    });
  }

  it('enrolls an authenticator only after a valid first code', async () => {
    const setup = await post('/v1/me/mfa/totp');
    const wrong = await post('/v1/me/mfa/totp/activate', { code: '000000' });

    expect(setup.statusCode).toBe(200);
    expect(wrong.statusCode).toBe(422);

    await enroll();
    const me = await context.app.inject({ method: 'GET', url: '/v1/me', headers: amina.headers });
    expect(me.json()).toMatchObject({ mfaEnabled: true });
    expect((await post('/v1/me/mfa/totp')).statusCode).toBe(409);
  });

  it('stores the TOTP seed encrypted', async () => {
    const seed = await enroll();
    const user = await context.users.findByEmail('amina@exemple.ma');

    expect(user?.totpSecret).toBeInstanceOf(Buffer);
    expect(user?.totpSecret?.includes(seed)).toBe(false);
  });

  it('asks for the code after the password, then opens an MFA session', async () => {
    const seed = await enroll();
    context.clock.advance(STEP_MS);

    const first = await passwordStep();
    expect(first.json()).toMatchObject({ status: 'mfa_required', expiresIn: 300 });
    expect(first.headers['set-cookie']).toBeUndefined();

    const { challengeId } = first.json<{ challengeId: string }>();
    const second = await codeStep(challengeId, totp(seed, context.clock.now()));

    expect(second.statusCode).toBe(200);
    expect(second.json()).toMatchObject({ status: 'authenticated', mfa: true });
    expect(String(second.headers['set-cookie'])).toMatch(/^__Host-sg_session=/);
  });

  it('refuses a code that was already used, including the activation code', async () => {
    const seed = await enroll();
    const activationCode = totp(seed, context.clock.now());

    const { challengeId } = (await passwordStep()).json<{ challengeId: string }>();
    expect((await codeStep(challengeId, activationCode)).statusCode).toBe(401);

    context.clock.advance(STEP_MS);
    const freshCode = totp(seed, context.clock.now());
    expect((await codeStep(challengeId, freshCode)).statusCode).toBe(200);

    const { challengeId: next } = (await passwordStep()).json<{ challengeId: string }>();
    expect((await codeStep(next, freshCode)).statusCode).toBe(401);
  });

  it('invalidates the challenge after 5 wrong codes', async () => {
    const seed = await enroll();
    context.clock.advance(STEP_MS);
    const { challengeId } = (await passwordStep()).json<{ challengeId: string }>();

    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect((await codeStep(challengeId, '000000')).statusCode).toBe(401);
    }

    expect((await codeStep(challengeId, totp(seed, context.clock.now()))).statusCode).toBe(401);
  });

  it('expires the challenge after 5 minutes', async () => {
    const seed = await enroll();
    const { challengeId } = (await passwordStep()).json<{ challengeId: string }>();

    context.clock.advance(5 * 60_000);

    const response = await codeStep(challengeId, totp(seed, context.clock.now()));
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ detail: 'Invalid or expired verification' });
  });

  it('requires the password to disable two-factor authentication', async () => {
    await enroll();

    expect(
      (await post('/v1/me/mfa/totp/disable', { password: 'not my password' })).statusCode,
    ).toBe(403);
    expect((await post('/v1/me/mfa/totp/disable', { password: STRONG_PASSWORD })).statusCode).toBe(
      204,
    );
    expect((await passwordStep()).json()).toMatchObject({ status: 'authenticated' });
    await context.audit.flush();
    expect(context.auditStore.actions()).toEqual(
      expect.arrayContaining(['user.mfa_enabled', 'user.mfa_disabled']),
    );
  });
});
