import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createTestApp,
  createUser,
  ORIGIN,
  signIn,
  type SignedIn,
  type TestContext,
} from '../../testing/test-app.js';

interface AuditPage {
  items: { id: string; '@timestamp': string; event: { action: string; outcome: string } }[];
  nextCursor: string | null;
}

describe('audit trail (HTTP)', () => {
  let context: TestContext;
  let analyst: SignedIn;

  beforeEach(async () => {
    context = await createTestApp();
    await createUser(context, { email: 'analyst@shieldgate.ma', roles: ['security-analyst'] });
    await createUser(context, { email: 'amina@exemple.ma' });
    await context.app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      headers: { origin: ORIGIN },
      payload: { email: 'amina@exemple.ma', password: 'wrong password!!' },
    });
    analyst = await signIn(context, 'analyst@shieldgate.ma');
    await context.audit.flush();
  });

  afterEach(async () => {
    await context.app.close();
  });

  function search(query: string, as = analyst) {
    return context.app.inject({
      method: 'GET',
      url: `/v1/audit-events${query}`,
      headers: as.headers,
    });
  }

  it('returns the newest events first with ISO timestamps', async () => {
    const page = (await search('')).json<AuditPage>();

    expect(page.items.map((item) => [item.event.action, item.event.outcome])).toEqual([
      ['user.login', 'success'],
      ['user.login', 'failure'],
    ]);
    expect(page.items[0]?.['@timestamp']).toBe('2026-10-20T09:00:00.000Z');
  });

  it('filters by outcome and paginates with a cursor', async () => {
    const failures = (await search('?outcome=failure')).json<AuditPage>();
    const first = (await search('?limit=1')).json<AuditPage>();
    const second = (await search(`?limit=1&cursor=${first.nextCursor ?? ''}`)).json<AuditPage>();

    expect(failures.items).toHaveLength(1);
    expect(first.items[0]?.event.outcome).toBe('success');
    expect(second.items[0]?.event.outcome).toBe('failure');
    expect(second.nextCursor).toBeNull();
  });

  it('only accepts plain values as filters (no operator injection)', async () => {
    expect((await search('?action[$ne]=x')).statusCode).toBe(400);
    expect((await search('?cursor=../../etc')).statusCode).toBe(400);
    expect((await search('?action=user.deleted_everything')).statusCode).toBe(400);
  });

  it('requires the audit:read permission', async () => {
    const member = await signIn(context, 'amina@exemple.ma');

    expect((await search('', member)).statusCode).toBe(403);
  });
});
