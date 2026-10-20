import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createTestApp,
  createUser,
  signIn,
  type SignedIn,
  type TestContext,
} from '../../testing/test-app.js';

const DAY_MS = 86_400_000;

describe('API keys (HTTP)', () => {
  let context: TestContext;
  let admin: SignedIn;

  beforeEach(async () => {
    context = await createTestApp();
    await createUser(context, { email: 'admin@shieldgate.ma', roles: ['admin'] });
    await createUser(context, { email: 'amina@exemple.ma' });
    admin = await signIn(context, 'admin@shieldgate.ma');
  });

  afterEach(async () => {
    await context.app.close();
  });

  async function createKey(payload: object = { name: 'Back-office', scopes: ['authorize'] }) {
    const response = await context.app.inject({
      method: 'POST',
      url: '/v1/api-keys',
      headers: admin.headers,
      payload,
    });
    return { response, key: response.json<{ key: string; id: string }>() };
  }

  function authorizeWith(token: string) {
    return context.app.inject({
      method: 'POST',
      url: '/v1/authorize',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        subject: { id: 'u-42', roles: [] },
        action: 'invoice:read',
        resource: { type: 'invoice', id: 'inv-1' },
      },
    });
  }

  it('shows the key once and stores only its HMAC', async () => {
    const { response, key } = await createKey();

    expect(response.statusCode).toBe(201);
    expect(key.key).toMatch(/^sg_live_[a-z2-7]{8}_[\w-]{43}$/);
    const stored = context.apiKeys.keys[0];
    expect(stored?.secretHmac).toHaveLength(32);
    expect(JSON.stringify(stored)).not.toContain(key.key.split('_').slice(3).join('_'));

    const listed = await context.app.inject({
      method: 'GET',
      url: '/v1/api-keys',
      headers: admin.headers,
    });
    expect(listed.json<object[]>()[0]).not.toHaveProperty('key');
    expect(listed.json<object[]>()[0]).not.toHaveProperty('secretHmac');
  });

  it('authenticates a valid key and records its last use', async () => {
    const { key } = await createKey();

    expect((await authorizeWith(key.key)).statusCode).toBe(200);
    expect(context.apiKeys.keys[0]?.lastUsedAt).toBeInstanceOf(Date);
  });

  it('writes last_used_at at most once a minute', async () => {
    const { key } = await createKey();

    await authorizeWith(key.key);
    await authorizeWith(key.key);
    context.clock.advance(60_000);
    await authorizeWith(key.key);

    expect(context.apiKeys.usageWrites).toBe(2);
  });

  it.each([
    ['a malformed key', 'not-a-key'],
    ['an unknown prefix', 'sg_live_aaaaaaaa_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'],
  ])('rejects %s', async (_label, token) => {
    expect((await authorizeWith(token)).statusCode).toBe(401);
  });

  it('rejects a key whose secret was tampered with', async () => {
    const { key } = await createKey();
    const tampered = `${key.key.slice(0, -1)}${key.key.endsWith('A') ? 'B' : 'A'}`;

    expect((await authorizeWith(tampered)).statusCode).toBe(401);
  });

  it('revokes a key immediately', async () => {
    const { key } = await createKey();

    const revoked = await context.app.inject({
      method: 'DELETE',
      url: `/v1/api-keys/${key.id}`,
      headers: admin.headers,
    });

    expect(revoked.statusCode).toBe(204);
    expect((await authorizeWith(key.key)).statusCode).toBe(401);
    const again = await context.app.inject({
      method: 'DELETE',
      url: `/v1/api-keys/${key.id}`,
      headers: admin.headers,
    });
    expect(again.statusCode).toBe(404);
  });

  it('stops accepting a key after its expiry', async () => {
    const { key } = await createKey({ name: 'Partner', scopes: ['authorize'], expiresInDays: 30 });

    context.clock.advance(30 * DAY_MS);

    expect((await authorizeWith(key.key)).statusCode).toBe(401);
  });

  it('requires the api-keys permissions and audits creation and revocation', async () => {
    const member = await signIn(context, 'amina@exemple.ma');
    const forbidden = await context.app.inject({
      method: 'POST',
      url: '/v1/api-keys',
      headers: member.headers,
      payload: { name: 'Mine', scopes: ['authorize'] },
    });
    const { key } = await createKey();
    await context.app.inject({
      method: 'DELETE',
      url: `/v1/api-keys/${key.id}`,
      headers: admin.headers,
    });
    await context.audit.flush();

    expect(forbidden.statusCode).toBe(403);
    expect(context.auditStore.actions()).toEqual(
      expect.arrayContaining(['api_key.created', 'api_key.revoked']),
    );
  });
});
