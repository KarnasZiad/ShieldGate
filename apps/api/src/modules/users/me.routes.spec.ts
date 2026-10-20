import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, createUser, signIn, type TestContext } from '../../testing/test-app.js';

interface SessionView {
  id: string;
  current: boolean;
  ip: string;
}

describe('self-service (HTTP)', () => {
  let context: TestContext;

  beforeEach(async () => {
    context = await createTestApp();
    await createUser(context, { email: 'amina@exemple.ma' });
    await createUser(context, { email: 'youssef@exemple.ma' });
  });

  afterEach(async () => {
    await context.app.close();
  });

  it('returns the profile of the signed-in user', async () => {
    const { headers } = await signIn(context, 'amina@exemple.ma');

    const response = await context.app.inject({ method: 'GET', url: '/v1/me', headers });

    expect(response.json()).toMatchObject({ email: 'amina@exemple.ma', mfaEnabled: false });
  });

  it('lists the sessions of the user and flags the current one', async () => {
    const laptop = await signIn(context, 'amina@exemple.ma', undefined, '203.0.113.1');
    await signIn(context, 'amina@exemple.ma', undefined, '203.0.113.2');

    const response = await context.app.inject({
      method: 'GET',
      url: '/v1/me/sessions',
      headers: laptop.headers,
    });
    const sessions = response.json<SessionView[]>();

    expect(sessions).toHaveLength(2);
    expect(sessions.find((session) => session.current)?.ip).toBe('203.0.113.1');
  });

  it('closes another session of the user, effective immediately', async () => {
    const laptop = await signIn(context, 'amina@exemple.ma', undefined, '203.0.113.1');
    const phone = await signIn(context, 'amina@exemple.ma', undefined, '203.0.113.2');
    const sessions = (
      await context.app.inject({ method: 'GET', url: '/v1/me/sessions', headers: laptop.headers })
    ).json<SessionView[]>();
    const phoneSession = sessions.find((session) => !session.current);

    const response = await context.app.inject({
      method: 'DELETE',
      url: `/v1/me/sessions/${phoneSession?.id ?? ''}`,
      headers: laptop.headers,
    });

    expect(response.statusCode).toBe(204);
    expect(
      (await context.app.inject({ method: 'GET', url: '/v1/me', headers: phone.headers }))
        .statusCode,
    ).toBe(401);
    expect(
      (await context.app.inject({ method: 'GET', url: '/v1/me', headers: laptop.headers }))
        .statusCode,
    ).toBe(200);
  });

  it("cannot close another user's session (reported as missing)", async () => {
    const amina = await signIn(context, 'amina@exemple.ma');
    const youssef = await signIn(context, 'youssef@exemple.ma');
    const [youssefSession] = (
      await context.app.inject({ method: 'GET', url: '/v1/me/sessions', headers: youssef.headers })
    ).json<SessionView[]>();

    const response = await context.app.inject({
      method: 'DELETE',
      url: `/v1/me/sessions/${youssefSession?.id ?? ''}`,
      headers: amina.headers,
    });

    expect(response.statusCode).toBe(404);
    expect(
      (await context.app.inject({ method: 'GET', url: '/v1/me', headers: youssef.headers }))
        .statusCode,
    ).toBe(200);
  });
});
